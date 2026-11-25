import { readSession } from '../../../../src/server/session';
import { getProfile, isUsernameFree, profileInputSchema, saveProfile, SocialError } from '../../../../src/server/social';
import { failure, firstIssue, json, limitWallet, readJson, requireWriter } from '../../../../src/server/socialHttp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The signed-in wallet and its profile; { wallet: null } when signed out.
export async function GET(request: Request) {
  const session = readSession(request);
  if (!session) return json({ wallet: null, profile: null });
  try {
    return json({ wallet: session.wallet, profile: await getProfile(session.wallet), expiresAt: session.expiresAt });
  } catch (error) {
    return failure(error);
  }
}

// Creates or updates the signed-in wallet's profile.
export async function PUT(request: Request) {
  try {
    const { session } = await requireWriter(request, false);
    await limitWallet(session.wallet, 'profile', 30, 60 * 60_000);
    const parsed = profileInputSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new SocialError(firstIssue(parsed.error));
    if (!await isUsernameFree(parsed.data.username, session.wallet)) throw new SocialError('That username is taken.', 409);
    return json({ wallet: session.wallet, profile: await saveProfile(session.wallet, parsed.data) });
  } catch (error) {
    return failure(error);
  }
}
