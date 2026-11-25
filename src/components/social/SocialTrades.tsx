import React, { useEffect, useState } from 'react';
import { ExternalLink, Loader2, Radio } from 'lucide-react';
import { explorerTx } from '../../config/chains';
import { fetchSocialTrades, timeAgo, type SocialTrade } from '../../services/social';
import { useApp } from '../../context/AppContext';
import { OkxTokenLogo } from '../OkxTokenLogo';
import { useOpenToken } from './ThesisCard';
import { formatPrice, formatUsd, TraderLabel } from './SocialBits';

const formatAmount = (value: number) => value.toLocaleString('en-US', { notation: value >= 1e6 ? 'compact' : 'standard', maximumFractionDigits: 2 });

// Trades from followed traders, every BankrDex profile, or one wallet; refreshes every 15 s.
export const SocialTrades: React.FC<{ scope: 'community' | 'following' | 'wallet'; wallet?: string; showTrader?: boolean; emptyText?: string }> = ({
  scope, wallet, showTrader = true, emptyText = 'No trades yet.',
}) => {
  const { tokens } = useApp();
  const openToken = useOpenToken();
  const [trades, setTrades] = useState<SocialTrade[] | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    let active = true;
    setTrades(null);
    const load = () => fetchSocialTrades(scope, { wallet, limit: 40 })
      .then((result) => {
        if (!active) return;
        setNeedsSignIn(Boolean(result.needsSignIn));
        setTrades((current) => {
          if (!current) { setHasMore(result.trades.length === 40); return result.trades; }
          const fresh = result.trades.filter((trade) => !current.some((existing) => existing.txHash === trade.txHash && existing.trader === trade.trader && existing.tokenAddress === trade.tokenAddress));
          return fresh.length ? [...fresh, ...current] : current;
        });
      })
      .catch(() => { if (active) setTrades((current) => current ?? []); });
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [scope, wallet]);

  const loadMore = async () => {
    if (!trades?.length || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchSocialTrades(scope, { wallet, before: trades[trades.length - 1].ts, limit: 40 });
      setTrades([...trades, ...page.trades]);
      setHasMore(page.trades.length === 40);
    } finally {
      setLoadingMore(false);
    }
  };

  if (trades === null) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted" /></div>;
  if (trades.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line bg-panel/50 px-6 py-10 text-center text-sm text-muted">
        <Radio className="h-6 w-6 text-accent" />
        {needsSignIn ? 'Sign in to see trades from traders you follow.' : emptyText}
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-panel">
      <ul className="divide-y divide-line/70">
        {trades.map((trade, index) => {
          const logo = tokens.find((token) => token.address.toLowerCase() === trade.tokenAddress)?.logo;
          return (
            <li key={`${trade.txHash}:${trade.tokenAddress}:${index}`} className="flex items-center gap-3 px-3 py-2.5 text-xs transition hover:bg-raised/40 sm:px-4">
              <span className={`w-11 shrink-0 rounded-md py-1 text-center text-[0.6875rem] font-black ${trade.isBuy ? 'bg-up/15 text-up' : 'bg-down/15 text-down'}`}>{trade.isBuy ? 'BUY' : 'SELL'}</span>
              <div className="min-w-0 flex-1">
                {showTrader && <TraderLabel wallet={trade.trader} card={trade.profile} size={18} className="max-w-full" />}
                <button type="button" onClick={() => openToken(trade.tokenAddress)} className="mt-0.5 flex min-w-0 items-center gap-1.5 text-left hover:text-accent">
                  <OkxTokenLogo logo={logo} symbol={trade.tokenSymbol ?? '?'} name={trade.tokenName ?? ''} size="xs" />
                  <span className="truncate font-mono text-fg-soft">{formatAmount(trade.tokenAmount)} <span className="font-sans font-bold text-fg">${trade.tokenSymbol ?? trade.tokenAddress.slice(0, 6)}</span></span>
                  <span className="hidden text-subtle sm:inline">@ {formatPrice(trade.priceUsd)}</span>
                </button>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-mono font-bold text-fg">{formatUsd(trade.volumeUsd)}</div>
                <a href={explorerTx('base', trade.txHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-subtle hover:text-accent">
                  {timeAgo(trade.ts)} <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </li>
          );
        })}
      </ul>
      {hasMore && (
        <button type="button" onClick={() => void loadMore()} className="flex w-full items-center justify-center gap-2 border-t border-line py-2 text-xs font-bold text-fg-soft hover:bg-raised">
          {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Load more
        </button>
      )}
    </div>
  );
};
