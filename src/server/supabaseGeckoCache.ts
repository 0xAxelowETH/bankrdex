interface SupabaseCacheRow {
  status_code: number;
  response_body: string;
  expires_at: string;
  cached_at: string;
}

export interface PersistentGeckoCacheEntry {
  status: number;
  body: string;
  expiresAt: number;
  cachedAt: number;
}

const TABLE = 'bankrdex_gecko_cache';

function getSupabaseConfig(): { url: string; serviceRoleKey: string } | null {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  return { url, serviceRoleKey };
}

function getHeaders(serviceRoleKey: string): HeadersInit {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

export function isSupabaseGeckoCacheEnabled(): boolean {
  return getSupabaseConfig() !== null;
}

export async function readSupabaseGeckoCache(cacheKey: string): Promise<PersistentGeckoCacheEntry | null> {
  const config = getSupabaseConfig();
  if (!config) return null;

  const params = new URLSearchParams({
    select: 'status_code,response_body,expires_at,cached_at',
    cache_key: `eq.${cacheKey}`,
    limit: '1',
  });
  const response = await fetch(`${config.url}/rest/v1/${TABLE}?${params}`, {
    headers: getHeaders(config.serviceRoleKey),
    signal: AbortSignal.timeout(3_000),
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Supabase cache read failed (${response.status}).`);
  }

  const rows = (await response.json()) as SupabaseCacheRow[];
  const row = rows[0];
  if (!row || typeof row.response_body !== 'string') return null;
  const expiresAt = Date.parse(row.expires_at);
  const cachedAt = Date.parse(row.cached_at);
  if (!Number.isFinite(expiresAt) || !Number.isFinite(cachedAt)) {
    throw new Error('Supabase cache row contains invalid timestamps.');
  }
  return {
    status: row.status_code,
    body: row.response_body,
    expiresAt,
    cachedAt,
  };
}

export async function writeSupabaseGeckoCache(
  cacheKey: string,
  entry: PersistentGeckoCacheEntry
): Promise<void> {
  const config = getSupabaseConfig();
  if (!config) return;

  const params = new URLSearchParams({ on_conflict: 'cache_key' });
  const response = await fetch(`${config.url}/rest/v1/${TABLE}?${params}`, {
    method: 'POST',
    headers: {
      ...getHeaders(config.serviceRoleKey),
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({
      cache_key: cacheKey,
      status_code: entry.status,
      response_body: entry.body,
      expires_at: new Date(entry.expiresAt).toISOString(),
      cached_at: new Date(entry.cachedAt).toISOString(),
    }),
    signal: AbortSignal.timeout(3_000),
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Supabase cache write failed (${response.status}).`);
  }
}

const PRUNE_INTERVAL_MS = 10 * 60 * 1000;
let lastPruneAt = 0;

// Deletes rows older than the maximum stale window. Runs at most every 10 minutes per instance.
export async function pruneSupabaseGeckoCache(maxAgeMs: number): Promise<void> {
  const config = getSupabaseConfig();
  const now = Date.now();
  if (!config || now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;
  const params = new URLSearchParams({ cached_at: `lt.${new Date(now - maxAgeMs).toISOString()}` });
  const response = await fetch(`${config.url}/rest/v1/${TABLE}?${params}`, {
    method: 'DELETE',
    headers: { ...getHeaders(config.serviceRoleKey), Prefer: 'return=minimal' },
    signal: AbortSignal.timeout(5_000),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Supabase cache prune failed (${response.status}).`);
}
