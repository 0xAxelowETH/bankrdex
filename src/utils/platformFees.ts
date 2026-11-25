import type { PendingPlatformFee } from '../types';

const PENDING_PLATFORM_FEES_KEY = 'bankrdex-pending-platform-fees';

export function readPendingPlatformFees(): PendingPlatformFee[] {
  try {
    const stored = window.localStorage.getItem(PENDING_PLATFORM_FEES_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): PendingPlatformFee[] => {
      if (!item || typeof item !== 'object') return [];
      const fee = item as Partial<PendingPlatformFee> & { outputTokenAddress?: unknown };
      const feeTokenAddress = fee.feeTokenAddress ?? fee.outputTokenAddress;
      if (
        typeof fee.id !== 'string' ||
        typeof fee.walletAddress !== 'string' ||
        typeof feeTokenAddress !== 'string' ||
        typeof fee.amountRaw !== 'string' ||
        !/^\d+$/.test(fee.amountRaw) ||
        typeof fee.amount !== 'string' ||
        typeof fee.decimals !== 'number' ||
        !Number.isInteger(fee.decimals) ||
        typeof fee.swapTxHash !== 'string' ||
        typeof fee.createdAt !== 'number' ||
        (fee.feeTxHash !== undefined && typeof fee.feeTxHash !== 'string')
      ) return [];
      return [{ ...fee, feeTokenAddress } as PendingPlatformFee];
    });
  } catch (error) {
    console.error('Unable to read pending platform fees:', error);
    return [];
  }
}

export function writePendingPlatformFees(fees: PendingPlatformFee[]): void {
  try {
    window.localStorage.setItem(PENDING_PLATFORM_FEES_KEY, JSON.stringify(fees));
  } catch (error) {
    console.error('Unable to persist pending platform fees:', error);
    throw new Error('The fee is unpaid, but local persistence failed. Do not repeat the swap; save this swap transaction hash.');
  }
}

export function upsertPendingPlatformFee(fee: PendingPlatformFee): PendingPlatformFee[] {
  const fees = readPendingPlatformFees();
  const index = fees.findIndex((item) => item.id === fee.id);
  if (index < 0) fees.unshift(fee);
  else fees[index] = fee;
  writePendingPlatformFees(fees);
  return fees;
}

export function removePendingPlatformFee(id: string): PendingPlatformFee[] {
  const fees = readPendingPlatformFees().filter((fee) => fee.id !== id);
  writePendingPlatformFees(fees);
  return fees;
}
