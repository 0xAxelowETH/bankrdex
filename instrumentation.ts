import * as Sentry from '@sentry/nextjs';

// Server-side error reporting is opt-in via SENTRY_DSN.
export async function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn || process.env.NEXT_RUNTIME !== 'nodejs') return;
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
    // Swap requests carry wallet addresses in query strings; collect none of it.
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    tracesSampleRate: 0,
  });
}

export const onRequestError = Sentry.captureRequestError;
