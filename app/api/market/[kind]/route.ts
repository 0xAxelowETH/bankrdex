import {
  getActiveTokens,
  getIndexFreshness,
  getIndexedOhlcv,
  getIndexedStats,
  getIndexedTrades,
  getLaunchRows,
  getPoolForToken,
  getTokenRisk,
  isIndexedTimeframe,
  isMarketIndexConfigured,
} from '../../../../src/server/marketIndex';
import { getBankrToken } from '../../../../src/server/bankrTokenCatalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// On-chain market index for Bankr tokens on Base (scripts/indexer.mjs):
//   GET /api/market/stats?tokens=0x..,0x..        price, changes, volume, buys/sells, traders
//   GET /api/market/ohlcv?token=0x..&tf=5m&limit=  USD candles
//   GET /api/market/trades?token=0x..&limit=&trader=0x..
//   GET /api/market/risk?token=0x..               snipers, bundles, dev / sniper holdings
//   GET /api/market/pulse?minutes=60&limit=100    most active tokens, with names
//   GET /api/market/pool?token=0x..               Uniswap V4 pool key parts for direct swaps
//   GET /api/market/freshness                     how far the index is behind the chain
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const CACHE_MS: Record<string, number> = { stats: 3_000, ohlcv: 5_000, trades: 2_000, risk: 30_000, pulse: 3_000, pool: 300_000, freshness: 10_000 };
const cache = new Map<string, { at: number; body: unknown }>();

const bad = (message: string, status = 400) => Response.json({ error: message }, { status });

async function handle(kind: string, params: URLSearchParams): Promise<unknown> {
  const token = (params.get('token') ?? '').toLowerCase();
  switch (kind) {
    case 'stats': {
      const tokens = (params.get('tokens') ?? '').toLowerCase().split(',').filter((value) => ADDRESS.test(value));
      if (tokens.length === 0 || tokens.length > 200) throw new RangeError('Provide 1 to 200 token addresses.');
      return { stats: await getIndexedStats(tokens) };
    }
    case 'ohlcv': {
      const timeframe = params.get('tf') ?? '5m';
      if (!ADDRESS.test(token) || !isIndexedTimeframe(timeframe)) throw new RangeError('Provide a token and a timeframe (1m, 5m, 15m, 1h, 4h, 1D).');
      return { candles: await getIndexedOhlcv(token, timeframe, Number(params.get('limit') ?? 200)) };
    }
    case 'trades': {
      if (!ADDRESS.test(token)) throw new RangeError('Provide a token address.');
      return { trades: await getIndexedTrades(token, Number(params.get('limit') ?? 50), params.get('trader') ?? undefined) };
    }
    case 'risk': {
      if (!ADDRESS.test(token)) throw new RangeError('Provide a token address.');
      const [catalogToken, launch] = await Promise.all([
        getBankrToken(token, 'base').catch(() => null),
        getLaunchRows([token]).then((rows) => rows[0]).catch(() => undefined),
      ]);
      return { risk: await getTokenRisk(token, catalogToken?.creator, launch?.block_number) };
    }
    case 'pulse': {
      const minutes = Number(params.get('minutes') ?? 60);
      const limit = Number(params.get('limit') ?? 100);
      const active = await getActiveTokens(minutes, limit);
      const launches = new Map((await getLaunchRows(active.map((row) => row.token_address))).map((row) => [row.token_address, row]));
      return {
        tokens: active.map((row) => ({ ...row, ...launches.get(row.token_address) })),
      };
    }
    case 'pool': {
      if (!ADDRESS.test(token)) throw new RangeError('Provide a token address.');
      return { pool: await getPoolForToken(token) };
    }
    case 'freshness':
      return getIndexFreshness();
    default:
      throw new RangeError('Unknown market endpoint.');
  }
}

export async function GET(request: Request, context: { params: Promise<{ kind: string }> }) {
  const { kind } = await context.params;
  if (!isMarketIndexConfigured()) return bad('The on-chain market index is not configured.', 503);
  const params = new URL(request.url).searchParams;
  params.sort();
  const key = `${kind}?${params}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < (CACHE_MS[kind] ?? 3_000)) {
    return Response.json(cached.body, { headers: { 'Cache-Control': 'no-store', 'X-Index-Cache': 'HIT' } });
  }
  try {
    const body = await handle(kind, params);
    cache.set(key, { at: Date.now(), body });
    if (cache.size > 2_000) cache.delete(cache.keys().next().value as string);
    return Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof RangeError) return bad(error.message);
    console.error(`Market index ${kind} failed:`, error);
    return bad('The market index is unavailable.', 502);
  }
}
