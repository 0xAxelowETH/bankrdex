import { addComment, commentInputSchema, deleteComment, listComments, SocialError } from '../../../../../../src/server/social';
import { failure, firstIssue, json, limitWallet, readJson, requireWriter } from '../../../../../../src/server/socialHttp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return json({ comments: await listComments((await params).id) });
  } catch (error) {
    return failure(error);
  }
}

// Body: { content } → { comment }
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requireWriter(request);
    await limitWallet(session.wallet, 'comment', 60, 60 * 60_000);
    const parsed = commentInputSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new SocialError(firstIssue(parsed.error));
    const comment = await addComment((await params).id, session.wallet, parsed.data.content);
    return comment ? json({ comment }, 201) : json({ error: 'Thesis not found.' }, 404);
  } catch (error) {
    return failure(error);
  }
}

// ?comment=<id>: comment authors and the thesis author can remove a comment.
export async function DELETE(request: Request) {
  try {
    const { session } = await requireWriter(request);
    const commentId = new URL(request.url).searchParams.get('comment') ?? '';
    return await deleteComment(commentId, session.wallet) ? json({ ok: true }) : json({ error: 'Comment not found.' }, 404);
  } catch (error) {
    return failure(error);
  }
}
