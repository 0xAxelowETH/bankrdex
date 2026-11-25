import { isSameOrigin, isSessionConfigured, sessionCookie } from '../../../../../src/server/session';
import { checkSiweMessage, verifySiweSignature } from '../../../../../src/server/siwe';
import { consumeNonce, getProfile, SocialError } from '../../../../../src/server/social';
import { failure, json, readJson } from '../../../../../src/server/socialHttp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REASONS: Record<string, string> = {
  malformed: 'The sign-in message is not valid.',
  domain: 'The sign-in message is for a different site.',
  chain: 'Sign in on Base.',
  expired: 'The sign-in request expired. Try again.',
  nonce: 'The sign-in request expired or was already used. Try again.',
  signature: 'The signature does not match this wallet.',
};

// Body: { message, signature } where message is an EIP-4361 message signed with personal_sign.
// Sets the session cookie and returns the wallet's profile (null until one is created).
export async function POST(request: Request) {
  try {
    if (!isSameOrigin(request)) throw new SocialError('Cross-site request blocked.', 403);
    if (!isSessionConfigured()) throw new SocialError('Sign-in is not configured on this server (SESSION_SECRET).', 503);
    const body = await readJson(request);
    const message = typeof body.message === 'string' ? body.message : '';
    const signature = typeof body.signature === 'string' ? body.signature : '';
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '';
    const check = checkSiweMessage(message, host);
    if (!check.ok || !check.wallet || !check.nonce) throw new SocialError(REASONS[check.reason ?? 'malformed'], 400);
    if (!await consumeNonce(check.nonce)) throw new SocialError(REASONS.nonce, 400);
    if (!await verifySiweSignature(message, signature, check.wallet)) throw new SocialError(REASONS.signature, 401);
    const profile = await getProfile(check.wallet);
    return json({ wallet: check.wallet, profile }, 200, { 'Set-Cookie': sessionCookie(request, check.wallet) });
  } catch (error) {
    return failure(error);
  }
}
