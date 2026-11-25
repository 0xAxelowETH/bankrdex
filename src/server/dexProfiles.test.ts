import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDexProfiles, paidFromOrders, parseDexInfo, withDexSocials } from './dexProfiles';

afterEach(() => vi.unstubAllGlobals());

describe('parseDexInfo', () => {
  it('maps socials and websites to links, keeping extra ones', () => {
    expect(parseDexInfo({
      imageUrl: 'https://cdn.dexscreener.com/cms/images/logo?width=800',
      header: 'https://cdn.dexscreener.com/cms/images/banner',
      websites: [{ label: 'Website', url: 'https://bankr.bot' }, { label: 'Warpcast', url: 'https://warpcast.com/bankr' }],
      socials: [
        { type: 'twitter', url: 'https://x.com/bankrbot' },
        { type: 'telegram', url: 'https://t.me/bankr' },
        { type: 'discord', url: 'https://discord.gg/bankr' },
        { type: 'farcaster', url: 'https://farcaster.xyz/bankr' },
        { type: 'tiktok', url: 'https://tiktok.com/@bankr' },
      ],
    })).toEqual({
      imageUrl: 'https://cdn.dexscreener.com/cms/images/logo?width=800',
      headerUrl: 'https://cdn.dexscreener.com/cms/images/banner',
      socials: {
        twitter: 'https://x.com/bankrbot',
        telegram: 'https://t.me/bankr',
        discord: 'https://discord.gg/bankr',
        farcaster: 'https://farcaster.xyz/bankr',
        website: 'https://bankr.bot/',
        links: [{ label: 'Tiktok', url: 'https://tiktok.com/@bankr' }, { label: 'Warpcast', url: 'https://warpcast.com/bankr' }],
      },
    });
  });

  it('drops links that are not https and images from other hosts', () => {
    expect(parseDexInfo({
      imageUrl: 'https://evil.example/logo.png',
      websites: [{ url: 'javascript:alert(1)' }, { url: 'http://plain.example' }],
      socials: [{ type: 'twitter', url: 'data:text/html,hi' }],
    })).toBeNull();
    expect(parseDexInfo(null)).toBeNull();
  });
});

describe('paidFromOrders', () => {
  it('needs an approved Enhanced Token Info or Community Takeover order', () => {
    expect(paidFromOrders({ orders: [{ type: 'tokenProfile', status: 'approved' }] })).toEqual({ paid: true, paidType: 'tokenProfile' });
    expect(paidFromOrders({ orders: [{ type: 'communityTakeover', status: 'approved' }, { type: 'tokenProfile', status: 'cancelled' }] }))
      .toEqual({ paid: true, paidType: 'communityTakeover' });
    expect(paidFromOrders([{ type: 'tokenProfile', status: 'approved' }])).toEqual({ paid: true, paidType: 'tokenProfile' });
    expect(paidFromOrders({ orders: [{ type: 'tokenProfile', status: 'cancelled' }, { type: 'tokenAd', status: 'approved' }] })).toEqual({ paid: false });
    expect(paidFromOrders({ orders: [{ type: 'tokenProfile', status: 'on-hold' }] })).toEqual({ paid: false });
    expect(paidFromOrders({})).toEqual({ paid: false });
  });
});

const PAID = '0x1111111111111111111111111111111111111ba3';
const CANCELLED = '0x2222222222222222222222222222222222222ba3';
const PLAIN = '0x3333333333333333333333333333333333333ba3';
const pair = (address: string, info?: unknown) => ({ baseToken: { address: address.toUpperCase().replace('0X', '0x') }, info });

describe('getDexProfiles', () => {
  it('only uses the links of tokens with an approved paid order', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/tokens/v1/base/')) {
        return Response.json([
          pair(PAID, { imageUrl: 'https://cdn.dexscreener.com/cms/images/a', socials: [{ type: 'twitter', url: 'https://x.com/paid' }], websites: [{ url: 'https://paid.xyz' }] }),
          pair(CANCELLED, { imageUrl: 'https://cdn.dexscreener.com/cms/images/b', socials: [{ type: 'twitter', url: 'https://x.com/cancelled' }] }),
          pair(PLAIN),
        ]);
      }
      if (url.endsWith(`/orders/v1/base/${PAID}`)) return Response.json({ orders: [{ type: 'tokenProfile', status: 'approved' }], boosts: [] });
      if (url.endsWith(`/orders/v1/base/${CANCELLED}`)) return Response.json({ orders: [{ type: 'tokenProfile', status: 'cancelled' }], boosts: [] });
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const profiles = await getDexProfiles('base', [PAID, CANCELLED, PLAIN], 5_000);
    expect(profiles[PAID]).toEqual({
      paid: true,
      paidType: 'tokenProfile',
      imageUrl: 'https://cdn.dexscreener.com/cms/images/a',
      headerUrl: undefined,
      socials: { twitter: 'https://x.com/paid', website: 'https://paid.xyz/' },
    });
    // A profile whose orders were cancelled keeps its image but its links are not used.
    expect(profiles[CANCELLED]).toEqual({ paid: false, paidType: undefined, imageUrl: 'https://cdn.dexscreener.com/cms/images/b', headerUrl: undefined, socials: undefined });
    expect(profiles[PLAIN]).toEqual({ paid: false });
    const orderCalls = fetchMock.mock.calls.map(([input]) => String(input)).filter((url) => url.includes('/orders/'));
    expect(orderCalls).toHaveLength(2);

    const catalog = withDexSocials([
      { address: PAID, chain: 'base' as const, symbol: 'P' },
      { address: CANCELLED, chain: 'base' as const, symbol: 'C' },
      { address: PLAIN, chain: 'base' as const, symbol: 'N' },
    ]);
    expect(catalog[0]).toEqual({ address: PAID, chain: 'base', symbol: 'P', imageUrl: 'https://cdn.dexscreener.com/cms/images/a', dexPaid: 'tokenProfile', dexSocials: { twitter: 'https://x.com/paid', website: 'https://paid.xyz/' } });
    // Not paid: the DexScreener image is still the token's logo, the links are not used.
    expect(catalog[1]).toEqual({ address: CANCELLED, chain: 'base', symbol: 'C', imageUrl: 'https://cdn.dexscreener.com/cms/images/b' });
    expect(catalog[2]).toEqual({ address: PLAIN, chain: 'base', symbol: 'N' });
    // Everything was cached: the catalog did not start new lookups.
    expect(fetchMock.mock.calls.length).toBe(3);
  });
});
