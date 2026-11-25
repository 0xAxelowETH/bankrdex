import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDownWideNarrow, ArrowUpWideNarrow, ExternalLink } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { formatCurrency, shortenAddress } from '../utils/web3';
import { BrandLogo } from './BrandLogo';
import { explorerTx } from '../config/chains';
import { TraderLabel, useProfileCards } from './social/SocialBits';

type UsdSortOrder = 'descending' | 'ascending';
const PAGE_ROWS = 15;
const formatTradeTime = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

export const TradingActivity: React.FC = () => {
  const { activeToken, recentTrades, refreshActivePoolData, wallet, t } = useApp();
  const [minimumUsd, setMinimumUsd] = useState('0');
  const [sortOrder, setSortOrder] = useState<UsdSortOrder>('descending');
  const [visibleRows, setVisibleRows] = useState(PAGE_ROWS);
  useEffect(() => setVisibleRows(PAGE_ROWS), [activeToken.id]);
  const [activityScope, setActivityScope] = useState<'pool' | 'wallet'>('pool');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshSucceeded, setRefreshSucceeded] = useState<boolean | null>(null);
  const minimumUsdValue = Math.max(0, Number(minimumUsd) || 0);

  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      setRefreshSucceeded(await refreshActivePoolData());
    } finally {
      setIsRefreshing(false);
    }
  };

  const displayedTrades = useMemo(() => recentTrades
    .filter((trade) =>
      trade.tokenId === activeToken.id &&
      trade.amountUsd >= minimumUsdValue &&
      (activityScope === 'pool' || (
        wallet.isConnected && trade.wallet.toLowerCase() === wallet.address.toLowerCase()
      ))
    )
    .sort((left, right) => sortOrder === 'descending'
      ? right.amountUsd - left.amountUsd
      : left.amountUsd - right.amountUsd)
    .slice(0, 50),
  [activeToken.id, activityScope, minimumUsdValue, recentTrades, sortOrder, wallet.address, wallet.isConnected]);
  const visibleTrades = displayedTrades.slice(0, visibleRows);
  const traderCards = useProfileCards(visibleTrades.map((trade) => trade.wallet).filter((address) => /^0x[0-9a-fA-F]{40}$/.test(address)));
  const traderOf = (address: string) => /^0x[0-9a-fA-F]{40}$/.test(address)
    ? <TraderLabel wallet={address.toLowerCase()} card={traderCards[address.toLowerCase()]} size={18} className="max-w-[11rem]" />
    : <span className="text-subtle">—</span>;

  return (
    <section id="trading-activity" className="bd-card flex flex-col p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <div>
          <h3 className="text-sm font-extrabold text-fg">Buy / sell activity</h3>
          <p className="mt-0.5 text-[0.75rem] text-muted">
            {activityScope === 'wallet'
              ? `${shortenAddress(wallet.address)} · in loaded pool feed`
              : `$${activeToken.symbol} · latest pool transactions`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Activity source" className="flex items-center rounded-lg border border-line bg-sunken p-0.5">
            <button
              type="button"
              onClick={() => setActivityScope('pool')}
              aria-pressed={activityScope === 'pool'}
              className={`rounded-md px-2.5 py-1 text-[0.75rem] font-semibold ${activityScope === 'pool' ? 'bg-raised text-fg' : 'text-muted hover:text-fg'}`}
            >
              Pool
            </button>
            <button
              type="button"
              onClick={() => setActivityScope('wallet')}
              disabled={!wallet.isConnected}
              aria-pressed={activityScope === 'wallet'}
              title={wallet.isConnected ? 'Filter activity to the connected wallet address' : 'Connect a wallet to filter activity'}
              className={`rounded-md px-2.5 py-1 text-[0.75rem] font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${activityScope === 'wallet' ? 'bg-raised text-accent' : 'text-muted hover:text-fg'}`}
            >
              Wallet
            </button>
          </div>
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={isRefreshing || !activeToken.poolAddress}
            aria-label="Refresh buy/sell transactions"
            title="Reload transactions and this token's pool data"
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-sunken px-2.5 py-1.5 text-[0.75rem] font-semibold text-fg-soft transition-colors hover:border-accent/50 hover:text-fg disabled:cursor-wait disabled:opacity-60"
          >
            <BrandLogo brand="bankrdex" size={14} className={isRefreshing ? 'animate-spin' : ''} />
            {isRefreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          {refreshSucceeded !== null && !isRefreshing && (
            <span role="status" className={`text-[0.75rem] ${refreshSucceeded ? 'text-up' : 'text-warn'}`}>
              {refreshSucceeded ? 'Transaction data updated' : t.feedRetry}
            </span>
          )}
          <label className="flex items-center gap-2 rounded-lg border border-line bg-sunken px-2.5 py-1.5 text-[0.75rem] text-muted">
            <span>Min. USD</span>
            <span className="flex items-center gap-1 border-l border-line pl-2 text-fg">
              <span>$</span>
              <input
                type="number"
                min="0"
                step="1"
                value={minimumUsd}
                onChange={(event) => setMinimumUsd(event.target.value)}
                aria-label="Minimum transaction value in USD"
                className="w-24 bg-transparent text-right font-mono text-xs outline-none placeholder:text-subtle"
                placeholder="0"
              />
            </span>
          </label>

          <div role="group" aria-label="Sort transactions by USD value" className="flex items-center rounded-lg border border-line bg-sunken p-0.5">
            <button
              type="button"
              onClick={() => setSortOrder('descending')}
              aria-label="Highest USD value first"
              aria-pressed={sortOrder === 'descending'}
              title="Highest USD value first"
              className={`rounded-md p-1.5 ${sortOrder === 'descending' ? 'bg-raised text-accent' : 'text-subtle hover:text-fg'}`}
            >
              <ArrowDownWideNarrow className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setSortOrder('ascending')}
              aria-label="Lowest USD value first"
              aria-pressed={sortOrder === 'ascending'}
              title="Lowest USD value first"
              className={`rounded-md p-1.5 ${sortOrder === 'ascending' ? 'bg-raised text-accent' : 'text-subtle hover:text-fg'}`}
            >
              <ArrowUpWideNarrow className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Phones: compact cards with every field visible. */}
      <ul className="mt-3 divide-y divide-line/50 font-mono text-xs tabular-nums sm:hidden">
        {displayedTrades.length === 0 && (
          <li className="py-8 text-center text-subtle">No buy/sell transactions to show.</li>
        )}
        {visibleTrades.map((trade, index) => (
          <li key={`card-${trade.id}:${index}`} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={`font-bold ${trade.type === 'buy' ? 'text-up' : 'text-down'}`}>{trade.type === 'buy' ? 'BUY' : 'SELL'}</span>
                <span className="truncate text-fg-soft">{trade.amountToken.toLocaleString('en-US', { maximumFractionDigits: 2, notation: trade.amountToken >= 1e6 ? 'compact' : 'standard' })} ${activeToken.symbol}</span>
              </div>
              <div className="text-[0.75rem] text-subtle">{formatTradeTime(trade.timestamp)} · {formatCurrency(trade.priceUsd, true, 7)}</div>
              <div className="mt-0.5 text-[0.75rem]">{traderOf(trade.wallet)}</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="font-semibold text-fg">{formatCurrency(trade.amountUsd, true, 2)}</span>
              <a
                href={explorerTx(activeToken.chain, trade.txHash)}
                target="_blank"
                rel="noreferrer"
                aria-label={`${t.openTransactionOnBaseScan}: ${shortenAddress(trade.txHash)}`}
                className="rounded p-1 text-muted hover:text-accent"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-3 hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[54rem] text-left text-xs">
          <thead>
            <tr className="border-b border-line/80 font-mono text-[0.75rem] uppercase text-subtle">
              <th className="pb-2">Time</th>
              <th className="pb-2">Type</th>
              <th className="pb-2">Trader</th>
              <th className="pb-2 text-right">Token amount</th>
              <th className="pb-2 text-right">Price</th>
              <th className="pb-2 text-right">USD value</th>
              <th className="pb-2 text-right">{t.transactions}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/50 font-mono tabular-nums">
            {displayedTrades.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-xs text-subtle">
                  {activityScope === 'wallet'
                    ? 'No transactions for this wallet in the loaded pool feed.'
                    : recentTrades.some((trade) => trade.tokenId === activeToken.id)
                      ? 'No transactions meet the USD threshold.'
                      : 'No buy/sell transactions for this token yet.'}
                </td>
              </tr>
            ) : visibleTrades.map((trade, index) => (
              <tr key={`${trade.id}:${index}`} className="transition-colors hover:bg-raised/40">
                <td className="py-2.5 text-[0.75rem] text-muted">
                  {formatTradeTime(trade.timestamp)}
                </td>
                <td className={`py-2.5 font-bold ${trade.type === 'buy' ? 'text-up' : 'text-down'}`}>
                  {trade.type === 'buy' ? 'BUY' : 'SELL'}
                </td>
                <td className="py-2.5 text-[0.75rem]">{traderOf(trade.wallet)}</td>
                <td className="py-2.5 text-right text-fg-soft">
                  {trade.amountToken.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${activeToken.symbol}
                </td>
                <td className="py-2.5 text-right text-muted">
                  {formatCurrency(trade.priceUsd, true, 7)}
                </td>
                <td className="py-2.5 text-right font-semibold text-fg">
                  {formatCurrency(trade.amountUsd, true, 2)}
                </td>
                <td className="py-2.5 text-right">
                  <a
                    href={explorerTx(activeToken.chain, trade.txHash)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`${t.openTransactionOnBaseScan}: ${shortenAddress(trade.txHash)}`}
                    className="inline-flex items-center justify-end gap-1 text-muted hover:text-accent"
                  >
                    {shortenAddress(trade.txHash)}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[0.75rem] text-subtle">
        <span>{Math.min(visibleRows, displayedTrades.length)} / {displayedTrades.length} {t.transactionCount}</span>
        {displayedTrades.length > visibleRows && (
          <button
            type="button"
            onClick={() => setVisibleRows((rows) => rows + PAGE_ROWS)}
            className="rounded border border-line px-3 py-1 font-semibold text-fg-soft hover:border-accent/60 hover:text-fg"
          >
            Show more
          </button>
        )}
      </div>
    </section>
  );
};