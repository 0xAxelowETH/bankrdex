// Signed-in wallet sessions for the social features. After Sign-In with Ethereum the server
// sets an httpOnly cookie holding the wallet and expiry, signed with HMAC-SHA256; nothing else
// is stored. SESSION_SECRET signs it (falls back to a key derived from the Supabase service key).
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'bankrdex_session';
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const WALLET = /^0x[0-9a-f]{40}$/;

export interface Session {
  wallet: string;
  expiresAt: number;
}

function secret(): string | null {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32) return process.env.SESSION_SECRET;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return serviceKey ? createHmac('sha256', serviceKey).update('bankrdex-session-v1').digest('hex') : null;
}

export const isSessionConfigured = () => secret() !== null;

const sign = (payload: string, key: string) => createHmac('sha256', key).update(payload).digest('base64url');

export function encodeSession(wallet: string, now = Date.now()): string {
  const key = secret();
  if (!key) throw new Error('Sessions are not configured (set SESSION_SECRET).');
  const payload = Buffer.from(JSON.stringify({ w: wallet.toLowerCase(), e: Math.floor(now / 1000) + SESSION_TTL_SECONDS })).toString('base64url');
  return `${payload}.${sign(payload, key)}`;
}

export function decodeSession(value: string | undefined, now = Date.now()): Session | null {
  const key = secret();
  if (!key || !value) return null;
  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload, key));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { w?: unknown; e?: unknown };
    if (typeof data.w !== 'string' || !WALLET.test(data.w) || typeof data.e !== 'number') return null;
    if (data.e * 1000 <= now) return null;
    return { wallet: data.w, expiresAt: data.e * 1000 };
  } catch {
    return null;
  }
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

export const readSession = (request: Request): Session | null => decodeSession(readCookie(request, SESSION_COOKIE));

const isSecure = (request: Request) =>
  new URL(request.url).protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';

export function sessionCookie(request: Request, wallet: string): string {
  return `${SESSION_COOKIE}=${encodeSession(wallet)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${isSecure(request) ? '; Secure' : ''}`;
}

export function clearedSessionCookie(request: Request): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isSecure(request) ? '; Secure' : ''}`;
}

// Writes must come from a BankrDex page: browsers send Origin on POST/PUT/DELETE, and a
// cross-site form or script would carry a different one.
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!origin || !host) return request.headers.get('sec-fetch-site') === 'same-origin';
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
