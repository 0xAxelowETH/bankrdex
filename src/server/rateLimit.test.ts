import { describe, expect, it } from 'vitest';
import { getClientIp, rateLimit } from './rateLimit';

describe('rateLimit (memory fallback)', () => {
  it('allows up to the limit and then blocks within the window', async () => {
    const key = `test:${Math.random()}`;
    const results = [];
    for (let index = 0; index < 4; index += 1) results.push(await rateLimit(key, 3, 60_000));
    expect(results.map((result) => result.allowed)).toEqual([true, true, true, false]);
    expect(results[3].remaining).toBe(0);
  });

  it('tracks keys independently', async () => {
    const first = await rateLimit(`a:${Math.random()}`, 1, 60_000);
    const second = await rateLimit(`b:${Math.random()}`, 1, 60_000);
    expect(first.allowed && second.allowed).toBe(true);
  });
});

describe('getClientIp', () => {
  it('uses the first forwarded address', () => {
    expect(getClientIp(new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }))).toBe('1.2.3.4');
  });

  it('falls back to x-real-ip and then a local key', () => {
    expect(getClientIp(new Headers({ 'x-real-ip': '5.6.7.8' }))).toBe('5.6.7.8');
    expect(getClientIp(new Headers())).toBe('local');
  });
});
