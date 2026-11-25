import { getLeaderboard } from '../../../../src/server/social';
import { failure, json } from '../../../../src/server/socialHttp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WINDOWS: Record<string, number> = { '24h': 24, '7d': 168 };

// ?window=24h|7d&sort=pnl|volume → { rows } — Bankr-token traders ranked from the swap index.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const hours = WINDOWS[params.get('window') ?? '24h'] ?? 24;
  const sort = params.get('sort') === 'volume' ? 'volume' : 'pnl';
  try {
    return json({ rows: await getLeaderboard(hours, sort, 50), window: hours === 24 ? '24h' : '7d', sort }, 200, {
      'Cache-Control': 'public, max-age=30',
    });
  } catch (error) {
    return failure(error);
  }
}
