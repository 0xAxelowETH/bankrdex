import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { OkxTokenHeader } from './OkxTokenHeader';
import type { SwapIntent } from './swap/SwapUi';
import { RouterSwapPanel, routersFor, useRouterStatus } from './swap/RouterSwapPanel';
import { TerminalSocial } from './social/TerminalSocial';
import { TokenInfoCard } from './TokenInfoCard';
import { BankrLaunchCard } from './BankrLaunchCard';
import { TokenRiskCard } from './TokenRiskCard';
import { useApp } from '../context/AppContext';
import { chainByKey, dexscreenerUrl, type ChainKey } from '../config/chains';
import { ChainEmblem } from './ChainEmblem';
import { DirectSwapPanel } from './DirectSwapPanel';
import { OrdersPanel } from './OrdersPanel';
import { SoonBadge } from './SoonBadge';
import { FEATURES } from '../config/features';
import { fetchDirectPool, isNativePaired, supportsDirectSwap, type DirectPool } from '../services/directSwap';
import { payAssetsFor, type PayAsset } from './swap/payAssets';
import { BrandLogo } from './BrandLogo';
import { Bell, KeyRound, Route, Sparkles, X, Zap } from 'lucide-react';

const TradingViewCandlestickChart = lazy(() => import('./TradingViewCandlestickChart').then((module) => ({
  default: module.TradingViewCandlestickChart,
})));

export const ProView: React.FC = () => {
  const { activeToken, pendingSwapTokenToSell, setPendingSwapTokenToSell } = useApp();
  // Phones: the swap panel lives in a bottom sheet opened from a sticky Buy / Sell bar,
  // so trading does not require scrolling past the chart. It stays mounted when closed.
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [intent, setIntent] = useState<SwapIntent | undefined>();
  const openSheet = (direction: SwapIntent['direction']) => {
    setIntent({ direction, nonce: Date.now() });
    setIsSheetOpen(true);
  };

  // "Sell" from the portfolio opens the swap panel on the sell side.
  useEffect(() => {
    if (!pendingSwapTokenToSell) return;
    setIntent({ direction: 'sell', nonce: Date.now() });
    setPendingSwapTokenToSell(null);
  }, [pendingSwapTokenToSell, setPendingSwapTokenToSell]);

  useEffect(() => {
    if (!isSheetOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setIsSheetOpen(false); };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [isSheetOpen]);

  return (
    <div className="grid grid-cols-1 gap-2 pb-16 lg:grid-cols-12 lg:pb-0">
      <div className="min-w-0 space-y-2 lg:col-span-8 lg:col-start-1 lg:row-start-1">
        <OkxTokenHeader />

        <div id="market-chart" className="bd-card w-full min-w-0 max-w-full scroll-mt-20 h-[min(70dvh,900px)] min-h-[26rem] overflow-hidden lg:h-[38.75rem]">
          <Suspense fallback={<div className="flex h-full items-center justify-center text-xs text-neutral-400">Loading TradingView chart…</div>}>
            <TradingViewCandlestickChart />
          </Suspense>
        </div>

        <div className="pt-2">
          <TerminalSocial />
          <div className="mt-3 space-y-3 lg:hidden">
            <TokenRiskCard />
            <BankrLaunchCard />
          </div>
        </div>
      </div>

      {isSheetOpen && (
        <button
          type="button"
          aria-label="Close swap"
          onClick={() => setIsSheetOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
        />
      )}

      {/* Swap panel: sticky column on desktop, bottom sheet on phones */}
      <div
        id="swap-desk"
        role={isSheetOpen ? 'dialog' : undefined}
        aria-modal={isSheetOpen ? true : undefined}
        aria-label="Swap"
        className={`min-w-0 scroll-mt-20 space-y-2 lg:sticky lg:top-[4.5rem] lg:col-span-4 lg:col-start-9 lg:row-start-1 lg:block lg:self-start ${
          isSheetOpen
            ? 'max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-50 max-lg:max-h-[90dvh] max-lg:overflow-y-auto max-lg:rounded-t-2xl max-lg:bg-surface max-lg:p-2 max-lg:pb-[env(safe-area-inset-bottom)]'
            : 'max-lg:hidden'
        }`}
      >
        <div className="flex items-center justify-between px-2 pt-1 lg:hidden">
          <span className="mx-auto h-1 w-10 rounded-full bg-line" aria-hidden="true" />
          <button type="button" onClick={() => setIsSheetOpen(false)} aria-label="Close swap" className="absolute right-3 rounded p-1.5 text-muted hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>
        <SwapArea intent={intent} />
        <div className="hidden space-y-3 lg:block">
          <TokenRiskCard />
          <TokenInfoCard />
          <BankrLaunchCard />
        </div>
      </div>


      {!isSheetOpen && (
        <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 grid grid-cols-[1.4fr_1fr] gap-2 border-t border-line bg-sunken/95 px-3 py-2 backdrop-blur lg:hidden">
          <button
            type="button"
            onClick={() => openSheet('buy')}
            className="rounded-xl bg-up py-2.5 text-sm font-extrabold text-black shadow-[0_8px_22px_-10px_var(--bd-up)] active:scale-[0.98]"
          >
            Buy ${activeToken.symbol}
          </button>
          <button
            type="button"
            onClick={() => openSheet('sell')}
            className="rounded-xl bg-down py-2.5 text-sm font-extrabold text-white active:scale-[0.98]"
          >
            Sell
          </button>
        </div>
      )}
    </div>
  );
};

// Shown when no route can serve the token: no direct pool and no aggregator for its chain.
function RouterNotice({ chain, configured }: { chain: ChainKey; configured: boolean | null }) {
  const { activeToken } = useApp();
  const config = chainByKey(chain);
  return (
    <section aria-label="Swap" className="bd-card bd-glow-edge p-4 text-sm">
      <div className="mb-2 flex items-center gap-2 font-bold text-fg">
        <ChainEmblem chain={config.key} />
        ${activeToken.symbol} on {config.name}
      </div>
      {configured === false ? (
        <p className="flex items-start gap-2 text-muted">
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
          Swaps through OKX DEX and Binance Web3 need their API keys on this server (OKX_API_KEY / OKX_SECRET_KEY /
          OKX_PASSPHRASE, BINANCE_WEB3_API_KEY / BINANCE_WEB3_SECRET_KEY). Until then, trade it on Bankr or a {config.name} DEX.
        </p>
      ) : (
        <p className="text-muted">
          Neither OKX DEX nor Binance Web3 routes {config.name} yet{configured === null ? ' (router status unavailable)' : ''}. Charts, trades
          and launch data work as usual; to trade it, use Bankr or a {config.name} DEX.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={dexscreenerUrl(config.key, activeToken.address)} target="_blank" rel="noopener noreferrer" className="rounded-xl border border-line px-3 py-1.5 text-xs font-semibold text-fg-soft hover:border-accent/60 hover:text-fg">
          View on DexScreener
        </a>
        <a href="https://bankr.bot" target="_blank" rel="noopener noreferrer" className="btn-gradient rounded-xl px-3 py-1.5 text-xs font-bold text-white">
          Open Bankr
        </a>
      </div>
    </section>
  );
}

// Stand-in for <OrdersPanel /> while limit orders and alerts are not live (FEATURES.limitOrders).
function OrdersSoon() {
  return (
    <section aria-label="Orders and alerts" className="bd-card p-4 text-xs opacity-80">
      <div className="mb-1 flex items-center gap-2">
        <Bell className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-bold text-fg">Orders &amp; alerts</h3>
        <SoonBadge />
      </div>
      <p className="text-muted">Limit buy, take-profit, stop-loss and price alerts.</p>
    </section>
  );
}

const ROUTE_KEY = 'bankrdex-swap-route';
type SwapRoute = 'best' | 'direct' | 'okx' | 'binance';
const readRoute = (): SwapRoute => {
  try {
    const value = window.localStorage.getItem(ROUTE_KEY);
    // 'router' was the aggregator choice before routes could be picked one by one.
    return value === 'direct' || value === 'okx' || value === 'binance' ? value : 'best';
  } catch {
    return 'best';
  }
};

// Swap routes: Recommended (best quote of OKX DEX and Binance Web3; the token's own pool when no
// aggregator serves it), Pool direct (Uniswap V4, no API), or one aggregator only.
function SwapArea({ intent }: { intent?: SwapIntent }) {
  const { activeToken, tokens } = useApp();
  const chain = activeToken.chain ?? 'base';
  const address = activeToken.address.toLowerCase();
  const routerStatus = useRouterStatus();
  const providers = routersFor(routerStatus, chain);
  const [route, setRoute] = useState<SwapRoute>(readRoute);
  const [pool, setPool] = useState<{ address: string; value: DirectPool | null } | null>(null);
  const [payAsset, setPayAsset] = useState('native');
  // Base pools come from the on-chain index: until it runs, the direct route there is "Soon".
  const directSoon = chain === 'base' && !FEATURES.baseDirectSwap;
  const directChain = supportsDirectSwap(chain) && !directSoon;
  const poolHint = activeToken.poolAddress;
  const quoteHint = activeToken.quoteAddress;
  const payAssets = useMemo(() => payAssetsFor(activeToken, tokens), [activeToken, tokens]);
  useEffect(() => {
    if (!directChain) return;
    let active = true;
    fetchDirectPool(address, chain, { poolId: poolHint, quote: quoteHint })
      .then((value) => { if (active) setPool({ address, value }); })
      .catch(() => { if (active) setPool({ address, value: null }); });
    return () => { active = false; };
  }, [address, chain, directChain, poolHint, quoteHint]);
  // A pay asset of another chain (or one this token no longer offers) falls back to the native coin.
  useEffect(() => {
    if (!payAssets.some((asset) => asset.address === payAsset)) setPayAsset('native');
  }, [payAsset, payAssets]);

  const directPool = directChain ? (pool?.address === address ? pool.value : undefined) : null;
  if (directPool === undefined) {
    return <div className="bd-card h-[26rem] animate-pulse" aria-label="Loading swap" />;
  }
  const choose = (next: SwapRoute) => {
    setRoute(next);
    try { window.localStorage.setItem(ROUTE_KEY, next); } catch { /* optional */ }
  };
  const available: Record<SwapRoute, boolean> = {
    best: providers.length > 0 || Boolean(directPool),
    direct: Boolean(directPool),
    okx: providers.includes('okx'),
    binance: providers.includes('binance'),
  };
  // Recommended without any aggregator is the pool itself.
  const effective: SwapRoute | null = available[route]
    ? route === 'best' && providers.length === 0 ? 'direct' : route
    : providers.length > 0 ? 'best' : directPool ? 'direct' : null;
  const directCounter = directPool ? (isNativePaired(directPool) ? 'native' : directPool.quote.toLowerCase()) : null;
  const pickPayAsset = (asset: PayAsset) => {
    setPayAsset(asset.address);
    // The pool only trades against its own pair: other assets need an aggregator route.
    if (effective === 'direct' && asset.address !== directCounter && providers.length > 0) choose('best');
  };
  const configured = routerStatus ? routerStatus.okx.configured || routerStatus.binance.configured : null;
  const options: [SwapRoute, React.ComponentType<{ className?: string }>, string, string][] = [
    ['best', Sparkles, 'Recommended', providers.length > 0 ? 'Best quote' : 'Token pool'],
    ['direct', Zap, 'Pool direct', 'Uniswap V4'],
    ['okx', Route, 'OKX', 'DEX router'],
    ['binance', Route, 'Binance', 'Web3 router'],
  ];
  return (
    <div className="space-y-3">
      <div className="bd-card grid grid-cols-4 gap-1 p-1" role="radiogroup" aria-label="Swap route">
        {options.map(([key, Icon, label, hint]) => {
          // Recommended stays highlighted when it resolved to the pool (no aggregator).
          const selected = (route === 'best' && effective === 'direct' ? 'best' : effective) === key;
          const soon = key === 'direct' && directSoon;
          return (
            <button key={key} type="button" role="radio" aria-checked={selected} disabled={!available[key]} onClick={() => choose(key)}
              title={!available[key] ? (soon ? 'Coming soon: direct Uniswap V4 swaps on Base.' : key === 'direct' ? 'This token has no pool BankrDex can trade directly.' : 'Not available for this chain on this server.') : undefined}
              className={`flex flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-2 text-center transition disabled:cursor-not-allowed disabled:opacity-35 ${selected ? 'nav-active text-fg' : 'text-muted hover:text-fg'}`}>
              {key === 'okx' || key === 'binance'
                ? <BrandLogo brand={key} size={16} className={selected ? '' : 'opacity-70 grayscale'} />
                : <Icon className={`h-4 w-4 ${selected ? 'text-accent' : ''}`} />}
              <span className="text-[0.6875rem] font-extrabold leading-tight">{label}</span>
              {soon
                ? <SoonBadge />
                : <span className="hidden text-[0.5625rem] leading-tight text-subtle sm:block">{hint}</span>}
            </button>
          );
        })}
      </div>
      {effective === 'direct' && directPool && <DirectSwapPanel pool={directPool} intent={intent} payAssets={payAssets} onPayAsset={pickPayAsset} />}
      {effective && effective !== 'direct' && (
        <RouterSwapPanel
          intent={intent}
          providers={providers}
          mode={effective === 'best' ? 'best' : effective}
          payAssets={payAssets}
          payAsset={payAsset}
          onPayAsset={pickPayAsset}
          onUseDirect={directPool ? () => choose('direct') : undefined}
        />
      )}
      {effective === null && <RouterNotice chain={chain} configured={configured} />}
      {chain === 'base' && (FEATURES.limitOrders ? directPool && <OrdersPanel /> : <OrdersSoon />)}
    </div>
  );
}
