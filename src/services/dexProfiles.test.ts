import { describe, expect, it } from 'vitest';
import type { Token } from '../types';
import { applyDexProfile } from './dexProfiles';

const token = (extra: Partial<Token> = {}) => ({
  address: '0x1111111111111111111111111111111111111ba3',
  symbol: 'T',
  logo: 'ipfs://launch-logo',
  socials: { twitter: 'https://x.com/launch', source: 'launch' },
  dexscreenerPaidInfo: { hasPaid: null, paidType: 'unknown', socialsCount: 1, hasBanner: null, hasCustomIcon: null, verifiedBadge: null, dexUrl: '' },
  ...extra,
}) as Token;

describe('applyDexProfile', () => {
  it('replaces the launch links with the paid profile links', () => {
    const shown = applyDexProfile(token(), {
      paid: true,
      paidType: 'communityTakeover',
      imageUrl: 'https://cdn.dexscreener.com/cms/images/a',
      socials: { twitter: 'https://x.com/community', telegram: 'https://t.me/community' },
    });
    expect(shown.logo).toBe('https://cdn.dexscreener.com/cms/images/a');
    expect(shown.socials).toEqual({ twitter: 'https://x.com/community', telegram: 'https://t.me/community', source: 'dexscreener' });
    expect(shown.dexscreenerPaidInfo).toMatchObject({ hasPaid: true, paidType: 'community_takeover' });
  });

  it('keeps the launch links when the profile is not paid or lists no links', () => {
    expect(applyDexProfile(token(), { paid: false }).socials).toEqual({ twitter: 'https://x.com/launch', source: 'launch' });
    expect(applyDexProfile(token(), { paid: null }).socials).toEqual({ twitter: 'https://x.com/launch', source: 'launch' });
    expect(applyDexProfile(token(), { paid: true, paidType: 'tokenProfile', socials: {} }).socials).toEqual({ twitter: 'https://x.com/launch', source: 'launch' });
  });

  it('returns the same token when nothing changes', () => {
    const shown = applyDexProfile(token(), { paid: true, paidType: 'tokenProfile', socials: { website: 'https://site.xyz/' } });
    expect(applyDexProfile(shown, { paid: true, paidType: 'tokenProfile', socials: { website: 'https://site.xyz/' } })).toBe(shown);
    const plain = token();
    expect(applyDexProfile(plain, undefined)).toBe(plain);
  });
});
