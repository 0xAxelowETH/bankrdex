import { getTokenStats } from '../../../../src/server/tokenStats';
import { isChainKey } from '../../../../src/config/chains';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/token-stats/<address>?chain=<base|robinhood|arbitrum|arc>
// -> holder count, top-10 share and burned amount.
export async function GET(request: Request, context: { params: Promise<{ address: string }> }) {
  const { address } = await context.params;
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return Response.json({ error: 'Invalid token address.' }, { status: 400 });
  }
  const chain = new URL(request.url).searchParams.get('chain') ?? 'base';
  if (!isChainKey(chain)) return Response.json({ error: 'Unsupported chain.' }, { status: 400 });
  return Response.json(await getTokenStats(address, chain), { headers: { 'Cache-Control': 'no-store' } });
}
