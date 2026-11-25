import { getImage, IMAGE_KINDS, type ImageKind } from '../../../../../../src/server/social';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A profile's avatar or banner. URLs carry ?v=<version>, so a versioned response never changes.
export async function GET(request: Request, { params }: { params: Promise<{ wallet: string; kind: string }> }) {
  const { wallet, kind } = await params;
  if (!(IMAGE_KINDS as readonly string[]).includes(kind)) return new Response(null, { status: 404 });
  try {
    const image = await getImage(wallet, kind as ImageKind);
    if (!image) return new Response(null, { status: 404, headers: { 'Cache-Control': 'public, max-age=60' } });
    const versioned = new URL(request.url).searchParams.has('v');
    return new Response(new Uint8Array(image.data), {
      headers: {
        'Content-Type': image.mime,
        'Content-Length': String(image.data.length),
        'Cache-Control': versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=60',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new Response(null, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
