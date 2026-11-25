import { lookupLaunch } from '../../../../src/server/bankrRegistry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/bankr-launches/<address> -> whether the token is a Bankr launch, with its registry
// row and Bankr's own launch record.
export async function GET(_request: Request, context: { params: Promise<{ address: string }> }) {
  const { address } = await context.params;
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return Response.json({ error: 'Invalid address.' }, { status: 400 });
  try {
    return Response.json(await lookupLaunch(address), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Bankr launch lookup failed:', error);
    return Response.json({ error: 'Lookup failed.' }, { status: 502 });
  }
}
