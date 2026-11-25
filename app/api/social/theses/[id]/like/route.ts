import { setLike } from '../../../../../../src/server/social';
import { failure, json, limitWallet, readJson, requireWriter } from '../../../../../../src/server/socialHttp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Body: { like: boolean } → { liked, likeCount }
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requireWriter(request);
    await limitWallet(session.wallet, 'like', 300, 60 * 60_000);
    const body = await readJson(request);
    const result = await setLike((await params).id, session.wallet, body.like !== false);
    return result ? json(result) : json({ error: 'Thesis not found.' }, 404);
  } catch (error) {
    return failure(error);
  }
}
