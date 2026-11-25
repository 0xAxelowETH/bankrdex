import { isChainKey } from '../../../src/config/chains';
import { getDexProfiles } from '../../../src/server/dexProfiles';
import { getClientIp, rateLimit } from '../../../src/server/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// DexScreener profiles (logo, banner, paid status and, for paid profiles, the registered links)
// for up to 30 tokens of one chain: GET /api/dex-profile?chain=base&addresses=0x…,0x…
const ADDRESS = /^0x[a-f0-9]{40}$/;
const MAX_ADDRESSES = 30;
// How long a request waits for paid checks that are not cached yet.
const WAIT_MS = 6_000;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const chain = params.get('chain') ?? 'base';
  const addresses = [...new Set((params.get('addresses') ?? '')
    .toLowerCase()
    .split(',')
    .map((value) => value.trim())
    .filter((value) => ADDRESS.test(value)))];
  if (!isChainKey(chain) || addresses.length === 0 || addresses.length > MAX_ADDRESSES) {
    return Response.json({ error: `Provide a chain and 1 to ${MAX_ADDRESSES} token addresses.` }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  const limit = await rateLimit(`dex-profile:${getClientIp(request.headers)}`, 120, 60_000);
  if (!limit.allowed) {
    return Response.json({ error: 'Too many requests.' }, { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))) } });
  }

  const profiles = await getDexProfiles(chain, addresses, WAIT_MS);
  const unresolved = Object.values(profiles).some((profile) => profile.paid === null);
  return Response.json({ profiles }, { headers: { 'Cache-Control': unresolved ? 'no-store' : 'public, max-age=300' } });
}
