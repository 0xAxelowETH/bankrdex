import { z } from 'zod';
import { NATIVE_TOKEN_SENTINEL, PLATFORM_FEE_PERCENT, PLATFORM_FEE_RECEIVER } from '../config/platformFee';
import { CHAIN_KEYS, CHAINS } from '../config/chains';

export const evmAddress = z.string().regex(/^0x[a-fA-F\d]{40}$/, 'must be a 0x-prefixed EVM address');
export const tokenOrNative = evmAddress.refine(
  (value) => value.toLowerCase() !== '0x0000000000000000000000000000000000000000',
  'zero address is not a token'
);
export const positiveIntString = z.string().regex(/^\d{1,78}$/).refine((value) => BigInt(value) > 0n, 'must be > 0');
export const baseChain = z.literal('8453');
// Chains BankrDex routes through the aggregators (chain ids, as OKX's chainIndex and Binance's
// binanceChainId expect for EVM chains).
export const OKX_CHAIN_INDEXES = CHAIN_KEYS.map((key) => CHAINS[key].okxChainIndex).filter((id): id is string => Boolean(id));
export const BINANCE_CHAIN_IDS = CHAIN_KEYS.map((key) => CHAINS[key].binanceChainId).filter((id): id is string => Boolean(id));
export const routerChain = z.enum(OKX_CHAIN_INDEXES as [string, ...string[]], { error: 'chain is not routed by BankrDex' });
export const slippagePercent = z.coerce.number().gt(0).lte(50).transform(String);

export const feePercent = z.literal(PLATFORM_FEE_PERCENT, {
  error: `must include the ${PLATFORM_FEE_PERCENT}% platform fee`,
});
export const feeReceiver = z.string().refine(
  (value) => value.toLowerCase() === PLATFORM_FEE_RECEIVER.toLowerCase(),
  'must pay the platform fee to the configured revenue wallet'
).transform(() => PLATFORM_FEE_RECEIVER);

export { NATIVE_TOKEN_SENTINEL };

// Parses a URLSearchParams into a fresh, schema-only URLSearchParams. Unknown keys are dropped,
// so callers can never smuggle extra upstream parameters through the proxy.
export function parseQuery<T extends z.ZodRawShape>(
  shape: T,
  input: URLSearchParams
): { ok: true; params: URLSearchParams } | { ok: false; error: string } {
  const raw: Record<string, string> = {};
  for (const key of Object.keys(shape)) {
    const value = input.get(key);
    if (value !== null) raw[key] = value;
  }
  const result = z.strictObject(shape).safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    return { ok: false, error: `${issue.path.join('.') || 'query'}: ${issue.message}` };
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(result.data as Record<string, unknown>)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return { ok: true, params };
}

export function badRequest(error: string, status = 400): Response {
  return Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}
