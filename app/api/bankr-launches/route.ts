import { listLaunches } from '../../../src/server/bankrRegistry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/bankr-launches?limit=50&before=<block>&q=<symbol prefix | 0x address>
// Every Bankr launch on Base, newest first, from the on-chain registry.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const before = Number(params.get('before'));
  const limit = Number(params.get('limit') || 50);
  const query = (params.get('q') ?? '').slice(0, 64);
  if ((params.has('before') && (!Number.isSafeInteger(before) || before <= 0)) || !Number.isFinite(limit)) {
    return Response.json({ error: 'Invalid query.' }, { status: 400 });
  }
  try {
    const result = await listLaunches({ before: params.has('before') ? before : undefined, limit, query });
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Bankr launch list failed:', error);
    return Response.json({ error: 'The launch registry is unavailable.' }, { status: 502 });
  }
}
