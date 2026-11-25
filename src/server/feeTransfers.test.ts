import { describe, expect, it } from 'vitest';
import { feeTransfersIn, nativeFeeIn } from './feeTransfers';
import { formatUnits } from './baseRpc';

const FEE = '0xe9477c650411fccf640239595dfd2687dcb6e7a1';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const pad = (address: string) => `0x${address.slice(2).padStart(64, '0')}`;
const USDT = '0x55d398326f99059ff775485246999027b3197955';
const USER = '0x8894e0a0c962cb723c1976a4421c95949be2d4e3';

describe('feeTransfersIn', () => {
  it('finds ERC-20 transfers to the fee wallet only', () => {
    const transfers = feeTransfersIn({
      status: '0x1',
      logs: [
        { address: USDT, topics: [TRANSFER, pad(USER), pad(FEE)], data: '0x' + (10n ** 15n).toString(16).padStart(64, '0') },
        { address: USDT, topics: [TRANSFER, pad(USER), pad('0x1111111111111111111111111111111111111111')], data: '0x' + '1'.padStart(64, '0') },
        { address: USDT, topics: [TRANSFER, pad(USER), pad(FEE), pad('0x01')], data: '0x' }, // ERC-721 style
        { address: USDT, topics: ['0xdeadbeef', pad(USER), pad(FEE)], data: '0x' + '5'.padStart(64, '0') },
      ],
    }, FEE.toUpperCase().replace('0X', '0x'));
    expect(transfers).toEqual([{ token: USDT, amount: 10n ** 15n }]);
  });

  it('reads ETH sent directly to the fee wallet', () => {
    expect(nativeFeeIn({ to: FEE.toUpperCase().replace('0X', '0x'), value: '0x38d7ea4c68000' }, FEE)).toBe(10n ** 15n);
    expect(nativeFeeIn({ to: USDT, value: '0x38d7ea4c68000' }, FEE)).toBe(0n);
    expect(nativeFeeIn({ to: null, value: '0x1' }, FEE)).toBe(0n);
  });

  it('formats amounts with decimals', () => {
    expect(formatUnits(10n ** 15n, 18)).toBe('0.001');
    expect(formatUnits(1234567n * 10n ** 16n, 18)).toBe('12,345.67');
  });
});
