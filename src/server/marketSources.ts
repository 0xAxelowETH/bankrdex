// Binance Web3 "hot" tokens on Base, normalized into one list, plus live Binance stats for the
// most-traded Bankr tokens. Shared by every visitor through a short server cache, so upstream
// calls stay constant (about 2-3 Binance + 1 DexScreener request per refresh) regardless of traffic.

import { createHmac } from 'node:crypto';
import { getBinanceWeb3Credentials } from './binanceWeb3Credentials';
import { getBaseBankrTokens } from './bankrTokenCatalog';
import { runInBackground } from './background';

export type ExternalSource = 'binance';

export interface ExternalMarketToken {
  source: ExternalSource;
  address: string;
  name: string;
  symbol: string;
  logo: string;
  priceUsd: number;
  marketCapUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  change5m: number;
  change1h: number;
  change24h: number;
  buys24h: number;
  sells24h: number;
  txs24h: number;
  holders: number;
  bondingProgress: number;
  isGraduated: boolean;
  createdAt: string;
  externalUrl: string;
  tags: string[];
  // Trading pair: deepest pool from DexScreener.
  quoteSymbol: string;
  quoteAddress: string;
  poolAddress: string;
  dexId: string;
  socials: { twitter?: string; telegram?: string; website?: string };
  activity: Partial<Record<'5m' | '1h' | '4h' | '24h', { volumeUsd: number; buys: number; sells: number; txs: number }>>;
  // Percent; null when the source does not report taxes.
  buyTax: number | null;
  sellTax: number | null;
  lastTradeAt: number;
}

// Live market stats for the most-traded Bankr tokens (the catalog itself has no
// price changes or trade counts), used for per-source Hot rankings.
export interface BankrMarketStat {
  address: string;
  priceUsd: number;
  marketCapUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  change1h: number;
  change24h: number;
  activity: ExternalMarketToken['activity'];
  lastTradeAt: number;
}

const BANKR_STATS_COUNT = 100;

export interface MarketSourcesResult {
  bankrStats: BankrMarketStat[];
  tokens: ExternalMarketToken[];
  sources: Record<'binance', { ok: boolean; count: number }>;
  updatedAt: number;
}

const FRESH_MS = 30_000;
const MAX_STALE_MS = 10 * 60_000;
const BASE_CHAIN_ID = '8453';
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

let cached: MarketSourcesResult | null = null;
let inFlight: Promise<MarketSourcesResult> | null = null;

const num = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
};
const text = (value: unknown, max = 80): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const toArray = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : [];

function blank(source: ExternalSource, address: string): ExternalMarketToken {
  return {
    source,
    address,
    name: '',
    symbol: '',
    logo: '',
    priceUsd: 0,
    marketCapUsd: 0,
    liquidityUsd: 0,
    volume24hUsd: 0,
    change5m: 0,
    change1h: 0,
    change24h: 0,
    buys24h: 0,
    sells24h: 0,
    txs24h: 0,
    holders: 0,
    bondingProgress: 100,
    isGraduated: true,
    createdAt: '',
    externalUrl: `https://web3.binance.com/en/token/base/${address}`,
    tags: [],
    quoteSymbol: '',
    quoteAddress: '',
    poolAddress: '',
    dexId: '',
    socials: {},
    activity: {},
    buyTax: null,
    sellTax: null,
    lastTradeAt: 0,
  };
}

function binanceHeaders(method: 'GET' | 'POST', path: string, body = ''): Record<string, string> | null {
  const { apiKey, secretKey } = getBinanceWeb3Credentials();
  if (!apiKey || !secretKey) return null;
  const timestamp = new Date().toISOString();
  return {
    Accept: 'application/json',
    'X-OC-APIKEY': apiKey,
    'X-OC-TIMESTAMP': timestamp,
    'X-OC-SIGN': createHmac('sha256', secretKey).update(`${timestamp}${method}${path}${body}`, 'utf8').digest('base64'),
    ...(body ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function fetchBinanceHot(): Promise<ExternalMarketToken[]> {
  const path = `/build/api/v1/dex/market/token/hot-token?binanceChainId=${BASE_CHAIN_ID}`;
  const headers = binanceHeaders('GET', path);
  if (!headers) throw new Error('Binance Web3 credentials are not configured.');
  const response = await fetch(`https://web3.binance.com${path}`, { headers, signal: AbortSignal.timeout(10_000), cache: 'no-store' });
  const payload = await response.json() as { code?: unknown; msg?: unknown; data?: { items?: unknown } };
  if (!response.ok || String(payload.code) !== '0') throw new Error(`Binance hot tokens failed: ${String(payload.msg ?? response.status)}`);
  return toArray(payload.data?.items).flatMap((item) => {
    const address = text(item.tokenContractAddress, 42).toLowerCase();
    if (!ADDRESS.test(address)) return [];
    const tags = (Array.isArray(item.tokenTags) ? item.tokenTags : []).map((tag) => text(tag, 40)).filter(Boolean);
    return [{
      ...blank('binance', address),
      symbol: text(item.tokenSymbol, 24),
      name: text(item.tokenSymbol, 24),
      logo: text(item.tokenLogoUrl, 300).startsWith('https://') ? text(item.tokenLogoUrl, 300) : '',
      priceUsd: num(item.price),
      marketCapUsd: num(item.marketCap),
      liquidityUsd: num(item.liquidity),
      volume24hUsd: num(item.volume),
      change24h: num(item.change),
      buys24h: num(item.buyTxs),
      sells24h: num(item.sellTxs),
      txs24h: num(item.txs),
      holders: num(item.holders),
      tags,
    }];
  });
}

export function readActivity(item: Record<string, unknown>): ExternalMarketToken['activity'] {
  const windows = { '5m': '5M', '1h': '1H', '4h': '4H', '24h': '24H' } as const;
  const activity: ExternalMarketToken['activity'] = {};
  for (const [key, suffix] of Object.entries(windows) as [keyof typeof windows, string][]) {
    activity[key] = {
      volumeUsd: num(item[`volume${suffix}`]),
      buys: num(item[`buyTxs${suffix}`]),
      sells: num(item[`sellTxs${suffix}`]),
      txs: num(item[`txs${suffix}`]),
    };
  }
  return activity;
}

// Fills volume, trades, liquidity and short-term changes from Binance (100 addresses per call).
async function enrichWithBinance(tokens: ExternalMarketToken[]): Promise<void> {
  const path = '/build/api/v1/dex/market/price-info';
  for (let index = 0; index < tokens.length; index += 100) {
    const batch = tokens.slice(index, index + 100);
    const body = JSON.stringify(batch.map((token) => ({ binanceChainId: BASE_CHAIN_ID, tokenContractAddress: token.address })));
    const headers = binanceHeaders('POST', path, body);
    if (!headers) return;
    const response = await fetch(`https://web3.binance.com${path}`, {
      method: 'POST', headers, body, signal: AbortSignal.timeout(10_000), cache: 'no-store',
    });
    const payload = await response.json().catch(() => null) as { code?: unknown; data?: unknown } | null;
    if (!response.ok || String(payload?.code) !== '0') throw new Error('Binance price-info enrichment failed.');
    const byAddress = new Map(toArray(payload?.data).map((item) => [text(item.tokenContractAddress, 42).toLowerCase(), item]));
    for (const token of batch) {
      const item = byAddress.get(token.address);
      if (!item || num(item.price) <= 0) continue;
      token.priceUsd = num(item.price);
      token.marketCapUsd = num(item.marketCap) || token.marketCapUsd;
      token.liquidityUsd = num(item.liquidity) || token.liquidityUsd;
      token.volume24hUsd = num(item.volume24H);
      token.change5m = num(item.priceChange5M);
      token.change1h = num(item.priceChange1H);
      token.change24h = num(item.priceChange24H);
      token.buys24h = num(item.buyTxs24H);
      token.sells24h = num(item.sellTxs24H);
      token.txs24h = num(item.txs24H);
      token.activity = readActivity(item);
      token.lastTradeAt = num(item.time);
      token.holders = num(item.holders) || token.holders;
    }
  }
}

const DEXSCREENER_BATCH = 30;
const PAIR_CACHE_MS = 10 * 60_000;
interface PairInfo {
  quoteSymbol: string;
  quoteAddress: string;
  poolAddress: string;
  dexId: string;
  createdAt: number;
  socials: ExternalMarketToken['socials'];
  at: number;
}
const pairCache = new Map<string, PairInfo>();

const httpsUrl = (value: unknown) => {
  const url = text(value, 300);
  return url.startsWith('https://') ? url : undefined;
};

function readSocials(info: unknown): ExternalMarketToken['socials'] {
  const record = (info && typeof info === 'object' ? info : {}) as Record<string, unknown>;
  const socials: ExternalMarketToken['socials'] = {};
  for (const social of toArray(record.socials)) {
    const type = text(social.type, 20).toLowerCase();
    const url = httpsUrl(social.url);
    if (!url) continue;
    if ((type === 'twitter' || type === 'x') && !socials.twitter) socials.twitter = url;
    if (type === 'telegram' && !socials.telegram) socials.telegram = url;
  }
  socials.website = httpsUrl(toArray(record.websites)[0]?.url);
  return socials;
}

// Pair (quote token + pool) per token from DexScreener, 30 tokens per request. Pairs rarely
// change, so each token is looked up at most once every 10 minutes.
async function enrichWithPairs(tokens: ExternalMarketToken[]): Promise<void> {
  const now = Date.now();
  const missing = tokens.filter((token) => {
    const hit = pairCache.get(token.address);
    return !hit || now - hit.at > PAIR_CACHE_MS;
  });
  for (let index = 0; index < missing.length; index += DEXSCREENER_BATCH) {
    const batch = missing.slice(index, index + DEXSCREENER_BATCH);
    const response = await fetch(`https://api.dexscreener.com/tokens/v1/base/${batch.map((token) => token.address).join(',')}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`DexScreener pairs failed (${response.status}).`);
    const best = new Map<string, Record<string, unknown>>();
    for (const pair of toArray(await response.json())) {
      const base = text((pair.baseToken as Record<string, unknown> | undefined)?.address, 42).toLowerCase();
      const liquidity = num((pair.liquidity as Record<string, unknown> | undefined)?.usd);
      const current = best.get(base);
      if (!current || liquidity > num((current.liquidity as Record<string, unknown> | undefined)?.usd)) best.set(base, pair);
    }
    for (const token of batch) {
      const pair = best.get(token.address);
      const quote = (pair?.quoteToken ?? {}) as Record<string, unknown>;
      pairCache.set(token.address, {
        quoteSymbol: text(quote.symbol, 16),
        quoteAddress: ADDRESS.test(text(quote.address, 42)) ? text(quote.address, 42).toLowerCase() : '',
        poolAddress: text(pair?.pairAddress, 66).toLowerCase(),
        dexId: text(pair?.dexId, 24),
        createdAt: num(pair?.pairCreatedAt),
        socials: readSocials(pair?.info),
        at: now,
      });
    }
  }
  for (const token of tokens) {
    const pair = pairCache.get(token.address);
    if (!pair) continue;
    if (pair.quoteSymbol) {
      token.quoteSymbol = pair.quoteSymbol;
      token.quoteAddress = pair.quoteAddress;
    }
    token.poolAddress = pair.poolAddress;
    token.dexId = pair.dexId;
    token.socials = { ...pair.socials, ...Object.fromEntries(Object.entries(token.socials).filter(([, value]) => value)) };
    // Binance lists have no launch time; the pool creation time is the closest proxy.
    if (!token.createdAt && pair.createdAt > 0) token.createdAt = new Date(pair.createdAt).toISOString();
  }
}

async function loadBankrStats(): Promise<BankrMarketStat[]> {
  const catalog = await getBaseBankrTokens();
  const top = catalog
    .filter((token) => ADDRESS.test(String(token.address)))
    .sort((left, right) => num(right.volume24hUsd) - num(left.volume24hUsd))
    .slice(0, BANKR_STATS_COUNT)
    .map((token) => blank('binance', String(token.address).toLowerCase()));
  await enrichWithBinance(top);
  return top.filter((token) => token.priceUsd > 0).map((token) => ({
    address: token.address,
    priceUsd: token.priceUsd,
    marketCapUsd: token.marketCapUsd,
    liquidityUsd: token.liquidityUsd,
    volume24hUsd: token.volume24hUsd,
    change1h: token.change1h,
    change24h: token.change24h,
    activity: token.activity,
    lastTradeAt: token.lastTradeAt,
  }));
}

async function load(): Promise<MarketSourcesResult> {
  const [binanceHot, bankrStats] = await Promise.allSettled([fetchBinanceHot(), loadBankrStats()]);
  if (bankrStats.status === 'rejected') {
    console.warn('Market sources: Bankr stats unavailable:', bankrStats.reason instanceof Error ? bankrStats.reason.message : bankrStats.reason);
  }
  if (binanceHot.status === 'rejected') console.warn('Market sources: Binance hot list unavailable:', binanceHot.reason);
  // Bankr tokens are already listed from the Bankr catalog; keep only the rest of Base here.
  const bankrAddresses = new Set((await getBaseBankrTokens().catch(() => [])).map((token) => token.address.toLowerCase()));
  const tokens = binanceHot.status === 'fulfilled'
    ? binanceHot.value.filter((token) => !bankrAddresses.has(token.address))
    : [];
  const [binanceEnrichment, pairEnrichment] = await Promise.allSettled([enrichWithBinance(tokens), enrichWithPairs(tokens)]);
  if (binanceEnrichment.status === 'rejected') {
    console.warn('Market sources: Binance enrichment unavailable:', binanceEnrichment.reason instanceof Error ? binanceEnrichment.reason.message : binanceEnrichment.reason);
  }
  if (pairEnrichment.status === 'rejected') {
    console.warn('Market sources: DexScreener pairs unavailable:', pairEnrichment.reason instanceof Error ? pairEnrichment.reason.message : pairEnrichment.reason);
  }
  return {
    // Keep the previous stats when this refresh failed, so Hot rankings do not flicker.
    bankrStats: bankrStats.status === 'fulfilled' ? bankrStats.value : cached?.bankrStats ?? [],
    tokens,
    sources: {
      binance: { ok: binanceHot.status === 'fulfilled', count: tokens.length },
    },
    updatedAt: Date.now(),
  };
}

export async function getMarketSources(): Promise<MarketSourcesResult> {
  if (cached && Date.now() - cached.updatedAt < FRESH_MS) return cached;
  // Stale-while-revalidate: serve the previous list instantly and refresh in the background.
  if (cached && Date.now() - cached.updatedAt < MAX_STALE_MS) {
    if (!inFlight) runInBackground(refresh);
    return cached;
  }
  return refresh();
}

function refresh(): Promise<MarketSourcesResult> {
  inFlight ??= load()
    .then((result) => {
      // Keep the previous list when every upstream failed instead of blanking the table.
      if (result.tokens.length > 0 || result.bankrStats.length > 0 || !cached) cached = result;
      return cached;
    })
    .catch((error: unknown) => {
      if (cached && Date.now() - cached.updatedAt < MAX_STALE_MS) return cached;
      throw error;
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

// Addresses from external sources, used to extend the Binance proxy allowlist beyond Bankr.
export async function getExternalTokenAddresses(): Promise<Set<string>> {
  try {
    return new Set((await getMarketSources()).tokens.map((token) => token.address));
  } catch {
    return new Set(cached?.tokens.map((token) => token.address) ?? []);
  }
}
