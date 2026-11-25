import { parseUnits } from 'viem';

// Number#toString switches to exponent notation for very small/large values ("1e-7"),
// which viem's parseUnits rejects. This always yields a plain decimal string.
export function toPlainDecimalString(value: number | string): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d+(\.\d+)?$/.test(trimmed)) return trimmed;
    value = Number(trimmed);
  }
  if (!Number.isFinite(value) || value < 0) throw new Error('Amount must be a finite, non-negative number.');
  return value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 });
}

// Converts a human amount to raw token units, truncating (never rounding up) extra decimals,
// so a "max" amount cannot exceed the wallet balance.
export function toRawUnits(value: number | string, decimals: number): bigint {
  const [whole, fraction = ''] = toPlainDecimalString(value).split('.');
  return parseUnits(fraction ? `${whole}.${fraction.slice(0, decimals)}` : whole, decimals);
}

// Formats a spendable amount for an input field: truncated to `maxDecimals`, no exponent.
export function toInputAmount(value: number, maxDecimals = 12): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  const [whole, fraction = ''] = toPlainDecimalString(value).split('.');
  const trimmed = fraction.slice(0, maxDecimals).replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole;
}
