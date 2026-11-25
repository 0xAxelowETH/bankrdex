// Shared plumbing for the /api/social routes: JSON replies, session and profile checks,
// same-origin checks on writes and per-wallet write budgets.
import { rateLimit } from './rateLimit';
import { isSameOrigin, readSession, type Session } from './session';
import { getProfile, SocialError, type Profile } from './social';

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

export function failure(error: unknown): Response {
  if (error instanceof SocialError) return json({ error: error.message }, error.status);
  console.error('Social API error:', error instanceof Error ? error.message : error);
  return json({ error: 'Something went wrong. Please try again.' }, 500);
}

export function requireSession(request: Request): Session {
  const session = readSession(request);
  if (!session) throw new SocialError('Sign in with your wallet first.', 401);
  return session;
}

// Writes: same-origin page, signed in, and (for social actions) a profile.
export async function requireWriter(request: Request, needsProfile = true): Promise<{ session: Session; profile: Profile | null }> {
  if (!isSameOrigin(request)) throw new SocialError('Cross-site request blocked.', 403);
  const session = requireSession(request);
  const profile = await getProfile(session.wallet);
  if (needsProfile && !profile) throw new SocialError('Create your profile first.', 403);
  return { session, profile };
}

export async function limitWallet(wallet: string, bucket: string, limit: number, windowMs: number): Promise<void> {
  const result = await rateLimit(`social:${bucket}:${wallet}`, limit, windowMs);
  if (!result.allowed) throw new SocialError('You are doing that too often. Try again a little later.', 429);
}

export async function readJson(request: Request, maxBytes = 16_384): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > maxBytes) throw new SocialError('Request is too large.', 413);
  try {
    const value = JSON.parse(text) as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new SocialError('Send a JSON object.');
}

export function firstIssue(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  const issue = error.issues[0];
  return issue ? issue.message : 'Invalid input.';
}

export function viewerOf(request: Request): string | null {
  return readSession(request)?.wallet ?? null;
}
