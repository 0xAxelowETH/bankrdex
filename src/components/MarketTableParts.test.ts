import { describe, expect, it } from 'vitest';
import { formatPrice, formatTokenAge } from './MarketTableParts';

const minute = 60_000;

describe('formatTokenAge', () => {
  it('counts minutes in the first hour', () => {
    expect(formatTokenAge(20_000)).toBe('<1m');
    expect(formatTokenAge(minute)).toBe('1m');
    expect(formatTokenAge(59 * minute + 59_000)).toBe('59m');
  });

  it('counts hours and minutes until 24 hours', () => {
    expect(formatTokenAge(60 * minute)).toBe('1h');
    expect(formatTokenAge(5 * 60 * minute + 12 * minute)).toBe('5h 12m');
    expect(formatTokenAge(24 * 60 * minute - 1)).toBe('23h 59m');
  });

  it('counts whole days after 24 hours', () => {
    expect(formatTokenAge(24 * 60 * minute)).toBe('1d');
    expect(formatTokenAge(3 * 24 * 60 * minute + 23 * 60 * minute)).toBe('3d');
  });

  it('never shows negative ages', () => {
    expect(formatTokenAge(-5 * minute)).toBe('<1m');
  });
});

describe('formatPrice', () => {
  it('collapses leading zeros of tiny prices into a subscript count', () => {
    expect(formatPrice(0.000000222507)).toBe('$0.0₆2225');
    expect(formatPrice(0.00001)).toBe('$0.0₄1');
    expect(formatPrice(0.0000099999)).toBe('$0.0₄1');
  });

  it('keeps four significant digits between $0.0001 and $1', () => {
    expect(formatPrice(0.000325322)).toBe('$0.0003253');
    expect(formatPrice(0.5)).toBe('$0.5');
  });

  it('uses cents above $1 and whole dollars above $1,000', () => {
    expect(formatPrice(2525.28)).toBe('$2,525');
    expect(formatPrice(3.14159)).toBe('$3.14');
  });

  it('shows a dash for missing prices', () => {
    expect(formatPrice(0)).toBe('—');
    expect(formatPrice(Number.NaN)).toBe('—');
  });
});
