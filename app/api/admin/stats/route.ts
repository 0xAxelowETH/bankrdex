import { timingSafeEqual } from 'node:crypto';
import { visitorStats } from '../../../../src/server/visitors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Uses STATS_SECRET, or CRON_SECRET when no separate key is set.
function authorized(request: Request): boolean {
  const secret = (process.env.STATS_SECRET || process.env.CRON_SECRET)?.trim();
  if (!secret) return false;
  const header = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  const provided = header || new URL(request.url).searchParams.get('key')?.trim() || '';
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return Response.json(await visitorStats(14), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Visitor statistics are unavailable.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
