import { getProfileByUsername, listFollows, WALLET_PATTERN } from '../../../../../../src/server/social';
import { failure, json } from '../../../../../../src/server/socialHttp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ?type=followers|following → { entries: [{ wallet, followedAt, profile }] }
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await params).id).trim().toLowerCase();
  const type = new URL(request.url).searchParams.get('type') === 'following' ? 'following' : 'followers';
  try {
    const wallet = WALLET_PATTERN.test(id) ? id : (await getProfileByUsername(id))?.wallet;
    if (!wallet) return json({ error: 'No trader with that name.' }, 404);
    return json({ entries: await listFollows(wallet, type) });
  } catch (error) {
    return failure(error);
  }
}
