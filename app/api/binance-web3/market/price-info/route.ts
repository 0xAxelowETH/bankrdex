import { createHmac } from 'node:crypto';
import { getBinanceWeb3Credentials } from '../../../../../src/server/binanceWeb3Credentials';
import { getBaseBankrTokens } from '../../../../../src/server/bankrTokenCatalog';
import { getExternalTokenAddresses } from '../../../../../src/server/marketSources';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRICE_CACHE_TTL_MS = 15_000;
// Binance answers "Rate limit exceeded" under bursts; serve the last good prices meanwhile.
const PRICE_STALE_MS = 5 * 60_000;
const PRICE_CACHE_MAX_ENTRIES = 200;
const priceCache = new Map<string, { body: string; expiresAt: number; fetchedAt: number }>();
const requestsInFlight = new Map<string, Promise<{ body: string; status: number }>>();

interface PriceRequestToken {
  binanceChainId: '8453';
  tokenContractAddress: string;
}

function getRequestTokens(value: unknown): PriceRequestToken[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) return null;
  const tokens: PriceRequestToken[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    const address = record.tokenContractAddress;
    if (
      record.binanceChainId !== '8453' ||
      typeof address !== 'string' ||
      !/^0x[a-f\d]{40}$/i.test(address)
    ) return null;
    tokens.push({ binanceChainId: '8453', tokenContractAddress: address });
  }
  return tokens;
}

function jsonResponse(body: string, cache: 'HIT' | 'MISS' | 'STALE', status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, max-age=15',
      'X-Binance-Web3-Cache': cache,
    },
  });
}

export async function POST(request: Request) {
  let requestJson: unknown;
  try {
    requestJson = await request.json();
  } catch {
    return Response.json(
      { error: 'Request body must be valid JSON.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  const requestedTokens = getRequestTokens(requestJson);
  if (!requestedTokens) {
    return Response.json(
      { error: 'Provide 1 to 100 token addresses on Base (binanceChainId "8453").' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  let allowedAddresses: Set<string>;
  try {
    const catalog = await getBaseBankrTokens();
    allowedAddresses = new Set([
      ...catalog.map((token) => String(token.address).toLowerCase()),
      ...await getExternalTokenAddresses(),
    ]);
  } catch (error) {
    console.error('Unable to verify the Bankr token catalog for Binance Web3 prices:', error);
    return Response.json(
      { error: 'Unable to verify the Bankr token catalog.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  // Skip addresses that are not (or no longer) listed instead of failing the whole page:
  // the launchpad feeds change between refreshes.
  const tokens = requestedTokens.filter((token) => allowedAddresses.has(token.tokenContractAddress.toLowerCase()));
  if (tokens.length === 0) {
    return Response.json(
      { error: 'Only tokens listed in the BankrDex market table are supported.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const credentials = getBinanceWeb3Credentials();
  if (!credentials.apiKey || !credentials.secretKey) {
    return Response.json(
      { error: 'Binance Web3 API credentials are not configured on the server.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  const { apiKey, secretKey } = credentials;

  const body = JSON.stringify(tokens);
  const cacheKey = body;
  const cached = priceCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return jsonResponse(cached.body, 'HIT');

  let pending = requestsInFlight.get(cacheKey);
  if (!pending) {
    pending = (async () => {
      const method = 'POST';
      const requestPath = '/build/api/v1/dex/market/price-info';
      const timestamp = new Date().toISOString();
      const signature = createHmac('sha256', secretKey)
        .update(`${timestamp}${method}${requestPath}${body}`, 'utf8')
        .digest('base64');
      const upstream = await fetch(`https://web3.binance.com${requestPath}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-OC-APIKEY': apiKey,
          'X-OC-SIGN': signature,
          'X-OC-TIMESTAMP': timestamp,
        },
        body,
        signal: AbortSignal.timeout(20_000),
        cache: 'no-store',
      });
      const upstreamBody = await upstream.text();
      if (upstream.ok) {
        let isSuccessfulResponse = false;
        try {
          const payload: unknown = JSON.parse(upstreamBody);
          isSuccessfulResponse = Boolean(
            payload &&
            typeof payload === 'object' &&
            'code' in payload &&
            String(payload.code) === '0'
          );
        } catch {
          isSuccessfulResponse = false;
        }
        if (isSuccessfulResponse) {
          priceCache.set(cacheKey, { body: upstreamBody, expiresAt: Date.now() + PRICE_CACHE_TTL_MS, fetchedAt: Date.now() });
          if (priceCache.size > PRICE_CACHE_MAX_ENTRIES) {
            const oldestKey = priceCache.keys().next().value;
            if (oldestKey) priceCache.delete(oldestKey);
          }
        }
      }
      return { body: upstreamBody, status: upstream.status };
    })();
    requestsInFlight.set(cacheKey, pending);
  }

  const stale = cached && Date.now() - cached.fetchedAt < PRICE_STALE_MS ? cached : null;
  try {
    const result = await pending;
    const succeeded = result.status >= 200 && result.status < 300 && priceCache.get(cacheKey) !== cached;
    if (!succeeded && stale) return jsonResponse(stale.body, 'STALE');
    return jsonResponse(result.body, 'MISS', result.status);
  } catch (error) {
    if (stale) return jsonResponse(stale.body, 'STALE');
    console.error('Binance Web3 market price request failed:', error);
    return Response.json(
      { error: 'Unable to reach the Binance Web3 API.' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    );
  } finally {
    if (requestsInFlight.get(cacheKey) === pending) requestsInFlight.delete(cacheKey);
  }
}
