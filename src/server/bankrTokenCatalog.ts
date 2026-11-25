// Catalog of Bankr-launched tokens on every chain Bankr launches on (Base, Robinhood, Arbitrum, Arc).
//
// Bankr's public API only lists the 50 most recent launches (all chains), so the catalog is
// accumulated: every refresh merges
//   1. Bankr `GET /token-launches` (identity: chain, creator, fee recipient, artwork, pool id)
//   2. GeckoTerminal's Bankr dex per network (market data for the most active pools)
// into the previous copy, which is kept in memory and, when configured, in Supabase. Tokens are
// never dropped because they fall out of either upstream window. Tokens are keyed by
// `chain:address`, since the same address can exist on several chains.
// GeckoTerminal's Bankr dexes also list other launchpads that reuse Doppler, so every token is
// verified (src/server/bankrVerification.ts) and only confirmed Bankr launches are served;
// tokens proven not to be Bankr's are dropped from the catalog.
import bankrTokensJson from '../data/bankrTokens.json';
import { CHAIN_KEYS, CHAINS, chainById, isChainKey, type ChainKey } from '../config/chains';
import { runInBackground } from './background';
import { hasGeckoBudget, recordGeckoCall } from './geckoBudget';
import { verdictOf, verifyTokens, type VerifyMethod } from './bankrVerification';
import { hasBankrSuffix } from '../config/bankrDoppler';

export const BASE_CHAIN_ID = CHAINS.base.chainId;
export const WETH_ADDRESS = CHAINS.base.wrappedNative.address;
export const BNKR_ADDRESS = '0x22af33fe49fd1fa80c7149773dde5890d3c76f3b';
const BANKR_API = 'https://api.bankr.bot';
const GECKO_API = 'https://api.geckoterminal.com/api/v2';
const ADDRESS_PATTERN = /^0x[a-f\d]{40}$/i;
const POOL_PATTERN = /^0x(?:[a-f\d]{64}|[a-f\d]{40})$/i;
const SUPABASE_TABLE = 'bankrdex_token_catalog';

const MEMORY_FRESH_MS = 2 * 60_000;
const MEMORY_STALE_MS = 24 * 60 * 60_000;
const LAUNCHES_FRESH_MS = 20_000;
// GeckoTerminal lists at most 10 pages (20 pools each) per sort. Every refresh reads page 1 of
// each list (the most active pools, kept fresh) plus a few deeper pages in rotation, so the
// whole depth is covered every ~10 refreshes without exceeding the shared per-minute budget.
const GECKO_SORTS = ['h24_volume_usd_desc', 'h24_tx_count_desc'];
const GECKO_MAX_PAGES = 10;
const GECKO_ROTATING_PAGES_PER_REFRESH = 4;
let geckoRotation = 0;

// Quote assets Bankr launches pair with (GET /token-launches/quote-tokens?chain=<chain>).
export const BANKR_QUOTE_TOKENS_BY_CHAIN: Record<ChainKey, Record<string, string>> = {
  base: {
    [WETH_ADDRESS]: 'WETH',
    [BNKR_ADDRESS]: 'BNKR',
    '0x5577a294ae5a21446a11b0e4100ca83803995720': 'ba3Pump',
    '0xb200000000000000000000451d033a5000cb479e': 'cbHYPE',
    '0xb2000000000000000000008501b13360000cb2ec': 'cbZEC',
    '0xf3081494b87e8d5fb7960f066e931d1d0e6e3d67': 'TAO',
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'USDC',
  },
  robinhood: {
    [CHAINS.robinhood.wrappedNative.address]: 'WETH',
    '0x178e54df3d091ee4d0b2534742ef9e3692b76526': 'BNKR',
  },
  arbitrum: {
    [CHAINS.arbitrum.wrappedNative.address]: 'WETH',
  },
  arc: {
    [CHAINS.arc.wrappedNative.address]: 'USDC',
  },
};
// Base quote tokens, for Base-only code paths.
export const BANKR_QUOTE_TOKENS = BANKR_QUOTE_TOKENS_BY_CHAIN.base;

export interface BankrCatalogToken {
  address: string;
  name: string;
  symbol: string;
  chain: ChainKey;
  chainId: number;
  // Uniswap V4 pool id (32 bytes) for Doppler launches; a 20-byte pool for V3 launches.
  pool?: string;
  quoteAddress?: string;
  quoteSymbol?: string;
  creator?: string;
  creatorX?: { username: string; avatar?: string };
  feeRecipient?: string;
  feeRecipientX?: { username: string; avatar?: string };
  launchType?: string;
  launchedAt?: number;
  txHash?: string;
  imageUrl?: string;
  description?: string;
  website?: string;
  twitter?: string;
  tweetUrl?: string;
  priceUsd?: number;
  marketCapUsd?: number;
  liquidityUsd?: number;
  volume24hUsd?: number;
  change5m?: number;
  change1h?: number;
  change24h?: number;
  totalBuys24h?: number;
  totalSells24h?: number;
  totalTx24h?: number;
  trendingScore?: number;
  marketUpdatedAt?: number;
  pinned?: boolean;
  // How the token was confirmed as a Bankr launch (set when served).
  verifiedBy?: VerifyMethod;
}

type Json = Record<string, unknown>;

const obj = (value: unknown): Json | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Json : null;
const str = (value: unknown, max = 200): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
const num = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const https = (value: unknown): string | undefined => {
  const url = str(value, 500);
  return url && /^https:\/\//i.test(url) ? url : undefined;
};
const xProfile = (party: Json | null): BankrCatalogToken['creatorX'] => {
  const username = str(party?.xUsername, 40);
  if (!username || !/^[A-Za-z0-9_]{1,40}$/.test(username)) return undefined;
  return { username, avatar: https(party?.xProfileImageUrl) };
};

export const catalogKey = (chain: ChainKey, address: string) => `${chain}:${address.toLowerCase()}`;

// Older records (Base-only catalog) carry chainId but no chain.
function tokenChain(token: Json): ChainKey | null {
  if (isChainKey(token.chain)) return token.chain;
  if (token.chainId === undefined) return 'base';
  return chainById(Number(token.chainId))?.key ?? null;
}

export function isCatalogToken(value: unknown): value is BankrCatalogToken {
  const token = obj(value);
  return Boolean(
    token &&
    typeof token.address === 'string' && ADDRESS_PATTERN.test(token.address) &&
    typeof token.name === 'string' && token.name.trim().length > 0 &&
    typeof token.symbol === 'string' && token.symbol.trim().length > 0 &&
    tokenChain(token) !== null
  );
}

function normalize(token: BankrCatalogToken): BankrCatalogToken {
  const chain = tokenChain(token as unknown as Json) ?? 'base';
  return { ...token, chain, chainId: CHAINS[chain].chainId };
}

// One Bankr launch record -> catalog identity fields. Only deployed launches on known chains.
export function fromBankrLaunch(value: unknown): BankrCatalogToken | null {
  const launch = obj(value);
  if (!launch || !isChainKey(launch.chain) || launch.status !== 'deployed') return null;
  const chain = launch.chain;
  const address = str(launch.tokenAddress, 42)?.toLowerCase();
  const name = str(launch.tokenName, 80);
  const symbol = str(launch.tokenSymbol, 32);
  if (!address || !ADDRESS_PATTERN.test(address) || !name || !symbol) return null;
  const pool = str(launch.poolId, 66)?.toLowerCase();
  const paired = obj(launch.pairedToken) ?? obj(launch.pairedStock);
  const pairedAddress = str(paired?.address, 42)?.toLowerCase();
  const quoteAddress = pairedAddress && ADDRESS_PATTERN.test(pairedAddress) ? pairedAddress : CHAINS[chain].wrappedNative.address;
  const imageUri = str(launch.imageUri, 200);
  const deployer = obj(launch.deployer);
  const feeRecipient = obj(launch.feeRecipient);
  const timestamp = num(launch.timestamp);
  const txHash = str(launch.txHash, 66);
  return {
    address,
    name,
    symbol,
    chain,
    chainId: CHAINS[chain].chainId,
    pool: pool && POOL_PATTERN.test(pool) ? pool : undefined,
    quoteAddress,
    quoteSymbol: str(paired?.symbol, 16) ?? BANKR_QUOTE_TOKENS_BY_CHAIN[chain][quoteAddress] ?? CHAINS[chain].wrappedNative.symbol,
    creator: str(deployer?.walletAddress, 42)?.toLowerCase(),
    creatorX: xProfile(deployer),
    feeRecipient: str(feeRecipient?.walletAddress, 42)?.toLowerCase(),
    feeRecipientX: xProfile(feeRecipient),
    launchType: str(launch.launchType, 20),
    launchedAt: timestamp && timestamp > 0 ? timestamp : undefined,
    txHash: txHash && /^0x[a-f\d]{64}$/i.test(txHash) ? txHash.toLowerCase() : undefined,
    imageUrl: imageUri && /^ipfs:\/\//i.test(imageUri) ? imageUri : https(imageUri),
    website: https(launch.websiteUrl),
    tweetUrl: https(launch.tweetUrl),
  };
}

// One GeckoTerminal pool of a Bankr dex -> catalog token with market data.
export function fromGeckoPool(pool: Json, included: Json[], chain: ChainKey = 'base'): BankrCatalogToken | null {
  const quotes = BANKR_QUOTE_TOKENS_BY_CHAIN[chain];
  const prefix = `${CHAINS[chain].geckoNetwork}_`;
  const attributes = obj(pool.attributes);
  const relationships = obj(pool.relationships);
  const idOf = (side: string) => String(obj(obj(relationships?.[side])?.data)?.id ?? '').toLowerCase();
  const baseId = idOf('base_token');
  const quoteId = idOf('quote_token');
  const baseAddress = baseId.slice(prefix.length);
  const quoteAddress = quoteId.slice(prefix.length);
  // The launched token is the side that is not a known quote asset. Bankr launches pair with
  // other assets too (stock tokens on Robinhood), so when neither side is a known quote the side
  // carrying Bankr's `ba3` address suffix is the launched token.
  const bothUnknown = !quotes[baseAddress] && !quotes[quoteAddress];
  const tokenIsBase = bothUnknown
    ? hasBankrSuffix(baseAddress) || !hasBankrSuffix(quoteAddress)
    : !quotes[baseAddress] || Boolean(quotes[quoteAddress]);
  const [tokenId, pairId] = tokenIsBase ? [baseId, quoteId] : [quoteId, baseId];
  const address = tokenId.slice(prefix.length);
  const pairAddress = pairId.slice(prefix.length);
  const poolAddress = str(attributes?.address, 66)?.toLowerCase();
  if (!tokenId.startsWith(prefix) || !ADDRESS_PATTERN.test(address) || !poolAddress || !POOL_PATTERN.test(poolAddress)) return null;
  const tokenInfo = obj(included.find((item) => String(item.id).toLowerCase() === tokenId)?.attributes);
  const pairInfo = obj(included.find((item) => String(item.id).toLowerCase() === pairId)?.attributes);
  const [poolBase, poolQuote] = String(attributes?.name ?? '').split(' / ');
  const symbol = str(tokenInfo?.symbol, 32) ?? str(tokenIsBase ? poolBase : poolQuote, 32);
  const name = str(tokenInfo?.name, 80) ?? symbol;
  if (!symbol || !name) return null;
  const change = obj(attributes?.price_change_percentage);
  const transactions = obj(obj(attributes?.transactions)?.h24);
  const buys = num(transactions?.buys) ?? 0;
  const sells = num(transactions?.sells) ?? 0;
  const volume24h = num(obj(attributes?.volume_usd)?.h24) ?? 0;
  const image = https(tokenInfo?.image_url);
  const createdAt = Date.parse(String(attributes?.pool_created_at ?? ''));
  return {
    address,
    name,
    symbol,
    chain,
    chainId: CHAINS[chain].chainId,
    pool: poolAddress,
    quoteAddress: ADDRESS_PATTERN.test(pairAddress) ? pairAddress : CHAINS[chain].wrappedNative.address,
    quoteSymbol: str(pairInfo?.symbol, 16) ?? quotes[pairAddress] ?? str(tokenIsBase ? poolQuote : poolBase, 16),
    imageUrl: image && !image.includes('missing.png') ? image : undefined,
    launchedAt: Number.isFinite(createdAt) ? createdAt : undefined,
    priceUsd: num(tokenIsBase ? attributes?.base_token_price_usd : attributes?.quote_token_price_usd),
    // GeckoTerminal reports market_cap_usd only for CoinGecko-listed tokens; Bankr supply is
    // fixed at 100B, so FDV is the market cap for everything else.
    marketCapUsd: tokenIsBase ? num(attributes?.market_cap_usd) || num(attributes?.fdv_usd) : undefined,
    liquidityUsd: num(attributes?.reserve_in_usd),
    volume24hUsd: volume24h,
    change5m: tokenIsBase ? num(change?.m5) : undefined,
    change1h: tokenIsBase ? num(change?.h1) : undefined,
    change24h: tokenIsBase ? num(change?.h24) : undefined,
    totalBuys24h: tokenIsBase ? buys : sells,
    totalSells24h: tokenIsBase ? sells : buys,
    totalTx24h: buys + sells,
    trendingScore: volume24h,
    marketUpdatedAt: Date.now(),
  };
}

// Identity from Bankr wins; market fields only overwrite when the newer record has them.
export function mergeToken(previous: BankrCatalogToken | undefined, next: BankrCatalogToken): BankrCatalogToken {
  if (!previous) return next;
  const merged: BankrCatalogToken = { ...previous };
  for (const [key, value] of Object.entries(next) as [keyof BankrCatalogToken, unknown][]) {
    if (value === undefined || value === null) continue;
    (merged as unknown as Record<string, unknown>)[key] = value;
  }
  // A Bankr launch record is authoritative for the pool, the pair and the launch time.
  if (previous.launchType && !next.launchType) {
    merged.pool = previous.pool ?? next.pool;
    merged.quoteAddress = previous.quoteAddress ?? next.quoteAddress;
    merged.launchedAt = previous.launchedAt ?? next.launchedAt;
  }
  // An https image (GeckoTerminal / CoinGecko) loads faster than an IPFS gateway round trip.
  if (previous.imageUrl?.startsWith('https://') && next.imageUrl?.startsWith('ipfs://')) {
    merged.imageUrl = previous.imageUrl;
  }
  return merged;
}

function bundledTokens(): BankrCatalogToken[] {
  return ((bankrTokensJson as { tokens?: unknown[] }).tokens ?? []).filter(isCatalogToken).map(normalize);
}

// ---- Upstreams -------------------------------------------------------------------------------

let launchesSnapshot: { tokens: BankrCatalogToken[]; loadedAt: number } | null = null;
let launchesRequest: Promise<BankrCatalogToken[]> | null = null;

async function requestBankrLaunches(): Promise<BankrCatalogToken[]> {
  const response = await fetch(`${BANKR_API}/token-launches`, {
    headers: { Accept: 'application/json', 'User-Agent': 'BankrDex/1.0' },
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Bankr token-launches request failed (${response.status}).`);
  const payload = obj(await response.json());
  if (!Array.isArray(payload?.launches)) throw new Error('Bankr token-launches returned an invalid response.');
  const tokens = payload.launches.flatMap((launch) => {
    const token = fromBankrLaunch(launch);
    return token ? [token] : [];
  });
  launchesSnapshot = { tokens, loadedAt: Date.now() };
  return tokens;
}

// The 50 most recent Bankr launches on every supported chain. Shared by every caller for 20 s.
export async function fetchBankrLaunches(): Promise<BankrCatalogToken[]> {
  if (launchesSnapshot && Date.now() - launchesSnapshot.loadedAt < LAUNCHES_FRESH_MS) return launchesSnapshot.tokens;
  launchesRequest ??= requestBankrLaunches().finally(() => { launchesRequest = null; });
  try {
    return await launchesRequest;
  } catch (error) {
    if (launchesSnapshot) return launchesSnapshot.tokens;
    throw error;
  }
}

interface GeckoPage { chain: ChainKey; dex: string; sort: string; page: number }

const GECKO_LISTS = CHAIN_KEYS.flatMap((chain) => CHAINS[chain].geckoBankrDexes.flatMap((dex) =>
  GECKO_SORTS.map((sort) => ({ chain, dex, sort }))));
const GECKO_DEEP_PAGES: GeckoPage[] = GECKO_LISTS.flatMap((list) =>
  Array.from({ length: GECKO_MAX_PAGES - 1 }, (_, index) => ({ ...list, page: index + 2 })));

// Page 1 of every list, then the next slice of deeper pages.
export function geckoPagesForRefresh(rotation: number): GeckoPage[] {
  const deep = Array.from({ length: Math.min(GECKO_ROTATING_PAGES_PER_REFRESH, GECKO_DEEP_PAGES.length) }, (_, index) =>
    GECKO_DEEP_PAGES[(rotation * GECKO_ROTATING_PAGES_PER_REFRESH + index) % GECKO_DEEP_PAGES.length]);
  return [...GECKO_LISTS.map((list) => ({ ...list, page: 1 })), ...deep];
}

async function fetchGeckoBankrPools(): Promise<BankrCatalogToken[]> {
  const tokens: BankrCatalogToken[] = [];
  const pages = geckoPagesForRefresh(geckoRotation);
  geckoRotation += 1;
  for (const { chain, dex, sort, page } of pages) {
    if (!hasGeckoBudget(false)) return tokens;
    recordGeckoCall(false);
    const response = await fetch(
      `${GECKO_API}/networks/${CHAINS[chain].geckoNetwork}/dexes/${dex}/pools?sort=${sort}&page=${page}&include=base_token,quote_token`,
      {
        headers: { Accept: 'application/json;version=20230302', 'User-Agent': 'BankrDex/1.0' },
        signal: AbortSignal.timeout(12_000),
        cache: 'no-store',
      },
    );
    if (!response.ok) {
      console.warn(`GeckoTerminal ${chain} Bankr pools page ${page} failed (${response.status}).`);
      continue;
    }
    const payload = obj(await response.json());
    const pools = Array.isArray(payload?.data) ? payload.data.flatMap((item: unknown): Json[] => obj(item) ? [obj(item)!] : []) : [];
    const included = Array.isArray(payload?.included) ? payload.included.flatMap((item: unknown): Json[] => obj(item) ? [obj(item)!] : []) : [];
    for (const pool of pools) {
      const token = fromGeckoPool(pool, included, chain);
      if (token) tokens.push(token);
    }
  }
  return tokens;
}

// ---- Supabase persistence --------------------------------------------------------------------

function supabaseConfig(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

const supabaseHeaders = (key: string): HeadersInit => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  Accept: 'application/json',
  'Content-Type': 'application/json',
});

async function readSupabaseCatalog(config: { url: string; key: string }): Promise<BankrCatalogToken[]> {
  const tokens: BankrCatalogToken[] = [];
  const pageSize = 1_000;
  for (let offset = 0; ; offset += pageSize) {
    const query = new URLSearchParams({
      select: 'token_data',
      order: 'token_address.asc',
      limit: String(pageSize),
      offset: String(offset),
    });
    const response = await fetch(`${config.url}/rest/v1/${SUPABASE_TABLE}?${query}`, {
      headers: supabaseHeaders(config.key),
      signal: AbortSignal.timeout(6_000),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Supabase Bankr catalog read failed (${response.status}).`);
    const rows = await response.json() as Array<{ token_data: unknown }>;
    tokens.push(...rows.flatMap((row) => isCatalogToken(row.token_data) ? [normalize(row.token_data)] : []));
    if (rows.length < pageSize) return tokens;
  }
}

async function writeSupabaseCatalog(config: { url: string; key: string }, tokens: BankrCatalogToken[]): Promise<void> {
  const updatedAt = new Date().toISOString();
  const rows = tokens.map((token) => ({ token_address: catalogKey(token.chain, token.address), token_data: token, updated_at: updatedAt }));
  for (let index = 0; index < rows.length; index += 250) {
    const response = await fetch(`${config.url}/rest/v1/${SUPABASE_TABLE}?on_conflict=token_address`, {
      method: 'POST',
      headers: { ...supabaseHeaders(config.key), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows.slice(index, index + 250)),
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Supabase Bankr catalog write failed (${response.status}).`);
  }
}

async function deleteSupabaseCatalog(config: { url: string; key: string }, keys: string[]): Promise<void> {
  for (let index = 0; index < keys.length; index += 100) {
    const list = keys.slice(index, index + 100).map((key) => `"${key}"`).join(',');
    const response = await fetch(`${config.url}/rest/v1/${SUPABASE_TABLE}?token_address=in.(${encodeURIComponent(list)})`, {
      method: 'DELETE',
      headers: { ...supabaseHeaders(config.key), Prefer: 'return=minimal' },
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Supabase Bankr catalog delete failed (${response.status}).`);
  }
}

// Only tokens confirmed as Bankr launches, tagged with how they were confirmed.
function servedTokens(tokens: Iterable<BankrCatalogToken>): BankrCatalogToken[] {
  const served: BankrCatalogToken[] = [];
  for (const token of tokens) {
    const verdict = verdictOf(token.chain, token.address);
    if (verdict?.bankr) served.push(token.verifiedBy === verdict.method ? token : { ...token, verifiedBy: verdict.method });
  }
  return served;
}

// ---- Catalog ---------------------------------------------------------------------------------

let catalog: { tokens: Map<string, BankrCatalogToken>; loadedAt: number } | null = null;
let catalogRequest: Promise<BankrCatalogToken[]> | null = null;
let supabaseLoaded = false;

async function refreshCatalog(): Promise<BankrCatalogToken[]> {
  const tokens = new Map<string, BankrCatalogToken>(catalog?.tokens ?? []);
  if (tokens.size === 0) {
    for (const token of bundledTokens()) tokens.set(catalogKey(token.chain, token.address), token);
  }
  const config = supabaseConfig();
  if (config && !supabaseLoaded) {
    try {
      for (const token of await readSupabaseCatalog(config)) {
        const key = catalogKey(token.chain, token.address);
        tokens.set(key, mergeToken(tokens.get(key), token));
      }
      supabaseLoaded = true;
    } catch (error) {
      console.error('Unable to read the Supabase Bankr catalog:', error);
    }
  }

  const changed = new Map<string, BankrCatalogToken>();
  const [launches, pools] = await Promise.allSettled([fetchBankrLaunches(), fetchGeckoBankrPools()]);
  // Launches first so GeckoTerminal market data lands on top of the Bankr identity.
  for (const result of [launches, pools]) {
    if (result.status === 'rejected') {
      console.error('Bankr catalog source failed:', result.reason);
      continue;
    }
    for (const token of result.value) {
      const key = catalogKey(token.chain, token.address);
      const merged = mergeToken(tokens.get(key) ?? changed.get(key), token);
      tokens.set(key, merged);
      changed.set(key, merged);
    }
  }
  if (launches.status === 'rejected' && pools.status === 'rejected' && tokens.size === 0) {
    throw new Error('No Bankr catalog source is reachable.');
  }

  // Drop tokens proven not to be Bankr launches; undecided ones stay but are not served.
  try {
    await verifyTokens([...tokens.values()]);
  } catch (error) {
    console.error('Bankr token verification failed:', error);
  }
  const rejected = [...tokens.entries()].filter(([, token]) => verdictOf(token.chain, token.address)?.bankr === false).map(([key]) => key);
  for (const key of rejected) {
    tokens.delete(key);
    changed.delete(key);
  }
  if (config && rejected.length > 0) {
    runInBackground(() => deleteSupabaseCatalog(config, rejected).catch((error: unknown) => {
      console.error('Unable to remove non-Bankr tokens from the Supabase catalog:', error);
    }));
  }

  catalog = { tokens, loadedAt: Date.now() };
  if (config && changed.size > 0) {
    runInBackground(() => writeSupabaseCatalog(config, [...changed.values()]).catch((error: unknown) => {
      console.error('Unable to write the Supabase Bankr catalog:', error);
    }));
  }
  return servedTokens(tokens.values());
}

export async function getBankrTokenCatalog(): Promise<BankrCatalogToken[]> {
  const age = catalog ? Date.now() - catalog.loadedAt : Infinity;
  if (catalog && age < MEMORY_FRESH_MS) return servedTokens(catalog.tokens.values());
  const refresh = () => {
    catalogRequest ??= refreshCatalog().finally(() => { catalogRequest = null; });
    return catalogRequest;
  };
  // Stale-while-revalidate: answer with the previous copy while one refresh runs.
  if (catalog && age < MEMORY_STALE_MS) {
    if (!catalogRequest) runInBackground(() => refresh().then(() => undefined, () => undefined));
    return servedTokens(catalog.tokens.values());
  }
  try {
    return await refresh();
  } catch (error) {
    // The bundled list only holds verified Bankr launches (scripts/clean-bundled-tokens.mjs).
    const fallback = bundledTokens();
    if (fallback.length > 0) {
      console.warn('Using the bundled Bankr catalog:', error);
      return fallback;
    }
    throw error;
  }
}

// Base tokens only, for the Base-specific features (recent buys, Binance Web3 stats).
export async function getBaseBankrTokens(): Promise<BankrCatalogToken[]> {
  return (await getBankrTokenCatalog()).filter((token) => token.chain === 'base');
}

// One catalog token by address (and chain, when known), for page metadata. Never waits on a
// full refresh when cold.
export async function getBankrToken(address: string, chain?: ChainKey): Promise<BankrCatalogToken | null> {
  const key = address.toLowerCase();
  if (!ADDRESS_PATTERN.test(key)) return null;
  const matches = (token: BankrCatalogToken) => token.address === key && (!chain || token.chain === chain);
  const known = catalog ? servedTokens([...catalog.tokens.values()].filter(matches))[0] : undefined;
  if (known) return known;
  try {
    // Bankr's own launch list: verified by definition.
    const launch = (await fetchBankrLaunches()).find(matches);
    if (launch) return { ...launch, verifiedBy: 'bankr-api' };
  } catch {
    // Fall through.
  }
  const candidate = (catalog ? [...catalog.tokens.values()].find(matches) : undefined) ?? bundledTokens().find(matches);
  if (!candidate) return null;
  await verifyTokens([candidate]).catch(() => undefined);
  return servedTokens([candidate])[0] ?? null;
}

// Tokens launched after `since` (ms), straight from the near-live Bankr launch list.
export async function getNewBankrTokens(since: number): Promise<BankrCatalogToken[]> {
  const launches = await fetchBankrLaunches();
  return launches
    .filter((token) => (token.launchedAt ?? 0) > since)
    .map((token) => {
      const known = catalog?.tokens.get(catalogKey(token.chain, token.address));
      return known ? mergeToken(known, token) : token;
    })
    .sort((left, right) => (right.launchedAt ?? 0) - (left.launchedAt ?? 0));
}
