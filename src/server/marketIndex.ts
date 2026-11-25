// Reads the on-chain market index (scripts/indexer.mjs) for Bankr tokens on Base: per-token stats,
// candles, trades, launch-time risk signals and the most active tokens. All data comes from
// Postgres (local Supabase or a hosted one); null when it is not configured.
import { createPublicClient, erc20Abi, http } from 'viem';
import { base } from 'viem/chains';
import { baseRpc } from './baseRpc';

// Bankr launches mint a fixed 100B supply.
export const BANKR_TOTAL_SUPPLY = 100_000_000_000;
const ADDRESS = /^0x[a-f0-9]{40}$/;

function supabase(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

export const isMarketIndexConfigured = () => supabase() !== null;

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const config = supabase();
  if (!config) throw new Error('The market index is not configured.');
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json', Accept: 'application/json', ...init.headers },
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Market index request failed (${response.status}).`);
  return response.json() as Promise<T>;
}
const rpc = <T>(name: string, body: unknown) => rest<T>(`rpc/${name}`, { method: 'POST', body: JSON.stringify(body) });

export interface IndexedStats {
  token_address: string;
  price_usd: number | null;
  price_quote: number | null;
  change_5m: number | null;
  change_1h: number | null;
  change_24h: number | null;
  volume_5m: number;
  volume_1h: number;
  volume_24h: number;
  buys_5m: number;
  sells_5m: number;
  buys_1h: number;
  sells_1h: number;
  buys_24h: number;
  sells_24h: number;
  traders_24h: number;
  last_trade_at: string | null;
  first_trade_at: string | null;
  market_cap_usd: number | null;
}

export async function getIndexedStats(addresses: string[]): Promise<IndexedStats[]> {
  const list = [...new Set(addresses.map((address) => address.toLowerCase()).filter((address) => ADDRESS.test(address)))].slice(0, 200);
  if (list.length === 0) return [];
  const rows = await rpc<Omit<IndexedStats, 'market_cap_usd'>[]>('bankrdex_token_stats', { addresses: list });
  return rows.map((row) => ({ ...row, market_cap_usd: row.price_usd ? row.price_usd * BANKR_TOTAL_SUPPLY : null }));
}

const TIMEFRAMES: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3_600, '4h': 14_400, '1D': 86_400 };
export const isIndexedTimeframe = (value: string) => value in TIMEFRAMES;

export async function getIndexedOhlcv(token: string, timeframe: string, limit: number) {
  const rows = await rpc<{ bucket: number; open: number; high: number; low: number; close: number; volume: number }[]>('bankrdex_ohlcv', {
    p_token: token.toLowerCase(),
    p_bucket_seconds: TIMEFRAMES[timeframe] ?? 300,
    p_limit: Math.min(Math.max(limit, 1), 500),
  });
  return rows.reverse();
}

export interface IndexedTrade {
  block_number: number;
  log_index: number;
  tx_hash: string;
  trader: string | null;
  is_buy: boolean;
  token_amount: number;
  quote_amount: number;
  price_usd: number | null;
  volume_usd: number | null;
  ts: string;
}

export async function getIndexedTrades(token: string, limit: number, trader?: string): Promise<IndexedTrade[]> {
  const params = new URLSearchParams({
    select: 'block_number,log_index,tx_hash,trader,is_buy,token_amount,quote_amount,price_usd,volume_usd,ts',
    token_address: `eq.${token.toLowerCase()}`,
    order: 'block_number.desc,log_index.desc',
    limit: String(Math.min(Math.max(limit, 1), 200)),
  });
  if (trader && ADDRESS.test(trader.toLowerCase())) params.set('trader', `eq.${trader.toLowerCase()}`);
  return rest<IndexedTrade[]>(`bankrdex_swaps?${params}`);
}

export async function getActiveTokens(minutes: number, limit: number) {
  return rpc<{ token_address: string; trades: number; buys: number; volume_usd: number; last_trade_at: string; pool_id: string }[]>('bankrdex_active_tokens', {
    p_minutes: Math.min(Math.max(minutes, 1), 1_440),
    p_limit: Math.min(Math.max(limit, 1), 1_000),
  });
}

// Names and launch data for tokens the indexer has seen trade (registry rows that passed the
// Bankr launch check; flagged look-alikes are never returned).
// How far the on-chain index (scripts/indexer.mjs) is behind the chain: its saved cursor block
// against the Base head (2 s blocks), and when it last saved it.
export interface IndexFreshness {
  block: number | null;
  head: number | null;
  lagSeconds: number | null;
  updatedAt: string | null;
}

export async function getIndexFreshness(): Promise<IndexFreshness> {
  const [rows, head] = await Promise.all([
    rest<{ value: unknown; updated_at: string }[]>('bankrdex_notify_state?select=value,updated_at&key=eq.indexer-cursor'),
    baseRpc<string>('eth_blockNumber', []).then((value) => Number.parseInt(value, 16)).catch(() => null),
  ]);
  const block = typeof rows[0]?.value === 'number' ? rows[0].value : null;
  return {
    block,
    head,
    lagSeconds: block !== null && head ? Math.max(0, (head - block) * 2) : null,
    updatedAt: rows[0]?.updated_at ?? null,
  };
}

export async function getLaunchRows(addresses: string[]) {
  const list = [...new Set(addresses.map((address) => address.toLowerCase()).filter((address) => ADDRESS.test(address)))];
  const rows: { token_address: string; name: string | null; symbol: string | null; quote_address: string; block_number: number; tx_hash: string }[] = [];
  for (let index = 0; index < list.length; index += 150) {
    rows.push(...await rest<typeof rows>(`bankrdex_launches?select=token_address,name,symbol,quote_address,block_number,tx_hash&not_bankr=is.false&token_address=in.(${list.slice(index, index + 150).join(',')})`));
  }
  return rows;
}

export async function getPoolForToken(token: string) {
  const rows = await rest<{ pool_id: string; quote_address: string; token_is_currency0: boolean; hooks: string | null }[]>(
    `bankrdex_pool_map?select=pool_id,quote_address,token_is_currency0,hooks&token_address=eq.${token.toLowerCase()}`,
  );
  if (rows.length <= 1) return rows[0] ?? null;
  // Two candidate pools per launch: the one with indexed swaps is the real one.
  const traded = await rest<{ pool_id: string }[]>(`bankrdex_swaps?select=pool_id&token_address=eq.${token.toLowerCase()}&limit=1`);
  return rows.find((row) => row.pool_id === traded[0]?.pool_id) ?? null;
}

// ---- Risk ------------------------------------------------------------------------------------

const client = createPublicClient({ chain: base, transport: http('https://base-rpc.publicnode.com', { timeout: 15_000, retryCount: 2 }) });

export interface TokenRisk {
  firstTradeBlock: number | null;
  snipers: number;
  sniperHoldingPct: number | null;
  bundledBuys: number;
  buyers: number;
  sellers: number;
  devHoldingPct: number | null;
  burnedPct: number | null;
  // True when the indexer started after the token's first trades: early-trade signals are partial.
  partialHistory: boolean;
}

export async function getTokenRisk(token: string, creator?: string, launchBlock?: number): Promise<TokenRisk> {
  const address = token.toLowerCase();
  const [risk] = await rpc<{ first_block: number | null; sniper_wallets: string[]; bundled_txs: number; buyers: number; sellers: number }[]>('bankrdex_token_risk', { p_token: address });
  const snipers = (risk?.sniper_wallets ?? []).filter((wallet) => ADDRESS.test(wallet));
  const holders = [...snipers, ...(creator && ADDRESS.test(creator.toLowerCase()) ? [creator.toLowerCase()] : []), '0x000000000000000000000000000000000000dead'];
  let balances: (bigint | null)[] = [];
  try {
    const results = await client.multicall({
      allowFailure: true,
      contracts: holders.map((holder) => ({ address: address as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf' as const, args: [holder as `0x${string}`] })),
    });
    balances = results.map((result) => result.status === 'success' ? result.result as bigint : null);
  } catch {
    balances = holders.map(() => null);
  }
  const pct = (raw: bigint | null | undefined) => raw === null || raw === undefined ? null : Number(raw) / 1e18 / BANKR_TOTAL_SUPPLY * 100;
  const sniperBalances = balances.slice(0, snipers.length);
  const sniperHoldingPct = snipers.length === 0 ? 0 : sniperBalances.every((balance) => balance !== null)
    ? sniperBalances.reduce((sum, balance) => sum + pct(balance)!, 0)
    : null;
  const devIndex = creator ? snipers.length : -1;
  return {
    firstTradeBlock: risk?.first_block ?? null,
    snipers: snipers.length,
    sniperHoldingPct,
    bundledBuys: risk?.bundled_txs ?? 0,
    buyers: risk?.buyers ?? 0,
    sellers: risk?.sellers ?? 0,
    devHoldingPct: devIndex >= 0 ? pct(balances[devIndex]) : null,
    burnedPct: pct(balances[balances.length - 1]),
    partialHistory: Boolean(launchBlock && risk?.first_block && risk.first_block > launchBlock + 5),
  };
}
