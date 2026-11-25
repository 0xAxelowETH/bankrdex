const USER_CANCELLED = /user (rejected|denied|cancel)|ACTION_REJECTED|4001/i;

// Reports failed swaps so a provider outage shows up as a spike instead of silently in
// users' consoles. Wallet addresses and amounts are deliberately not sent. The SDK is
// loaded lazily and only when a DSN is configured.
export function reportSwapFailure(
  message: string,
  context: { provider?: 'okx' | 'binance'; direction: 'buy' | 'sell'; stage: 'build' | 'submit' | 'confirm' },
  error?: unknown
): void {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  if (USER_CANCELLED.test(message) || (error instanceof Error && USER_CANCELLED.test(error.message))) return;
  void import('@sentry/nextjs').then((Sentry) => {
    Sentry.withScope((scope) => {
      scope.setTag('feature', 'swap');
      scope.setTag('swap.provider', context.provider ?? 'unknown');
      scope.setTag('swap.direction', context.direction);
      scope.setTag('swap.stage', context.stage);
      scope.setFingerprint(['swap-failure', context.provider ?? 'unknown', context.stage]);
      if (error instanceof Error) Sentry.captureException(error);
      else Sentry.captureMessage(`Swap failed: ${message.slice(0, 200)}`, 'error');
    });
  }).catch(() => undefined);
}
