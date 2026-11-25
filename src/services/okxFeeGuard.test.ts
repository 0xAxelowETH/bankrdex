import { describe, expect, it } from 'vitest';
import { PLATFORM_FEE_RECEIVER } from '../config/platformFee';
import { assertOkxSwapIncludesFee } from './okxFeeGuard';

const ROUTER = '0x9333c74bdd1e118634fe5664aca7a9710b108bab';
const receiverHex = PLATFORM_FEE_RECEIVER.slice(2);

describe('assertOkxSwapIncludesFee', () => {
  it('accepts calldata that carries the fee receiver', () => {
    expect(() => assertOkxSwapIncludesFee(
      { to: ROUTER, data: `0xabcdef00${receiverHex.toUpperCase()}0000`, value: '0x10' },
      true,
      0x10n
    )).not.toThrow();
  });

  it('rejects a route where OKX dropped the fee', () => {
    expect(() => assertOkxSwapIncludesFee({ to: ROUTER, data: '0xabcdef', value: '0x0' }, false, 1n))
      .toThrow(/without the 0.1% platform fee/);
  });

  it('rejects sending the swap directly to the fee wallet', () => {
    expect(() => assertOkxSwapIncludesFee({ to: PLATFORM_FEE_RECEIVER, data: `0x${receiverHex}`, value: '0x0' }, false, 1n))
      .toThrow(/invalid swap target/);
  });

  it('rejects a transaction that sends more ETH than requested', () => {
    expect(() => assertOkxSwapIncludesFee({ to: ROUTER, data: `0x${receiverHex}`, value: '0x11' }, true, 0x10n))
      .toThrow(/more ETH/);
    expect(() => assertOkxSwapIncludesFee({ to: ROUTER, data: `0x${receiverHex}`, value: '0x1' }, false, 0x10n))
      .toThrow(/more ETH/);
  });
});
