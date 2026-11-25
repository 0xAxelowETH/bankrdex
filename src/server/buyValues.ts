// USD value of individual Bankr buys, read from the swap event the recent-buys feed points at.
// A confirmed swap never changes, so each result is computed once and kept in memory.
import { baseRpc, tokenMeta } from './baseRpc';
import { getBaseBankrTokens } from './bankrTokenCatalog';
import { decodeV4Buy, POOL_MANAGER, v4Pools, V4_SWAP_TOPIC } from './bankrSales';

// Uniswap V3: Swap(sender, recipient, int256 amount0, int256 amount1, sqrtPriceX96, liquidity, tick).
// Forks that add protocol-fee fields keep the same leading layout.
const V3_SWAP_TOPICS = new Set([
  '0x19b47279256b2a23a1665c810c8d55a1758940ee09377d4f8d26497a3577dc83',
  '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67',
]);
// Uniswap V2: Swap(sender, amount0In, amount1In, amount0Out, amount1Out, to).
const V2_SWAP_TOPIC = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822';

const RESULT_CACHE_LIMIT = 5_000;
const PRICE_CACHE_MS = 60_000;

export interface BuySaleRef {
  txHash: string;
  logIndex: number;
  tokenAddress: string;
  poolAddress: string;
}

export interface BuyValue {
  usd: number | null;
  quoteAmount: number;
  quoteSymbol: string;
  buyer: string;
  isDev: boolean;
}

const results = new Map<string, BuyValue | null>();
const poolTokens = new Map<string, Promise<[string, string]>>();
const quotePrices = new Map<string, { usd: number | null; at: number }>();

export const saleKey = (sale: Pick<BuySaleRef, 'txHash' | 'logIndex'>) => `${sale.txHash.toLowerCase()}:${sale.logIndex}`;

const word = (data: string, index: number) => data.slice(2 + index * 64, 2 + (index + 1) * 64);
const toSigned = (hex: string) => BigInt.asIntN(256, BigInt(`0x${hex || '0'}`));
const toAddress = (hex: string) => `0x${hex.slice(-40)}`.toLowerCase();

function getPoolTokens(pool: string): Promise<[string, string]> {
  let request = poolTokens.get(pool);
  if (!request) {
    request = Promise.all([
      baseRpc<string>('eth_call', [{ to: pool, data: '0x0dfe1681' }, 'latest']),
      baseRpc<string>('eth_call', [{ to: pool, data: '0xd21220a7' }, 'latest']),
    ]).then(([token0, token1]) => [toAddress(token0), toAddress(token1)] as [string, string]);
    request.catch(() => poolTokens.delete(pool));
    poolTokens.set(pool, request);
  }
  return request;
}

// Amount of the quote token paid into a V2/V3 pool, or null when the event is not a buy of `token`.
// Bankr's V4 launches are decoded by decodeV4Buy instead.
export function decodeBuy(
  log: { topics: string[]; data: string },
  tokenIsToken0: boolean,
): bigint | null {
  const topic = log.topics[0]?.toLowerCase();
  if (topic && V3_SWAP_TOPICS.has(topic)) {
    const amount0 = toSigned(word(log.data, 0));
    const amount1 = toSigned(word(log.data, 1));
    const [tokenDelta, quoteDelta] = tokenIsToken0 ? [amount0, amount1] : [amount1, amount0];
    // The pool pays the token out (negative) and receives the quote token (positive).
    return tokenDelta < 0n && quoteDelta > 0n ? quoteDelta : null;
  }
  if (topic === V2_SWAP_TOPIC) {
    const [in0, in1, out0, out1] = [0, 1, 2, 3].map((index) => BigInt(`0x${word(log.data, index) || '0'}`));
    const [tokenOut, quoteIn] = tokenIsToken0 ? [out0, in1] : [out1, in0];
    return tokenOut > 0n && quoteIn > 0n ? quoteIn : null;
  }
  return null;
}

async function quotePricesUsd(addresses: string[]): Promise<Map<string, number | null>> {
  const now = Date.now();
  const missing = addresses.filter((address) => {
    const cached = quotePrices.get(address);
    return !cached || now - cached.at > PRICE_CACHE_MS;
  });
  if (missing.length > 0) {
    try {
      const response = await fetch(`https://coins.llama.fi/prices/current/${missing.map((address) => `base:${address}`).join(',')}`, {
        signal: AbortSignal.timeout(6_000),
        cache: 'no-store',
      });
      const payload = response.ok ? await response.json() as { coins?: Record<string, { price?: number }> } : {};
      missing.forEach((address) => {
        const price = payload.coins?.[`base:${address}`]?.price;
        quotePrices.set(address, { usd: typeof price === 'number' && price > 0 ? price : null, at: now });
      });
    } catch {
      // Keep any previous price; values without one are shown without a USD amount.
    }
  }
  return new Map(addresses.map((address) => [address, quotePrices.get(address)?.usd ?? null]));
}

type SaleContext = { creators: Map<string, string>; pools: ReturnType<typeof v4Pools> };

async function readSale(sale: BuySaleRef, context: SaleContext): Promise<{ quote: string; raw: bigint; buyer: string; isDev: boolean } | null> {
  const receipt = await baseRpc<{ status: string; from: string; logs: { address: string; logIndex: string; topics: string[]; data: string }[] } | null>(
    'eth_getTransactionReceipt',
    [sale.txHash],
  );
  if (!receipt || receipt.status !== '0x1') return null;
  const log = receipt.logs.find((entry) => Number.parseInt(entry.logIndex, 16) === sale.logIndex);
  if (!log) return null;
  const buyer = receipt.from.toLowerCase();

  // Uniswap V4: every pool lives in the PoolManager and is identified by its 32-byte id.
  if (/^0x[a-f0-9]{64}$/.test(sale.poolAddress)) {
    const pool = context.pools.get(sale.poolAddress);
    if (
      !pool ||
      pool.token !== sale.tokenAddress ||
      log.address.toLowerCase() !== POOL_MANAGER ||
      log.topics[0]?.toLowerCase() !== V4_SWAP_TOPIC ||
      log.topics[1]?.toLowerCase() !== sale.poolAddress
    ) return null;
    const raw = decodeV4Buy(log.data, pool.tokenIsCurrency0);
    if (raw === null) return null;
    return { quote: pool.quote, raw, buyer, isDev: context.creators.get(sale.tokenAddress) === buyer };
  }

  if (log.address.toLowerCase() !== sale.poolAddress) return null;
  const [token0, token1] = await getPoolTokens(sale.poolAddress);
  if (token0 !== sale.tokenAddress && token1 !== sale.tokenAddress) return null;
  const tokenIsToken0 = token0 === sale.tokenAddress;
  const raw = decodeBuy(log, tokenIsToken0);
  if (raw === null) return null;
  return {
    quote: tokenIsToken0 ? token1 : token0,
    raw,
    buyer,
    isDev: context.creators.get(sale.tokenAddress) === buyer,
  };
}

export async function getBuyValues(sales: BuySaleRef[]): Promise<Record<string, BuyValue | null>> {
  const pending = sales.filter((sale) => !results.has(saleKey(sale)));
  const uncached = new Map<string, BuyValue>();
  if (pending.length > 0) {
    const catalog = await getBaseBankrTokens().catch(() => []);
    const creators = new Map(catalog.flatMap((token) => (
      typeof token.address === 'string' && typeof token.creator === 'string'
        ? [[token.address.toLowerCase(), token.creator.toLowerCase()] as const]
        : []
    )));
    const context: SaleContext = { creators, pools: v4Pools(catalog) };
    const decoded = await Promise.all(pending.map((sale) => readSale(sale, context).catch(() => undefined)));
    const quotes = [...new Set(decoded.flatMap((entry) => (entry ? [entry.quote] : [])))];
    const [prices, metas] = await Promise.all([
      quotePricesUsd(quotes),
      Promise.all(quotes.map(async (quote) => [quote, await tokenMeta(quote)] as const)).then((entries) => new Map(entries)),
    ]);
    pending.forEach((sale, index) => {
      const entry = decoded[index];
      // undefined = temporary RPC failure: leave uncached so the next request retries.
      if (entry === undefined) return;
      let value: BuyValue | null = null;
      if (entry) {
        const meta = metas.get(entry.quote) ?? { symbol: 'TOKEN', decimals: 18 };
        const quoteAmount = Number(entry.raw) / 10 ** meta.decimals;
        const price = prices.get(entry.quote) ?? null;
        value = {
          usd: price === null ? null : quoteAmount * price,
          quoteAmount,
          quoteSymbol: meta.symbol,
          buyer: entry.buyer,
          isDev: entry.isDev,
        };
      }
      // A missing price may appear later; only cache priced (or definitely non-buy) results.
      if (value && value.usd === null) {
        uncached.set(saleKey(sale), value);
        return;
      }
      if (results.size >= RESULT_CACHE_LIMIT) results.delete(results.keys().next().value!);
      results.set(saleKey(sale), value);
    });
  }
  return Object.fromEntries(sales.map((sale) => [saleKey(sale), results.get(saleKey(sale)) ?? uncached.get(saleKey(sale)) ?? null]));
}
