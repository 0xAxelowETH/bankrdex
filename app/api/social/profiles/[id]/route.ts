import { getProfile, getProfileByUsername, getWalletSummary, WALLET_PATTERN } from '../../../../../src/server/social';
import { failure, json, viewerOf } from '../../../../../src/server/socialHttp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A profile page by username, or any trader by wallet (profile null when they have none):
// { wallet, profile, summary: followers, following, theses, 24h / 7d trading results }.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await params).id).trim().toLowerCase();
  try {
    const isWallet = WALLET_PATTERN.test(id);
    const profile = isWallet ? await getProfile(id) : await getProfileByUsername(id);
    const wallet = profile?.wallet ?? (isWallet ? id : null);
    if (!wallet) return json({ error: 'No trader with that name.' }, 404);
    const summary = await getWalletSummary(wallet, viewerOf(request));
    return json({ wallet, profile, summary });
  } catch (error) {
    return failure(error);
  }
}
