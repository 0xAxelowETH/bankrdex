import { describe, expect, it } from 'vitest';
import { decodeBuy } from './buyValues';

const V3_SWAP = '0x19b47279256b2a23a1665c810c8d55a1758940ee09377d4f8d26497a3577dc83';
const V2_SWAP = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822';
const word = (value: bigint) => BigInt.asUintN(256, value).toString(16).padStart(64, '0');

describe('decodeBuy', () => {
  // A real V3 buy: the pool paid the launch token (token0) out for 0x00afdbfcdc61c000 of the quote token.
  const realV3 = {
    topics: [V3_SWAP],
    data: '0xffffffffffffffffffffffffffffffffffffffffffff9e7f1c584655ca95198400000000000000000000000000000000000000000000000000afdbfcdc61c0000000000000000000000000000000000000000000001565f1f67f9626453461420000000000000000000000000000000000000000000012cbe2dcd627878a7a53fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffd8cdb0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000090105fbb8000',
  };

  it('reads the quote amount paid in a V3 buy', () => {
    expect(decodeBuy(realV3, true)).toBe(0xafdbfcdc61c000n);
  });

  it('ignores a V3 sell (token flows into the pool)', () => {
    expect(decodeBuy(realV3, false)).toBeNull();
    const sell = { topics: [V3_SWAP], data: `0x${word(10n ** 18n)}${word(-(10n ** 16n))}${'0'.repeat(64 * 5)}` };
    expect(decodeBuy(sell, true)).toBeNull();
  });

  it('reads V2 buys in either token order', () => {
    // token1 out, quote (token0) in
    const log = { topics: [V2_SWAP], data: `0x${word(5n)}${word(0n)}${word(0n)}${word(900n)}` };
    expect(decodeBuy(log, false)).toBe(5n);
    expect(decodeBuy(log, true)).toBeNull();
  });

  it('ignores unrelated events', () => {
    expect(decodeBuy({ topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'], data: '0x' }, true)).toBeNull();
  });
});
