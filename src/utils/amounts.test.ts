import { describe, expect, it } from 'vitest';
import { toInputAmount, toPlainDecimalString, toRawUnits } from './amounts';

describe('toPlainDecimalString', () => {
  it('never returns exponent notation', () => {
    expect(toPlainDecimalString(1e-7)).toBe('0.0000001');
    expect(toPlainDecimalString(1e21)).toBe('1000000000000000000000');
  });

  it('passes plain decimal strings through unchanged', () => {
    expect(toPlainDecimalString('0.000123')).toBe('0.000123');
  });

  it('rejects negative and non-finite values', () => {
    expect(() => toPlainDecimalString(-1)).toThrow();
    expect(() => toPlainDecimalString(Number.NaN)).toThrow();
  });
});

describe('toRawUnits', () => {
  it('converts tiny amounts that String(number) would print as 1e-7', () => {
    expect(toRawUnits(0.0000001, 18)).toBe(100_000_000_000n);
  });

  it('truncates extra decimals instead of rounding up past the balance', () => {
    expect(toRawUnits('1.2345679', 6)).toBe(1_234_567n);
    expect(toRawUnits(0.9999999, 6)).toBe(999_999n);
  });

  it('handles whole numbers', () => {
    expect(toRawUnits(5, 18)).toBe(5_000_000_000_000_000_000n);
  });
});

describe('toInputAmount', () => {
  it('formats max amounts without exponent and trims trailing zeros', () => {
    expect(toInputAmount(0.5)).toBe('0.5');
    expect(toInputAmount(1e-7, 12)).toBe('0.0000001');
    expect(toInputAmount(1.123456789, 4)).toBe('1.1234');
  });

  it('returns 0 for empty or invalid balances', () => {
    expect(toInputAmount(0)).toBe('0');
    expect(toInputAmount(-3)).toBe('0');
  });
});
