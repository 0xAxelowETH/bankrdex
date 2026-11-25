export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public (no API key) endpoints of api.bankr.bot that the app uses. Everything else is rejected
// so the route cannot be used as a general-purpose proxy. Each route rebuilds its query from an
// allowlist, which also bounds the cache key space.
const BANKR_API = 'https://api.bankr.bot';
const ADDRESS = '0x[a-fA-F0-9]{40}';
const addressParam = (value: string) => /^0x[a-fA-F0-9]{40}$/.test(value) ? value.toLowerCase() : null;
const daysParam = (value: string) => /^\d{1,2}$/.test(value) && Number(value) >= 1 && Number(value) <= 90 ? value : null;

interface RouteRule {
  pattern: RegExp;
  freshMs: number;
  query?: Record<string, { required?: boolean; parse: (value: string) => string | null }>;
}

const ROUTES: RouteRule[] = [
  { pattern: /^token-launches$/, freshMs: 15_000 },
  {
    pattern: /^token-launches\/quote-tokens$/,
    freshMs: 5 * 60_000,
    query: { chain: { required: true, parse: (value) => value === 'base' ? value : null } },
  },
  { pattern: new RegExp(`^token-launches/${ADDRESS}$`), freshMs: 60_000 },
  {
    pattern: new RegExp(`^token-launches/${ADDRESS}/fees$`),
    freshMs: 5 * 60_000,
    query: { days: { parse: daysParam } },
  },
  {
    pattern: new RegExp(`^token-launches/${ADDRESS}/vesting$`),
    freshMs: 5 * 60_000,
    query: { beneficiary: { required: true, parse: addressParam } },
  },
  {
    pattern: /^tokens\/search$/,
    freshMs: 30_000,
    query: {
      query: { required: true, parse: (value) => value.trim().length >= 1 && value.length <= 100 ? value.trim() : null },
      chainId: { parse: (value) => value === '8453' ? value : null },
    },
  },
  {
    pattern: new RegExp(`^public/doppler/claimable-fees/${ADDRESS}$`),
    freshMs: 60_000,
    query: { beneficiary: { required: true, parse: addressParam } },
  },
  {
    pattern: new RegExp(`^public/doppler/creator-fees/${ADDRESS}$`),
    freshMs: 5 * 60_000,
    query: { days: { parse: daysParam } },
  },
];

// Bankr serves the last good copy for this long when the API is slow or down.
const MAX_STALE_MS = 15 * 60_000;
const MAX_ENTRIES = 1_000;

interface CacheEntry {
  body: string;
  contentType: string;
  fetchedAt: number;
}

interface UpstreamResult {
  status: number;
  body: string;
  contentType: string;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<UpstreamResult>>();

function respond(body: string, contentType: string, status: number, cacheState: 'HIT' | 'MISS' | 'STALE') {
  return new Response(body, {
    status,
    headers: { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'X-Bankr-Cache': cacheState },
  });
}

async function fetchUpstream(pathAndQuery: string, init: RequestInit = {}): Promise<UpstreamResult> {
  const upstream = await fetch(`${BANKR_API}/${pathAndQuery}`, {
    ...init,
    headers: { Accept: 'application/json', 'User-Agent': 'BankrDex/1.0', ...init.headers },
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  });
  return {
    status: upstream.status,
    body: await upstream.text(),
    contentType: upstream.headers.get('content-type') || 'application/json; charset=utf-8',
  };
}

function buildQuery(rule: RouteRule, search: URLSearchParams): string | null {
  const params = new URLSearchParams();
  for (const [name, spec] of Object.entries(rule.query ?? {})) {
    const raw = search.get(name);
    if (raw === null) {
      if (spec.required) return null;
      continue;
    }
    const value = spec.parse(raw);
    if (value === null) return null;
    params.set(name, value);
  }
  params.sort();
  return params.size ? `?${params}` : '';
}

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const joinedPath = path.join('/');
  const rule = ROUTES.find(({ pattern }) => pattern.test(joinedPath));
  if (!rule) return Response.json({ error: 'Unsupported Bankr route.' }, { status: 404 });
  const query = buildQuery(rule, new URL(request.url).searchParams);
  if (query === null) return Response.json({ error: 'Invalid Bankr query.' }, { status: 400 });

  const key = `${joinedPath.toLowerCase()}${query}`;
  const cached = cache.get(key);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < rule.freshMs) {
    return respond(cached.body, cached.contentType, 200, 'HIT');
  }
  const stale = cached && now - cached.fetchedAt < MAX_STALE_MS ? cached : null;

  let pending = inFlight.get(key);
  if (!pending) {
    pending = fetchUpstream(`${joinedPath}${query}`).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }

  try {
    const result = await pending;
    if (result.status >= 200 && result.status < 300) {
      cache.delete(key);
      cache.set(key, { body: result.body, contentType: result.contentType, fetchedAt: Date.now() });
      if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
      return respond(result.body, result.contentType, result.status, 'MISS');
    }
    if (stale && result.status >= 500) return respond(stale.body, stale.contentType, 200, 'STALE');
    return respond(result.body, result.contentType, result.status, 'MISS');
  } catch (error) {
    if (stale) return respond(stale.body, stale.contentType, 200, 'STALE');
    console.error('Bankr proxy request failed:', error);
    return Response.json(
      { error: 'Unable to reach Bankr.' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

// POST /api/bankr-proxy/public/doppler/build-claim
// Builds unsigned fee-claim transactions for a fee beneficiary; the wallet signs them itself.
export async function POST(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (path.join('/') !== 'public/doppler/build-claim') {
    return Response.json({ error: 'Unsupported Bankr route.' }, { status: 404 });
  }
  const body = await request.json().catch(() => null) as { beneficiaryAddress?: unknown; tokenAddresses?: unknown } | null;
  const beneficiaryAddress = typeof body?.beneficiaryAddress === 'string' ? addressParam(body.beneficiaryAddress) : null;
  const tokenAddresses = Array.isArray(body?.tokenAddresses)
    ? body.tokenAddresses.map((value) => typeof value === 'string' ? addressParam(value) : null)
    : [];
  if (!beneficiaryAddress || tokenAddresses.length < 1 || tokenAddresses.length > 50 || tokenAddresses.includes(null)) {
    return Response.json({ error: 'Invalid claim request.' }, { status: 400 });
  }
  try {
    const result = await fetchUpstream('public/doppler/build-claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ beneficiaryAddress, tokenAddresses }),
    });
    return respond(result.body, result.contentType, result.status, 'MISS');
  } catch (error) {
    console.error('Bankr build-claim request failed:', error);
    return Response.json({ error: 'Unable to reach Bankr.' }, { status: 502 });
  }
}
