import { afterEach, describe, expect, it, vi } from 'vitest';
import { lookupLogo, usableImage } from './tokenLogos';

afterEach(() => vi.unstubAllGlobals());

const TOKEN = '0x4444444444444444444444444444444444444ba3';
const CID = 'bafkreicqhdp4xhopvq5fx3rdrcngp7f2gyo6zcdscffowxihm3gkaeoucq';

describe('usableImage', () => {
  it('keeps https and ipfs images only', () => {
    expect(usableImage('https://api.bankr.bot/public/images/abc')).toBe('https://api.bankr.bot/public/images/abc');
    expect(usableImage(`ipfs://${CID}`)).toBe(`ipfs://${CID}`);
    expect(usableImage('http://plain.example/logo.png')).toBeNull();
    expect(usableImage('javascript:alert(1)')).toBeNull();
    expect(usableImage('https://assets.example/missing.png')).toBeNull();
    expect(usableImage(null)).toBeNull();
  });
});

describe('lookupLogo', () => {
  it('uses the Bankr launch image, then the IPFS metadata image', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ launch: { imageUri: 'https://api.bankr.bot/public/images/abc' } })));
    expect(await lookupLogo('base', TOKEN)).toEqual({ image: 'https://api.bankr.bot/public/images/abc', source: 'bankr' });

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => String(input).includes('api.bankr.bot')
      ? Response.json({ launch: { imageUri: '', metadataUri: `ipfs://${CID}` } })
      : Response.json({ name: 'T', image: `ipfs://${CID}` })));
    expect(await lookupLogo('base', TOKEN)).toEqual({ image: `ipfs://${CID}`, source: 'metadata' });
  });

  it('returns null for launches without an image and throws when Bankr is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => String(input).includes('api.bankr.bot')
      ? Response.json({ launch: { metadataUri: `ipfs://${CID}` } })
      : Response.json({ name: 'No image' })));
    expect(await lookupLogo('base', TOKEN)).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })));
    await expect(lookupLogo('base', TOKEN)).rejects.toThrow();
  });
});
