// Bankr launch metadata and GeckoTerminal market data for Base
import { Candle, Token, Trade } from '../types';
import type { ActivityWindow, TokenActivity, TokenSocials } from '../types';
import bankrTokensJson from '../data/bankrTokens.json';
import { formatUnits } from 'viem';
import { toRawUnits } from '../utils/amounts';
import { assertOkxSwapIncludesFee } from './okxFeeGuard';
import { fetchChainTokenDecimals, PLATFORM_FEE_BPS, PLATFORM_FEE_RECEIVER } from '../utils/web3';
import { CHAINS, chainById, chainByKey, dexscreenerUrl, isChainKey, type ChainKey } from '../config/chains';
import { dexSocialsOf, type DexProfileSocials } from './dexProfiles';

export interface RawBankrToken {
  address: string;
  kind?: string;
  factoryAddress?: string;
  pool?: string;
  quoteAddress?: string;
  creator?: string;
  name: string;
  symbol: string;
  quoteSymbol?: string;
  launchedAt?: number;
  blockNumber?: number;
  blockHash?: string;
  transactionHash?: string;
  imageUrl?: string;
  description?: string;
  website?: string;
  twitter?: string;
  chainId?: number;
  chain?: string;
  priceUsd?: number;
  priceEth?: number;
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
  // Bankr launch details (GET https://api.bankr.bot/token-launches).
  launchType?: string;
  // How the server confirmed the token is a Bankr launch.
  verifiedBy?: string;
  creatorX?: { username: string; avatar?: string };
  feeRecipient?: string;
  feeRecipientX?: { username: string; avatar?: string };
  tweetUrl?: string;
  txHash?: string;
  // Links and order type of the token's paid DexScreener profile (added by /api/token-catalog).
  dexSocials?: DexProfileSocials;
  dexPaid?: 'tokenProfile' | 'communityTakeover';
}

export type BankrTab = 'trending' | 'last-sale' | 'market-cap';
export type BankrChartTimeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1D';

const OKX_NATIVE_TOKEN_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

function okxChainIndexOf(chain: ChainKey): string {
  const index = CHAINS[chain].okxChainIndex;
  if (!index) throw new Error(`OKX DEX does not route ${CHAINS[chain].name}.`);
  return index;
}

function binanceChainIdOf(chain: ChainKey): string {
  const id = CHAINS[chain].binanceChainId;
  if (!id) throw new Error(`Binance Web3 does not route ${CHAINS[chain].name}.`);
  return id;
}

export interface AggregatorQuote {
  provider: 'okx' | 'binance';
  outputAmount: number;
  minimumOutput: number;
  estimatedGasEth: number | null;
  route: string;
  router: string;
  quotedAt: number;
  providerFeeUsd: number | null;
  priceImpactPercent: number | null;
  quoteId?: string;
  vendorName?: string;
  approveTarget?: string | null;
  inputAmountRaw: string;
  feeAmountRaw: string;
  feeDecimals: number;
}

export type OkxAggregatorQuote = AggregatorQuote;

export interface OkxMarketToken {
  chainIndex: string;
  address: string;
  name: string;
  symbol: string;
  logoUrl: string;
  priceUsd: number;
  change24h: number;
  liquidityUsd: number;
  marketCapUsd: number;
  holders: number;
  communityRecognized: boolean;
}


export interface BinanceMarketPrice {
  address: string;
  priceUsd: number;
  change24h: number;
  liquidityUsd: number;
  marketCapUsd: number;
  volume24hUsd: number;
  activity: TokenActivity;
  // Last trade time (buy or sell), ms.
  lastTradeAt: number;
}

function readBinanceActivity(item: Record<string, unknown>): TokenActivity {
  const windows = { '5m': '5M', '1h': '1H', '4h': '4H', '24h': '24H' } as const;
  const activity: TokenActivity = {};
  for (const [key, suffix] of Object.entries(windows) as [ActivityWindow, string][]) {
    activity[key] = {
      volumeUsd: readOkxNumber(item, [`volume${suffix}`]),
      buys: readOkxNumber(item, [`buyTxs${suffix}`]),
      sells: readOkxNumber(item, [`sellTxs${suffix}`]),
      txs: readOkxNumber(item, [`txs${suffix}`]),
    };
  }
  return activity;
}

export interface OkxTransaction {
  to: `0x${string}`;
  data: `0x${string}`;
  value: `0x${string}`;
  gas?: `0x${string}`;
  gasPrice?: `0x${string}`;
}

export interface FeeProtectedSwapTransactions {
  provider: 'okx' | 'binance';
  approval?: OkxTransaction;
  swap: OkxTransaction;
  feeIncluded: true;
  feeTokenAddress: string;
  feeAmountRaw: string;
  feeDecimals: number;
}

export type OkxSwapTransactions = FeeProtectedSwapTransactions;

export interface BankrPoolSnapshot {
  poolTokenIsBase: boolean;
  quoteLogo?: string;
  priceUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  marketCapUsd?: number;
  change5m: number;
  change1h: number;
  change24h: number;
  totalBuys24h: number;
  totalSells24h: number;
  totalTx24h: number;
}

export interface BankrPoolTrade {
  id: string;
  type: 'buy' | 'sell';
  priceUsd: number;
  amountToken: number;
  amountUsd: number;
  wallet: string;
  timestamp: number;
  txHash: string;
}

function getObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function getFirstObject(value: unknown): Record<string, unknown> | null {
  return Array.isArray(value) ? getObject(value[0]) : getObject(value);
}

function readString(object: Record<string, unknown> | null, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = object?.[key];
    if (typeof value === 'string' && value.length > 0) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function readFiniteNumber(object: Record<string, unknown> | null, keys: string[]): number | null {
  const value = readString(object, keys);
  if (value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readResponseData(payload: unknown): Record<string, unknown> {
  const envelope = getObject(payload);
  if (!envelope) throw new Error('OKX DEX returned an invalid response.');
  if (envelope.code !== undefined && String(envelope.code) !== '0') {
    throw new Error(`OKX DEX request failed: ${String(envelope.msg || envelope.code)}`);
  }
  const data = getFirstObject(envelope.data);
  if (!data) throw new Error('OKX DEX returned no route data.');
  return data;
}

class OkxDexRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly upstreamCode?: string
  ) {
    super(message);
    this.name = 'OkxDexRequestError';
  }
}

function isUnsupportedOkxPartnerFeeError(error: unknown): error is OkxDexRequestError {
  return error instanceof OkxDexRequestError
    && /(?:feePercent|referrer|referral|commission)/i.test(error.message)
    && /(?:not supported|unsupported|does not support|not available)/i.test(error.message);
}

async function requestOkxDex(
  path: string,
  params: URLSearchParams,
  signal?: AbortSignal,
  method: 'GET' | 'POST' = 'GET'
): Promise<unknown> {
  const isPost = method === 'POST';
  const response = await fetch(`/api/okx-dex${path}${isPost ? '' : `?${params.toString()}`}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(isPost ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(isPost ? { body: JSON.stringify(Object.fromEntries(params.entries())) } : {}),
    signal: signalWithTimeout(signal, 15_000),
  });
  const payload: unknown = await response.json().catch(() => null);
  const responseEnvelope = getObject(payload);
  const upstreamCode = readString(responseEnvelope, ['code']);
  if (upstreamCode && upstreamCode !== '0') {
    const upstreamMessage = readString(responseEnvelope, ['msg', 'error', 'message']);
    throw new OkxDexRequestError(
      upstreamMessage || `OKX DEX request failed: ${upstreamCode}`,
      response.status,
      upstreamCode
    );
  }
  if (!response.ok) {
    const errorPayload = getObject(payload);
    const upstreamMessage = readString(errorPayload, ['msg', 'error', 'message']);
    throw new OkxDexRequestError(
      upstreamMessage
        ? `OKX DEX request failed (${response.status})${upstreamCode ? ` [${upstreamCode}]` : ''}: ${upstreamMessage}`
        : `OKX DEX request failed (${response.status})`,
      response.status,
      upstreamCode
    );
  }
  return payload;
}

export async function searchOkxMarketTokens(query: string, signal?: AbortSignal): Promise<OkxMarketToken[]> {
  const search = query.trim();
  if (search.length < 2 || search.length > 100) return [];

  const params = new URLSearchParams({
    chains: '8453',
    search,
    limit: '20',
  });
  const payload = await requestOkxDex('/market/token/search', params, signal);
  const envelope = getObject(payload);
  if (!envelope || !Array.isArray(envelope.data)) {
    throw new Error('OKX DEX returned an invalid token search response.');
  }

  return envelope.data.flatMap((value): OkxMarketToken[] => {
    const token = getObject(value);
    const address = readString(token, ['tokenContractAddress']);
    const name = readString(token, ['tokenName']);
    const symbol = readString(token, ['tokenSymbol']);
    const chainIndex = readString(token, ['chainIndex']);
    if (
      !address ||
      !/^0x[a-f\d]{40}$/i.test(address) ||
      address.toLowerCase() === OKX_NATIVE_TOKEN_ADDRESS ||
      !name ||
      !symbol ||
      chainIndex !== '8453'
    ) return [];

    const numberValue = (key: string) => {
      const parsed = Number(readString(token, [key]));
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const tagList = getObject(token?.tagList);

    return [{
      chainIndex,
      address: address.toLowerCase(),
      name,
      symbol,
      logoUrl: readString(token, ['tokenLogoUrl']) || '',
      priceUsd: numberValue('price'),
      change24h: numberValue('change'),
      liquidityUsd: numberValue('liquidity'),
      marketCapUsd: numberValue('marketCap'),
      holders: numberValue('holders'),
      communityRecognized: tagList?.communityRecognized === true,
    }];
  });
}

function readOkxDataList(payload: unknown, message: string): Record<string, unknown>[] {
  const envelope = getObject(payload);
  if (!envelope || (envelope.code !== undefined && String(envelope.code) !== '0')) {
    throw new Error(`OKX DEX ${message} request failed: ${String(envelope?.msg || envelope?.code || 'invalid response')}`);
  }
  if (!Array.isArray(envelope.data)) throw new Error(`OKX DEX returned an invalid ${message} response.`);
  return envelope.data.flatMap((item) => {
    const record = getObject(item);
    return record ? [record] : [];
  });
}

function readOkxNumber(record: Record<string, unknown>, keys: string[]): number {
  const value = Number(readString(record, keys));
  return Number.isFinite(value) ? value : 0;
}

const OKX_PRICE_BATCH = 100;

// Live prices from OKX DEX market price-info, for any chain OKX routes, in the same shape as the
// Binance Web3 feed. OKX reports trade counts per window but not the buy / sell split, so 24h
// activity is left to the on-chain index (which has the split) and 5m / 1h / 4h carry totals only.
export async function fetchOkxLivePrices(tokens: Token[], signal?: AbortSignal): Promise<BinanceMarketPrice[]> {
  const byChain = new Map<ChainKey, Set<string>>();
  for (const token of tokens) {
    const chain = token.chain ?? 'base';
    const address = token.address.toLowerCase();
    if (!CHAINS[chain].okxChainIndex || !/^0x[a-f\d]{40}$/.test(address) || address === OKX_NATIVE_TOKEN_ADDRESS) continue;
    byChain.set(chain, (byChain.get(chain) ?? new Set()).add(address));
  }
  const requests: Promise<BinanceMarketPrice[]>[] = [];
  for (const [chain, set] of byChain) {
    const addresses = [...set];
    for (let index = 0; index < addresses.length; index += OKX_PRICE_BATCH) {
      const batch = addresses.slice(index, index + OKX_PRICE_BATCH);
      const params = new URLSearchParams({ chainIndex: okxChainIndexOf(chain), tokenContractAddress: batch.join(',') });
      requests.push(requestOkxDex('/market/price-info', params, signal, 'POST').then((payload) =>
        readOkxDataList(payload, 'market price').flatMap((item): BinanceMarketPrice[] => {
          const address = readString(item, ['tokenContractAddress'])?.toLowerCase();
          if (!address || !batch.includes(address)) return [];
          const window = (suffix: string) => ({
            volumeUsd: readOkxNumber(item, [`volume${suffix}`]),
            txs: readOkxNumber(item, [`txs${suffix}`]),
            buys: 0,
            sells: 0,
          });
          return [{
            address,
            priceUsd: readOkxNumber(item, ['price']),
            change24h: readOkxNumber(item, ['priceChange24H']),
            liquidityUsd: readOkxNumber(item, ['liquidity']),
            marketCapUsd: readOkxNumber(item, ['marketCap']),
            volume24hUsd: readOkxNumber(item, ['volume24H']),
            activity: { '5m': window('5M'), '1h': window('1H'), '4h': window('4H') },
            lastTradeAt: 0,
          }];
        })));
    }
  }
  const settled = await Promise.allSettled(requests);
  const prices = settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
  if (prices.length === 0 && settled.some((result) => result.status === 'rejected')) {
    throw (settled.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason;
  }
  return prices;
}

export type LivePriceSource = 'binance' | 'okx' | 'binance+okx';
const BINANCE_RETRY_MS = 5 * 60_000;
let binanceRetryAt = 0;

// Table prices: Binance Web3 for Base (it has the buy / sell split), OKX DEX for other chains and
// as the fallback when Binance is unreachable (it blocks some networks and regions).
export async function fetchLiveMarketPrices(tokens: Token[], signal?: AbortSignal): Promise<{ prices: BinanceMarketPrice[]; source: LivePriceSource }> {
  const base = tokens.filter((token) => (token.chain ?? 'base') === 'base');
  const others = tokens.filter((token) => (token.chain ?? 'base') !== 'base');
  const prices: BinanceMarketPrice[] = [];
  let binanceOk = false;
  let binanceError: unknown;
  if (base.length > 0 && Date.now() >= binanceRetryAt) {
    try {
      prices.push(...await fetchBinanceMarketPrices(base, signal));
      binanceOk = true;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      binanceError = error;
      // Blocked networks fail every time: ask OKX directly for a while before trying Binance again.
      binanceRetryAt = Date.now() + BINANCE_RETRY_MS;
    }
  }
  const viaOkx = binanceOk ? others : [...base, ...others];
  let okxOk = false;
  if (viaOkx.length > 0) {
    try {
      prices.push(...await fetchOkxLivePrices(viaOkx, signal));
      okxOk = true;
    } catch (error) {
      if (!binanceOk) throw binanceError ?? error;
    }
  }
  return { prices, source: binanceOk ? (okxOk ? 'binance+okx' : 'binance') : 'okx' };
}

export async function fetchBinanceMarketPrices(
  tokens: Token[],
  signal?: AbortSignal
): Promise<BinanceMarketPrice[]> {
  const addresses = [...new Set(tokens
    .map((token) => token.address.toLowerCase())
    .filter((address) => /^0x[a-f\d]{40}$/i.test(address) && address !== OKX_NATIVE_TOKEN_ADDRESS))];
  if (addresses.length === 0) return [];

  const response = await fetch('/api/binance-web3/market/price-info', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(addresses.map((tokenContractAddress) => ({
      binanceChainId: '8453',
      tokenContractAddress,
    }))),
    signal: signalWithTimeout(signal, 15_000),
  });
  const payload: unknown = await response.json().catch(() => null);
  const envelope = getObject(payload);
  if (!envelope || (envelope.code !== undefined && String(envelope.code) !== '0')) {
    const message = readString(envelope, ['msg', 'error', 'code']);
    throw new Error(message || 'Binance Web3 returned an invalid market price response.');
  }
  if (!response.ok) {
    throw new Error(readString(envelope, ['msg', 'error']) || `Binance Web3 market price request failed (${response.status}).`);
  }
  if (!Array.isArray(envelope.data)) {
    throw new Error('Binance Web3 returned an invalid market price response.');
  }

  return envelope.data.flatMap((value): BinanceMarketPrice[] => {
    const item = getObject(value);
    const address = readString(item, ['tokenContractAddress'])?.toLowerCase();
    if (!item || !address || !addresses.includes(address)) return [];
    return [{
      address,
      priceUsd: readOkxNumber(item, ['price']),
      change24h: readOkxNumber(item, ['priceChange24H']),
      liquidityUsd: readOkxNumber(item, ['liquidity']),
      marketCapUsd: readOkxNumber(item, ['marketCap']),
      volume24hUsd: readOkxNumber(item, ['volume24H']),
      activity: readBinanceActivity(item),
      lastTradeAt: readOkxNumber(item, ['time']),
    }];
  });
}

export type BinanceGeneralDataEndpoint =
  | 'chains'
  | 'price'
  | 'trading-info'
  | 'candles'
  | 'search'
  | 'basic-info'
  | 'advanced-info'
  | 'hot-tokens'
  | 'holders'
  | 'top-traders'
  | 'top-liquidity'
  | 'trades'
  | 'dev-info';

export async function fetchBinanceGeneralData(
  endpoint: BinanceGeneralDataEndpoint,
  token: Token,
  signal?: AbortSignal
): Promise<unknown> {
  const isPost = endpoint === 'price' || endpoint === 'trading-info' || endpoint === 'basic-info';
  const hasJsonBody = endpoint === 'price' || endpoint === 'trading-info';
  const params = new URLSearchParams();
  let body: string | undefined;

  if (endpoint === 'chains') {
    // The chain directory is filtered to Base by the server proxy.
  } else if (endpoint === 'hot-tokens') {
    params.set('binanceChainId', '8453');
  } else if (endpoint === 'search') {
    params.set('chains', '8453');
    params.set('search', token.symbol);
  } else if (endpoint === 'basic-info') {
    params.set('binanceChainId', '8453');
    params.set('tokenContractAddress', token.address);
  } else if (hasJsonBody) {
    const tokenRequest = {
      binanceChainId: '8453',
      tokenContractAddress: token.address,
    };
    body = JSON.stringify([tokenRequest]);
  } else {
    params.set('binanceChainId', '8453');
    params.set('tokenContractAddress', token.address);
    if (endpoint === 'candles') {
      params.set('bar', '1h');
      params.set('limit', '100');
    }
    if (endpoint === 'trades') params.set('limit', '30');
  }

  const response = await fetch(
    `/api/binance-web3/general/${endpoint}${params.size ? `?${params.toString()}` : ''}`,
    {
      method: isPost ? 'POST' : 'GET',
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body } : {}),
      cache: 'no-store',
      signal: signalWithTimeout(signal, 20_000),
    }
  );
  const payload: unknown = await response.json().catch(() => null);
  const envelope = getObject(payload);
  if (!response.ok) {
    throw new Error(
      readString(envelope, ['msg', 'error', 'message']) ||
      `Binance Web3 ${endpoint} request failed (${response.status}).`
    );
  }
  if (!envelope || (envelope.code !== undefined && String(envelope.code) !== '0')) {
    throw new Error(
      readString(envelope, ['msg', 'error', 'message', 'code']) ||
      `Binance Web3 returned an invalid ${endpoint} response.`
    );
  }
  return payload;
}

function readOkxTimestamp(record: Record<string, unknown>): number {
  const value = readString(record, ['tradeTime', 'timestamp', 'blockTime', 'time']);
  if (!value) return 0;
  const numericTimestamp = Number(value);
  if (Number.isFinite(numericTimestamp)) {
    return numericTimestamp < 100_000_000_000 ? numericTimestamp * 1_000 : numericTimestamp;
  }
  const parsedTimestamp = Date.parse(value);
  return Number.isFinite(parsedTimestamp) ? parsedTimestamp : 0;
}

export async function fetchOkxMarketTrades(
  token: Token,
  signal?: AbortSignal
): Promise<Trade[]> {
  const address = token.address.toLowerCase();
  if (!/^0x[a-f\d]{40}$/i.test(address) || address === OKX_NATIVE_TOKEN_ADDRESS) return [];

  const params = new URLSearchParams({
    chainIndex: '8453',
    tokenContractAddress: address,
    limit: '20',
  });
  const payload = await requestOkxDex('/market/trades', params, signal);
  return readOkxDataList(payload, 'market trades').flatMap((item): Trade[] => {
    const txHash = readString(item, ['txHash', 'transactionHash', 'txId', 'hash', 'txHashUrl', 'id']) || '';
    const timestamp = readOkxTimestamp(item);
    const side = (readString(item, ['side', 'tradeType', 'txType', 'transactionType', 'type']) || '').toLowerCase();
    const type = side.includes('buy') ? 'buy' : side.includes('sell') ? 'sell' : null;
    if (!txHash || !type || timestamp <= 0) return [];

    const tokenAddress = token.address.toLowerCase();
    const changedToken = Array.isArray(item.changedTokenInfo)
      ? item.changedTokenInfo
        .map(getObject)
        .find((change) => readString(change, ['tokenAddress'])?.toLowerCase() === tokenAddress)
      : undefined;
    const amountToken = changedToken
      ? readOkxNumber(changedToken, ['amount'])
      : readOkxNumber(item, ['tokenAmount', 'amountToken', 'amount', 'quantity']);
    const priceUsd = readOkxNumber(item, ['price', 'tokenPrice', 'priceUsd']);
    const amountUsd = readOkxNumber(item, ['amountUsd', 'tradeAmountUsd', 'volumeUsd', 'usdValue', 'volume']) ||
      amountToken * priceUsd;
    if (!Number.isFinite(amountToken) || !Number.isFinite(amountUsd) || amountToken <= 0 || amountUsd <= 0) return [];

    const transactionHash = txHash.startsWith('0x') ? txHash : `0x${txHash}`;
    if (!/^0x[a-f\d]{64}$/i.test(transactionHash)) return [];
    return [{
      id: transactionHash,
      tokenId: token.id,
      type,
      priceUsd: priceUsd > 0 ? priceUsd : amountUsd / amountToken,
      amountToken,
      amountEth: 0,
      amountUsd,
      wallet: readString(item, ['walletAddress', 'traderAddress', 'maker', 'txFromAddress', 'fromAddress', 'from', 'userAddress']) || '',
      timestamp,
      txHash: transactionHash,
    }];
  }).sort((left, right) => right.timestamp - left.timestamp);
}

function getOkxAmountRaw(data: Record<string, unknown>): string {
  const router = getObject(data.routerResult) || data;
  const amount = readString(router, ['toTokenAmount', 'toAmount', 'amountOut']);
  if (!amount || !/^\d+$/.test(amount)) throw new Error('OKX DEX quote did not include a valid output amount.');
  return amount;
}

export async function fetchOkxAggregatorQuote(
  fromTokenAddress: string,
  toTokenAddress: string,
  amount: number,
  slippage: number,
  userWalletAddress?: string,
  fromTokenSymbol?: string,
  toTokenSymbol?: string,
  signal?: AbortSignal,
  chain: ChainKey = 'base'
): Promise<AggregatorQuote> {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Swap amount is invalid.');

  const isNativeInput = fromTokenAddress.toLowerCase() === 'native';
  const isNativeOutput = toTokenAddress.toLowerCase() === 'native';
  const fromAddress = isNativeInput ? OKX_NATIVE_TOKEN_ADDRESS : fromTokenAddress;
  const toAddress = isNativeOutput ? OKX_NATIVE_TOKEN_ADDRESS : toTokenAddress;
  const nativeSymbol = CHAINS[chain].nativeSymbol;
  const inputDecimals = isNativeInput ? 18 : await fetchChainTokenDecimals(chain, fromAddress);
  const outputDecimals = isNativeOutput ? 18 : await fetchChainTokenDecimals(chain, toAddress);
  const inputAmountRaw = toRawUnits(amount, inputDecimals).toString();
  const feeAmountRaw = (BigInt(inputAmountRaw) * BigInt(PLATFORM_FEE_BPS)) / 10_000n;
  if (feeAmountRaw === 0n) {
    throw new Error('The 0.1% fee is below the smallest unit of the input asset.');
  }
  const amountRaw = (BigInt(inputAmountRaw) - feeAmountRaw).toString();
  const params = new URLSearchParams({
    chainIndex: okxChainIndexOf(chain),
    fromTokenAddress: fromAddress,
    toTokenAddress: toAddress,
    amount: amountRaw,
    swapMode: 'exactIn',
    slippage: String(slippage),
  });
  if (userWalletAddress) params.set('userWalletAddress', userWalletAddress);

  const data = readResponseData(await requestOkxDex('/aggregator/quote', params, signal));
  const router = getObject(data.routerResult) || data;
  const outputRaw = getOkxAmountRaw(data);
  const minimumRaw = readString(router, ['minReceiveAmount', 'minimumReceived']);
  const outputAmount = Number(formatUnits(BigInt(outputRaw), outputDecimals));
  const minimumOutput = minimumRaw && /^\d+$/.test(minimumRaw)
    ? Number(formatUnits(BigInt(minimumRaw), outputDecimals))
    : outputAmount * (1 - Math.min(Math.max(slippage, 0), 100) / 100);
  const dexRoutes = Array.isArray(router.dexRouterList)
    ? router.dexRouterList.map((item) => {
        const route = getObject(item);
        return readString(route, ['dexName', 'dexProtocol', 'name']);
      }).filter((name): name is string => Boolean(name))
    : [];

  return {
    provider: 'okx',
    outputAmount,
    minimumOutput,
    estimatedGasEth: null,
    route: `${fromTokenSymbol || (isNativeInput ? nativeSymbol : 'Token')} → ${toTokenSymbol || (isNativeOutput ? nativeSymbol : 'Token')}`,
    router: dexRoutes.length > 0 ? `OKX · ${[...new Set(dexRoutes)].join(', ')}` : 'OKX DEX Aggregator',
    quotedAt: Date.now(),
    providerFeeUsd: readFiniteNumber(router, ['networkFeeUsd', 'estimatedFeeUsd', 'tradeFee']),
    priceImpactPercent: readFiniteNumber(router, ['priceImpactPercent', 'priceImpact']),
    inputAmountRaw,
    feeAmountRaw: feeAmountRaw.toString(),
    feeDecimals: inputDecimals,
  };
}

function normalizeAggregatorTransaction(value: unknown, fallbackTo?: string): OkxTransaction {
  const transaction = getObject(value);
  const to = readString(transaction, ['to']) || fallbackTo;
  const data = readString(transaction, ['data']);
  const rawValue = readString(transaction, ['value']) || '0x0';
  const gas = readString(transaction, ['gas', 'gasLimit']);
  const gasPrice = readString(transaction, ['gasPrice']);
  if (!to || !/^0x[a-fA-F0-9]{40}$/.test(to) || !data || !/^0x(?:[a-fA-F0-9]{2})*$/.test(data)) {
    throw new Error('The DEX aggregator returned an invalid wallet transaction.');
  }
  const toHexQuantity = (quantity: string) => {
    if (/^0x[0-9a-f]+$/i.test(quantity)) return quantity as `0x${string}`;
    if (/^\d+$/.test(quantity)) return `0x${BigInt(quantity).toString(16)}` as `0x${string}`;
    throw new Error('OKX DEX returned an invalid transaction quantity.');
  };
  return {
    to: to as `0x${string}`,
    data: data as `0x${string}`,
    value: toHexQuantity(rawValue),
    ...(gas ? { gas: toHexQuantity(gas) } : {}),
    ...(gasPrice ? { gasPrice: toHexQuantity(gasPrice) } : {}),
  };
}

const BINANCE_NATIVE_TOKEN_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

async function requestBinanceAggregator(path: string, params: URLSearchParams, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`/api/binance-web3/aggregator/${path}?${params.toString()}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: signalWithTimeout(signal, 15_000),
  });
  const payload: unknown = await response.json().catch(() => null);
  const envelope = getObject(payload);
  if (!envelope) throw new Error('Binance Web3 returned an invalid aggregator response.');
  if (envelope.code !== undefined && String(envelope.code) !== '0') {
    throw new Error(`Binance Web3 aggregator request failed: ${readString(envelope, ['msg', 'message', 'code']) || 'unknown error'}`);
  }
  if (!response.ok) {
    throw new Error(readString(envelope, ['error', 'msg', 'message']) || `Binance Web3 aggregator request failed (${response.status}).`);
  }
  return payload;
}

function readBinanceAggregatorData(payload: unknown): Record<string, unknown> {
  const envelope = getObject(payload);
  if (!envelope || envelope.success === false) {
    throw new Error(readString(envelope, ['msg', 'message']) || 'Binance Web3 did not return a successful aggregator response.');
  }
  const data = getFirstObject(envelope.data);
  if (!data) throw new Error('Binance Web3 returned no aggregator route data.');
  return data;
}

export async function fetchBinanceAggregatorQuote(
  fromTokenAddress: string,
  toTokenAddress: string,
  amount: number,
  slippage: number,
  userWalletAddress?: string,
  fromTokenSymbol?: string,
  toTokenSymbol?: string,
  signal?: AbortSignal,
  chain: ChainKey = 'base'
): Promise<AggregatorQuote> {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Swap amount is invalid.');
  const isNativeInput = fromTokenAddress.toLowerCase() === 'native';
  const isNativeOutput = toTokenAddress.toLowerCase() === 'native';
  const fromAddress = isNativeInput ? BINANCE_NATIVE_TOKEN_ADDRESS : fromTokenAddress;
  const toAddress = isNativeOutput ? BINANCE_NATIVE_TOKEN_ADDRESS : toTokenAddress;
  const nativeSymbol = CHAINS[chain].nativeSymbol;
  const inputDecimals = isNativeInput ? 18 : await fetchChainTokenDecimals(chain, fromAddress);
  const outputDecimals = isNativeOutput ? 18 : await fetchChainTokenDecimals(chain, toAddress);
  const inputAmountRaw = toRawUnits(amount, inputDecimals).toString();
  const params = new URLSearchParams({
    binanceChainId: binanceChainIdOf(chain),
    amount: inputAmountRaw,
    fromTokenAddress: fromAddress,
    toTokenAddress: toAddress,
    feePercent: String(PLATFORM_FEE_BPS / 100),
    feeSource: 'FROM_TOKEN',
    fromTokenReferrerWalletAddress: PLATFORM_FEE_RECEIVER,
  });
  if (userWalletAddress) params.set('userWalletAddress', userWalletAddress);
  const payload = await requestBinanceAggregator('quote', params, signal);
  const envelope = getObject(payload);
  const candidates = Array.isArray(envelope?.data) ? envelope.data : [];
  const expectedFee = (BigInt(inputAmountRaw) * BigInt(PLATFORM_FEE_BPS) + 5_000n) / 10_000n;
  const validRoutes = candidates.flatMap((candidate): AggregatorQuote[] => {
    const route = getObject(candidate);
    const quoteId = readString(route, ['quoteId']);
    const vendorName = readString(route, ['vendorName']);
    const outputRaw = readString(route, ['toTokenAmount']);
    const feeRaw = readString(route, ['feeAmount']);
    const feeToken = readString(route, ['feeToken']);
    const actualSwapAmount = readString(route, ['actualSwapAmount']);
    if (
      !route ||
      route.executionMode !== 'SWAP' ||
      !quoteId ||
      !vendorName ||
      !outputRaw ||
      !/^\d+$/.test(outputRaw) ||
      !feeRaw ||
      !/^\d+$/.test(feeRaw) ||
      BigInt(feeRaw) !== expectedFee ||
      !feeToken ||
      feeToken.toLowerCase() !== fromAddress.toLowerCase() ||
      actualSwapAmount !== (BigInt(inputAmountRaw) - expectedFee).toString()
    ) return [];
    const outputAmount = Number(formatUnits(BigInt(outputRaw), outputDecimals));
    if (!Number.isFinite(outputAmount) || outputAmount <= 0) return [];
    return [{
      provider: 'binance',
      outputAmount,
      minimumOutput: outputAmount * (1 - Math.min(Math.max(slippage, 0), 100) / 100),
      estimatedGasEth: null,
      route: `${fromTokenSymbol || (isNativeInput ? nativeSymbol : 'Token')} → ${toTokenSymbol || (isNativeOutput ? nativeSymbol : 'Token')}`,
      router: `Binance Web3 · ${vendorName}`,
      quotedAt: Date.now(),
      providerFeeUsd: readFiniteNumber(route, ['tradeFee']),
      priceImpactPercent: readFiniteNumber(route, ['priceImpactPercent']),
      quoteId,
      vendorName,
      approveTarget: readString(route, ['approveTarget']) || null,
      inputAmountRaw,
      feeAmountRaw: feeRaw,
      feeDecimals: inputDecimals,
    }];
  });
  if (validRoutes.length === 0) {
    throw new Error('Binance Web3 returned no SWAP route with the configured 0.1% input fee.');
  }
  const firstRoute = getObject(candidates[0]);
  const outputToken = getObject(firstRoute?.toToken);
  return rankAggregatorQuotes(
    validRoutes,
    readFiniteNumber(outputToken, ['tokenUnitPrice', 'priceUsd']) || 0
  )[0];
}

export interface RouterStatus {
  configured: boolean;
  chains: ChainKey[];
  verified: boolean;
}

// Which aggregators this deployment can route on which chain (GET /api/routers/status).
let routerStatusRequest: Promise<{ okx: RouterStatus; binance: RouterStatus }> | null = null;
export function fetchRouterStatus(): Promise<{ okx: RouterStatus; binance: RouterStatus }> {
  routerStatusRequest ??= fetch('/api/routers/status', { headers: { Accept: 'application/json' } })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Router status failed (${response.status}).`);
      return response.json() as Promise<{ okx: RouterStatus; binance: RouterStatus }>;
    })
    .catch((error: unknown) => {
      routerStatusRequest = null;
      throw error;
    });
  return routerStatusRequest;
}

export function rankAggregatorQuotes(quotes: AggregatorQuote[], outputTokenPriceUsd: number): AggregatorQuote[] {
  return [...quotes].sort((left, right) => {
    let leftNetValue: number | null = null;
    let rightNetValue: number | null = null;
    if (
      Number.isFinite(outputTokenPriceUsd) &&
      outputTokenPriceUsd > 0 &&
      left.providerFeeUsd !== null &&
      right.providerFeeUsd !== null
    ) {
      leftNetValue = left.outputAmount * outputTokenPriceUsd - left.providerFeeUsd;
      rightNetValue = right.outputAmount * outputTokenPriceUsd - right.providerFeeUsd;
    }

    const leftRateValue = leftNetValue ?? left.outputAmount;
    const rightRateValue = rightNetValue ?? right.outputAmount;
    const nearEqualThreshold = Math.max(Math.abs(leftRateValue), Math.abs(rightRateValue)) * 0.001;
    if (Math.abs(leftRateValue - rightRateValue) <= nearEqualThreshold) {
      const leftImpact = left.priceImpactPercent === null ? Number.POSITIVE_INFINITY : Math.abs(left.priceImpactPercent);
      const rightImpact = right.priceImpactPercent === null ? Number.POSITIVE_INFINITY : Math.abs(right.priceImpactPercent);
      if (leftImpact !== rightImpact) return leftImpact - rightImpact;
    }

    if (leftRateValue !== rightRateValue) return rightRateValue - leftRateValue;
    if (left.providerFeeUsd !== null && right.providerFeeUsd !== null && left.providerFeeUsd !== right.providerFeeUsd) {
      return left.providerFeeUsd - right.providerFeeUsd;
    }
    const leftImpact = left.priceImpactPercent === null ? Number.POSITIVE_INFINITY : Math.abs(left.priceImpactPercent);
    const rightImpact = right.priceImpactPercent === null ? Number.POSITIVE_INFINITY : Math.abs(right.priceImpactPercent);
    return leftImpact - rightImpact;
  });
}

export async function fetchOkxSwapTransactions(
  fromTokenAddress: string,
  toTokenAddress: string,
  amount: number,
  slippage: number,
  userWalletAddress: string,
  chain: ChainKey = 'base'
): Promise<OkxSwapTransactions> {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Swap amount is invalid.');
  const isNativeInput = fromTokenAddress.toLowerCase() === 'native';
  const isNativeOutput = toTokenAddress.toLowerCase() === 'native';
  const fromAddress = isNativeInput ? OKX_NATIVE_TOKEN_ADDRESS : fromTokenAddress;
  const toAddress = isNativeOutput ? OKX_NATIVE_TOKEN_ADDRESS : toTokenAddress;
  const inputDecimals = isNativeInput ? 18 : await fetchChainTokenDecimals(chain, fromAddress);
  const amountRaw = toRawUnits(amount, inputDecimals).toString();
  const grossInputAmount = BigInt(amountRaw);
  const feeAmountRaw = (grossInputAmount * BigInt(PLATFORM_FEE_BPS)) / 10_000n;
  if (feeAmountRaw === 0n) {
    throw new Error('The 0.1% fee is below the smallest unit of the input asset; the swap was cancelled.');
  }
  const requestParams = new URLSearchParams({
    chainIndex: okxChainIndexOf(chain),
    fromTokenAddress: fromAddress,
    toTokenAddress: toAddress,
    amount: amountRaw,
    swapMode: 'exactIn',
    slippagePercent: String(slippage),
    userWalletAddress,
    feePercent: '0.1',
    fromTokenReferrerWalletAddress: PLATFORM_FEE_RECEIVER,
  });

  let swapPayload: unknown;
  try {
    swapPayload = await requestOkxDex('/aggregator/swap', requestParams);
  } catch (error) {
    if (!isUnsupportedOkxPartnerFeeError(error)) throw error;
    throw new Error(
      `OKX cannot include the 0.1% fee for this route. The swap was cancelled and no transaction was sent.${error instanceof Error ? ` (${error.message})` : ''}`
    );
  }
  const approvalPayload = isNativeInput
    ? null
    : await requestOkxDex('/aggregator/approve-transaction', new URLSearchParams({
        chainIndex: okxChainIndexOf(chain),
        tokenContractAddress: fromAddress,
        approveAmount: amountRaw,
      })).catch((error: unknown) => {
        if (error instanceof Error && error.message.includes('(400)')) return null;
        throw error;
      });

  const swapData = readResponseData(swapPayload);
  const swap = normalizeAggregatorTransaction(swapData.tx || swapData.transaction || swapData);
  assertOkxSwapIncludesFee(swap, isNativeInput, grossInputAmount);
  const approvalData = approvalPayload ? readResponseData(approvalPayload) : null;
  const approval = approvalData
    ? normalizeAggregatorTransaction(approvalData.tx || approvalData.transaction || approvalData, fromAddress)
    : undefined;
  return {
    provider: 'okx',
    approval,
    swap,
    feeIncluded: true,
    feeTokenAddress: fromTokenAddress,
    feeAmountRaw: feeAmountRaw.toString(),
    feeDecimals: inputDecimals,
  };
}

export async function fetchBinanceSwapTransactions(
  quote: OkxAggregatorQuote,
  fromTokenAddress: string,
  toTokenAddress: string,
  slippage: number,
  userWalletAddress: string,
  chain: ChainKey = 'base'
): Promise<OkxSwapTransactions> {
  if (
    quote.provider !== 'binance' ||
    !quote.quoteId ||
    !quote.vendorName ||
    Date.now() - quote.quotedAt > 25_000
  ) {
    throw new Error('The Binance Web3 quote has expired. Refresh the quote before swapping.');
  }
  const isNativeInput = fromTokenAddress.toLowerCase() === 'native';
  const isNativeOutput = toTokenAddress.toLowerCase() === 'native';
  const fromAddress = isNativeInput ? BINANCE_NATIVE_TOKEN_ADDRESS : fromTokenAddress;
  const toAddress = isNativeOutput ? BINANCE_NATIVE_TOKEN_ADDRESS : toTokenAddress;
  const params = new URLSearchParams({
    binanceChainId: binanceChainIdOf(chain),
    amount: quote.inputAmountRaw,
    fromTokenAddress: fromAddress,
    toTokenAddress: toAddress,
    userWalletAddress,
    quoteId: quote.quoteId,
    slippagePercent: String(slippage),
    feePercent: String(PLATFORM_FEE_BPS / 100),
    fromTokenReferrerWalletAddress: PLATFORM_FEE_RECEIVER,
  });
  const swapData = readBinanceAggregatorData(await requestBinanceAggregator('swap', params));
  if (swapData.executionMode !== 'SWAP') {
    throw new Error('Binance Web3 returned an unsupported RFQ route; no transaction was submitted.');
  }
  const routerResult = getObject(swapData.routerResult);
  const tx = getObject(swapData.tx);
  if (
    !routerResult ||
    routerResult.executionMode === 'RFQ' ||
    readString(routerResult, ['vendorName']) !== quote.vendorName ||
    readString(routerResult, ['feeAmount']) !== quote.feeAmountRaw ||
    readString(routerResult, ['feeToken'])?.toLowerCase() !== fromAddress.toLowerCase() ||
    !tx
  ) {
    throw new Error('Binance Web3 returned an invalid or unsupported swap transaction.');
  }
  const swap = normalizeAggregatorTransaction(tx);
  let approval: OkxTransaction | undefined;
  if (!isNativeInput && quote.approveTarget) {
    const approvalParams = new URLSearchParams({
      binanceChainId: binanceChainIdOf(chain),
      tokenContractAddress: fromAddress,
      approveAmount: quote.inputAmountRaw,
    });
    const approvalData = readBinanceAggregatorData(
      await requestBinanceAggregator('approve-transaction', approvalParams)
    );
    const spender = readString(approvalData, ['dexContractAddress']);
    if (!spender || spender.toLowerCase() !== quote.approveTarget.toLowerCase()) {
      throw new Error('Binance Web3 approval target does not match the selected quote.');
    }
    approval = normalizeAggregatorTransaction(approvalData, fromAddress);
  }
  return {
    provider: 'binance',
    approval,
    swap,
    feeIncluded: true,
    feeTokenAddress: fromTokenAddress,
    feeAmountRaw: quote.feeAmountRaw,
    feeDecimals: quote.feeDecimals,
  };
}

export interface BankrRecentSale {
  tokenAddress: string;
  poolAddress: string;
  timestamp: number;
  txHash?: string;
  logIndex?: number;
}

export interface BuyValue {
  usd: number | null;
  quoteAmount: number;
  quoteSymbol: string;
  buyer: string;
  isDev: boolean;
}

export const buySaleKey = (sale: { txHash: string; logIndex: number }) => `${sale.txHash.toLowerCase()}:${sale.logIndex}`;

// USD value, buyer and dev flag of the given buys, decoded on-chain by /api/buy-values.
export async function fetchBuyValues(
  sales: (BankrRecentSale & { txHash: string; logIndex: number })[],
  signal?: AbortSignal,
): Promise<Record<string, BuyValue | null>> {
  // Batches run in parallel (one slow or failed batch no longer holds up or discards the
  // others). Keys missing from the result failed and should be retried.
  const batches: (typeof sales)[] = [];
  for (let index = 0; index < sales.length; index += 25) batches.push(sales.slice(index, index + 25));
  const results = await Promise.allSettled(batches.map(async (batch) => {
    const refs = batch.map((sale) => `${sale.txHash}:${sale.logIndex}:${sale.tokenAddress}:${sale.poolAddress}`).join(',');
    const response = await fetch(`/api/buy-values?sales=${refs}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: signalWithTimeout(signal, 20_000),
    });
    if (!response.ok) throw new Error(`Buy values request failed (${response.status}).`);
    const payload = await response.json() as { values?: Record<string, BuyValue | null> };
    return payload.values ?? {};
  }));
  const values: Record<string, BuyValue | null> = {};
  results.forEach((result) => { if (result.status === 'fulfilled') Object.assign(values, result.value); });
  return values;
}

export interface BankrTokenHolder {
  address: string;
  balance: string;
  share: number | null;
  label?: string;
}

export interface BankrTokenStats {
  address: string;
  burnedAmount: string | null;
  burnUpdatedAt: number | null;
  burnLoaded: boolean;
  holderCount: number | null;
  // GeckoTerminal indexes holders continuously; counts are close but not exact.
  holdersComplete: boolean;
  holdersLoaded: boolean;
  // Percent of supply held by the 10 largest wallets.
  top10Share: number | null;
  topHolders: BankrTokenHolder[];
}

const BANKR_TOKEN_STATS_CACHE_MS = 15 * 60 * 1000;
const BANKR_TOKEN_STATS_RETRY_MS = 60 * 1000;
const BANKR_TOKEN_STATS_CACHE_KEY = 'bankrdex-token-stats-v2';
const BANKR_STATS_CONCURRENCY = 3;
interface BankrTokenStatsCacheEntry {
  expiresAt: number;
  stats: BankrTokenStats;
}

const bankrTokenStatsCache = new Map<string, BankrTokenStatsCacheEntry>();
let bankrTokenStatsCacheLoaded = false;
let bankrTokenStatsCachePersistTimer: number | null = null;

const finiteOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

// Stats are per chain: the same address can exist on several chains.
const statsKey = (token: Pick<Token, 'address' | 'chain'>) => `${token.chain ?? 'base'}:${token.address.toLowerCase()}`;

function readTokenStats(address: string, value: unknown): BankrTokenStats | null {
  const data = getObject(value);
  if (!data || String(data.address).toLowerCase() !== address) return null;
  const holderCount = finiteOrNull(data.holderCount);
  const burnedAmount = typeof data.burnedAmount === 'string' && Number.isFinite(Number(data.burnedAmount))
    ? data.burnedAmount
    : null;
  return {
    address,
    burnedAmount,
    burnUpdatedAt: finiteOrNull(data.burnUpdatedAt),
    burnLoaded: burnedAmount !== null,
    holderCount: holderCount !== null && holderCount >= 0 ? Math.round(holderCount) : null,
    holdersComplete: false,
    holdersLoaded: holderCount !== null,
    top10Share: finiteOrNull(data.top10Share),
    topHolders: [],
  };
}

function loadBankrTokenStatsCache(): void {
  if (bankrTokenStatsCacheLoaded || typeof window === 'undefined') return;
  bankrTokenStatsCacheLoaded = true;
  try {
    const saved = window.localStorage.getItem(BANKR_TOKEN_STATS_CACHE_KEY);
    if (!saved) return;
    const entries: unknown = JSON.parse(saved);
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return;
    Object.entries(entries).forEach(([key, value]) => {
      const entry = getObject(value);
      const address = key.split(':').pop() ?? '';
      const stats = /^[a-z]+:0x[a-f\d]{40}$/.test(key) ? readTokenStats(address, entry?.stats) : null;
      const expiresAt = Number(entry?.expiresAt);
      if (stats) bankrTokenStatsCache.set(key, { expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0, stats });
    });
  } catch (error) {
    console.warn('Unable to read cached Bankr token statistics:', error);
  }
}

function persistBankrTokenStatsCache(): void {
  if (typeof window === 'undefined') return;
  if (bankrTokenStatsCachePersistTimer !== null) window.clearTimeout(bankrTokenStatsCachePersistTimer);
  bankrTokenStatsCachePersistTimer = window.setTimeout(() => {
    bankrTokenStatsCachePersistTimer = null;
    try {
      const recentEntries = [...bankrTokenStatsCache.entries()].slice(-1_000);
      window.localStorage.setItem(BANKR_TOKEN_STATS_CACHE_KEY, JSON.stringify(Object.fromEntries(recentEntries)));
    } catch (error) {
      console.warn('Unable to save cached Bankr token statistics:', error);
    }
  }, 250);
}

// Latest buys across all Bankr pools, decoded on-chain by /api/recent-buys.
export async function fetchBankrRecentSales(signal?: AbortSignal): Promise<BankrRecentSale[]> {
  const response = await fetch('/api/recent-buys', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: signalWithTimeout(signal, 10_000),
  });
  if (!response.ok) throw new Error(`Bankr recent buys request failed (${response.status}).`);

  const payload: unknown = await response.json();
  const data = getObject(payload);
  if (!data || !Array.isArray(data.sales)) {
    throw new Error('Bankr recent buys returned an invalid response.');
  }
  if (data.status === 'unavailable') {
    throw new Error('Bankr recent buys are temporarily unavailable.');
  }

  return data.sales.flatMap((value): BankrRecentSale[] => {
    const sale = getObject(value);
    const tokenAddress = typeof sale?.tokenAddress === 'string' ? sale.tokenAddress : '';
    const poolAddress = typeof sale?.poolAddress === 'string' ? sale.poolAddress : '';
    const timestamp = Number(sale?.time);
    if (
      !/^0x[a-f\d]{40}$/i.test(tokenAddress) ||
      !/^0x(?:[a-f\d]{64}|[a-f\d]{40})$/i.test(poolAddress) ||
      !Number.isSafeInteger(timestamp) ||
      timestamp <= 0 ||
      timestamp > Date.now() + 60_000
    ) return [];

    const txHash = typeof sale?.transactionHash === 'string' && /^0x[a-f\d]{64}$/i.test(sale.transactionHash)
      ? sale.transactionHash.toLowerCase()
      : undefined;
    const logIndex = Number(sale?.logIndex);
    return [{
      tokenAddress: tokenAddress.toLowerCase(),
      poolAddress: poolAddress.toLowerCase(),
      timestamp,
      ...(txHash && Number.isSafeInteger(logIndex) && logIndex >= 0 ? { txHash, logIndex } : {}),
    }];
  });
}

// Holder count, top-10 share and burned supply per token, from /api/token-stats.
export async function fetchBankrTokenStats(
  tokens: Token[],
  signal?: AbortSignal,
  onTokenStats?: (stats: BankrTokenStats) => void,
): Promise<BankrTokenStats[]> {
  loadBankrTokenStatsCache();
  const uniqueTokens = [...new Map(tokens.map((token) => [statsKey(token), token])).values()];
  const statsByAddress = new Map<string, BankrTokenStats>();
  const now = Date.now();
  const tokensToFetch = uniqueTokens.filter((token) => {
    const key = statsKey(token);
    const cached = bankrTokenStatsCache.get(key);
    if (cached) {
      statsByAddress.set(key, cached.stats);
      onTokenStats?.(cached.stats);
      return cached.expiresAt <= now;
    }
    return /^0x[a-f\d]{40}$/i.test(token.address);
  });
  if (tokensToFetch.length === 0) return [...statsByAddress.values()];

  let nextTokenIndex = 0;
  let failures = 0;
  const worker = async () => {
    while (nextTokenIndex < tokensToFetch.length) {
      const token = tokensToFetch[nextTokenIndex++];
      const address = token.address.toLowerCase();
      const key = statsKey(token);
      const cached = bankrTokenStatsCache.get(key);
      let stats: BankrTokenStats | null = null;
      try {
        const response = await fetch(`/api/token-stats/${encodeURIComponent(address)}?chain=${token.chain ?? 'base'}`, {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          signal: signalWithTimeout(signal, 15_000),
        });
        if (!response.ok) throw new Error(`Token stats request failed (${response.status}).`);
        stats = readTokenStats(address, await response.json());
      } catch (error) {
        if (signal?.aborted) throw error;
        failures += 1;
      }
      // Keep the last good values when this refresh came back empty.
      const merged: BankrTokenStats = stats
        ? {
            ...stats,
            holderCount: stats.holderCount ?? cached?.stats.holderCount ?? null,
            holdersLoaded: stats.holdersLoaded || Boolean(cached?.stats.holdersLoaded),
            top10Share: stats.top10Share ?? cached?.stats.top10Share ?? null,
          }
        : cached?.stats ?? readTokenStats(address, { address })!;
      const complete = Boolean(stats && stats.holdersLoaded && stats.burnLoaded);
      bankrTokenStatsCache.delete(key);
      bankrTokenStatsCache.set(key, {
        expiresAt: Date.now() + (complete ? BANKR_TOKEN_STATS_CACHE_MS : BANKR_TOKEN_STATS_RETRY_MS),
        stats: merged,
      });
      persistBankrTokenStatsCache();
      statsByAddress.set(key, merged);
      if (JSON.stringify(cached?.stats) !== JSON.stringify(merged)) onTokenStats?.(merged);
    }
  };

  await Promise.all(Array.from({ length: Math.min(BANKR_STATS_CONCURRENCY, tokensToFetch.length) }, worker));
  if (failures > 0) {
    console.warn(`Token stats unavailable for ${failures} token(s); retrying in ${BANKR_TOKEN_STATS_RETRY_MS / 1000}s.`);
  }
  return uniqueTokens.flatMap((token) => {
    const stats = statsByAddress.get(statsKey(token));
    return stats ? [stats] : [];
  });
}

export interface MarketSnapshot {
  address: string;
  poolAddress: string;
  poolTokenIsBase: boolean;
  quoteLogo?: string;
  priceUsd?: number;
  volume24hUsd?: number;
  liquidityUsd?: number;
  marketCapUsd?: number;
  change5m?: number;
  change1h?: number;
  change24h?: number;
  totalBuys24h?: number;
  totalSells24h?: number;
  totalTx24h?: number;
}

function numericValue(value: unknown): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function isRawBankrToken(value: unknown): value is RawBankrToken {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const token = value as Record<string, unknown>;
  return typeof token.address === 'string' &&
    /^0x[a-f\d]{40}$/i.test(token.address) &&
    typeof token.name === 'string' &&
    token.name.trim().length > 0 &&
    typeof token.symbol === 'string' &&
    token.symbol.trim().length > 0 &&
    (isChainKey(token.chain) || token.chainId === undefined || Boolean(chainById(Number(token.chainId))));
}

function rawTokenChain(t: RawBankrToken): ChainKey {
  if (isChainKey(t.chain)) return t.chain;
  return chainById(Number(t.chainId))?.key ?? 'base';
}

const signalWithTimeout = (signal: AbortSignal | undefined, timeoutMs = 8_000) => {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
};

const CHART_CANDLE_CACHE_PREFIX = 'bankrdex-chart-candles:';
const CHART_CANDLE_CACHE_INDEX_KEY = 'bankrdex-chart-candle-cache-index';
const CHART_CANDLE_CACHE_LIMIT = 12;
const chartCandleCache = new Map<string, Candle[]>();

function normalizeChartCandles(candles: Candle[]): Candle[] {
  const candlesByChartTime = new Map<number, Candle>();
  candles.forEach((candle) => {
    const chartTimestamp = Math.floor(candle.timestamp / 1000);
    candlesByChartTime.set(chartTimestamp, {
      ...candle,
      timestamp: chartTimestamp * 1000,
    });
  });
  return [...candlesByChartTime.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function getChartCandleCacheKey(poolAddress: string, timeframe: BankrChartTimeframe, tokenSide: 'base' | 'quote', chain: ChainKey = 'base') {
  return `${chain}:${poolAddress.toLowerCase()}:${timeframe}:${tokenSide}`;
}

export function readCachedBankrPoolOhlcv(
  poolAddress: string,
  timeframe: BankrChartTimeframe,
  tokenSide: 'base' | 'quote' = 'base',
  chain: ChainKey = 'base'
): Candle[] {
  const key = getChartCandleCacheKey(poolAddress, timeframe, tokenSide, chain);
  const inMemoryCandles = chartCandleCache.get(key);
  if (inMemoryCandles) return normalizeChartCandles(inMemoryCandles);
  if (typeof window === 'undefined') return [];

  try {
    const serializedCandles = window.sessionStorage.getItem(`${CHART_CANDLE_CACHE_PREFIX}${key}`);
    if (!serializedCandles) return [];
    const savedCandles = JSON.parse(serializedCandles) as Candle[];
    if (!Array.isArray(savedCandles)) return [];
    const validCandles = normalizeChartCandles(savedCandles.filter((candle) =>
      Number.isFinite(candle.timestamp) &&
      Number.isFinite(candle.open) &&
      Number.isFinite(candle.high) &&
      Number.isFinite(candle.low) &&
      Number.isFinite(candle.close) &&
      Number.isFinite(candle.volume)
    )).slice(-120);
    if (validCandles.length > 0) chartCandleCache.set(key, validCandles);
    return validCandles;
  } catch {
    return [];
  }
}

function writeCachedBankrPoolOhlcv(key: string, candles: Candle[]): void {
  const trimmedCandles = normalizeChartCandles(candles).slice(-120);
  chartCandleCache.set(key, trimmedCandles);
  if (typeof window === 'undefined') return;

  try {
    const savedIndex = JSON.parse(window.sessionStorage.getItem(CHART_CANDLE_CACHE_INDEX_KEY) || '[]') as unknown;
    const previousKeys = Array.isArray(savedIndex)
      ? savedIndex.filter((cacheKey): cacheKey is string => typeof cacheKey === 'string')
      : [];
    const nextKeys = [key, ...previousKeys.filter((cacheKey) => cacheKey !== key)];
    const evictedKeys = nextKeys.splice(CHART_CANDLE_CACHE_LIMIT);
    evictedKeys.forEach((cacheKey) => window.sessionStorage.removeItem(`${CHART_CANDLE_CACHE_PREFIX}${cacheKey}`));
    window.sessionStorage.setItem(`${CHART_CANDLE_CACHE_PREFIX}${key}`, JSON.stringify(trimmedCandles));
    window.sessionStorage.setItem(CHART_CANDLE_CACHE_INDEX_KEY, JSON.stringify(nextKeys));
  } catch {
    return;
  }
}

function mapGeckoPoolToSnapshot(pool: Record<string, any>, tokenAddress: string, includedTokens: unknown[] = []): MarketSnapshot | null {
  const attributes = pool.attributes || {};
  const relationships = pool.relationships || {};
  const baseAddress = String(relationships.base_token?.data?.id || '').split('_').slice(1).join('_').toLowerCase();
  const baseTokenId = String(relationships.base_token?.data?.id || '').toLowerCase();
  const quoteTokenId = String(relationships.quote_token?.data?.id || '').toLowerCase();
  const quoteAddress = quoteTokenId.split('_').slice(1).join('_').toLowerCase();
  const normalizedAddress = tokenAddress.toLowerCase();
  const isBaseToken = baseAddress === normalizedAddress;
  const isQuoteToken = quoteAddress === normalizedAddress;
  if (!isBaseToken && !isQuoteToken) return null;
  // The pair logo belongs to the other side of the pool. GeckoTerminal sometimes lists the pool
  // inverted (e.g. ZEC / SHIELD), and then its "quote" token is the token itself.
  const pairTokenId = isBaseToken ? quoteTokenId : baseTokenId;
  const pairToken = includedTokens.find((item) =>
    String((item as Record<string, any>)?.id || '').toLowerCase() === pairTokenId
  ) as Record<string, any> | undefined;
  const quoteLogo = typeof pairToken?.attributes?.image_url === 'string'
    && pairToken.attributes.image_url !== 'missing.png'
    ? pairToken.attributes.image_url
    : undefined;

  const invertChange = (value: unknown) => {
    const change = numericValue(value);
    return change > -100 ? ((1 / (1 + change / 100)) - 1) * 100 : 0;
  };
  const transactions = attributes.transactions?.h24 || {};
  const buys = numericValue(transactions.buys);
  const sells = numericValue(transactions.sells);
  const address = String(attributes.address || String(pool.id ?? '').split('_').pop() || '').toLowerCase();

  return {
    address: normalizedAddress,
    poolAddress: address,
    poolTokenIsBase: isBaseToken,
    quoteLogo,
    priceUsd: numericValue(isBaseToken ? attributes.base_token_price_usd : attributes.quote_token_price_usd),
    volume24hUsd: numericValue(attributes.volume_usd?.h24),
    liquidityUsd: numericValue(attributes.reserve_in_usd),
    // GeckoTerminal only reports market_cap_usd for CoinGecko-verified tokens; fresh launches
    // have it null, so fall back to FDV (Bankr supply is fully circulating at launch).
    marketCapUsd: isBaseToken
      ? numericValue(attributes.market_cap_usd) || numericValue(attributes.fdv_usd) || undefined
      : undefined,
    change5m: isBaseToken ? numericValue(attributes.price_change_percentage?.m5) : invertChange(attributes.price_change_percentage?.m5),
    change1h: isBaseToken ? numericValue(attributes.price_change_percentage?.h1) : invertChange(attributes.price_change_percentage?.h1),
    change24h: isBaseToken ? numericValue(attributes.price_change_percentage?.h24) : invertChange(attributes.price_change_percentage?.h24),
    totalBuys24h: isBaseToken ? buys : sells,
    totalSells24h: isBaseToken ? sells : buys,
    totalTx24h: buys + sells,
  };
}

export async function fetchGeckoPoolSnapshots(tokens: Token[], signal?: AbortSignal): Promise<MarketSnapshot[]> {
  const tokensWithPools = tokens.filter((token) => token.poolAddress);
  // GeckoTerminal batches pools per network, so tokens are grouped by chain first.
  const batches: { chain: ChainKey; tokens: Token[] }[] = [];
  const byChain = new Map<ChainKey, Token[]>();
  tokensWithPools.forEach((token) => {
    const chain = token.chain ?? 'base';
    byChain.set(chain, [...(byChain.get(chain) ?? []), token]);
  });
  byChain.forEach((chainTokens, chain) => {
    for (let index = 0; index < chainTokens.length; index += 20) {
      batches.push({ chain, tokens: chainTokens.slice(index, index + 20) });
    }
  });
  const results = await Promise.allSettled(batches.map(async ({ chain, tokens: batch }) => {
    const poolAddresses = [...new Set(batch.map((token) => token.poolAddress!.toLowerCase()))].sort();
    const response = await fetch(`/api/geckoterminal/api/v2/networks/${CHAINS[chain].geckoNetwork}/pools/multi/${poolAddresses.join(',')}?include=base_token,quote_token`, {
      headers: { Accept: 'application/json;version=20230302' },
      signal: signalWithTimeout(signal, 12_000),
    });
    if (!response.ok) throw new Error(`GeckoTerminal pool batch failed (${response.status})`);
    const payload = await response.json();
    const pools = Array.isArray(payload?.data) ? payload.data : [];
    const includedTokens: unknown[] = Array.isArray(payload?.included) ? payload.included : [];
    const poolsByAddress = new Map(pools.map((pool: Record<string, any>) => [
      String(pool.attributes?.address || String(pool.id ?? '').split('_').pop() || '').toLowerCase(),
      pool,
    ]));
    return batch.flatMap((token) => {
      const pool = poolsByAddress.get(token.poolAddress!.toLowerCase());
      const snapshot = pool ? mapGeckoPoolToSnapshot(pool, token.address, includedTokens) : null;
      return snapshot ? [snapshot] : [];
    });
  }));
  return results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
}

// ---- On-chain market index (Base): /api/market/* ------------------------------------------

export interface IndexedStats {
  token_address: string;
  price_usd: number | null;
  change_5m: number | null;
  change_1h: number | null;
  change_24h: number | null;
  volume_24h: number;
  buys_24h: number;
  sells_24h: number;
  traders_24h: number;
  last_trade_at: string | null;
  market_cap_usd: number | null;
}

export async function fetchIndexedStats(addresses: string[], signal?: AbortSignal): Promise<Map<string, IndexedStats>> {
  const result = new Map<string, IndexedStats>();
  const unique = [...new Set(addresses.map((address) => address.toLowerCase()))].filter((address) => /^0x[a-f0-9]{40}$/.test(address));
  for (let index = 0; index < unique.length; index += 100) {
    const response = await fetch(`/api/market/stats?tokens=${unique.slice(index, index + 100).join(',')}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: signalWithTimeout(signal, 12_000),
    });
    if (!response.ok) continue;
    const payload = await response.json() as { stats?: IndexedStats[] };
    payload.stats?.forEach((row) => result.set(row.token_address, row));
  }
  return result;
}

// Indexed USD candles for one Base token (token-based, so no pool address is needed).
export async function fetchIndexedCandles(tokenAddress: string, timeframe: BankrChartTimeframe, limit: number, signal?: AbortSignal): Promise<Candle[]> {
  const response = await fetch(`/api/market/ohlcv?token=${tokenAddress.toLowerCase()}&tf=${encodeURIComponent(timeframe)}&limit=${limit}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: signalWithTimeout(signal, 12_000),
  });
  if (!response.ok) throw new Error(`Indexed candles failed (${response.status}).`);
  const payload = await response.json() as { candles?: { bucket: number; open: number; high: number; low: number; close: number; volume: number }[] };
  return normalizeChartCandles((payload.candles ?? [])
    .filter((row) => [row.open, row.high, row.low, row.close].every((value) => Number.isFinite(value) && value > 0))
    .map((row) => ({ timestamp: row.bucket * 1000, open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume || 0, isUp: row.close >= row.open })));
}

export async function fetchIndexedTrades(tokenAddress: string, signal?: AbortSignal, trader?: string): Promise<BankrPoolTrade[]> {
  const response = await fetch(`/api/market/trades?token=${tokenAddress.toLowerCase()}&limit=50${trader ? `&trader=${trader}` : ''}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: signalWithTimeout(signal, 10_000),
  });
  if (!response.ok) throw new Error(`Indexed trades failed (${response.status}).`);
  const payload = await response.json() as { trades?: { block_number: number; log_index: number; tx_hash: string; trader: string | null; is_buy: boolean; token_amount: number; price_usd: number | null; volume_usd: number | null; ts: string }[] };
  return (payload.trades ?? []).flatMap((trade): BankrPoolTrade[] => {
    const timestamp = Date.parse(trade.ts);
    if (!Number.isFinite(timestamp) || !(trade.token_amount > 0)) return [];
    return [{
      id: `${trade.tx_hash}:${trade.log_index}`,
      type: trade.is_buy ? 'buy' : 'sell',
      priceUsd: trade.price_usd ?? 0,
      amountToken: trade.token_amount,
      amountUsd: trade.volume_usd ?? 0,
      wallet: trade.trader ?? '',
      timestamp,
      txHash: trade.tx_hash,
    }];
  });
}

function applyIndexedStats(token: Token, stats: IndexedStats | undefined): Token {
  if (!stats || !stats.price_usd) return token;
  return {
    ...token,
    priceUsd: stats.price_usd,
    marketCapUsd: stats.market_cap_usd ?? token.marketCapUsd,
    volume24hUsd: stats.volume_24h,
    change5m: stats.change_5m ?? token.change5m,
    change1h: stats.change_1h ?? token.change1h,
    change24h: stats.change_24h ?? token.change24h,
    totalBuys24h: stats.buys_24h,
    totalSells24h: stats.sells_24h,
    totalTx24h: stats.buys_24h + stats.sells_24h,
    lastTradeAt: stats.last_trade_at ? Date.parse(stats.last_trade_at) : token.lastTradeAt,
    liveSnapshotAt: Date.now(),
  };
}

export async function enrichTokenMarketData(tokens: Token[]): Promise<Token[]> {
  const candidates = tokens;
  let snapshots: MarketSnapshot[] = [];
  let indexed = new Map<string, IndexedStats>();
  const baseAddresses = tokens.filter((token) => (token.chain ?? 'base') === 'base').map((token) => token.address);
  const [geckoResult, indexResult] = await Promise.allSettled([
    fetchGeckoPoolSnapshots(candidates),
    baseAddresses.length ? fetchIndexedStats(baseAddresses) : Promise.resolve(indexed),
  ]);
  if (geckoResult.status === 'fulfilled') snapshots = geckoResult.value;
  else console.info('GeckoTerminal market batch unavailable:', geckoResult.reason);
  if (indexResult.status === 'fulfilled') indexed = indexResult.value;
  const snapshotByAddress = new Map(snapshots.map((snapshot) => [`${snapshot.poolAddress}:${snapshot.address}`, snapshot]));

  return tokens.map((token) => {
    const snapshot = token.poolAddress ? snapshotByAddress.get(`${token.poolAddress.toLowerCase()}:${token.address.toLowerCase()}`) : undefined;
    // On-chain index wins for price, changes, volume and trades; GeckoTerminal adds liquidity.
    const indexedStats = (token.chain ?? 'base') === 'base' ? indexed.get(token.address.toLowerCase()) : undefined;
    if (!snapshot) return applyIndexedStats(token, indexedStats);
    return applyIndexedStats({
      ...token,
      priceUsd: snapshot.priceUsd || 0,
      volume24hUsd: snapshot.volume24hUsd || 0,
      liquidityUsd: snapshot.liquidityUsd || 0,
      // Keep the catalog value when the pool snapshot has none, instead of blanking it.
      marketCapUsd: snapshot.marketCapUsd || token.marketCapUsd || 0,
      change5m: snapshot.change5m ?? 0,
      change1h: snapshot.change1h ?? 0,
      change24h: snapshot.change24h ?? 0,
      totalBuys24h: snapshot.totalBuys24h ?? 0,
      totalSells24h: snapshot.totalSells24h ?? 0,
      totalTx24h: snapshot.totalTx24h ?? 0,
      poolTokenIsBase: snapshot.poolTokenIsBase,
      quoteLogo: snapshot.quoteLogo || token.quoteLogo,
      liveSnapshotAt: Date.now(),
    }, indexedStats);
  });
}

const GECKOTERMINAL_TIMEFRAMES: Record<BankrChartTimeframe, { unit: string; aggregate: number }> = {
  '1m': { unit: 'minute', aggregate: 1 },
  '5m': { unit: 'minute', aggregate: 5 },
  '15m': { unit: 'minute', aggregate: 15 },
  '1h': { unit: 'hour', aggregate: 1 },
  '4h': { unit: 'hour', aggregate: 4 },
  '1D': { unit: 'day', aggregate: 1 },
};

export async function fetchBankrPoolOhlcv(
  poolAddress: string,
  timeframe: BankrChartTimeframe,
  signal?: AbortSignal,
  limit = 120,
  tokenSide: 'base' | 'quote' = 'base',
  chain: ChainKey = 'base'
): Promise<Candle[]> {
  const interval = GECKOTERMINAL_TIMEFRAMES[timeframe];
  const params = new URLSearchParams({
    aggregate: String(interval.aggregate),
    limit: String(limit),
    currency: 'usd',
    token: tokenSide,
  });
  const url = `/api/geckoterminal/api/v2/networks/${CHAINS[chain].geckoNetwork}/pools/${encodeURIComponent(poolAddress)}/ohlcv/${interval.unit}?${params}`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json;version=20230302' },
    signal: signalWithTimeout(signal, 12_000),
  });

  if (!response.ok) {
    throw new Error(`GeckoTerminal OHLCV request failed (${response.status})`);
  }

  const payload = await response.json();
  const rows: unknown[] = payload?.data?.attributes?.ohlcv_list || [];
  const candles = normalizeChartCandles(rows
    .filter((row): row is number[] => Array.isArray(row) && row.length >= 6)
    .map(([timestamp, open, high, low, close, volume]) => ({
      timestamp: timestamp * 1000,
      open,
      high,
      low,
      close,
      volume,
      isUp: close >= open,
    }))
    .filter((candle) => [candle.timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite))
    .reverse());

  if (candles.length > 0) {
    const cacheKey = getChartCandleCacheKey(poolAddress, timeframe, tokenSide, chain);
    const previousCandles = readCachedBankrPoolOhlcv(poolAddress, timeframe, tokenSide, chain);
    const mergedCandles = normalizeChartCandles([...previousCandles, ...candles]);
    writeCachedBankrPoolOhlcv(
      cacheKey,
      mergedCandles
    );
  }

  return candles;
}

export async function fetchBankrPoolSnapshot(
  poolAddress: string,
  tokenAddress: string,
  signal?: AbortSignal,
  chain: ChainKey = 'base'
): Promise<BankrPoolSnapshot | null> {
  const requestSignal = signalWithTimeout(signal);
  const url = `/api/geckoterminal/api/v2/networks/${CHAINS[chain].geckoNetwork}/pools/multi/${encodeURIComponent(poolAddress)}?include=base_token,quote_token`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json;version=20230302' },
    signal: requestSignal,
  });

  if (!response.ok) throw new Error(`GeckoTerminal pool request failed (${response.status})`);

  const payload = await response.json();
  const pool = Array.isArray(payload?.data) ? payload.data[0] : null;
  if (!pool) return null;
  const includedTokens: unknown[] = Array.isArray(payload?.included) ? payload.included : [];
  const snapshot = mapGeckoPoolToSnapshot(pool, tokenAddress, includedTokens);
  if (!snapshot || !snapshot.priceUsd) return null;

  return {
    poolTokenIsBase: snapshot.poolTokenIsBase,
    quoteLogo: snapshot.quoteLogo,
    priceUsd: snapshot.priceUsd,
    liquidityUsd: snapshot.liquidityUsd || 0,
    volume24hUsd: snapshot.volume24hUsd || 0,
    marketCapUsd: snapshot.marketCapUsd,
    change5m: snapshot.change5m ?? 0,
    change1h: snapshot.change1h ?? 0,
    change24h: snapshot.change24h ?? 0,
    totalBuys24h: snapshot.totalBuys24h ?? 0,
    totalSells24h: snapshot.totalSells24h ?? 0,
    totalTx24h: snapshot.totalTx24h ?? 0,
  };
}

export async function fetchBankrPoolTrades(
  poolAddress: string,
  tokenAddress: string,
  signal?: AbortSignal,
  chain: ChainKey = 'base'
): Promise<BankrPoolTrade[]> {
  // Base: the on-chain index has every swap with the real trader; GeckoTerminal is the fallback.
  if (chain === 'base') {
    try {
      const indexed = await fetchIndexedTrades(tokenAddress, signal);
      if (indexed.length > 0) return indexed;
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }
  const params = new URLSearchParams({
    limit: '50',
    trade_volume_in_usd_greater_than: '0',
  });
  const url = `/api/geckoterminal/api/v2/networks/${CHAINS[chain].geckoNetwork}/pools/${encodeURIComponent(poolAddress)}/trades?${params}`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json;version=20230302' },
    cache: 'no-store',
    signal: signalWithTimeout(signal),
  });

  if (!response.ok) throw new Error(`GeckoTerminal trades request failed (${response.status})`);

  const payload = await response.json();
  const rows: unknown[] = payload?.data || [];
  const selectedAddress = tokenAddress.toLowerCase();

  return rows.flatMap((row): BankrPoolTrade[] => {
    const resource = row as { id?: unknown; attributes?: Record<string, unknown> };
    const attributes = resource?.attributes;
    if (!attributes) return [];

    const fromTokenAddress = String(attributes.from_token_address || '').toLowerCase();
    const toTokenAddress = String(attributes.to_token_address || '').toLowerCase();
    const isBuy = toTokenAddress === selectedAddress;
    const isSell = fromTokenAddress === selectedAddress;
    if (!isBuy && !isSell) return [];

    const amountToken = numericValue(isBuy ? attributes.to_token_amount : attributes.from_token_amount);
    const amountUsd = numericValue(attributes.volume_in_usd);
    const txHash = String(attributes.tx_hash || '');
    const timestamp = Date.parse(String(attributes.block_timestamp || ''));

    if (amountToken <= 0 || amountUsd <= 0 || !txHash || !Number.isFinite(timestamp)) return [];

    return [{
      id: typeof resource.id === 'string' && resource.id.length > 0
        ? resource.id
        : `${txHash}:${timestamp}:${isBuy ? 'buy' : 'sell'}:${attributes.tx_from_address || ''}:${amountToken}:${amountUsd}`,
      type: isBuy ? 'buy' : 'sell',
      priceUsd: amountUsd / amountToken,
      amountToken,
      amountUsd,
      wallet: String(attributes.tx_from_address || ''),
      timestamp,
      txHash,
    }];
  }).sort((a, b) => b.timestamp - a.timestamp);
}

// Helper: transform raw token into rich Token model
function mapRawToken(t: RawBankrToken): Token {
  const mcap = numericValue(t.marketCapUsd);
  const vol = numericValue(t.volume24hUsd);
  const logo = typeof t.imageUrl === 'string' ? t.imageUrl : '';
  const launchedAt = numericValue(t.launchedAt);
  const createdAt = launchedAt > 0 && Number.isFinite(new Date(launchedAt).getTime())
    ? new Date(launchedAt).toISOString().split('T')[0]
    : '';

  const chain = rawTokenChain(t);
  return {
    id: `bankr-${chain === 'base' ? '' : `${chain}-`}${t.symbol.toLowerCase()}-${t.address.slice(2, 6)}`,
    chain,
    name: t.name || t.symbol,
    symbol: t.symbol,
    address: t.address,
    // Doppler launches trade in a Uniswap V4 pool, identified by a 32-byte pool id.
    poolAddress: typeof t.pool === 'string' && /^0x(?:[a-f\d]{64}|[a-f\d]{40})$/i.test(t.pool) ? t.pool.toLowerCase() : undefined,
    quoteAddress: typeof t.quoteAddress === 'string' && /^0x[a-f\d]{40}$/i.test(t.quoteAddress) ? t.quoteAddress : undefined,
    quoteSymbol: typeof t.quoteSymbol === 'string' ? t.quoteSymbol : undefined,
    priceUsd: numericValue(t.priceUsd),
    priceEth: numericValue(t.priceEth),
    change5m: numericValue(t.change5m),
    change1h: numericValue(t.change1h),
    change24h: numericValue(t.change24h),
    volume24hUsd: Math.round(vol),
    liquidityUsd: numericValue(t.liquidityUsd),
    marketCapUsd: Math.round(mcap),
    // Bankr launches are seeded straight into their Uniswap V4 pool; there is no bonding curve.
    bondingCurveProgress: 100,
    isGraduated: true,
    totalBuys24h: numericValue(t.totalBuys24h),
    totalSells24h: numericValue(t.totalSells24h),
    totalTx24h: numericValue(t.totalTx24h),
    holders: 0,
    creator: typeof t.creator === 'string' ? t.creator : '',
    createdAt,
    launchedAt: launchedAt > 0 ? launchedAt : undefined,
    logo,
    // A paid DexScreener profile's links replace the ones given at launch.
    socials: t.dexSocials && Object.values(t.dexSocials).some(Boolean) ? dexSocialsOf(t.dexSocials) : bankrSocials(t),
    bankr: {
      verifiedBy: t.verifiedBy === 'official' || t.verifiedBy === 'bankr-api' || t.verifiedBy === 'registry' || t.verifiedBy === 'onchain' ? t.verifiedBy : undefined,
      launchType: typeof t.launchType === 'string' ? t.launchType : undefined,
      creatorX: t.creatorX,
      feeRecipient: typeof t.feeRecipient === 'string' ? t.feeRecipient : undefined,
      feeRecipientX: t.feeRecipientX,
      tweetUrl: typeof t.tweetUrl === 'string' && /^https:\/\//i.test(t.tweetUrl) ? t.tweetUrl : undefined,
      txHash: typeof t.txHash === 'string' ? t.txHash : undefined,
    },
    description: typeof t.description === 'string' && t.description.length > 0
      ? t.description
      : `Token launched with Bankr on ${chainByKey(chain).name}.`,
    audit: {
      isHoneypot: null,
      buyTax: null,
      sellTax: null,
      isMintable: null,
      isLpLocked: null,
      contractVerified: null,
      riskScore: 'UNKNOWN',
    },
    dexscreenerPaidInfo: {
      hasPaid: t.dexPaid ? true : null,
      paidType: t.dexPaid === 'communityTakeover' ? 'community_takeover' : t.dexPaid ? 'enhanced_profile' : 'unknown',
      socialsCount: t.dexSocials
        ? (['twitter', 'telegram', 'discord', 'farcaster', 'website'] as const).filter((kind) => t.dexSocials?.[kind]).length
        : (typeof t.website === 'string' && t.website ? 1 : 0) + (typeof t.twitter === 'string' && t.twitter ? 1 : 0),
      hasBanner: null,
      hasCustomIcon: logo ? true : null,
      verifiedBadge: null,
      dexUrl: dexscreenerUrl(chain, t.address),
    },
  };
}

// Bankr stores a bare handle or a full URL; only https links (or handles) are rendered.
function bankrSocials(t: RawBankrToken): TokenSocials | undefined {
  const twitterRaw = typeof t.twitter === 'string' ? t.twitter.trim() : '';
  const websiteRaw = typeof t.website === 'string' ? t.website.trim() : '';
  const twitter = /^https:\/\//i.test(twitterRaw)
    ? twitterRaw
    : /^@?[A-Za-z0-9_]{1,15}$/.test(twitterRaw) ? `https://x.com/${twitterRaw.replace(/^@/, '')}` : undefined;
  const website = /^https:\/\//i.test(websiteRaw) ? websiteRaw : undefined;
  return twitter || website ? { twitter, website, source: 'launch' } : undefined;
}

// 3. Guaranteed local fallback for verified Bankr data when live fetch is unavailable.
export function getInitialBankrTokens(tab: BankrTab = 'trending'): Token[] {
  const rawList: RawBankrToken[] = (bankrTokensJson as { tokens?: RawBankrToken[] }).tokens || [];

  const sorted = [...rawList].sort((a, b) => {
    if (tab === 'last-sale') {
      return numericValue(b.launchedAt) - numericValue(a.launchedAt);
    }
    if (tab === 'market-cap') {
      return numericValue(b.marketCapUsd) - numericValue(a.marketCapUsd);
    }
    return numericValue(b.trendingScore || b.volume24hUsd) - numericValue(a.trendingScore || a.volume24hUsd);
  });

  const mappedTokens = sorted.map((token) => mapRawToken(token));
  const logoByAddress = new Map(mappedTokens.map((token) => [token.address.toLowerCase(), token.logo]));
  return mappedTokens.map((token) => ({
    ...token,
    quoteLogo: token.quoteAddress ? logoByAddress.get(token.quoteAddress.toLowerCase()) : undefined,
  }));
}

// Tokens launched after `since` (ms), from the small near-live endpoint. Polled often so new
// launches appear within seconds; the full registry refresh still runs on its own slower cycle.
export async function fetchNewBankrTokens(since: number, signal?: AbortSignal): Promise<Token[]> {
  const response = await fetch(`/api/token-catalog?since=${Math.floor(since)}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: signalWithTimeout(signal, 15_000),
  });
  if (!response.ok) throw new Error(`New token request failed (${response.status}).`);
  const data = await response.json();
  const rawTokens: RawBankrToken[] = Array.isArray(data?.tokens) ? data.tokens.filter(isRawBankrToken) : [];
  return rawTokens.map((token) => mapRawToken(token));
}

// One Bankr token by address, for links to launches outside the market catalog.
export async function fetchBankrTokenByAddress(address: string, signal?: AbortSignal, chain?: ChainKey): Promise<Token | null> {
  const response = await fetch(`/api/bankr-launches/${encodeURIComponent(address.toLowerCase())}${chain ? `?chain=${chain}` : ''}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: signalWithTimeout(signal, 15_000),
  });
  if (!response.ok) return null;
  const payload = await response.json() as { token?: unknown };
  return isRawBankrToken(payload.token) ? mapRawToken(payload.token) : null;
}

export interface LaunchPage {
  tokens: Token[];
  total: number;
  next: number | null;
  complete: boolean;
}

// One page of the on-chain launch registry (every Bankr launch on Base, newest first), with
// market data for the page from a single GeckoTerminal tokens/multi request.
export async function fetchLaunchPage(
  options: { before?: number | null; query?: string; limit?: number },
  signal?: AbortSignal,
): Promise<LaunchPage> {
  const params = new URLSearchParams({ limit: String(Math.min(options.limit ?? 30, 30)) });
  if (options.before) params.set('before', String(options.before));
  if (options.query?.trim()) params.set('q', options.query.trim());
  const response = await fetch(`/api/bankr-launches?${params}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: signalWithTimeout(signal, 20_000),
  });
  if (!response.ok) throw new Error(`Launch registry request failed (${response.status}).`);
  const payload = await response.json() as {
    launches?: { address: string; name: string | null; symbol: string | null; quote: string; quoteSymbol: string; launchedAt: number; txHash: string }[];
    total?: number;
    next?: number | null;
    complete?: boolean;
  };
  const launches = (payload.launches ?? []).filter((launch) => /^0x[a-f0-9]{40}$/.test(launch.address));
  const market = new Map<string, { snapshot: MarketSnapshot | null; image?: string; fdv: number; volume: number; liquidity: number; price: number }>();
  if (launches.length > 0) {
    try {
      const geckoResponse = await fetch(
        `/api/geckoterminal/api/v2/networks/base/tokens/multi/${launches.map((launch) => launch.address).join(',')}?include=top_pools`,
        { headers: { Accept: 'application/json;version=20230302' }, signal: signalWithTimeout(signal, 15_000) },
      );
      if (geckoResponse.ok) {
        const gecko = await geckoResponse.json() as { data?: Record<string, any>[]; included?: Record<string, any>[] };
        const pools = new Map((gecko.included ?? []).map((pool) => [String(pool.id).toLowerCase(), pool]));
        for (const item of gecko.data ?? []) {
          const address = String(item.attributes?.address ?? '').toLowerCase();
          const poolId = String(item.relationships?.top_pools?.data?.[0]?.id ?? '').toLowerCase();
          const pool = pools.get(poolId);
          const image = typeof item.attributes?.image_url === 'string' && item.attributes.image_url.startsWith('https://') && !item.attributes.image_url.includes('missing')
            ? item.attributes.image_url
            : undefined;
          market.set(address, {
            snapshot: pool ? mapGeckoPoolToSnapshot(pool, address, []) : null,
            image,
            fdv: numericValue(item.attributes?.market_cap_usd) || numericValue(item.attributes?.fdv_usd),
            volume: numericValue(item.attributes?.volume_usd?.h24),
            liquidity: numericValue(item.attributes?.total_reserve_in_usd),
            price: numericValue(item.attributes?.price_usd),
          });
        }
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      // Rows still render; market cells stay empty until GeckoTerminal answers.
    }
  }
  const tokens = launches.map((launch): Token => {
    const info = market.get(launch.address);
    const snapshot = info?.snapshot;
    const token = mapRawToken({
      address: launch.address,
      name: launch.name || launch.symbol || launch.address.slice(0, 10),
      symbol: launch.symbol || '?',
      chain: 'base',
      pool: snapshot?.poolAddress,
      quoteAddress: launch.quote,
      quoteSymbol: launch.quoteSymbol,
      launchedAt: launch.launchedAt,
      txHash: launch.txHash,
      imageUrl: info?.image,
    });
    return {
      ...token,
      priceUsd: snapshot?.priceUsd || info?.price || 0,
      marketCapUsd: snapshot?.marketCapUsd || info?.fdv || 0,
      volume24hUsd: snapshot?.volume24hUsd ?? info?.volume ?? 0,
      liquidityUsd: snapshot?.liquidityUsd || info?.liquidity || 0,
      change5m: snapshot?.change5m ?? 0,
      change1h: snapshot?.change1h ?? 0,
      change24h: snapshot?.change24h ?? 0,
      totalBuys24h: snapshot?.totalBuys24h ?? 0,
      totalSells24h: snapshot?.totalSells24h ?? 0,
      totalTx24h: snapshot?.totalTx24h ?? 0,
      poolTokenIsBase: snapshot?.poolTokenIsBase,
      liveSnapshotAt: info ? Date.now() : undefined,
    };
  });
  return {
    tokens,
    total: typeof payload.total === 'number' ? payload.total : tokens.length,
    next: payload.next ?? null,
    complete: payload.complete === true,
  };
}

// 4. Fetch the complete live launchpad registry from Bankr and sort it by tab.
export async function fetchBankrTokens(tab: BankrTab = 'trending'): Promise<Token[]> {
  try {
    const url = '/api/token-catalog';
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    if (res.ok) {
      const data = await res.json();
      const rawTokens: RawBankrToken[] = Array.isArray(data?.tokens)
        ? [...new Map<string, RawBankrToken>(
            data.tokens
              .filter(isRawBankrToken)
              .map((token: RawBankrToken): [string, RawBankrToken] => [
                token.address.toLowerCase(),
                token,
              ])
          ).values()]
        : [];

      if (rawTokens.length > 0) {
        const sorted = [...rawTokens].sort((a, b) => {
          if (tab === 'last-sale') {
            return numericValue(b.launchedAt) - numericValue(a.launchedAt);
          }
          if (tab === 'market-cap') {
            return numericValue(b.marketCapUsd) - numericValue(a.marketCapUsd);
          }
          return numericValue(b.trendingScore || b.volume24hUsd) - numericValue(a.trendingScore || a.volume24hUsd);
        });

        const mappedTokens = sorted.map((token) => mapRawToken(token));
        const logoByAddress = new Map(mappedTokens.map((token) => [token.address.toLowerCase(), token.logo]));
        return mappedTokens.map((token) => ({
          ...token,
          quoteLogo: token.quoteAddress ? logoByAddress.get(token.quoteAddress.toLowerCase()) : undefined,
        }));
      }
    }
  } catch (error) {
    console.info('Live Bankr fetch failed, using local verified fallback:', error);
  }

  // Final fallback: local verified dataset embedded in the app.
  return getInitialBankrTokens(tab);
}

// 5. Estimate a quote locally from pool liquidity (used before an aggregator quote arrives)
export function calculateOkxXRouting(
  inputAmount: number,
  inputTokenPriceUsd: number,
  outputTokenPriceUsd: number,
  liquidityUsd: number
) {
  if (!inputAmount || inputAmount <= 0) {
    return {
      outputAmount: 0,
      outputUsd: 0,
      priceImpact: 0,
      minimumReceived: 0,
      estimatedGasEth: 0,
      estimatedGasUsd: 0,
      routeSplit: [],
      rateUsd: outputTokenPriceUsd,
    };
  }

  const inputUsd = inputAmount * inputTokenPriceUsd;
  if (inputTokenPriceUsd <= 0 || outputTokenPriceUsd <= 0) {
    return {
      outputAmount: 0,
      outputUsd: 0,
      priceImpact: 0,
      minimumReceived: 0,
      estimatedGasEth: 0,
      estimatedGasUsd: 0,
      routeSplit: [],
      rateUsd: 0,
    };
  }

  const rawOutput = inputUsd / outputTokenPriceUsd;
  const priceImpact = liquidityUsd > 0 ? Math.min(10, Math.max(0.01, (inputUsd / liquidityUsd) * 100)) : 0;

  const finalOutput = rawOutput * (1 - priceImpact / 100);
  const minReceived = finalOutput * 0.995; // 0.5% default slippage

  return {
    outputAmount: finalOutput,
    outputUsd: finalOutput * outputTokenPriceUsd,
    priceImpact: +priceImpact.toFixed(2),
    minimumReceived: minReceived,
    estimatedGasEth: 0,
    estimatedGasUsd: 0,
    routeSplit: [],
    rateUsd: outputTokenPriceUsd,
  };
}

interface ExternalMarketTokenPayload {
  source: 'binance';
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
  quoteSymbol?: string;
  quoteAddress?: string;
  poolAddress?: string;
  dexId?: string;
  socials?: TokenSocials;
  activity?: TokenActivity;
  buyTax?: number | null;
  sellTax?: number | null;
  lastTradeAt?: number;
}

export interface BankrMarketStat extends BinanceMarketPrice {
  change1h: number;
}

// Binance Web3 hot tokens on Base (outside Bankr), normalized by /api/market-sources.
export async function fetchExternalMarketTokens(signal?: AbortSignal): Promise<Token[]> {
  return (await fetchMarketSources(signal)).tokens;
}

// Same feed plus live stats for the most-traded Bankr tokens.
export async function fetchMarketSources(signal?: AbortSignal): Promise<{ tokens: Token[]; bankrStats: BankrMarketStat[] }> {
  const response = await fetch('/api/market-sources', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: signalWithTimeout(signal, 20_000),
  });
  if (!response.ok) throw new Error(`External market sources failed (${response.status}).`);
  const payload = await response.json() as { tokens?: ExternalMarketTokenPayload[]; bankrStats?: (Omit<BankrMarketStat, 'activity'> & { activity?: TokenActivity })[] };
  const bankrStats = (payload.bankrStats ?? []).map((stat): BankrMarketStat => ({ ...stat, activity: stat.activity ?? {} }));
  return { bankrStats, tokens: (payload.tokens ?? []).map((item): Token => ({
    id: `${item.source}-${item.address}`,
    name: item.name || item.symbol,
    symbol: item.symbol || '?',
    address: item.address,
    priceUsd: item.priceUsd,
    priceEth: 0,
    change5m: item.change5m,
    change1h: item.change1h,
    change24h: item.change24h,
    volume24hUsd: item.volume24hUsd,
    liquidityUsd: item.liquidityUsd,
    marketCapUsd: item.marketCapUsd,
    liveSnapshotAt: Date.now(),
    bondingCurveProgress: item.bondingProgress,
    isGraduated: item.isGraduated,
    totalBuys24h: item.buys24h,
    totalSells24h: item.sells24h,
    totalTx24h: item.txs24h,
    holders: item.holders,
    creator: '',
    createdAt: item.createdAt,
    logo: item.logo,
    description: '',
    externalSource: 'market',
    source: item.source,
    externalUrl: item.externalUrl,
    quoteSymbol: item.quoteSymbol || undefined,
    quoteAddress: item.quoteAddress || undefined,
    // GeckoTerminal reads both 20-byte pools and 32-byte Uniswap V4 pool ids on Base.
    poolAddress: /^0x(?:[a-f0-9]{64}|[a-f0-9]{40})$/.test(item.poolAddress ?? '') ? item.poolAddress : undefined,
    socials: item.socials,
    activity: item.activity,
    lastTradeAt: item.lastTradeAt || undefined,
    audit: { isHoneypot: null, buyTax: item.buyTax ?? null, sellTax: item.sellTax ?? null, isMintable: null, isLpLocked: null, contractVerified: null, riskScore: 'UNKNOWN' },
    dexscreenerPaidInfo: {
      hasPaid: null, paidType: 'unknown', socialsCount: 0, hasBanner: null, hasCustomIcon: null, verifiedBadge: null,
      dexUrl: `https://dexscreener.com/base/${item.address}`,
    },
  })) };
}

// Finds the deepest liquidity pool for a token (via Binance Web3) so the chart can load it.
export async function resolveTokenPool(address: string, signal?: AbortSignal): Promise<{ poolAddress?: string; quoteSymbol?: string } | null> {
  const params = new URLSearchParams({ binanceChainId: '8453', tokenContractAddress: address });
  const response = await fetch(`/api/binance-web3/general/top-liquidity?${params}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: signalWithTimeout(signal, 10_000),
  });
  if (!response.ok) return null;
  const payload = getObject(await response.json().catch(() => null));
  const pools = Array.isArray(payload?.data) ? payload.data : [];
  const ranked = pools
    .map((item) => getObject(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .sort((left, right) => Number(right.liquidityUsd) - Number(left.liquidityUsd));
  if (ranked.length === 0) return null;
  // Quote symbol from the deepest pool; GeckoTerminal charts both 20-byte pools and 32-byte
  // Uniswap V4 pool ids on Base.
  const quoteSymbol = readString(ranked[0], ['pool'])?.split('/')[1]?.trim() || undefined;
  const addressable = ranked.find((item) => /^0x(?:[a-fA-F0-9]{64}|[a-fA-F0-9]{40})$/.test(String(item.poolAddress)));
  return { poolAddress: addressable ? String(addressable.poolAddress).toLowerCase() : undefined, quoteSymbol };
}

const BINANCE_CANDLE_BARS: Record<BankrChartTimeframe, string> = {
  '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1D': '1d',
};

// Binance Web3 token candles: rows are [open, high, low, close, volumeUsd, timestampMs, trades].
export async function fetchBinanceTokenCandles(
  tokenAddress: string,
  timeframe: BankrChartTimeframe,
  signal?: AbortSignal,
  limit = 120
): Promise<Candle[]> {
  const params = new URLSearchParams({
    binanceChainId: '8453',
    tokenContractAddress: tokenAddress,
    bar: BINANCE_CANDLE_BARS[timeframe],
    limit: String(Math.min(Math.max(limit, 1), 500)),
  });
  const response = await fetch(`/api/binance-web3/general/candles?${params}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: signalWithTimeout(signal, 12_000),
  });
  if (!response.ok) throw new Error(`Binance Web3 candles failed (${response.status}).`);
  const payload = getObject(await response.json().catch(() => null));
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows.flatMap((row): Candle[] => {
    if (!Array.isArray(row) || row.length < 6) return [];
    const [open, high, low, close, volume, timestamp] = row.map(Number);
    if (![open, high, low, close, timestamp].every((value) => Number.isFinite(value) && value > 0)) return [];
    return [{ timestamp, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0, isUp: close >= open }];
  }).sort((left, right) => left.timestamp - right.timestamp);
}
