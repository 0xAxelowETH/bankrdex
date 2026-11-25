import React, { useMemo } from 'react';
import { Activity, ArrowRight, BarChart3, Flame, Layers, Newspaper, Rocket, Sparkles, Trophy, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useSocial } from '../context/SocialContext';
import { CHAINS } from '../config/chains';
import type { Token } from '../types';
import { OkxTokenLogo } from './OkxTokenLogo';
import { ChainEmblem } from './ChainEmblem';
import { ChangeValue, compactUsd, exactPrice, formatPrice, TokenAge } from './MarketTableParts';
import { compactNumber, launchedAtOf, marketTotals } from './market/marketStats';

function Kpi({ icon, label, value, children, title }: { icon: React.ReactNode; label: string; value: React.ReactNode; children?: React.ReactNode; title?: string }) {
  return (
    <div className="hero-stat min-w-0 rounded-2xl px-3 py-2.5 sm:px-3.5 sm:py-3" title={title}>
      <div className="flex items-center gap-1.5 bd-label">{icon}{label}</div>
      <div className="mt-1 truncate font-mono text-lg font-extrabold tracking-tight text-fg sm:text-[1.35rem]">{value}</div>
      {children && <div className="mt-1.5 min-w-0 text-[0.6875rem] text-muted">{children}</div>}
    </div>
  );
}

type SpotlightKind = 'trending' | 'gainers' | 'new';

function SpotlightRow({ token, index, kind, onOpen }: { token: Token; index: number; kind: SpotlightKind; onOpen: (token: Token) => void }) {
  return (
    <li>
      <button type="button" onClick={() => onOpen(token)} className="spot-row flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left">
        <span className={`rank-badge shrink-0 ${index < 3 ? `rank-${index + 1}` : ''}`}>{index + 1}</span>
        <span className="relative shrink-0">
          <OkxTokenLogo logo={token.logo} symbol={token.symbol} name={token.name} size="sm" />
          <ChainEmblem chain={token.chain ?? 'base'} className="absolute -bottom-1 -right-1 h-3 w-3 border border-panel" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.8125rem] font-bold text-fg">${token.symbol}</span>
          {token.priceUsd > 0 ? (
            <span className="block truncate font-mono text-[0.6875rem] text-muted" title={exactPrice(token.priceUsd)}>
              {formatPrice(token.priceUsd)} · MC {compactUsd(token.marketCapUsd)}
            </span>
          ) : <span className="block truncate text-[0.6875rem] text-muted">{token.name || '—'}</span>}
        </span>
        <span className="shrink-0 text-right font-mono text-[0.75rem]">
          {kind === 'trending' && (
            <>
              <span className="block font-bold text-fg">{compactNumber(token.totalTx24h)} tx</span>
              <ChangeValue value={token.change24h} available={token.volume24hUsd > 0} className="mt-0.5 text-[0.6875rem]" />
            </>
          )}
          {kind === 'gainers' && (
            <>
              <ChangeValue value={token.change24h} available className="text-[0.75rem]" />
              <span className="mt-0.5 block text-[0.6875rem] text-muted">Vol {compactUsd(token.volume24hUsd)}</span>
            </>
          )}
          {kind === 'new' && (
            <>
              <span className="block font-bold text-accent"><TokenAge at={launchedAtOf(token)} /></span>
              <span className="mt-0.5 block text-[0.6875rem] text-muted">{token.totalTx24h > 0 ? `${compactNumber(token.totalTx24h)} tx` : 'no trades yet'}</span>
            </>
          )}
        </span>
      </button>
    </li>
  );
}

function Spotlight({ icon, title, hint, tokens, kind, onOpen }: { icon: React.ReactNode; title: string; hint: string; tokens: Token[]; kind: SpotlightKind; onOpen: (token: Token) => void }) {
  return (
    <section aria-label={title} className="bd-card w-[86vw] max-w-[24rem] shrink-0 snap-start p-2 sm:w-[22rem] lg:w-auto lg:max-w-none">
      <header className="flex items-center gap-2 px-2 pb-1.5 pt-1">
        {icon}
        <h2 className="text-sm font-bold text-fg">{title}</h2>
        <span className="ml-auto truncate text-[0.6875rem] text-subtle">{hint}</span>
      </header>
      {tokens.length === 0
        ? <p className="px-2 py-6 text-center text-xs text-subtle">Nothing yet. Check back soon.</p>
        : <ol className="space-y-0.5">{tokens.map((token, index) => <SpotlightRow key={`${token.chain ?? 'base'}:${token.address}`} token={token} index={index} kind={kind} onOpen={onOpen} />)}</ol>}
    </section>
  );
}

// Top of the market page: live market totals with small charts, three spotlight boards
// (most traded, top gainers, newest) and a ticker of today's biggest movers.
export const MarketHero: React.FC<{ onOpenToken: (token: Token) => void; onHide: () => void }> = ({ onOpenToken, onHide }) => {
  const { tokens } = useApp();
  const { navigate } = useSocial();
  const totals = useMemo(() => marketTotals(tokens), [tokens]);
  const buyShare = totals.buys + totals.sells > 0 ? (totals.buys / (totals.buys + totals.sells)) * 100 : 50;
  const breadth = totals.gainers + totals.losers > 0 ? (totals.gainers / (totals.gainers + totals.losers)) * 100 : 50;
  const chainVolume = totals.chains.filter((chain) => chain.volume > 0);

  return (
    <div className="market-hero border-b border-line">
      <div className="relative z-10 space-y-3 px-3 pb-3 pt-3.5 sm:px-5 sm:pt-5">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-end">
          <div className="min-w-0 pr-6">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-up/30 bg-up/10 px-2.5 py-1 text-[0.6875rem] font-extrabold uppercase tracking-wider text-up">
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-up" /> Live ·
              {(totals.chains.some((chain) => chain.volume > 0) ? totals.chains.filter((chain) => chain.volume > 0) : [{ chain: 'base' as const }]).map((chain, index) => (
                <span key={chain.chain} className={`chain-${chain.chain} chain-text`}>{index > 0 && <span className="text-up"> + </span>}{CHAINS[chain.chain].name}</span>
              ))}
            </span>
            <h1 className="font-display mt-2 text-[1.5rem] font-bold leading-[1.05] tracking-tight text-fg sm:text-[2.35rem]">
              Ape every <span className="neon-text">Bankr launch</span>. First.
            </h1>
            <p className="mt-1.5 hidden max-w-xl text-sm leading-relaxed text-muted sm:block">
              Verified launches only. On-chain charts, one-click swaps straight into the pool, safety checks and theses from the traders who called it.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => navigate({ name: 'feed' })} className="btn-gradient inline-flex h-9 items-center gap-1.5 rounded-xl px-4 text-xs font-extrabold text-white">
                <Newspaper className="h-3.5 w-3.5" /> Community feed <ArrowRight className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => navigate({ name: 'leaderboard' })} className="bd-control text-xs font-extrabold">
                <Trophy className="h-3.5 w-3.5 text-warn" /> Top traders
              </button>
              <a href="/launches" className="bd-control hidden text-xs font-extrabold sm:inline-flex">
                <Rocket className="h-3.5 w-3.5 text-accent" /> All launches
              </a>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
            <Kpi icon={<BarChart3 className="h-3 w-3" />} label="24h volume" value={compactUsd(totals.volume)} title="Combined 24h volume of listed tokens">
              {chainVolume.length > 0 && (
                <>
                  <span className="flex h-1.5 overflow-hidden rounded-full bg-raised" aria-hidden="true">
                    {chainVolume.map((chain) => (
                      <span key={chain.chain} style={{ width: `${(chain.volume / Math.max(1, totals.volume)) * 100}%`, background: CHAINS[chain.chain].color }} />
                    ))}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-x-2 truncate">
                    {chainVolume.slice(0, 2).map((chain) => (
                      <span key={chain.chain} className={`chain-${chain.chain} chain-text inline-flex items-center gap-1`}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: CHAINS[chain.chain].color }} />
                        {CHAINS[chain.chain].name} {Math.round((chain.volume / Math.max(1, totals.volume)) * 100)}%
                      </span>
                    ))}
                  </span>
                </>
              )}
            </Kpi>
            <Kpi icon={<Activity className="h-3 w-3" />} label="24h txns" value={compactNumber(totals.txns)} title={`${totals.buys.toLocaleString('en-US')} buys / ${totals.sells.toLocaleString('en-US')} sells`}>
              <span className="ratio-bar" aria-hidden="true"><span style={{ width: `${buyShare}%` }} /></span>
              <span className="mt-1 flex justify-between"><span className="text-up">{Math.round(buyShare)}% buys</span><span className="text-down">{100 - Math.round(buyShare)}%</span></span>
            </Kpi>
            <Kpi icon={<Flame className="h-3 w-3" />} label="Breadth 24h" value={<><span className="text-up">{totals.gainers}</span><span className="text-subtle"> / </span><span className="text-down">{totals.losers}</span></>} title="Traded tokens up vs down over 24 hours">
              <span className="ratio-bar" aria-hidden="true"><span style={{ width: `${breadth}%` }} /></span>
              <span className="mt-1 block truncate">{breadth >= 55 ? 'Risk-on: most tokens green' : breadth <= 45 ? 'Risk-off: most tokens red' : 'Mixed market'}</span>
            </Kpi>
            <Kpi icon={<Layers className="h-3 w-3" />} label="Tokens live" value={totals.count.toLocaleString('en-US')} title="Verified Bankr tokens listed">
              <span className="text-accent">+{totals.fresh.toLocaleString('en-US')}</span> launched in 24h
            </Kpi>
          </div>
        </div>

        <div className="scrollbar-none -mx-3 flex snap-x snap-mandatory gap-2 overflow-x-auto px-3 sm:-mx-5 sm:px-5 lg:mx-0 lg:grid lg:grid-cols-3 lg:overflow-visible lg:px-0">
          <Spotlight icon={<Flame className="h-4 w-4 text-orange-400" />} title="Most traded" hint="24h transactions" tokens={totals.trending} kind="trending" onOpen={onOpenToken} />
          <Spotlight icon={<Rocket className="h-4 w-4 text-up" />} title="Top gainers" hint="24h · vol > $1K" tokens={totals.topGainers} kind="gainers" onOpen={onOpenToken} />
          <Spotlight icon={<Sparkles className="h-4 w-4 text-accent" />} title="Just launched" hint="Newest first" tokens={totals.newest} kind="new" onOpen={onOpenToken} />
        </div>
      </div>

      {totals.movers.length > 0 && (
        <div className="ticker-wrap relative z-10 overflow-hidden border-t border-line/60 bg-sunken/40 py-2" aria-label="Top movers today">
          <div className="ticker-track gap-2 pl-3">
            {[...totals.movers, ...totals.movers].map((token, index) => (
              <button key={`${token.id}:${index}`} type="button" onClick={() => onOpenToken(token)} tabIndex={index >= totals.movers.length ? -1 : 0}
                className="mr-2 inline-flex shrink-0 items-center gap-2 rounded-full border border-line/70 bg-panel/70 py-1 pl-1 pr-2 text-xs hover:border-fg/20">
                <OkxTokenLogo logo={token.logo} symbol={token.symbol} name={token.name} size="xs" />
                <span className="font-extrabold text-fg">${token.symbol}</span>
                <ChangeValue value={token.change24h} available className="text-[0.6875rem]" />
              </button>
            ))}
          </div>
          <span className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-surface to-transparent" />
          <span className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-surface to-transparent" />
        </div>
      )}
      <button type="button" onClick={onHide} aria-label="Hide market overview" title="Hide market overview" className="absolute right-2 top-2 z-20 rounded-full p-1.5 text-muted hover:bg-raised hover:text-fg">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};
