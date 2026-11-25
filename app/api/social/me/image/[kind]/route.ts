import { deleteImage, IMAGE_KINDS, IMAGE_LIMITS, saveImage, sniffImage, SocialError, type ImageKind } from '../../../../../../src/server/social';
import { failure, json, limitWallet, requireWriter } from '../../../../../../src/server/socialHttp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function kindOf(value: string): ImageKind {
  if (!(IMAGE_KINDS as readonly string[]).includes(value)) throw new SocialError('Unknown image type.', 404);
  return value as ImageKind;
}

// Body: the image bytes (PNG, JPEG or WebP; the app uploads a resized WebP).
export async function POST(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  try {
    const kind = kindOf((await params).kind);
    const { session } = await requireWriter(request);
    await limitWallet(session.wallet, 'image', 30, 60 * 60_000);
    const declared = Number(request.headers.get('content-length') ?? 0);
    if (declared > IMAGE_LIMITS[kind]) throw new SocialError(`Images can be at most ${IMAGE_LIMITS[kind] / 1024} KB.`, 413);
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length > IMAGE_LIMITS[kind]) throw new SocialError(`Images can be at most ${IMAGE_LIMITS[kind] / 1024} KB.`, 413);
    const mime = sniffImage(bytes);
    if (!mime) throw new SocialError('Upload a PNG, JPEG or WebP image.', 415);
    const version = await saveImage(session.wallet, kind, mime, bytes);
    return json({ kind, version });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  try {
    const kind = kindOf((await params).kind);
    const { session } = await requireWriter(request);
    await deleteImage(session.wallet, kind);
    return json({ kind, version: 0 });
  } catch (error) {
    return failure(error);
  }
}
