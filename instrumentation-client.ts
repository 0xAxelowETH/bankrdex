// Error reporting is opt-in: without a DSN the Sentry SDK (~480 KB) is never downloaded.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  void import('@sentry/nextjs').then((Sentry) => {
    Sentry.init({
      dsn,
      environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV,
      // Swap requests carry wallet addresses in query strings; collect none of it.
      dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
      tracesSampleRate: 0,
      // Wallet extensions and RPC hiccups are noisy and not actionable.
      ignoreErrors: [/User rejected/i, /user denied/i, /ACTION_REJECTED/, /Failed to fetch/, /signal timed out/i],
    });
  });
}
