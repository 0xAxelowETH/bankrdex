import { describe, expect, it } from 'vitest';
import { decodeFunctionData } from 'viem';
import { fetchDirectPool, isNativePaired } from './directSwap';
import { buildBuyWithEth, poolKeyFor, routerAbi, V4_DEPLOYMENTS } from './v4Swap';

const MUSEBOOK = '0x91a2dae9699f0b82540b5886b0d8759c22820ba3';
const META = '0xc0d6457c16cc70d6790dd43521c899c87ce02f35';

describe('direct pools on Robinhood', () => {
  it('derives the pool key from Bankr’s pool id', async () => {
    const pool = await fetchDirectPool(MUSEBOOK, 'robinhood', { poolId: '0x40a433930370f6cdf0a78debc2c6dd599c23bd428c0d67dd8b5373e4f101557f', quote: META });
    expect(pool?.key.hooks).toBe(V4_DEPLOYMENTS.robinhood.hooks[0]);
    expect(pool && isNativePaired(pool)).toBe(false);
  });

  it('rejects a pool id that matches no Bankr pool key', async () => {
    expect(await fetchDirectPool(MUSEBOOK, 'arbitrum', { poolId: `0x${'1'.repeat(64)}`, quote: META })).toBeNull();
    expect(await fetchDirectPool(MUSEBOOK, 'robinhood', { poolId: `0x${'2'.repeat(64)}`, quote: META })).toBeNull();
  });

  it('builds swaps for the Robinhood router with the newer swap parameters', () => {
    const d = V4_DEPLOYMENTS.robinhood;
    const key = poolKeyFor(MUSEBOOK, d.weth, d.hooks[0]);
    const args = { key, token: MUSEBOOK, amountIn: 10n ** 15n, minOut: 1n, feeBps: 10, feeRecipient: '0xe9477c650411fccf640239595dfd2687dcb6e7a1', deadline: 1n, router: d.router, weth: d.weth };
    const legacy = buildBuyWithEth(args);
    const current = buildBuyWithEth({ ...args, minHopPrice: true });
    expect(current.to).toBe(d.router);
    const [, legacyInputs] = decodeFunctionData({ abi: routerAbi, data: legacy.data }).args;
    const [, inputs] = decodeFunctionData({ abi: routerAbi, data: current.data }).args;
    // minHopPriceX36 adds one 32-byte word to the V4 swap input.
    expect((inputs[2].length - legacyInputs[2].length) / 2).toBe(32);
  });
});
