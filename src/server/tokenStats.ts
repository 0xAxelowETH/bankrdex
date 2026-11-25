// Holder and burn statistics for one token on any chain Bankr launches on.
//   - holders: GeckoTerminal token info (count + share held by the top 10 wallets)
//   - burned:  balance of the 0x…dEaD burn address, read on-chain
// GeckoTerminal calls share the per-minute budget, so results are cached for a long time and a
// token is simply skipped (holders null) when the budget is spent.
import { CHAINS, type ChainKey } from '../config/chains';
import { chainRpc } from './chainRpc';
import { hasGeckoBudget, recordGeckoCall } from './geckoBudget';

const DEAD_ADDRESS = '000000000000000000000000000000000000dead';
const HOLDERS_FRESH_MS = 30 * 60_000;
const HOLDERS_RETRY_MS = 2 * 60_000;
const BURN_FRESH_MS = 5 * 60_000;
const MAX_ENTRIES = 2_000;

export interface TokenStats {
  address: string;
  chain: ChainKey;
  burnedAmount: string | null;
  burnUpdatedAt: number | null;
  holderCount: number | null;
  // Percent of supply held by the 10 largest wallets.
  top10Share: number | null;
  holdersUpdatedAt: number | null;
}

const holders = new Map<string, { count: number | null; top10: number | null; at: number; ok: boolean }>();
const burns = new Map<string, { amount: string | null; at: number }>();

function remember<T>(map: Map<string, T>, key: string, value: T) {
  map.delete(key);
  map.set(key, value);
  if (map.size > MAX_ENTRIES) map.delete(map.keys().next().value as string);
}

async function readHolders(chain: ChainKey, address: string): Promise<{ count: number | null; top10: number | null } | null> {
  const key = `${chain}:${address}`;
  const cached = holders.get(key);
  const now = Date.now();
  if (cached && now - cached.at < (cached.ok ? HOLDERS_FRESH_MS : HOLDERS_RETRY_MS)) return cached;
  if (!hasGeckoBudget(false)) return cached ?? null;
  recordGeckoCall(false);
  try {
    const response = await fetch(`https://api.geckoterminal.com/api/v2/networks/${CHAINS[chain].geckoNetwork}/tokens/${address}/info`, {
      headers: { Accept: 'application/json;version=20230302', 'User-Agent': 'BankrDex/1.0' },
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`GeckoTerminal token info failed (${response.status}).`);
    const payload = await response.json() as { data?: { attributes?: { holders?: { count?: unknown; distribution_percentage?: { top_10?: unknown } } } } };
    const info = payload.data?.attributes?.holders;
    const count = Number(info?.count);
    const top10 = Number(info?.distribution_percentage?.top_10);
    const result = {
      count: Number.isSafeInteger(count) && count >= 0 ? count : null,
      top10: Number.isFinite(top10) && top10 >= 0 && top10 <= 100 ? top10 : null,
    };
    remember(holders, key, { ...result, at: Date.now(), ok: true });
    return result;
  } catch {
    remember(holders, key, { count: cached?.count ?? null, top10: cached?.top10 ?? null, at: Date.now(), ok: false });
    return cached ?? null;
  }
}

async function readBurn(chain: ChainKey, address: string): Promise<string | null> {
  const key = `${chain}:${address}`;
  const cached = burns.get(key);
  if (cached && Date.now() - cached.at < BURN_FRESH_MS) return cached.amount;
  try {
    const [raw, decimalsHex] = await Promise.all([
      chainRpc<string>(chain, 'eth_call', [{ to: address, data: `0x70a08231${DEAD_ADDRESS.padStart(64, '0')}` }, 'latest']),
      chainRpc<string>(chain, 'eth_call', [{ to: address, data: '0x313ce567' }, 'latest']).catch(() => '0x12'),
    ]);
    const balance = /^0x[0-9a-f]+$/i.test(raw) ? BigInt(raw) : 0n;
    const decimals = Math.min(36, Number.parseInt(decimalsHex, 16) || 18);
    const amount = (Number(balance) / 10 ** decimals).toString();
    remember(burns, key, { amount, at: Date.now() });
    return amount;
  } catch {
    return cached?.amount ?? null;
  }
}

export async function getTokenStats(address: string, chain: ChainKey = 'base'): Promise<TokenStats> {
  const normalized = address.toLowerCase();
  const key = `${chain}:${normalized}`;
  const [holderInfo, burnedAmount] = await Promise.all([readHolders(chain, normalized), readBurn(chain, normalized)]);
  return {
    address: normalized,
    chain,
    burnedAmount,
    burnUpdatedAt: burns.get(key)?.at ?? null,
    holderCount: holderInfo?.count ?? null,
    top10Share: holderInfo?.top10 ?? null,
    holdersUpdatedAt: holders.get(key)?.ok ? holders.get(key)!.at : null,
  };
}
