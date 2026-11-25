import { clearedSessionCookie } from '../../../../../src/server/session';
import { json } from '../../../../../src/server/socialHttp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return json({ ok: true }, 200, { 'Set-Cookie': clearedSessionCookie(request) });
}
