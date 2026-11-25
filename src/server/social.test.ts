import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';
import { decodeSession, encodeSession, isSameOrigin } from './session';
import { checkSiweMessage, verifySiweSignature } from './siwe';
import { profileInputSchema, sniffImage, thesisInputSchema, usernameProblem } from './social';

process.env.SESSION_SECRET = 'test-secret-that-is-long-enough-for-hmac-signing';
const account = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const HOST = 'bankrdex.example';

function message(overrides: Partial<Parameters<typeof createSiweMessage>[0]> = {}) {
  return createSiweMessage({
    address: account.address,
    chainId: 8453,
    domain: HOST,
    nonce: 'abcdef0123456789abcdef',
    uri: `https://${HOST}`,
    version: '1',
    issuedAt: new Date(),
    ...overrides,
  });
}

describe('sessions', () => {
  it('round-trips and rejects tampering or expiry', () => {
    const value = encodeSession('0xAbC0000000000000000000000000000000000001');
    expect(decodeSession(value)?.wallet).toBe('0xabc0000000000000000000000000000000000001');
    expect(decodeSession(value.slice(0, -2) + (value.endsWith('A') ? 'BB' : 'AA'))).toBeNull();
    expect(decodeSession(value, Date.now() + 8 * 24 * 3_600_000)).toBeNull();
    expect(decodeSession('garbage')).toBeNull();
  });

  it('accepts same-origin writes only', () => {
    const request = (origin: string | null) => new Request(`https://${HOST}/api/social/me`, {
      method: 'PUT',
      headers: { host: HOST, ...(origin ? { origin } : {}) },
    });
    expect(isSameOrigin(request(`https://${HOST}`))).toBe(true);
    expect(isSameOrigin(request('https://evil.example'))).toBe(false);
    expect(isSameOrigin(request(null))).toBe(false);
  });
});

describe('sign-in with ethereum', () => {
  it('checks domain, chain and freshness', () => {
    expect(checkSiweMessage(message(), HOST)).toMatchObject({ ok: true, wallet: account.address.toLowerCase() });
    expect(checkSiweMessage(message({ domain: 'evil.example' }), HOST).reason).toBe('domain');
    expect(checkSiweMessage(message({ chainId: 1 }), HOST).reason).toBe('chain');
    expect(checkSiweMessage(message({ issuedAt: new Date(Date.now() - 3_600_000) }), HOST).reason).toBe('expired');
    expect(checkSiweMessage('hello', HOST).reason).toBe('malformed');
  });

  it('verifies an EOA signature offline', async () => {
    const text = message();
    const signature = await account.signMessage({ message: text });
    expect(await verifySiweSignature(text, signature, account.address.toLowerCase())).toBe(true);
    expect(await verifySiweSignature(`${text} `, signature, account.address.toLowerCase())).toBe(false);
  });
});

describe('profile input', () => {
  it('normalizes usernames and links', () => {
    const parsed = profileInputSchema.parse({ username: '@Degen_42', x: 'https://x.com/bankrbot', website: 'example.com', displayName: ' A\u0000B ' });
    expect(parsed).toMatchObject({ username: 'degen_42', x: 'bankrbot', website: 'https://example.com/', displayName: 'AB' });
  });

  it('rejects reserved and impersonating names', () => {
    expect(usernameProblem('bankr')).toBeTruthy();
    expect(usernameProblem('bankrdex_team')).toBeTruthy();
    expect(usernameProblem('support_desk')).toBeTruthy();
    expect(usernameProblem('ab')).toBeTruthy();
    expect(usernameProblem('bankrfan')).toBeNull();
  });

  it('only accepts https websites', () => {
    expect(profileInputSchema.safeParse({ username: 'okname', website: 'javascript:alert(1)' }).success).toBe(false);
    expect(profileInputSchema.safeParse({ username: 'okname', website: 'http://plain.example' }).success).toBe(false);
  });
});

describe('theses and images', () => {
  const base = { tokenAddress: '0x9e00fc92493451eba1c63dd3880d68b622037ba3', title: 'Clean title', content: 'Reasoning', timeframe: '1w' };
  it('keeps levels on the right side of the entry', () => {
    expect(thesisInputSchema.safeParse({ ...base, stance: 'bullish', entryPrice: 1, targetPrice: 2, stopPrice: 0.5 }).success).toBe(true);
    expect(thesisInputSchema.safeParse({ ...base, stance: 'bullish', entryPrice: 1, targetPrice: 0.5 }).success).toBe(false);
    expect(thesisInputSchema.safeParse({ ...base, stance: 'bearish', entryPrice: 1, targetPrice: 0.5, stopPrice: 1.2 }).success).toBe(true);
    expect(thesisInputSchema.safeParse({ ...base, stance: 'bearish', entryPrice: 1, stopPrice: 0.9 }).success).toBe(false);
  });

  it('recognises images by their bytes', () => {
    expect(sniffImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImage(new TextEncoder().encode('RIFF\u0000\u0000\u0000\u0000WEBPVP8 '))).toBe('image/webp');
    expect(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
  });
});
