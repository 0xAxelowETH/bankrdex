import { describe, expect, it } from 'vitest';
import { decodeFunctionData } from 'viem';
import { buildBuyWithEth, buildSell, platformFee, poolKeyFor, routerAbi, UNIVERSAL_ROUTER, WETH } from './v4Swap';

const TOKEN = '0x9e00fc92493451eba1c63dd3880d68b622037ba3';
const HOOK = '0xbdf938149ac6a781f94faa0ed45e6a0e984c6544';
const FEE_TO = '0xe9477c650411fccf640239595dfd2687dcb6e7a1';
const key = poolKeyFor(TOKEN, WETH, HOOK);

describe('poolKeyFor', () => {
  it('sorts currencies and keeps Bankr pool parameters', () => {
    expect(key.currency0).toBe(WETH);
    expect(key.currency1).toBe(TOKEN);
    expect(key.fee).toBe(0x800000);
    expect(key.tickSpacing).toBe(200);
  });
});

describe('buildBuyWithEth', () => {
  const amountIn = 10n ** 16n;
  const built = buildBuyWithEth({ key, token: TOKEN, amountIn, minOut: 1n, feeBps: 10, feeRecipient: FEE_TO, deadline: 1n });
  const { args } = decodeFunctionData({ abi: routerAbi, data: built.data });

  it('sends the full ETH amount to the Universal Router', () => {
    expect(built.to).toBe(UNIVERSAL_ROUTER);
    expect(built.value).toBe(amountIn);
  });

  it('transfers the 0.1% fee, wraps the rest and swaps it in the V4 pool', () => {
    expect(args[0]).toBe('0x050b10'); // TRANSFER, WRAP_ETH, V4_SWAP
    const fee = platformFee(amountIn, 10);
    expect(fee).toBe(10n ** 13n);
    expect(args[1][0].toLowerCase()).toContain(FEE_TO.slice(2));
    expect(args[1][0]).toContain(fee.toString(16));
  });
});

describe('buildSell', () => {
  it('takes the fee in the token via Permit2, swaps and unwraps WETH to ETH', () => {
    const built = buildSell({ key, token: TOKEN, quote: WETH, amountIn: 10n ** 21n, minOut: 1n, feeBps: 10, feeRecipient: FEE_TO, deadline: 1n });
    const { args } = decodeFunctionData({ abi: routerAbi, data: built.data });
    expect(built.value).toBe(0n);
    expect(args[0]).toBe('0x02100c'); // PERMIT2_TRANSFER_FROM, V4_SWAP, UNWRAP_WETH
  });
});
