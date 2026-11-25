import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { useSocial } from '../context/SocialContext';
import { shortenAddress } from '../utils/web3';
import { Check, Copy, ExternalLink, Lightbulb, Link2, Star } from 'lucide-react';
import { TokenSocialLinks } from './TokenSocialLinks';
import { DexScreenerEmblem } from './DexScreenerEmblem';
import { BankrVerifiedBadge } from './BankrVerifiedBadge';
import { OkxTokenLogo } from './OkxTokenLogo';
import { PairTokenLogo } from './PairTokenLogo';
import { ChainEmblem } from './ChainEmblem';
import { chainByKey, dexscreenerUrl, explorerToken } from '../config/chains';
import { readWatchlist, toggleWatch, WATCHLIST_EVENT, watchKey } from '../utils/marketPrefs';
import { ChangeValue, compactCount, compactUsd, exactPrice, formatPrice, formatTokenAge } from './MarketTableParts';
import { fetchBankrTokenStats, type BankrTokenStats } from '../services/tradingApis';
import { formatLag, useIndexFreshness } from './useIndexFreshness';

const LIVE_MS = 120_000;

function StatTile({ label, value, sub, title, children }: { label: string; value: React.ReactNode; sub?: React.ReactNode; title?: string; children?: React.ReactNode }) {
  return (
    <div className="stat-tile" title={title}>
      <div className="bd-label">{label}</div>
      <div className="mt-0.5 truncate font-mono text-[0.95rem] font-extrabold tabular-nums text-fg">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[0.6875rem] text-muted">{sub}</div>}
      {children}
    </div>
  );
}

// Token page header: identity and links, the live price with 5m / 1h / 24h changes, and the
// figures traders check first (market cap, liquidity depth, volume, buy/sell flow, holders, age).
export const OkxTokenHeader: React.FC = () => {
  const { activeToken: token } = useApp();
  const { openComposer } = useSocial();
  const [copied, setCopied] = useState<'address' | 'link' | null>(null);
  const key = watchKey(token);
  const [watched, setWatched] = useState(() => readWatchlist().has(key));
  const [stats, setStats] = useState<BankrTokenStats | null>(null);
  const chain = chainByKey(token.chain);

  useEffect(() => {
    const sync = () => setWatched(readWatchlist().has(key));
    sync();
    window.addEventListener(WATCHLIST_EVENT, sync);
    return () => window.removeEventListener(WATCHLIST_EVENT, sync);
  }, [key]);

  // Holder count and top-10 share (cached per token by the stats service).
  useEffect(() => {
    setStats(null);
    if (token.externalSource === 'market') return;
    const controller = new AbortController();
    fetchBankrTokenStats([token], controller.signal)
      .then(([item]) => { if (!controller.signal.aborted) setStats(item ?? null); })
      .catch(() => undefined);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token.address, token.chain]);

  const copy = async (what: 'address' | 'link') => {
    try {
      await navigator.clipboard.writeText(what === 'address' ? token.address : window.location.href);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 1_500);
    } catch {
      // Clipboard can be blocked.
    }
  };

  const index = useIndexFreshness();
  const indexBehind = (token.chain ?? 'base') === 'base' && (index.state === 'delayed' || index.state === 'stale');
  const live = Boolean(token.liveSnapshotAt && Date.now() - token.liveSnapshotAt < LIVE_MS) && !indexBehind;
  const hasData = token.priceUsd > 0 || token.marketCapUsd > 0 || token.volume24hUsd > 0;
  const launchedAt = token.launchedAt || Date.parse(token.createdAt) || 0;
  const buys = token.totalBuys24h || 0;
  const sells = token.totalSells24h || 0;
  const buyShare = buys + sells > 0 ? (buys / (buys + sells)) * 100 : null;
  const liqShare = token.liquidityUsd > 0 && token.marketCapUsd > 0 ? (token.liquidityUsd / token.marketCapUsd) * 100 : null;
  const holders = stats?.holderCount ?? (token.holders > 0 ? token.holders : null);
  const linkClass = 'inline-flex h-7 items-center gap-1 rounded-lg border border-line bg-sunken/40 px-2 text-[0.75rem] font-semibold text-muted transition hover:border-fg/20 hover:text-fg';

  return (
    <div className="bd-card token-hero min-w-0 p-3 sm:p-4">
      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative h-14 w-14 shrink-0">
            <span className="absolute inset-0 rounded-full bg-accent/25 blur-xl" aria-hidden="true" />
            <OkxTokenLogo logo={token.logo} symbol={token.symbol} name={token.name} size="xl" className="relative z-10 !h-14 !w-14" />
            <PairTokenLogo symbol={token.quoteSymbol} address={token.quoteAddress} logo={token.quoteLogo} refreshKey={token.liveSnapshotAt || 0} size="sm" className="absolute -bottom-1 -right-1 z-20 rounded-full border-2 border-panel bg-raised p-0.5" />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <h1 className="font-display truncate text-xl font-bold tracking-tight text-fg sm:text-2xl">{token.name || token.symbol}</h1>
              <span className="rounded-lg bg-raised px-2 py-0.5 font-mono text-xs font-bold text-fg-soft">${token.symbol}</span>
              <BankrVerifiedBadge token={token} />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
              <span className={`${linkClass} chain-chip chain-${chain.key}`}><ChainEmblem chain={chain.key} className="h-3.5 w-3.5" /> {chain.name}</span>
              {token.quoteSymbol && <span className={linkClass}>{token.symbol} / {token.quoteSymbol}</span>}
              <button type="button" onClick={() => void copy('address')} className={`${linkClass} font-mono`} title="Copy contract address">
                {shortenAddress(token.address)} {copied === 'address' ? <Check className="h-3 w-3 text-up" /> : <Copy className="h-3 w-3" />}
              </button>
              <a href={explorerToken(token.chain, token.address)} target="_blank" rel="noreferrer" className={linkClass} title={`View on ${chain.name} explorer`}>Explorer <ExternalLink className="h-3 w-3" /></a>
              <a href={dexscreenerUrl(token.chain, token.address)} target="_blank" rel="noreferrer" className={linkClass}>DexScreener <ExternalLink className="h-3 w-3" /></a>
              <TokenSocialLinks socials={token.socials} symbol={token.symbol} variant="button" showSource />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <DexScreenerEmblem token={token} />
          <button type="button" onClick={() => void copy('link')} title="Copy link to this token" aria-label="Copy link to this token" className="rounded-xl border border-line p-2 text-muted transition hover:border-fg/20 hover:text-fg">
            {copied === 'link' ? <Check className="h-4 w-4 text-up" /> : <Link2 className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => setWatched(toggleWatch(token).has(key))}
            aria-pressed={watched}
            title={watched ? 'Remove from watchlist' : 'Add to watchlist'}
            className={`rounded-xl border p-2 transition ${watched ? 'border-warn/50 bg-warn/10 text-warn' : 'border-line text-muted hover:border-fg/20 hover:text-fg'}`}
          >
            <Star className={`h-4 w-4 ${watched ? 'fill-current' : ''}`} />
          </button>
          <button type="button" onClick={() => openComposer()} className="btn-gradient inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3.5 text-xs font-extrabold text-white">
            <Lightbulb className="h-3.5 w-3.5" /> <span className="sm:hidden">Thesis</span><span className="hidden sm:inline">Post thesis</span>
          </button>
        </div>
      </div>

      <div className="relative mt-4 grid gap-3 lg:grid-cols-[minmax(13rem,auto)_minmax(0,1fr)] lg:items-stretch">
        <div className="flex flex-col justify-center rounded-2xl border border-line/80 bg-sunken/50 px-4 py-3">
          <div className="flex items-center gap-1.5 bd-label" title={indexBehind ? `The on-chain index is ${formatLag(index.lagSeconds)} behind the chain; the chart, trades and 24h stats may be out of date.` : undefined}>
            <span className={`h-1.5 w-1.5 rounded-full ${live ? 'live-dot bg-up' : indexBehind ? 'bg-warn' : 'bg-subtle'}`} />
            {live ? 'Live price' : indexBehind ? <span className="text-warn">Delayed <span className="normal-case">· index {formatLag(index.lagSeconds)} behind</span></span> : 'Last price'}
          </div>
          <div className="mt-1 font-mono text-[1.85rem] font-extrabold leading-none tracking-tight text-fg" title={exactPrice(token.priceUsd)}>
            {formatPrice(token.priceUsd)}
          </div>
          {token.priceEth > 0 && (
            <div className="mt-1 font-mono text-[0.6875rem] text-subtle" title="Price in ETH">
              {token.priceEth.toLocaleString('en-US', { maximumSignificantDigits: 4 })} ETH
            </div>
          )}
          <div className="mt-2.5 flex flex-wrap gap-1.5 text-[0.75rem]">
            {([['5m', token.change5m], ['1h', token.change1h], ['24h', token.change24h]] as const).map(([label, value]) => (
              <span key={label} className="inline-flex items-center gap-1">
                <span className="font-semibold text-subtle">{label}</span>
                <ChangeValue value={value} available={hasData} />
              </span>
            ))}
          </div>
        </div>

        <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3">
          <StatTile label="Market cap" value={compactUsd(token.marketCapUsd)} sub={token.isGraduated ? 'Pool live on DEX' : 'Price discovery'} />
          <StatTile
            label="Liquidity"
            value={compactUsd(token.liquidityUsd)}
            title="Pool liquidity and how deep it is compared to the market cap. Thin liquidity means bigger price impact."
            sub={liqShare !== null ? <span className={liqShare < 3 ? 'text-warn' : undefined}>{liqShare.toFixed(liqShare < 10 ? 1 : 0)}% of market cap</span> : undefined}
          />
          <StatTile
            label="Volume 24h"
            value={compactUsd(token.volume24hUsd)}
            sub={token.marketCapUsd > 0 && token.volume24hUsd > 0 ? `${((token.volume24hUsd / token.marketCapUsd) * 100).toFixed(1)}% of market cap` : undefined}
          />
          <StatTile label="Txns 24h" value={token.totalTx24h > 0 ? compactCount(token.totalTx24h) : '—'} title={`${buys.toLocaleString('en-US')} buys / ${sells.toLocaleString('en-US')} sells`}>
            {buyShare !== null && (
              <div className="mt-1">
                <span className="ratio-bar"><span style={{ width: `${buyShare}%` }} /></span>
                <div className="mt-0.5 flex justify-between font-mono text-[0.6875rem]"><span className="text-up">{compactCount(buys)} B</span><span className="text-down">{compactCount(sells)} S</span></div>
              </div>
            )}
          </StatTile>
          <StatTile
            label="Holders"
            value={holders !== null ? `${stats && !stats.holdersComplete ? '~' : ''}${compactCount(holders)}` : '—'}
            title="Holder count indexed by GeckoTerminal; the top-10 share includes the pool and vesting contracts."
            sub={stats?.top10Share != null ? <span className={stats.top10Share > 70 ? 'text-warn' : undefined}>Top 10 hold {stats.top10Share.toFixed(1)}%</span> : undefined}
          />
          <StatTile
            label="Age"
            value={launchedAt > 0 ? formatTokenAge(Date.now() - launchedAt) : '—'}
            sub={launchedAt > 0 ? new Date(launchedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : undefined}
          />
        </div>
      </div>
    </div>
  );
};
