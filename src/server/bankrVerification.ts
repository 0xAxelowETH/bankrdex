// Decides whether a catalog token really is a Bankr launch. GeckoTerminal's "bankr" dexes list every
// Doppler pool that uses the same hooks, including other launchpads, so every token is checked
// before it is listed:
//   official   BNKR, Bankr's own coin
//   bankr-api  Bankr's launch record (token-launches list or lookup) on the same chain
//   registry   Base: the on-chain launch registry (Airlock Create + Bankr integrator)
//   onchain    Base: Bankr's integrator and Bankr's launch setup (src/server/bankrLaunchRules.ts);
//              other chains: Airlock.getAssetData(token).integrator is Bankr's
//   suffix     (negative only) the address lacks the `ba3` suffix Bankr mines for every launch
// Verdicts live in memory and in Supabase (bankrdex_token_verification). Tokens that cannot be
// decided yet stay hidden and are retried later.
import { createPublicClient, fallback, http, parseAbi, type Chain } from 'viem';
import { base, robinhood } from 'viem/chains';
import { CHAINS, type ChainKey } from '../config/chains';
import { BANKR_INTEGRATOR, BNKR_TOKEN, DOPPLER_AIRLOCK, hasBankrSuffix } from '../config/bankrDoppler';
import { getLaunchRows, isMarketIndexConfigured } from './marketIndex';
import { checkBankrLaunches } from './bankrLaunchRules';
import type { BankrCatalogToken } from './bankrTokenCatalog';

export type VerifyMethod = 'official' | 'bankr-api' | 'registry' | 'onchain' | 'suffix';
export interface Verdict {
  bankr: boolean;
  method: VerifyMethod;
}

const BANKR_API = 'https://api.bankr.bot';
const TABLE = 'bankrdex_token_verification';
const UNKNOWN_RETRY_MS = 10 * 60_000;
const NO_RECORD_RETRY_MS = 6 * 60 * 60_000;
const API_CONCURRENCY = 4;

const CHAIN_BACKOFF_MS = 10 * 60_000;
const verdicts = new Map<string, Verdict>();
const retryAt = new Map<string, number>();
// Chains whose RPC failed recently are skipped, so a busy RPC never slows the catalog down.
const chainDownUntil = new Map<ChainKey, number>();
let loaded: Promise<void> | null = null;

export const verdictKey = (chain: ChainKey, address: string) => `${chain}:${address.toLowerCase()}`;
export const verdictOf = (chain: ChainKey, address: string): Verdict | undefined => verdicts.get(verdictKey(chain, address));
export const isVerifiedBankr = (chain: ChainKey, address: string) => verdictOf(chain, address)?.bankr === true;

function supabase(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  const config = supabase();
  if (!config) throw new Error('Supabase is not configured.');
  return fetch(`${config.url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json', Accept: 'application/json', ...init.headers },
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  });
}

function loadVerdicts(): Promise<void> {
  loaded ??= (async () => {
    if (!supabase()) return;
    for (let offset = 0; ; offset += 1_000) {
      const response = await rest(`${TABLE}?select=token_key,is_bankr,method&order=token_key.asc&limit=1000&offset=${offset}`);
      if (!response.ok) throw new Error(`Verification read failed (${response.status}).`);
      const rows = await response.json() as { token_key: string; is_bankr: boolean; method: VerifyMethod }[];
      for (const row of rows) verdicts.set(row.token_key, { bankr: row.is_bankr, method: row.method });
      if (rows.length < 1_000) return;
    }
  })().catch((error: unknown) => {
    console.warn('Token verification cache unavailable:', error instanceof Error ? error.message : error);
    loaded = null;
  });
  return loaded ?? Promise.resolve();
}

async function saveVerdicts(entries: [string, Verdict][]): Promise<void> {
  if (!supabase() || entries.length === 0) return;
  const checkedAt = new Date().toISOString();
  const rows = entries.map(([key, verdict]) => ({ token_key: key, is_bankr: verdict.bankr, method: verdict.method, checked_at: checkedAt }));
  for (let index = 0; index < rows.length; index += 500) {
    const response = await rest(`${TABLE}?on_conflict=token_key`, {
      method: 'POST',
      body: JSON.stringify(rows.slice(index, index + 500)),
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    });
    if (!response.ok) console.warn(`Token verification write failed (${response.status}).`);
  }
}

// ---- Sources ---------------------------------------------------------------------------------

const VIEM_CHAINS: Partial<Record<ChainKey, Chain>> = { base, robinhood };
const airlockAbi = parseAbi(['function getAssetData(address asset) view returns (address, address, address, address, address, address, address, uint256, uint256, address integrator)']);
const clients = new Map<ChainKey, ReturnType<typeof createPublicClient>>();

function clientFor(chain: ChainKey) {
  const viemChain = VIEM_CHAINS[chain];
  if (!viemChain) return null;
  let client = clients.get(chain);
  if (!client) {
    client = createPublicClient({
      chain: viemChain,
      transport: fallback(CHAINS[chain].rpcUrls.map((url) => http(url, { timeout: 8_000, retryCount: 0 }))),
    });
    clients.set(chain, client);
  }
  return client;
}

// Base: the full launch check (integrator plus Bankr's launch setup). null = undecided.
async function baseLaunchChecks(addresses: string[]): Promise<Map<string, boolean | null>> {
  const result = new Map<string, boolean | null>(addresses.map((address) => [address, null]));
  const client = clientFor('base');
  if (!client || addresses.length === 0 || (chainDownUntil.get('base') ?? 0) > Date.now()) return result;
  try {
    const checks = await checkBankrLaunches(client, addresses);
    for (const [address, check] of checks) result.set(address, check.bankr);
  } catch {
    chainDownUntil.set('base', Date.now() + CHAIN_BACKOFF_MS);
  }
  return result;
}

// Integrator per token; null when the chain could not be read.
async function onchainIntegrators(chain: ChainKey, addresses: string[]): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>(addresses.map((address) => [address, null]));
  const airlock = DOPPLER_AIRLOCK[chain];
  const client = clientFor(chain);
  if (!airlock || !client || addresses.length === 0 || (chainDownUntil.get(chain) ?? 0) > Date.now()) return result;
  for (let index = 0; index < addresses.length; index += 200) {
    const batch = addresses.slice(index, index + 200);
    try {
      const reads = await client.multicall({
        allowFailure: true,
        contracts: batch.map((address) => ({ address: airlock as `0x${string}`, abi: airlockAbi, functionName: 'getAssetData' as const, args: [address as `0x${string}`] })),
      });
      batch.forEach((address, position) => {
        const read = reads[position];
        if (read.status === 'success') result.set(address, String(read.result[9]).toLowerCase());
      });
    } catch {
      // RPC unreachable or busy: leave the rest undecided and stop asking this chain for a while.
      chainDownUntil.set(chain, Date.now() + CHAIN_BACKOFF_MS);
      break;
    }
  }
  return result;
}

// true: Bankr has a deployed launch record for this token on this chain; false: it has none;
// null: the API could not be reached.
async function bankrRecord(chain: ChainKey, address: string): Promise<boolean | null> {
  try {
    const response = await fetch(`${BANKR_API}/token-launches/${address}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'BankrDex/1.0' },
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
    if (response.status === 404) return false;
    if (!response.ok) return null;
    const launch = (await response.json() as { launch?: { chain?: string; status?: string; tokenAddress?: string } }).launch;
    return Boolean(launch && launch.chain === chain && launch.status === 'deployed' && launch.tokenAddress?.toLowerCase() === address);
  } catch {
    return null;
  }
}

// ---- Verification ----------------------------------------------------------------------------

// Decides every token that has no verdict yet (and is not waiting for a retry). Bankr API lookups
// are capped per call; undecided tokens are picked up by the next call.
export async function verifyTokens(tokens: BankrCatalogToken[], apiBudget = 80): Promise<void> {
  await loadVerdicts();
  const now = Date.now();
  const fresh: [string, Verdict][] = [];
  const decide = (token: BankrCatalogToken, verdict: Verdict) => {
    const key = verdictKey(token.chain, token.address);
    verdicts.set(key, verdict);
    retryAt.delete(key);
    fresh.push([key, verdict]);
  };
  let pending = tokens.filter((token) => {
    const key = verdictKey(token.chain, token.address);
    return !verdicts.has(key) && (retryAt.get(key) ?? 0) <= now;
  });
  if (pending.length === 0) return;

  pending = pending.filter((token) => {
    if (token.chain === 'base' && token.address === BNKR_TOKEN) { decide(token, { bankr: true, method: 'official' }); return false; }
    // Records from Bankr's own token-launches list carry the launch type.
    if (token.launchType) { decide(token, { bankr: true, method: 'bankr-api' }); return false; }
    return true;
  });

  const baseCandidates = pending.filter((token) => token.chain === 'base').map((token) => token.address);
  if (baseCandidates.length > 0 && isMarketIndexConfigured()) {
    try {
      const registered = new Set((await getLaunchRows(baseCandidates)).map((row) => row.token_address));
      pending = pending.filter((token) => {
        if (token.chain === 'base' && registered.has(token.address)) { decide(token, { bankr: true, method: 'registry' }); return false; }
        return true;
      });
    } catch {
      // Registry unavailable: the on-chain check below decides.
    }
  }

  const baseRemaining = pending.filter((token) => token.chain === 'base').map((token) => token.address);
  if (baseRemaining.length > 0) {
    const checks = await baseLaunchChecks(baseRemaining);
    pending = pending.filter((token) => {
      if (token.chain !== 'base') return true;
      const bankr = checks.get(token.address);
      if (bankr === null || bankr === undefined) return true;
      decide(token, { bankr, method: 'onchain' });
      return false;
    });
  }

  for (const chain of [...new Set(pending.map((token) => token.chain))]) {
    if (!DOPPLER_AIRLOCK[chain] || chain === 'base') continue;
    const integrators = await onchainIntegrators(chain, pending.filter((token) => token.chain === chain).map((token) => token.address));
    pending = pending.filter((token) => {
      if (token.chain !== chain) return true;
      const integrator = integrators.get(token.address);
      if (integrator === null || integrator === undefined) return true;
      decide(token, { bankr: integrator === BANKR_INTEGRATOR, method: 'onchain' });
      return false;
    });
  }

  pending = pending.filter((token) => {
    if (hasBankrSuffix(token.address)) return true;
    decide(token, { bankr: false, method: 'suffix' });
    return false;
  });

  const lookups = pending.slice(0, apiBudget);
  for (let index = 0; index < lookups.length; index += API_CONCURRENCY) {
    const batch = lookups.slice(index, index + API_CONCURRENCY);
    const records = await Promise.all(batch.map((token) => bankrRecord(token.chain, token.address)));
    batch.forEach((token, position) => {
      const record = records[position];
      if (record) decide(token, { bankr: true, method: 'bankr-api' });
      else retryAt.set(verdictKey(token.chain, token.address), now + (record === false ? NO_RECORD_RETRY_MS : UNKNOWN_RETRY_MS));
    });
  }
  await saveVerdicts(fresh);
}

export function verificationLabel(method: VerifyMethod | undefined): string {
  switch (method) {
    case 'official': return 'Bankr’s own token';
    case 'registry': return 'Verified on-chain (Bankr launch registry)';
    case 'onchain': return 'Verified on-chain (Bankr is the Doppler integrator)';
    case 'bankr-api': return 'Verified by Bankr’s launch records';
    default: return 'Not verified';
  }
}
