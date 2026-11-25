import { isBot, touchVisitor, VISITOR_ID_PATTERN } from '../../../src/server/visitors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Heartbeat from an open BankrDex tab: { visitorId, wallet? }. The ID is a random UUID kept in the
// visitor's browser, so several tabs of one browser count once; a connected wallet links browsers.
export async function POST(request: Request) {
  if (isBot(request.headers.get('user-agent'))) return new Response(null, { status: 204 });
  const body = await request.json().catch(() => null) as { visitorId?: unknown; wallet?: unknown } | null;
  const visitorId = typeof body?.visitorId === 'string' ? body.visitorId.toLowerCase() : '';
  if (!VISITOR_ID_PATTERN.test(visitorId)) return Response.json({ error: 'Invalid visitor ID.' }, { status: 400 });
  const wallet = typeof body?.wallet === 'string' && /^0x[a-fA-F0-9]{40}$/.test(body.wallet) ? body.wallet.toLowerCase() : null;
  try {
    await touchVisitor(visitorId, wallet);
  } catch (error) {
    console.warn('Presence heartbeat failed:', error instanceof Error ? error.message : error);
  }
  // Always 204: statistics must never affect the page.
  return new Response(null, { status: 204 });
}
