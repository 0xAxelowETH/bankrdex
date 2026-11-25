import { readSession } from '../../../../src/server/session';
import { followedWallets, getSocialTrades, SocialError, WALLET_PATTERN } from '../../../../src/server/social';
import { failure, json } from '../../../../src/server/socialHttp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ?scope=community  trades by every wallet with a BankrDex profile
// ?scope=following  trades by wallets the signed-in user follows
// ?scope=wallet&wallet=0x..  one wallet's trades (profile pages)
// plus ?before=<iso> to page back.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const scope = params.get('scope') ?? 'community';
  const before = params.get('before');
  const cursor = before && !Number.isNaN(Date.parse(before)) ? new Date(before).toISOString() : null;
  const limit = Math.min(Math.max(Number(params.get('limit')) || 40, 1), 100);
  try {
    if (scope === 'wallet') {
      const wallet = params.get('wallet')?.toLowerCase() ?? '';
      if (!WALLET_PATTERN.test(wallet)) throw new SocialError('Unknown wallet.');
      return json({ trades: await getSocialTrades([wallet], limit, cursor) });
    }
    if (scope === 'following') {
      const viewer = readSession(request)?.wallet;
      if (!viewer) return json({ trades: [], needsSignIn: true });
      const wallets = await followedWallets(viewer);
      return json({ trades: wallets.length ? await getSocialTrades(wallets, limit, cursor) : [], following: wallets.length });
    }
    return json({ trades: await getSocialTrades(null, limit, cursor) });
  } catch (error) {
    return failure(error);
  }
}
