// Anonymous visitor statistics stored in Supabase (see migration 20261008010000_visitors.sql).
function config(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const supabase = config();
  if (!supabase) throw new Error('Supabase is not configured.');
  const response = await fetch(`${supabase.url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: supabase.key,
      Authorization: `Bearer ${supabase.key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(5_000),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Supabase ${name} failed (${response.status}).`);
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

// Crawlers, link previews and monitors are not visitors.
const BOT_PATTERN = /bot|crawl|spider|slurp|preview|monitor|uptime|headless|lighthouse|curl|wget|python|axios|node-fetch|postman/i;
export const isBot = (userAgent: string | null) => !userAgent || BOT_PATTERN.test(userAgent);

export const VISITOR_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function touchVisitor(visitorId: string, wallet: string | null): Promise<void> {
  return rpc<void>('bankrdex_touch_visitor', { p_visitor_id: visitorId, p_wallet: wallet });
}

export interface VisitorStats {
  onlineNow: number;
  today: number;
  last7d: number;
  last30d: number;
  allTime: number;
  newToday: number;
  walletsToday: number;
  walletsAllTime: number;
  daily: { day: string; visitors: number; new: number }[];
}

export function visitorStats(days = 14): Promise<VisitorStats> {
  return rpc<VisitorStats>('bankrdex_visitor_stats', { p_days: days });
}
