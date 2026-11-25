import { describe, expect, it, vi } from 'vitest';

vi.mock('./background', () => ({ runInBackground: () => undefined }));

const { decodeV4Buy, v4Pools } = await import('./bankrSales');

const word = (value: bigint) => BigInt.asUintN(256, value).toString(16).padStart(64, '0');

describe('decodeV4Buy', () => {
  // Real Base PoolManager Swap log of a Bankr pool: the swapper paid WETH (currency0, negative)
  // and received the launched token (currency1, positive).
  const realBuy = '0xfffffffffffffffffffffffffffffffffffffffffffffffffff1cf274da4ba3b00000000000000000000000000000000000000000002db8965c9fab4735565590000000000000000000000000000000000007346073e1ffa6b99175fe84f919c00000000000000000000000000000000000000000000b21c343234bb616733bf00000000000000000000000000000000000000000000000000000000000324240000000000000000000000000000000000000000000000000000000000001b58';
  const paidWei = -BigInt.asIntN(256, 0xfffffffffffffffffffffffffffffffffffffffffffffffffff1cf274da4ba3bn);

  it('returns the quote amount paid for a buy', () => {
    expect(decodeV4Buy(realBuy, false)).toBe(paidWei);
    expect(paidWei > 0n).toBe(true);
  });

  it('ignores the same swap seen from the other side (a sell)', () => {
    expect(decodeV4Buy(realBuy, true)).toBeNull();
    const sell = `0x${word(10n ** 15n)}${word(-(10n ** 21n))}${'0'.repeat(64 * 4)}`;
    expect(decodeV4Buy(sell, false)).toBeNull();
  });
});

describe('v4Pools', () => {
  it('orders currencies by address and skips 20-byte pools', () => {
    const pools = v4Pools([
      { address: '0xaf5cc9cded3f0f5801072c85ed86809077e77ba3', name: 'A', symbol: 'A', chain: 'base', chainId: 8453, pool: `0x${'11'.repeat(32)}`, quoteAddress: '0x4200000000000000000000000000000000000006' },
      { address: '0x0000000000000000000000000000000000000001', name: 'B', symbol: 'B', chain: 'base', chainId: 8453, pool: `0x${'22'.repeat(32)}` },
      { address: '0x22af33fe49fd1fa80c7149773dde5890d3c76f3b', name: 'BNKR', symbol: 'BNKR', chain: 'base', chainId: 8453, pool: '0xaec085e5a5ce8d96a7bdd3eb3a62445d4f6ce703' },
    ]);
    expect(pools.size).toBe(2);
    expect(pools.get(`0x${'11'.repeat(32)}`)?.tokenIsCurrency0).toBe(false);
    expect(pools.get(`0x${'22'.repeat(32)}`)?.tokenIsCurrency0).toBe(true);
  });
});
