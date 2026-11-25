import { readSession } from '../../../../../src/server/session';
import { getThesis, hideThesis } from '../../../../../src/server/social';
import { failure, json, requireWriter } from '../../../../../src/server/socialHttp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const thesis = await getThesis((await params).id, readSession(request)?.wallet);
    return thesis ? json({ thesis }) : json({ error: 'Thesis not found.' }, 404);
  } catch (error) {
    return failure(error);
  }
}

// Authors can take their thesis down (it is hidden, likes and comments go with it).
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requireWriter(request);
    return await hideThesis((await params).id, session.wallet) ? json({ ok: true }) : json({ error: 'Thesis not found.' }, 404);
  } catch (error) {
    return failure(error);
  }
}
