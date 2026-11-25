// Small key/value store in Supabase (table bankrdex_notify_state) so alerts are sent once per
// change across serverless instances. Falls back to memory when Supabase is unavailable.
const TABLE = 'bankrdex_notify_state';
const memory = new Map<string, unknown>();

function config(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

export async function readState<T>(key: string): Promise<T | null> {
  const supabase = config();
  if (supabase) {
    try {
      const params = new URLSearchParams({ select: 'value', key: `eq.${key}`, limit: '1' });
      const response = await fetch(`${supabase.url}/rest/v1/${TABLE}?${params}`, {
        headers: { apikey: supabase.key, Authorization: `Bearer ${supabase.key}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(4_000),
        cache: 'no-store',
      });
      if (response.ok) {
        const rows = await response.json() as { value: T }[];
        return rows[0]?.value ?? null;
      }
    } catch {
      // fall through to memory
    }
  }
  return (memory.get(key) as T | undefined) ?? null;
}

export async function writeState(key: string, value: unknown): Promise<void> {
  memory.set(key, value);
  const supabase = config();
  if (!supabase) return;
  try {
    await fetch(`${supabase.url}/rest/v1/${TABLE}?on_conflict=key`, {
      method: 'POST',
      headers: {
        apikey: supabase.key,
        Authorization: `Bearer ${supabase.key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
      signal: AbortSignal.timeout(4_000),
      cache: 'no-store',
    });
  } catch {
    // memory copy is kept
  }
}
