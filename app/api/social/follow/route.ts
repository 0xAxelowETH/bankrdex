import { setFollow, SocialError, WALLET_PATTERN } from '../../../../src/server/social';
import { failure, json, limitWallet, readJson, requireWriter } from '../../../../src/server/socialHttp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Body: { wallet, follow: boolean } → { following, followers }
export async function POST(request: Request) {
  try {
    const { session } = await requireWriter(request);
    await limitWallet(session.wallet, 'follow', 120, 60 * 60_000);
    const body = await readJson(request);
    const wallet = typeof body.wallet === 'string' ? body.wallet.toLowerCase() : '';
    if (!WALLET_PATTERN.test(wallet)) throw new SocialError('Unknown wallet.');
    const follow = body.follow !== false;
    const followers = await setFollow(session.wallet, wallet, follow);
    return json({ following: follow, followers });
  } catch (error) {
    return failure(error);
  }
}
