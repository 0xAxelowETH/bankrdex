import { z } from 'zod';
import { isOkxConfigured, okxHeaders } from '../../../../src/server/okxDex';
import {
  badRequest,
  evmAddress,
  routerChain,
  feePercent,
  feeReceiver,
  parseQuery,
  positiveIntString,
  slippagePercent,
  tokenOrNative,
} from '../../../../src/server/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Every GET route rebuilds its upstream query from this schema, so callers cannot use the
// server's OKX credentials for other chains, other parameters, or fee-free swaps.
const getRouteSchemas: Record<string, z.ZodRawShape> = {
  // Chains OKX's aggregator serves (no parameters); cached for an hour.
  '/aggregator/supported/chain': {},
  '/aggregator/quote': {
    chainIndex: routerChain,
    fromTokenAddress: tokenOrNative,
    toTokenAddress: tokenOrNative,
    amount: positiveIntString,
    swapMode: z.literal('exactIn'),
    slippage: slippagePercent.optional(),
    userWalletAddress: evmAddress.optional(),
  },
  '/aggregator/swap': {
    chainIndex: routerChain,
    fromTokenAddress: tokenOrNative,
    toTokenAddress: tokenOrNative,
    amount: positiveIntString,
    swapMode: z.literal('exactIn'),
    slippagePercent,
    userWalletAddress: evmAddress,
    feePercent,
    fromTokenReferrerWalletAddress: feeReceiver,
  },
  '/aggregator/approve-transaction': {
    chainIndex: routerChain,
    tokenContractAddress: evmAddress,
    approveAmount: positiveIntString,
  },
  '/market/token/search': {
    chains: routerChain,
    search: z.string().trim().min(1).max(100),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  },
  '/market/trades': {
    chainIndex: routerChain,
    tokenContractAddress: evmAddress,
    limit: z.coerce.number().int().min(1).max(100).default(20),
  },
};

const priceInfoBody = z.object({
  chainIndex: routerChain,
  tokenContractAddress: z.string().transform((value) => value.split(',')).pipe(z.array(evmAddress).min(1).max(100)),
});

interface CacheEntry {
  expiresAt: number;
  body: string;
}

interface UpstreamResult {
  body: string;
  status: number;
}

const SEARCH_CACHE_TTL_MS = 30_000;
const MARKET_CACHE_TTL_MS = 15_000;
const CACHE_MAX_ENTRIES = 200;
const MAX_QUEUED_REQUESTS = 40;
const cache = new Map<string, CacheEntry>();
const requestsInFlight = new Map<string, Promise<UpstreamResult>>();
let nextOkxRequestAt = 0;
let queuedRequests = 0;
let okxRequestQueue: Promise<void> = Promise.resolve();

function waitForOkxRateLimit(): Promise<void> {
  const requestSlot = okxRequestQueue.then(async () => {
    const delay = Math.max(0, nextOkxRequestAt - Date.now());
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    nextOkxRequestAt = Date.now() + 210;
  });
  okxRequestQueue = requestSlot.catch(() => undefined);
  return requestSlot;
}

function jsonResponse(body: string, cacheState: 'HIT' | 'MISS', status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, max-age=20',
      'X-OKX-Cache': cacheState,
    },
  });
}

function isSuccessfulOkxBody(body: string): boolean {
  try {
    const payload: unknown = JSON.parse(body);
    return Boolean(payload && typeof payload === 'object' && 'code' in payload && String(payload.code) === '0');
  } catch {
    return false;
  }
}

async function handleRequest(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const route = `/${path.join('/')}`;
  const isPriceRequest = route === '/market/price-info';
  const schema = getRouteSchemas[route];
  if (!schema && !isPriceRequest) {
    return Response.json({ error: 'Unsupported OKX DEX API route.' }, { status: 404 });
  }
  const expectedMethod = isPriceRequest ? 'POST' : 'GET';
  if (request.method !== expectedMethod) {
    return Response.json(
      { error: `OKX ${route.split('/').pop()} requires ${expectedMethod}.` },
      { status: 405, headers: { Allow: expectedMethod } }
    );
  }

  let requestPath: string;
  let requestBody = '';
  if (isPriceRequest) {
    const parsed = priceInfoBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return badRequest('OKX price-info requires a routed chain and 1 to 100 valid token addresses.');
    }
    // v6 price-info takes one object per token; a comma-joined address list returns no data.
    requestBody = JSON.stringify(parsed.data.tokenContractAddress.map((tokenContractAddress) => ({
      chainIndex: parsed.data.chainIndex,
      tokenContractAddress,
    })));
    requestPath = `/api/v6/dex${route}`;
  } else {
    const parsed = parseQuery(schema, new URL(request.url).searchParams);
    if (!parsed.ok) return badRequest(`Invalid OKX ${route} request: ${parsed.error}`);
    const query = parsed.params.toString();
    requestPath = `/api/v6/dex${route}${query ? `?${query}` : ''}`;
  }

  const isSupportedChains = route === '/aggregator/supported/chain';
  const isCacheable = route.startsWith('/market/') || isSupportedChains;
  const cacheKey = `${requestPath}#${requestBody}`;
  if (isCacheable) {
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return jsonResponse(cached.body, 'HIT');
  }

  if (!isOkxConfigured()) {
    return badRequest('OKX DEX credentials are not configured on the server.', 503);
  }

  let pending = isCacheable ? requestsInFlight.get(cacheKey) : undefined;
  if (!pending) {
    if (queuedRequests >= MAX_QUEUED_REQUESTS) {
      return Response.json(
        { error: 'OKX DEX is busy. Retry in a few seconds.' },
        { status: 503, headers: { 'Retry-After': '5', 'Cache-Control': 'no-store' } }
      );
    }
    queuedRequests += 1;
    pending = (async () => {
      try {
        await waitForOkxRateLimit();
      } finally {
        queuedRequests -= 1;
      }
      // Sign after waiting in the queue so the timestamp is fresh.
      const upstream = await fetch(`https://web3.okx.com${requestPath}`, {
        method: expectedMethod,
        headers: okxHeaders(expectedMethod, requestPath, requestBody),
        body: requestBody || undefined,
        signal: AbortSignal.timeout(20_000),
        cache: 'no-store',
      });
      const body = await upstream.text();
      if (isCacheable && upstream.ok && isSuccessfulOkxBody(body)) {
        cache.set(cacheKey, {
          body,
          expiresAt: Date.now() + (isSupportedChains ? 60 * 60_000 : route === '/market/token/search' ? SEARCH_CACHE_TTL_MS : MARKET_CACHE_TTL_MS),
        });
        if (cache.size > CACHE_MAX_ENTRIES) {
          const oldestKey = cache.keys().next().value;
          if (oldestKey) cache.delete(oldestKey);
        }
      }
      return { body, status: upstream.status };
    })();
    if (isCacheable) requestsInFlight.set(cacheKey, pending);
  }

  try {
    const result = await pending;
    if (isCacheable) return jsonResponse(result.body, 'MISS', result.status);
    return new Response(result.body, {
      status: result.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('OKX DEX API request failed:', error);
    return badRequest('Unable to reach the OKX DEX API.', 502);
  } finally {
    if (isCacheable && requestsInFlight.get(cacheKey) === pending) requestsInFlight.delete(cacheKey);
  }
}

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return handleRequest(request, context);
}

export async function POST(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return handleRequest(request, context);
}
