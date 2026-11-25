import { createHmac } from 'node:crypto';
import { getBinanceWeb3Credentials } from '../../../../../src/server/binanceWeb3Credentials';
import { getBaseBankrTokens, type BankrCatalogToken } from '../../../../../src/server/bankrTokenCatalog';
import { getExternalTokenAddresses } from '../../../../../src/server/marketSources';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type EndpointConfig = {
  path: string;
  method: 'GET' | 'POST';
  tokenScoped?: boolean;
  globalList?: boolean;
};

const endpoints: Record<string, EndpointConfig> = {
  chains: { path: '/api/v1/dex/market/supported/chain', method: 'GET' },
  price: { path: '/api/v1/dex/market/price', method: 'POST', tokenScoped: true },
  'trading-info': { path: '/api/v1/dex/market/price-info', method: 'POST', tokenScoped: true },
  candles: { path: '/api/v1/dex/market/candles', method: 'GET', tokenScoped: true },
  search: { path: '/api/v1/dex/market/token/search', method: 'GET', globalList: true },
  'basic-info': { path: '/api/v1/dex/market/token/basic-info', method: 'POST', tokenScoped: true },
  'advanced-info': { path: '/api/v1/dex/market/token/advanced-info', method: 'GET', tokenScoped: true },
  'hot-tokens': { path: '/api/v1/dex/market/token/hot-token', method: 'GET', globalList: true },
  holders: { path: '/api/v1/dex/market/token/holder', method: 'GET', tokenScoped: true },
  'top-traders': { path: '/api/v1/dex/market/token/top-trader', method: 'GET', tokenScoped: true },
  'top-liquidity': { path: '/api/v1/dex/market/token/top-liquidity', method: 'GET', tokenScoped: true },
  trades: { path: '/api/v1/dex/market/trades', method: 'GET', tokenScoped: true },
  'dev-info': { path: '/api/v1/dex/market/memepump/tokenDevInfo', method: 'GET', tokenScoped: true },
};

const addressPattern = /^0x[a-f\d]{40}$/i;
const tokenAddressFields = ['tokenContractAddress', 'tokenAddress', 'contractAddress', 'address'];

function errorResponse(message: string, status = 400): Response {
  return Response.json({ error: message }, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function getAddress(value: unknown): string | null {
  const record = getRecord(value);
  if (!record) return null;
  for (const key of tokenAddressFields) {
    const address = record[key];
    if (typeof address === 'string' && addressPattern.test(address)) return address.toLowerCase();
  }
  return null;
}

function makeSuccessResponse(data: unknown): Response {
  return Response.json(
    { code: 0, msg: 'success', data, success: true },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

function filterGlobalResponse(payload: unknown, allowedAddresses: Set<string>): unknown {
  const envelope = getRecord(payload);
  if (!envelope) return payload;
  const data = envelope.data;
  if (Array.isArray(data)) {
    return { ...envelope, data: data.filter((item) => {
      const address = getAddress(item);
      return address !== null && allowedAddresses.has(address);
    }) };
  }
  if (getRecord(data)) {
    const address = getAddress(data);
    return address && allowedAddresses.has(address) ? payload : { ...envelope, data: null };
  }
  return { ...envelope, data: [] };
}

function validChain(chainId: string | null): boolean {
  return chainId === '8453';
}

function validateScopedQuery(
  endpoint: string,
  query: URLSearchParams,
  allowedAddresses: Set<string>,
  allowedTokens: BankrCatalogToken[]
): string | null {
  if (endpoint === 'chains') return null;
  if (endpoint === 'search') {
    if (query.get('chains') !== '8453') return 'Search is limited to Base (8453).';
    const search = query.get('search')?.trim();
    if (!search || search.length > 80) return 'Search requires a short Bankr token name, symbol, or address.';
    const needle = search.toLowerCase();
    const hasMatch = allowedTokens.some((token) =>
      [token.name, token.symbol, token.address]
        .some((value) => typeof value === 'string' && value.toLowerCase().includes(needle))
    );
    return hasMatch ? null : 'Search must match a token in the Bankr catalog.';
  }

  if (!validChain(query.get('binanceChainId'))) return 'Only Base (8453) is enabled.';
  if (endpoint === 'hot-tokens') return null;

  const address = query.get('tokenContractAddress')?.toLowerCase();
  if (!address || !addressPattern.test(address)) return 'A valid token contract address is required.';
  if (!allowedAddresses.has(address)) return 'Only tokens listed by Bankr are supported.';

  if (endpoint === 'candles') {
    const bar = query.get('bar') || '1h';
    if (!/^(1m|3m|5m|15m|30m|1h|2h|4h|6h|8h|12h|1d|3d|1w|1M)$/.test(bar)) {
      return 'Unsupported candle interval.';
    }
    query.set('bar', bar);
    const limit = query.get('limit');
    if (limit && (!/^\d{1,3}$/.test(limit) || Number(limit) < 1 || Number(limit) > 500)) {
      return 'Candle limit must be between 1 and 500.';
    }
    if (!limit) query.set('limit', '100');
    for (const field of ['after', 'before']) {
      const value = query.get(field);
      if (value && !/^\d{1,16}$/.test(value)) return `${field} must be a Unix timestamp in milliseconds.`;
    }
  }

  if (endpoint === 'trades') {
    const limit = query.get('limit') || '30';
    if (!/^\d{1,3}$/.test(limit) || Number(limit) < 1 || Number(limit) > 100) {
      return 'Trade limit must be between 1 and 100.';
    }
    query.set('limit', limit);
    const wallet = query.get('walletAddressFilter');
    if (wallet && !addressPattern.test(wallet)) return 'Wallet address filter is invalid.';
    const cursor = query.get('cursor');
    if (cursor && cursor.length > 512) return 'Trade cursor is too long.';
    const tagFilter = query.get('tagFilter');
    if (tagFilter && !/^\d{1,3}$/.test(tagFilter)) return 'Trade tag filter is invalid.';
  }

  return null;
}

function validateBatchBody(endpoint: string, body: unknown, allowedAddresses: Set<string>): string | null {
  const items = endpoint === 'basic-info'
    ? [body]
    : Array.isArray(body) ? body : null;
  if (!items || items.length < 1 || items.length > 100) {
    return endpoint === 'basic-info'
      ? 'Provide one Bankr token record.'
      : 'Provide 1 to 100 Bankr token records.';
  }
  for (const item of items) {
    const record = getRecord(item);
    const address = getAddress(item);
    if (
      !record ||
      typeof record.tokenContractAddress !== 'string' ||
      !address ||
      !validChain(typeof record.binanceChainId === 'string' ? record.binanceChainId : null) ||
      !allowedAddresses.has(address)
    ) {
      return 'Requests may contain only Base tokens listed by Bankr.';
    }
  }
  return null;
}

function buildUpstreamQuery(endpoint: string, incoming: URLSearchParams): URLSearchParams {
  const query = new URLSearchParams();
  if (endpoint === 'chains') return query;

  if (endpoint === 'search') {
    query.set('chains', '8453');
    query.set('search', incoming.get('search')!.trim());
    return query;
  }

  query.set('binanceChainId', '8453');
  if (endpoint === 'hot-tokens') return query;

  query.set('tokenContractAddress', incoming.get('tokenContractAddress')!.toLowerCase());
  if (endpoint === 'candles') {
    query.set('bar', incoming.get('bar') || '1h');
    query.set('limit', incoming.get('limit') || '100');
    for (const field of ['after', 'before']) {
      const value = incoming.get(field);
      if (value) query.set(field, value);
    }
  } else if (endpoint === 'trades') {
    query.set('limit', incoming.get('limit') || '30');
    for (const field of ['cursor', 'tagFilter', 'walletAddressFilter']) {
      const value = incoming.get(field);
      if (value) query.set(field, value);
    }
  } else if (endpoint === 'holders' || endpoint === 'top-traders') {
    const tagFilter = incoming.get('tagFilter');
    if (tagFilter && /^\d{1,3}$/.test(tagFilter)) query.set('tagFilter', tagFilter);
  }
  return query;
}

export async function GET(request: Request, context: { params: Promise<{ endpoint: string }> }) {
  return executeRequest(request, context, undefined);
}

export async function POST(request: Request, context: { params: Promise<{ endpoint: string }> }) {
  const { endpoint } = await context.params;
  if (endpoint === 'basic-info') return executeRequest(request, context, undefined);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Request body must be valid JSON.');
  }
  return executeRequest(request, context, body);
}

async function executeRequest(
  request: Request,
  context: { params: Promise<{ endpoint: string }> },
  body: unknown
): Promise<Response> {
  const { endpoint } = await context.params;
  const config = endpoints[endpoint];
  if (!config) return errorResponse('Unsupported Binance Web3 General Data endpoint.', 404);
  if (request.method !== config.method) return errorResponse(`Use ${config.method} for this endpoint.`, 405);

  const url = new URL(request.url);
  let allowedAddresses = new Set<string>();
  let allowedTokens: BankrCatalogToken[] = [];
  if (config.tokenScoped || config.globalList) {
    try {
      allowedTokens = await getBaseBankrTokens();
      // Bankr tokens plus the Binance-hot Base tokens shown in the market table.
      allowedAddresses = new Set([
        ...allowedTokens.map((token) => String(token.address).toLowerCase()),
        ...await getExternalTokenAddresses(),
      ]);
    } catch (error) {
      console.error('Unable to verify the Bankr token catalog for Binance Web3:', error);
      return errorResponse('Unable to verify the Bankr token catalog.', 503);
    }
  }

  const query = config.method === 'GET'
    || endpoint === 'basic-info'
    ? buildUpstreamQuery(endpoint, url.searchParams)
    : new URLSearchParams();
  const validationError = config.method === 'GET' || endpoint === 'basic-info'
    ? validateScopedQuery(endpoint, query, allowedAddresses, allowedTokens)
    : null;
  if (validationError) {
    if (endpoint === 'search' && validationError === 'Search must match a token in the Bankr catalog.') {
      return makeSuccessResponse([]);
    }
    return errorResponse(validationError);
  }

  let requestBody: string | undefined;
  if (config.method === 'POST' && endpoint !== 'basic-info') {
    const bodyError = validateBatchBody(endpoint, body, allowedAddresses);
    if (bodyError) return errorResponse(bodyError);
    requestBody = JSON.stringify(body);
  }

  const credentials = getBinanceWeb3Credentials();
  if (!credentials.apiKey || !credentials.secretKey) {
    return errorResponse('Binance Web3 API credentials are not configured on the server.', 503);
  }

  const requestPath = `${config.path}${query.size ? `?${query.toString()}` : ''}`;
  const signedPath = `/build${requestPath}`;
  const timestamp = new Date().toISOString();
  const signature = createHmac('sha256', credentials.secretKey)
    .update(`${timestamp}${config.method}${signedPath}${requestBody || ''}`, 'utf8')
    .digest('base64');

  try {
    const upstream = await fetch(`https://web3.binance.com${signedPath}`, {
      method: config.method,
      headers: {
        Accept: 'application/json',
        'X-OC-APIKEY': credentials.apiKey,
        'X-OC-SIGN': signature,
        'X-OC-TIMESTAMP': timestamp,
        ...(requestBody ? { 'Content-Type': 'application/json' } : {}),
        ...(requestBody ? { 'X-OC-RECV-WINDOW': '5000' } : {}),
      },
      ...(requestBody ? { body: requestBody } : {}),
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
    const upstreamBody = await upstream.text();
    if (!upstream.ok) {
      return new Response(upstreamBody, {
        status: upstream.status,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(upstreamBody);
    } catch {
      return errorResponse('Binance Web3 returned an invalid JSON response.', 502);
    }
    if (endpoint === 'chains') {
      const envelope = getRecord(payload);
      const data = envelope?.data;
      if (Array.isArray(data)) {
        payload = {
          ...envelope,
          data: data.filter((entry) => {
            const record = getRecord(entry);
            return record?.binanceChainId === '8453';
          }),
        };
      }
    } else if (config.globalList) {
      let resultAddresses = allowedAddresses;
      if (endpoint === 'search') {
        const needle = url.searchParams.get('search')!.trim().toLowerCase();
        resultAddresses = new Set(allowedTokens
          .filter((token) => [token.name, token.symbol, token.address]
            .some((value) => typeof value === 'string' && value.toLowerCase().includes(needle)))
          .map((token) => String(token.address).toLowerCase()));
      }
      payload = filterGlobalResponse(payload, resultAddresses);
    }
    return Response.json(payload, {
      status: upstream.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error(`Binance Web3 ${endpoint} request failed:`, error);
    return errorResponse('Unable to reach the Binance Web3 API.', 502);
  }
}
