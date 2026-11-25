import React, { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, XCircle } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { clearSwapHistory, readSwapHistory, SWAP_HISTORY_EVENT, type SwapHistoryEntry } from '../utils/swapHistory';

export const SwapHistoryList: React.FC = () => {
  const { wallet, t } = useApp();
  const [entries, setEntries] = useState<SwapHistoryEntry[]>(() => readSwapHistory(wallet.address));

  useEffect(() => {
    const reload = () => setEntries(readSwapHistory(wallet.address));
    reload();
    window.addEventListener(SWAP_HISTORY_EVENT, reload);
    window.addEventListener('storage', reload);
    return () => {
      window.removeEventListener(SWAP_HISTORY_EVENT, reload);
      window.removeEventListener('storage', reload);
    };
  }, [wallet.address]);

  if (!wallet.isConnected) return null;

  return (
    <section className="mt-5 overflow-hidden rounded-lg border border-line bg-sunken">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-fg">{t.swapHistoryTitle}</h3>
        {entries.length > 0 && (
          <button
            type="button"
            onClick={() => clearSwapHistory(wallet.address)}
            className="text-[0.75rem] text-muted hover:text-fg"
          >
            {t.clearHistory}
          </button>
        )}
      </div>
      {entries.length === 0 ? (
        <p className="px-3 py-4 text-center text-xs text-muted">{t.swapHistoryEmpty}</p>
      ) : (
        <ul className="max-h-64 divide-y divide-line overflow-y-auto">
          {entries.map((entry) => (
            <li key={entry.txHash} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
              <div className="flex min-w-0 items-center gap-2">
                {entry.status === 'success'
                  ? <CheckCircle2 className="h-4 w-4 shrink-0 text-up" aria-label={t.swapStatusSuccess} />
                  : <XCircle className="h-4 w-4 shrink-0 text-down" aria-label={t.swapStatusFailed} />}
                <div className="min-w-0">
                  <div className="truncate font-mono text-fg">
                    {entry.payAmount} {entry.paySymbol} → {entry.receiveAmount.toLocaleString('en-US', { maximumFractionDigits: 6 })} {entry.receiveSymbol}
                  </div>
                  <div className="text-[0.75rem] text-muted">
                    {new Date(entry.timestamp).toLocaleString()} · {entry.provider === 'binance' ? 'Binance Web3' : entry.provider === 'uniswap' ? 'Uniswap V4 (direct)' : 'OKX'}
                  </div>
                </div>
              </div>
              <a
                href={`https://basescan.org/tx/${entry.txHash}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center gap-1 font-mono text-[0.75rem] text-accent hover:underline"
              >
                {entry.txHash.slice(0, 8)}…
                <ExternalLink className="h-3 w-3" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
