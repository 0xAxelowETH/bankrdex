export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Bankr launch artwork is stored on IPFS (ipfs://<cid>). Public gateways are slow and rate
// limited, so the image is fetched once here and then served from memory and the CDN.
const CID_PATTERN = /^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,100})$/;
// ipfs.io and dweb.link now answer servers with a notice page or 429, so Pinata goes first.
const GATEWAYS = ['https://gateway.pinata.cloud/ipfs/', 'https://ipfs.io/ipfs/', 'https://dweb.link/ipfs/'];
const MAX_BYTES = 3 * 1024 * 1024;
const MEMORY_MAX_ENTRIES = 300;
// Content-addressed: the bytes behind a CID never change.
const IMMUTABLE_CACHE = 'public, max-age=604800, s-maxage=31536000, immutable';

interface Artwork {
  contentType: string;
  bytes: Uint8Array;
}

const memory = new Map<string, Artwork | null>();
const inFlight = new Map<string, Promise<Artwork | null>>();

function imageResponse(artwork: Artwork): Response {
  return new Response(artwork.bytes as BodyInit, {
    headers: {
      'Content-Type': artwork.contentType,
      'Cache-Control': IMMUTABLE_CACHE,
      'Content-Security-Policy': "default-src 'none'",
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function notFound(cacheControl: string): Response {
  return new Response(null, { status: 404, headers: { 'Cache-Control': cacheControl } });
}

// null = the CID is not an image; throws when no gateway could be reached.
async function fetchArtwork(cid: string): Promise<Artwork | null> {
  let lastError: unknown;
  for (const gateway of GATEWAYS) {
    try {
      const response = await fetch(`${gateway}${cid}`, {
        signal: AbortSignal.timeout(10_000),
        cache: 'no-store',
      });
      if (!response.ok) {
        lastError = new Error(`IPFS gateway answered ${response.status}.`);
        continue;
      }
      const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      // A gateway's HTML notice page is not an answer about the CID: try the next gateway.
      if (contentType === 'text/html') {
        lastError = new Error('IPFS gateway answered with a web page.');
        continue;
      }
      // SVG can carry script; only raster formats are served.
      if (!/^image\/(png|jpe?g|gif|webp|avif)$/.test(contentType)) return null;
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > MAX_BYTES) return null;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return null;
      return { contentType, bytes };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('All IPFS gateways failed.');
}

export async function GET(_request: Request, context: { params: Promise<{ cid: string }> }) {
  const { cid } = await context.params;
  if (!CID_PATTERN.test(cid)) return notFound('no-store');

  if (memory.has(cid)) {
    const cached = memory.get(cid);
    return cached ? imageResponse(cached) : notFound('public, max-age=86400');
  }

  let pending = inFlight.get(cid);
  if (!pending) {
    pending = fetchArtwork(cid).finally(() => inFlight.delete(cid));
    inFlight.set(cid, pending);
  }

  try {
    const artwork = await pending;
    memory.set(cid, artwork);
    if (memory.size > MEMORY_MAX_ENTRIES) memory.delete(memory.keys().next().value as string);
    return artwork ? imageResponse(artwork) : notFound('public, max-age=86400');
  } catch (error) {
    console.error('IPFS artwork lookup failed:', error);
    // Gateway outage: do not cache, so the next request retries.
    return new Response(null, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' } });
  }
}
