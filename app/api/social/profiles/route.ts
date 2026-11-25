import { getProfileCards, searchProfiles } from '../../../../src/server/social';
import { failure, json } from '../../../../src/server/socialHttp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ?wallets=0x..,0x.. → { profiles: { [wallet]: card } } (labels for trades and leaderboards)
// ?q=<prefix>        → { results: card[] } (username search)
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    const query = params.get('q');
    if (query !== null) return json({ results: await searchProfiles(query) }, 200, { 'Cache-Control': 'public, max-age=15' });
    const wallets = (params.get('wallets') ?? '').split(',').map((wallet) => wallet.trim()).filter(Boolean).slice(0, 200);
    return json({ profiles: await getProfileCards(wallets) }, 200, { 'Cache-Control': 'public, max-age=30' });
  } catch (error) {
    return failure(error);
  }
}
