import { NextResponse, type NextRequest } from 'next/server';
import { getClientIp, rateLimit } from './src/server/rateLimit';

interface RateRule {
  bucket: string;
  pattern: RegExp;
  limit: number;
}

const WINDOW_MS = 60_000;

// First matching rule wins. Transaction-building routes get the tightest budgets.
const RULES: RateRule[] = [
  { bucket: 'okx-tx', pattern: /^\/api\/okx-dex\/aggregator\/(swap|approve-transaction)$/, limit: 20 },
  { bucket: 'okx', pattern: /^\/api\/okx-dex\//, limit: 120 },
  { bucket: 'binance-tx', pattern: /^\/api\/binance-web3\/aggregator\/(swap|approve-transaction)$/, limit: 20 },
  { bucket: 'binance', pattern: /^\/api\/binance-web3\//, limit: 120 },
  { bucket: 'gecko', pattern: /^\/api\/geckoterminal\//, limit: 120 },
  { bucket: 'catalog', pattern: /^\/api\/token-catalog$/, limit: 30 },
  { bucket: 'logo', pattern: /^\/api\/token-logo\//, limit: 600 },
  { bucket: 'social-auth', pattern: /^\/api\/social\/auth\//, limit: 20 },
  { bucket: 'social-image', pattern: /^\/api\/social\/image\//, limit: 600 },
  { bucket: 'social', pattern: /^\/api\/social\//, limit: 240 },
  { bucket: 'api', pattern: /^\/api\//, limit: 180 },
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const rule = RULES.find(({ pattern }) => pattern.test(pathname));
  if (!rule) return NextResponse.next();

  const result = await rateLimit(`${rule.bucket}:${getClientIp(request.headers)}`, rule.limit, WINDOW_MS);
  const headers = {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
  };
  if (!result.allowed) {
    const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { error: 'Too many requests. Please slow down and retry shortly.' },
      { status: 429, headers: { ...headers, 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store' } }
    );
  }

  const response = NextResponse.next();
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
}

export const config = {
  matcher: '/api/:path*',
};
