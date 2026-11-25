// Registry of every Bankr launch on Base, read from the chain.
//
// Bankr's public API lists only the 50 latest launches, so the full history comes from Doppler's
// Airlock `Create` events. Bankr mines its token addresses to end in `ba3`, which narrows the
// candidates; a few other deployers mine the same suffix and even set Bankr as the Doppler
// integrator, so each candidate is checked against Bankr's full launch setup
// (src/server/bankrLaunchRules.ts). Rows that fail are flagged `not_bankr` and never listed.
// History is loaded once with scripts/backfill-bankr-launches.mjs + import-bankr-launches.mjs into
// Supabase; this module keeps it current by scanning new blocks, and reads it back page by page.
import { createPublicClient, erc20Abi, http } from 'viem';
import { base } from 'viem/chains';
import { baseRpc } from './baseRpc';
import { runInBackground } from './background';
import { readState, writeState } from './notifyState';
import { checkBankrLaunches } from './bankrLaunchRules';
import { getLocalLaunchIndex, type LocalLaunchIndex } from './localLaunchIndex';
import { BANKR_QUOTE_TOKENS, fromBankrLaunch, WETH_ADDRESS, type BankrCatalogToken } from './bankrTokenCatalog';

export const AIRLOCK = '0x660eaaedebc968f8f3694354fa8ec0b4c5ba8d12';
export const CREATE_TOPIC = '0x68ff1cfcdcf76864161555fc0de1878d8f83ec6949bf351df74d8a4a1a2679ab';
// Doppler integrator of every Bankr launch (shared by all launches Bankr's API confirms).
export const BANKR_INTEGRATOR = '0xf60633d02690e2a15a54ab919925f3d038df163e';
const client = createPublicClient({ chain: base, transport: http('https://base-rpc.publicnode.com', { timeout: 15_000 }) });
const TABLE = 'bankrdex_launches';
const CURSOR_KEY = 'bankr-registry-cursor';
const BLOCK_TIME_MS = 2_000;
// Public RPCs serve recent logs only; older ranges go to an archive-capable gateway.
const RECENT_RANGE = 2_000;
const ARCHIVE_RPC = process.env.BASE_ARCHIVE_RPC || 'https://gateway.tenderly.co/public/base';
const ARCHIVE_RANGE = 1_000;
const MAX_CHUNKS_PER_SYNC = 60;
const SYNC_EVERY_MS = 30_000;
const MEMORY_LIMIT = 20_000;

export interface LaunchRecord {
  address: string;
  quote: string;
  initializer: string;
  block: number;
  txHash: string;
  name?: string | null;
  symbol?: string | null;
  // Result of the launch check (bankrLaunchRules), when this process made it.
  checkReason?: string;
}

interface RpcLog {
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  removed?: boolean;
}

// One Airlock Create log -> launch record, or null when it is not a Bankr (ba3) launch.
export function fromCreateLog(log: RpcLog): LaunchRecord | null {
  if (log.removed || log.topics[0]?.toLowerCase() !== CREATE_TOPIC) return null;
  const address = `0x${log.data.slice(26, 66)}`.toLowerCase();
  if (!/^0x[a-f0-9]{37}ba3$/.test(address)) return null;
  return {
    address,
    quote: `0x${(log.topics[1] ?? '').slice(26)}`.toLowerCase(),
    initializer: `0x${log.data.slice(90, 130)}`.toLowerCase(),
    block: Number.parseInt(log.blockNumber, 16),
    txHash: log.transactionHash.toLowerCase(),
  };
}

// ---- Storage: Supabase when configured, otherwise a bounded in-memory list ------------------

function supabase(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

const headers = (key: string, extra: Record<string, string> = {}): HeadersInit => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  Accept: 'application/json',
  'Content-Type': 'application/json',
  ...extra,
});

interface Row {
  token_address: string;
  quote_address: string;
  initializer: string;
  block_number: number;
  tx_hash: string;
  name: string | null;
  symbol: string | null;
}

const toRow = (record: LaunchRecord) => ({
  token_address: record.address,
  quote_address: record.quote,
  initializer: record.initializer,
  block_number: record.block,
  tx_hash: record.txHash,
  ...(record.name !== undefined ? { name: record.name } : {}),
  ...(record.symbol !== undefined ? { symbol: record.symbol } : {}),
  ...(record.checkReason !== undefined ? { check_reason: record.checkReason, checked_at: new Date().toISOString(), not_bankr: false } : {}),
  updated_at: new Date().toISOString(),
});

const fromRow = (row: Row): LaunchRecord => ({
  address: row.token_address,
  quote: row.quote_address,
  initializer: row.initializer,
  block: Number(row.block_number),
  txHash: row.tx_hash,
  name: row.name,
  symbol: row.symbol,
});

const memory = new Map<string, LaunchRecord>();

async function store(records: LaunchRecord[]): Promise<void> {
  for (const record of records) {
    memory.set(record.address, { ...memory.get(record.address), ...record });
  }
  if (memory.size > MEMORY_LIMIT) {
    const oldest = [...memory.values()].sort((left, right) => left.block - right.block).slice(0, memory.size - MEMORY_LIMIT);
    oldest.forEach((record) => memory.delete(record.address));
  }
  const config = supabase();
  if (!config || records.length === 0) return;
  for (let index = 0; index < records.length; index += 500) {
    const response = await fetch(`${config.url}/rest/v1/${TABLE}?on_conflict=token_address`, {
      method: 'POST',
      headers: headers(config.key, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(records.slice(index, index + 500).map(toRow)),
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Supabase launch registry write failed (${response.status}).`);
  }
}

// ---- Live sync -------------------------------------------------------------------------------

async function archiveLogs(from: number, to: number): Promise<RpcLog[]> {
  const response = await fetch(ARCHIVE_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getLogs',
      params: [{ fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}`, address: AIRLOCK, topics: [CREATE_TOPIC] }],
    }),
    signal: AbortSignal.timeout(20_000),
    cache: 'no-store',
  });
  const payload = await response.json() as { result?: RpcLog[]; error?: unknown };
  if (!payload.result) throw new Error(`Archive getLogs failed: ${JSON.stringify(payload.error).slice(0, 120)}`);
  return payload.result;
}

let lastSyncAt = 0;
let syncing: Promise<void> | null = null;
let headCache: { block: number; at: number } | null = null;

async function headBlock(): Promise<number> {
  if (headCache && Date.now() - headCache.at < 10_000) return headCache.block;
  const block = Number.parseInt(await baseRpc<string>('eth_blockNumber', []), 16);
  headCache = { block, at: Date.now() };
  return block;
}

async function sync(): Promise<void> {
  const head = await headBlock();
  const saved = await readState<number>(CURSOR_KEY);
  // Without a cursor, continue after the local backfill file, or start from the last hour.
  const local = supabase() ? null : await getLocalLaunchIndex();
  let cursor = typeof saved === 'number' && saved > 0 ? saved : local?.scannedTo || head - 1_800;
  for (let chunk = 0; chunk < MAX_CHUNKS_PER_SYNC && cursor < head; chunk += 1) {
    const recent = head - cursor <= RECENT_RANGE;
    const from = cursor + 1;
    const to = Math.min(head, cursor + (recent ? RECENT_RANGE : ARCHIVE_RANGE));
    const logs = recent
      ? await baseRpc<RpcLog[]>('eth_getLogs', [{ fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}`, address: AIRLOCK, topics: [CREATE_TOPIC] }])
      : await archiveLogs(from, to);
    await store(await onlyBankr(logs.flatMap((log) => fromCreateLog(log) ?? [])));
    cursor = to;
    await writeState(CURSOR_KEY, cursor);
  }
}

// Keeps candidates that are Bankr launches (integrator plus Bankr's launch setup). A setup Bankr
// may have started using since (e.g. a new Doppler hook) is confirmed through Bankr's own record.
// Throws when a check cannot be made, so the sync cursor does not move past unchecked launches.
async function onlyBankr(candidates: LaunchRecord[]): Promise<LaunchRecord[]> {
  if (candidates.length === 0) return [];
  const checks = await checkBankrLaunches(client, candidates.map((record) => record.address));
  const confirmed: LaunchRecord[] = [];
  for (const record of candidates) {
    const check = checks.get(record.address);
    if (!check || check.reason === 'unreadable') throw new Error(`Launch check failed for ${record.address}.`);
    if (check.bankr) confirmed.push({ ...record, checkReason: check.reason });
    else if (check.bankr === null && await hasBankrRecord(record.address)) confirmed.push({ ...record, checkReason: `bankr-record:${check.reason}` });
  }
  return confirmed;
}

async function hasBankrRecord(address: string): Promise<boolean> {
  const response = await fetch(`https://api.bankr.bot/token-launches/${address}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'BankrDex/1.0' },
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`Bankr launch lookup failed (${response.status}).`);
  const launch = (await response.json() as { launch?: { chain?: string; status?: string } }).launch;
  return launch?.chain === 'base' && launch.status === 'deployed';
}

// Scans new blocks at most every 30 s; callers never wait on it.
export function syncLaunchRegistry(): void {
  if (syncing || Date.now() - lastSyncAt < SYNC_EVERY_MS) return;
  lastSyncAt = Date.now();
  syncing = sync()
    .catch((error: unknown) => console.error('Bankr launch registry sync failed:', error))
    .finally(() => { syncing = null; });
  runInBackground(() => syncing ?? Promise.resolve());
}

// ---- Names and symbols, read from the token contracts on first display ----------------------


async function fillNames(records: LaunchRecord[]): Promise<LaunchRecord[]> {
  const missing = records.filter((record) => !record.symbol);
  if (missing.length === 0) return records;
  try {
    const results = await client.multicall({
      allowFailure: true,
      contracts: missing.flatMap((record) => [
        { address: record.address as `0x${string}`, abi: erc20Abi, functionName: 'name' as const },
        { address: record.address as `0x${string}`, abi: erc20Abi, functionName: 'symbol' as const },
      ]),
    });
    const clean = (value: unknown, max: number) =>
      typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, '').trim().slice(0, max) || null : null;
    const filled = missing.map((record, index) => ({
      ...record,
      name: clean(results[index * 2]?.result, 80),
      symbol: clean(results[index * 2 + 1]?.result, 32),
    })).filter((record) => record.symbol);
    runInBackground(() => store(filled).catch(() => undefined));
    const byAddress = new Map(filled.map((record) => [record.address, record]));
    return records.map((record) => byAddress.get(record.address) ?? record);
  } catch {
    return records;
  }
}

// ---- Reads -----------------------------------------------------------------------------------

// One launch from the local backfill index, with a name if it was already read once.
function fromLocal(local: LocalLaunchIndex | null, index: number): LaunchRecord | null {
  if (!local || index < 0 || index >= local.count) return null;
  const launch = local.at(index);
  const named = memory.get(launch.address);
  return { ...launch, initializer: '', name: named?.name, symbol: named?.symbol };
}

export interface LaunchListItem {
  address: string;
  name: string | null;
  symbol: string | null;
  quote: string;
  quoteSymbol: string;
  block: number;
  launchedAt: number;
  txHash: string;
}

async function toItems(records: LaunchRecord[]): Promise<LaunchListItem[]> {
  const head = await headBlock().catch(() => 0);
  const withNames = await fillNames(records);
  return withNames.map((record) => ({
    address: record.address,
    name: record.name ?? null,
    symbol: record.symbol ?? null,
    quote: record.quote,
    quoteSymbol: BANKR_QUOTE_TOKENS[record.quote] ?? 'TOKEN',
    block: record.block,
    // Base produces one block every 2 seconds.
    launchedAt: head > 0 ? Date.now() - (head - record.block) * BLOCK_TIME_MS : 0,
    txHash: record.txHash,
  }));
}

let countCache: { total: number; at: number } | null = null;

// Look-alikes found by the launch check (flagged rows), shown next to the list.
let excludedCache: { total: number; at: number } | null = null;
async function countExcluded(config: { url: string; key: string }): Promise<number> {
  if (excludedCache && Date.now() - excludedCache.at < 5 * 60_000) return excludedCache.total;
  const response = await fetch(`${config.url}/rest/v1/${TABLE}?select=token_address&not_bankr=is.true&limit=1`, {
    headers: headers(config.key, { Prefer: 'count=exact' }),
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  });
  const total = Number(response.headers.get('content-range')?.split('/')[1]);
  if (!response.ok || !Number.isFinite(total)) throw new Error(`Supabase excluded count failed (${response.status}).`);
  excludedCache = { total, at: Date.now() };
  return total;
}

async function countSupabase(config: { url: string; key: string }): Promise<number> {
  if (countCache && Date.now() - countCache.at < 60_000) return countCache.total;
  const response = await fetch(`${config.url}/rest/v1/${TABLE}?select=token_address&not_bankr=is.false&limit=1`, {
    headers: headers(config.key, { Prefer: 'count=exact' }),
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  });
  const total = Number(response.headers.get('content-range')?.split('/')[1]);
  if (!response.ok || !Number.isFinite(total)) throw new Error(`Supabase launch count failed (${response.status}).`);
  countCache = { total, at: Date.now() };
  return total;
}

// Newest first. `before` is a block number cursor for the next page; `query` matches an exact
// address or a symbol prefix.
export async function listLaunches(options: { before?: number; limit: number; query?: string }): Promise<{
  launches: LaunchListItem[];
  total: number;
  next: number | null;
  complete: boolean;
  // Tokens that name Bankr as Doppler integrator but fail the launch check (left out).
  excluded: number;
}> {
  syncLaunchRegistry();
  const limit = Math.min(Math.max(options.limit, 1), 100);
  const query = options.query?.trim().toLowerCase() ?? '';
  const isAddress = /^0x[a-f0-9]{40}$/.test(query);
  const config = supabase();
  let records: LaunchRecord[];
  let total: number;
  let complete = Boolean(config);
  let excluded = 0;
  if (config) {
    const params = new URLSearchParams({
      select: 'token_address,quote_address,initializer,block_number,tx_hash,name,symbol',
      order: 'block_number.desc',
      limit: String(limit),
    });
    params.set('not_bankr', 'is.false');
    if (options.before) params.set('block_number', `lt.${options.before}`);
    if (isAddress) params.set('token_address', `eq.${query}`);
    else if (query) params.set('symbol', `ilike.${query.replace(/[%_*,()]/g, '')}*`);
    const response = await fetch(`${config.url}/rest/v1/${TABLE}?${params}`, {
      headers: headers(config.key),
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Supabase launch registry read failed (${response.status}).`);
    records = (await response.json() as Row[]).map(fromRow);
    [total, excluded] = await Promise.all([countSupabase(config).catch(() => -1), countExcluded(config).catch(() => 0)]);
  } else {
    // No Supabase: the local backfill file (if present) plus launches synced since then.
    const local = await getLocalLaunchIndex();
    const newer = [...memory.values()].filter((record) => !local || record.block > local.scannedTo);
    if (isAddress) {
      const known = memory.get(query) ?? fromLocal(local, local?.find(query) ?? -1);
      records = known ? [known] : [];
    } else if (query) {
      // Names are only known for launches already displayed once; symbol search needs Supabase.
      records = [...memory.values()]
        .filter((record) => record.symbol?.toLowerCase().startsWith(query) && (!options.before || record.block < options.before))
        .sort((left, right) => right.block - left.block)
        .slice(0, limit);
    } else {
      records = newer
        .filter((record) => !options.before || record.block < options.before)
        .sort((left, right) => right.block - left.block)
        .slice(0, limit);
      if (local) {
        const end = options.before ? local.lowerBound(options.before) : local.count;
        for (let index = end - 1; index >= 0 && records.length < limit; index -= 1) {
          records.push(fromLocal(local, index)!);
        }
      }
    }
    total = (local?.count ?? 0) + newer.length;
    complete = Boolean(local);
  }
  return {
    launches: await toItems(records),
    total,
    excluded,
    next: records.length === limit ? records[records.length - 1].block : null,
    // Without Supabase or the local backfill file, only launches seen since start are known.
    complete,
  };
}

const bankrMeta = new Map<string, { at: number; launch: Record<string, unknown> | null }>();

// Registry row (if any) plus Bankr's own launch record for one token.
export async function lookupLaunch(address: string): Promise<{
  isBankr: boolean;
  registry: LaunchListItem | null;
  launch: Record<string, unknown> | null;
  // Ready-to-list catalog token (same shape as /api/token-catalog), when one can be built.
  token: BankrCatalogToken | null;
}> {
  const key = address.toLowerCase();
  syncLaunchRegistry();
  let registry: LaunchListItem | null = null;
  const config = supabase();
  if (config) {
    const params = new URLSearchParams({ select: 'token_address,quote_address,initializer,block_number,tx_hash,name,symbol', token_address: `eq.${key}`, not_bankr: 'is.false', limit: '1' });
    const response = await fetch(`${config.url}/rest/v1/${TABLE}?${params}`, { headers: headers(config.key), signal: AbortSignal.timeout(6_000), cache: 'no-store' }).catch(() => null);
    const rows = response?.ok ? await response.json() as Row[] : [];
    if (rows[0]) registry = (await toItems([fromRow(rows[0])]))[0];
  } else {
    const local = memory.has(key) ? null : await getLocalLaunchIndex();
    const record = memory.get(key) ?? fromLocal(local, local?.find(key) ?? -1);
    if (record) registry = (await toItems([record]))[0];
  }
  let cached = bankrMeta.get(key);
  if (!cached || Date.now() - cached.at > 10 * 60_000) {
    try {
      const response = await fetch(`https://api.bankr.bot/token-launches/${key}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'BankrDex/1.0' },
        signal: AbortSignal.timeout(10_000),
        cache: 'no-store',
      });
      const payload = response.ok ? await response.json() as { launch?: Record<string, unknown> } : null;
      cached = { at: Date.now(), launch: response.status === 404 ? null : payload?.launch ?? null };
      if (response.ok || response.status === 404) bankrMeta.set(key, cached);
      if (bankrMeta.size > 5_000) bankrMeta.delete(bankrMeta.keys().next().value as string);
    } catch {
      cached = { at: 0, launch: null };
    }
  }
  const launchToken = cached.launch ? fromBankrLaunch(cached.launch) : null;
  const fromLaunch: BankrCatalogToken | null = launchToken ? { ...launchToken, verifiedBy: registry ? 'registry' : 'bankr-api' } : null;
  const token: BankrCatalogToken | null = fromLaunch ?? (registry?.symbol
    ? {
        address: registry.address,
        name: registry.name || registry.symbol,
        symbol: registry.symbol,
        chain: 'base' as const,
        chainId: 8453,
        quoteAddress: registry.quote || WETH_ADDRESS,
        quoteSymbol: registry.quoteSymbol,
        launchedAt: registry.launchedAt || undefined,
        txHash: registry.txHash,
        verifiedBy: 'registry' as const,
      }
    : null);
  return { isBankr: Boolean(registry || cached.launch), registry, launch: cached.launch, token };
}
