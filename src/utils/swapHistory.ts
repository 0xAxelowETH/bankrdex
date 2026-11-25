// Per-wallet swap history kept in this browser, so a user's own swaps survive reloads and
// pool-feed refreshes. It is a convenience view; BaseScan remains the source of truth.

export interface SwapHistoryEntry {
  txHash: string;
  timestamp: number;
  status: 'success' | 'failed';
  provider: 'okx' | 'binance' | 'uniswap';
  paySymbol: string;
  payAmount: string;
  receiveSymbol: string;
  receiveAmount: number;
  tokenAddress: string;
  feeTxHash?: string;
}

const KEY_PREFIX = 'bankrdex-swap-history:';
const MAX_ENTRIES = 100;
const TX_HASH = /^0x[a-fA-F0-9]{64}$/;
export const SWAP_HISTORY_EVENT = 'bankrdex:swap-history';

function storageKey(wallet: string): string {
  return `${KEY_PREFIX}${wallet.toLowerCase()}`;
}

function isEntry(value: unknown): value is SwapHistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<SwapHistoryEntry>;
  return typeof entry.txHash === 'string' && TX_HASH.test(entry.txHash)
    && typeof entry.timestamp === 'number'
    && (entry.status === 'success' || entry.status === 'failed')
    && (entry.provider === 'okx' || entry.provider === 'binance' || entry.provider === 'uniswap')
    && typeof entry.paySymbol === 'string'
    && typeof entry.payAmount === 'string'
    && typeof entry.receiveSymbol === 'string'
    && typeof entry.receiveAmount === 'number'
    && typeof entry.tokenAddress === 'string';
}

export function readSwapHistory(wallet: string): SwapHistoryEntry[] {
  if (!wallet) return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey(wallet)) || '[]');
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
}

export function recordSwap(wallet: string, entry: SwapHistoryEntry): void {
  if (!wallet || !TX_HASH.test(entry.txHash)) return;
  try {
    const entries = [entry, ...readSwapHistory(wallet).filter((item) => item.txHash !== entry.txHash)].slice(0, MAX_ENTRIES);
    window.localStorage.setItem(storageKey(wallet), JSON.stringify(entries));
    window.dispatchEvent(new CustomEvent(SWAP_HISTORY_EVENT));
  } catch {
    // Storage full or blocked: the swap itself already succeeded on chain.
  }
}

export function clearSwapHistory(wallet: string): void {
  try {
    window.localStorage.removeItem(storageKey(wallet));
    window.dispatchEvent(new CustomEvent(SWAP_HISTORY_EVENT));
  } catch {
    // Ignore unavailable storage.
  }
}
