// Uniswap V4 pool ids of Bankr's Doppler launches on Base, computed without any RPC call:
// a V4 pool id is keccak256(abi.encode(PoolKey)).
//
// Bankr's Doppler pools use the dynamic-fee flag (0x800000), tick spacing 200, and one of two hook
// contracts: launches through initializer 0xd59ce4… use hook 0xbb7784…, launches through
// initializer 0xbdf938… use either 0xbb7784… (early ones) or the initializer itself. Both
// candidates are kept; only the pool that exists ever shows up in swap logs.
// Imported by server code and, through Node's type stripping, by scripts/*.mjs.
import { encodeAbiParameters, keccak256 } from 'viem';

export const BANKR_OLD_HOOK = '0xbb7784a4d481184283ed89619a3e3ed143e1adc0';
export const BANKR_DYNAMIC_FEE = 0x800000;
export const BANKR_TICK_SPACING = 200;
const HOOKS_BY_INITIALIZER: Record<string, string[]> = {
  '0xd59ce43e53d69f190e15d9822fb4540dccc91178': [BANKR_OLD_HOOK],
  '0xbdf938149ac6a781f94faa0ed45e6a0e984c6544': ['0xbdf938149ac6a781f94faa0ed45e6a0e984c6544', BANKR_OLD_HOOK],
};

export interface PoolMapRow {
  pool_id: string;
  token_address: string;
  quote_address: string;
  token_is_currency0: boolean;
  hooks: string;
}

export function poolIdOf(currency0: string, currency1: string, hooks: string, fee = BANKR_DYNAMIC_FEE, tickSpacing = BANKR_TICK_SPACING): string {
  return keccak256(encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
    [currency0 as `0x${string}`, currency1 as `0x${string}`, fee, tickSpacing, hooks as `0x${string}`],
  ));
}

export function candidatePools(token: string, quote: string, initializer: string): PoolMapRow[] {
  const hooks = HOOKS_BY_INITIALIZER[initializer.toLowerCase()] ?? [];
  const tokenIsCurrency0 = BigInt(token) < BigInt(quote);
  const [currency0, currency1] = tokenIsCurrency0 ? [token, quote] : [quote, token];
  return hooks.map((hook) => ({
    pool_id: poolIdOf(currency0, currency1, hook),
    token_address: token.toLowerCase(),
    quote_address: quote.toLowerCase(),
    token_is_currency0: tokenIsCurrency0,
    hooks: hook,
  }));
}
