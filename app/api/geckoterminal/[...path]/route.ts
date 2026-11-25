import {
  isSupabaseGeckoCacheEnabled,
  pruneSupabaseGeckoCache,
  readSupabaseGeckoCache,
  writeSupabaseGeckoCache,
  type PersistentGeckoCacheEntry,
} from '../../../../src/server/supabaseGeckoCache';
import { z } from 'zod';
import { parseQuery } from '../../../../src/server/validation';
import { hasGeckoBudget, recordGeckoCall } from '../../../../src/server/geckoBudget';
import { CHAINS } from '../../../../src/config/chains';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CacheEntry {
  freshUntil: number;
  status: number;
  body: string;
  cachedAt: number;
}

const FRESH_TTL_MS = 15_000;
const MAX_STALE_AGE_MS = 24 * 60 * 60 * 1_000;
const SUPABASE_FAILURE_BACKOFF_MS = 30_000;
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<CacheEntry>>();
let supabaseCacheBackoffUntil = 0;

// Uniswap V2/V3 pools are 20-byte addresses; Uniswap V4 pools (every Bankr launch) are 32-byte ids.
const POOL = '0x(?:[a-fA-F0-9]{64}|[a-fA-F0-9]{40})';
// GeckoTerminal networks of the chains Bankr launches on (src/config/chains.ts).
const NETWORK = `(?:${Object.values(CHAINS).map((chain) => chain.geckoNetwork).join('|')})`;
const MULTI_PATH = new RegExp(`^api/v2/networks/${NETWORK}/pools/multi/(${POOL}(?:,${POOL}){0,29})$`);
const POOL_PATH = new RegExp(`^api/v2/networks/${NETWORK}/pools/(${POOL})/(trades|ohlcv/(?:minute|hour|day))$`);
// Market data for a page of the All launches view (tokens without a known pool yet).
const TOKEN = '0x[a-fA-F0-9]{40}';
const TOKENS_MULTI_PATH = new RegExp(`^api/v2/networks/${NETWORK}/tokens/multi/(${TOKEN}(?:,${TOKEN}){0,29})$`);

// Query schemas keep the cache key space bounded: arbitrary query strings would otherwise
// bypass the cache and drain the shared upstream budget for every user.
const multiQuery = { include: z.literal('base_token,quote_token').optional() };
const tokensMultiQuery = { include: z.literal('top_pools').optional() };
const ohlcvQuery = {
  aggregate: z.enum(['1', '4', '5', '12', '15']).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  currency: z.enum(['usd', 'token']).optional(),
  token: z.enum(['base', 'quote']).optional(),
  before_timestamp: z.string().regex(/^\d{1,12}$/).optional(),
};
const tradesQuery = {
  limit: z.coerce.number().int().min(1).max(300).optional(),
  trade_volume_in_usd_greater_than: z.coerce.number().min(0).max(1_000_000_000).optional(),
};

function normalizeGeckoRequest(path: string, search: URLSearchParams): string | null {
  const multi = MULTI_PATH.exec(path);
  const tokensMulti = multi ? null : TOKENS_MULTI_PATH.exec(path);
  const pool = multi || tokensMulti ? null : POOL_PATH.exec(path);
  if (!multi && !tokensMulti && !pool) return null;
  const schema = multi ? multiQuery : tokensMulti ? tokensMultiQuery : pool![2] === 'trades' ? tradesQuery : ohlcvQuery;
  const parsed = parseQuery(schema, search);
  if (!parsed.ok) return null;
  parsed.params.sort();
  const query = parsed.params.size ? `?${parsed.params}` : '';
  return `/${path.toLowerCase()}${query}`;
}

function hasAvailableSupabaseCache(): boolean {
  return Date.now() >= supabaseCacheBackoffUntil && isSupabaseGeckoCacheEnabled();
}

function pauseSupabaseCache() {
  supabaseCacheBackoffUntil = Date.now() + SUPABASE_FAILURE_BACKOFF_MS;
}

function toPersistentEntry(entry: CacheEntry): PersistentGeckoCacheEntry {
  return {
    status: entry.status,
    body: entry.body,
    expiresAt: entry.freshUntil,
    cachedAt: entry.cachedAt,
  };
}

function toMemoryEntry(entry: PersistentGeckoCacheEntry): CacheEntry {
  return {
    status: entry.status,
    body: entry.body,
    freshUntil: entry.expiresAt,
    cachedAt: entry.cachedAt,
  };
}

function remember(key: string, entry: CacheEntry) {
  cache.set(key, entry);
  if (cache.size > 500) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
}

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await context.params;
  const path = segments.join('/');
  const requestPath = normalizeGeckoRequest(path, new URL(request.url).searchParams);
  if (!requestPath) {
    return Response.json({ error: 'Unsupported GeckoTerminal API route or query.' }, { status: 404 });
  }
  const isChartRequest = path.includes('/ohlcv/');
  const now = Date.now();
  const cached = cache.get(requestPath);
  let persistentCacheAvailable = hasAvailableSupabaseCache();
  const responseHeaders = (cacheState: 'HIT' | 'MISS' | 'STALE' | 'RATE-LIMITED') => ({
    'Cache-Control': 'no-store',
    'X-Gecko-Cache': cacheState,
    'X-Gecko-Cache-Store': persistentCacheAvailable ? 'supabase' : 'memory',
  });
  if (cached && cached.freshUntil > now) {
    return new Response(cached.body, {
      status: cached.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...responseHeaders('HIT') },
    });
  }

  let persistentCacheEntry: CacheEntry | null = null;
  if (persistentCacheAvailable) {
    try {
      const persisted = await readSupabaseGeckoCache(requestPath);
      if (persisted) {
        persistentCacheEntry = toMemoryEntry(persisted);
        if (persisted.expiresAt > now) {
          remember(requestPath, persistentCacheEntry);
          return new Response(persisted.body, {
            status: persisted.status,
            headers: { 'Content-Type': 'application/json; charset=utf-8', ...responseHeaders('HIT') },
          });
        }
      }
    } catch (error) {
      pauseSupabaseCache();
      persistentCacheAvailable = false;
      console.error('Supabase GeckoTerminal cache read failed; using memory cache:', error);
    }
  }
  const staleEntry = persistentCacheEntry || cached || null;
  const canServeStale = staleEntry !== null && now - staleEntry.cachedAt <= MAX_STALE_AGE_MS;

  if (!inFlight.has(requestPath) && !hasGeckoBudget(isChartRequest, now)) {
    if (canServeStale && staleEntry) {
      return new Response(staleEntry.body, {
        status: staleEntry.status,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Warning': '110 - "Response is stale"',
          ...responseHeaders('STALE'),
        },
      });
    }
    return Response.json(
      { error: 'Local GeckoTerminal request budget reached. Retry after 60 seconds.' },
      {
        status: 429,
        headers: { 'Retry-After': '60', ...responseHeaders('RATE-LIMITED') },
      }
    );
  }

  let pending = inFlight.get(requestPath);
  if (!pending) {
    recordGeckoCall(isChartRequest, now);
    pending = (async () => {
      const upstream = await fetch(`https://api.geckoterminal.com${requestPath}`, {
        headers: {
          Accept: 'application/json;version=20230302',
          'User-Agent': 'BankrDex/1.0',
        },
        signal: AbortSignal.timeout(12_000),
        cache: 'no-store',
      });
      const entry: CacheEntry = {
        freshUntil: upstream.ok ? Date.now() + FRESH_TTL_MS : 0,
        status: upstream.status,
        body: await upstream.text(),
        cachedAt: Date.now(),
      };
      if (upstream.ok) {
        remember(requestPath, entry);
        if (persistentCacheAvailable) {
          try {
            await writeSupabaseGeckoCache(requestPath, toPersistentEntry(entry));
            void pruneSupabaseGeckoCache(MAX_STALE_AGE_MS).catch((error: unknown) => {
              console.error('Supabase GeckoTerminal cache prune failed:', error);
            });
          } catch (error) {
            pauseSupabaseCache();
            persistentCacheAvailable = false;
            console.error('Supabase GeckoTerminal cache write failed; retained memory cache:', error);
          }
        }
      }
      return entry;
    })();
    inFlight.set(requestPath, pending);
  }

  try {
    const entry = await pending;
    if ((entry.status < 200 || entry.status >= 300) && canServeStale && staleEntry) {
      return new Response(staleEntry.body, {
        status: staleEntry.status,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Warning': '110 - "Response is stale"',
          ...responseHeaders('STALE'),
        },
      });
    }
    return new Response(entry.body, {
      status: entry.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...responseHeaders('MISS') },
    });
  } catch (error) {
    console.error('GeckoTerminal API request failed:', error);
    if (canServeStale && staleEntry) {
      return new Response(staleEntry.body, {
        status: staleEntry.status,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Warning': '110 - "Response is stale"',
          ...responseHeaders('STALE'),
        },
      });
    }
    return Response.json(
      { error: 'GeckoTerminal unavailable; no cached snapshot exists.' },
      { status: 503, headers: responseHeaders('MISS') }
    );
  } finally {
    if (inFlight.get(requestPath) === pending) inFlight.delete(requestPath);
  }
}
