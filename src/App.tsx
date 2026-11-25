import type { ChainKey } from './config/chains';
import React, { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { OkxHeader } from './components/OkxHeader';
import { BasedMarketView } from './components/BasedMarketView';
import { ProView } from './components/ProView';
// Modals are downloaded the first time they open, not with the initial page.
const PortfolioModal = lazy(() => import('./components/PortfolioModal').then((m) => ({ default: m.PortfolioModal })));
const SettingsModal = lazy(() => import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal })));
const BiometricLockModal = lazy(() => import('./components/BiometricLockModal').then((m) => ({ default: m.BiometricLockModal })));
const ProfileEditorModal = lazy(() => import('./components/social/ProfileEditorModal').then((m) => ({ default: m.ProfileEditorModal })));
const ThesisComposer = lazy(() => import('./components/social/ThesisComposer').then((m) => ({ default: m.ThesisComposer })));
const FeedView = lazy(() => import('./components/social/FeedView').then((m) => ({ default: m.FeedView })));
const LeaderboardView = lazy(() => import('./components/social/LeaderboardView').then((m) => ({ default: m.LeaderboardView })));
const ProfileView = lazy(() => import('./components/social/ProfileView').then((m) => ({ default: m.ProfileView })));
const WalletConnectModal = lazy(() => import('./components/WalletConnectModal').then((m) => ({ default: m.WalletConnectModal })));
import { NotificationToast } from './components/NotificationToast';
import { ConsentGate } from './components/ConsentGate';
import { PresenceTracker } from './components/PresenceTracker';
import { OrderWatcher } from './components/OrderWatcher';
import { BankrMascot } from './components/BankrMascot';
import { SocialProvider, useSocial, viewFromPath, type AppView } from './context/SocialContext';
import { ProfileAvatar } from './components/social/SocialBits';
import { BarChart3, CandlestickChart, ChevronLeft, Newspaper, Trophy, UserRound } from 'lucide-react';
import { BrandWordmark } from './components/BrandMark';
import { formatLag, useIndexFreshness } from './components/useIndexFreshness';

const TERMINAL_OPEN_KEY = 'bankrdex-terminal-open';
const PAGE_SCROLL_KEY = 'bankrdex-page-scroll-y';

function readTerminalOpen(): boolean {
  try {
    return window.sessionStorage.getItem(TERMINAL_OPEN_KEY) === 'true';
  } catch {
    return false;
  }
}

function readScrollPosition(): number {
  try {
    const scrollY = Number(window.sessionStorage.getItem(PAGE_SCROLL_KEY));
    return Number.isFinite(scrollY) ? scrollY : 0;
  } catch {
    return 0;
  }
}

function pathFor(view: AppView, token: { address: string; chain?: string }): string {
  switch (view.name) {
    case 'terminal': {
      const chain = token.chain ?? 'base';
      return `/token/${token.address.toLowerCase()}${chain !== 'base' ? `?chain=${chain}` : ''}`;
    }
    case 'feed': return '/feed';
    case 'leaderboard': return '/leaderboard';
    case 'profile': return `/u/${encodeURIComponent(view.id)}`;
    default: return '/';
  }
}

const ViewFallback = () => <div className="mx-auto max-w-5xl px-4 py-6"><div className="h-64 animate-pulse rounded-3xl bg-panel" /></div>;

const MainLayout: React.FC = () => {
  const {
    activeToken,
    networkStats,
    tokens,
    setIsPortfolioOpen,
    setIsWalletConnectModalOpen,
    isPortfolioOpen,
    isSettingsOpen,
    isBiometricModalOpen,
    isWalletConnectModalOpen,
    wallet,
    t,
  } = useApp();
  const { view, navigate, isProfileEditorOpen, composer, profile, wallet: sessionWallet } = useSocial();
  const index = useIndexFreshness();
  const isTerminalOpen = view.name === 'terminal';
  const setIsTerminalOpen = (open: boolean) => navigate({ name: open ? 'terminal' : 'markets' });
  const lastViewName = useRef(view.name);
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);
  const scrollPositionRef = useRef(readScrollPosition());
  const isRestoringScrollRef = useRef(scrollPositionRef.current > 0);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(TERMINAL_OPEN_KEY, String(isTerminalOpen));
    } catch {
      // Session storage can be unavailable in restricted browser contexts.
    }
  }, [isTerminalOpen]);

  // Keep the address bar shareable: /token/<address> while trading, /feed, /leaderboard,
  // /u/<username>, / on the market list. A new page pushes history so Back works.
  useEffect(() => {
    const target = pathFor(view, activeToken);
    const current = `${window.location.pathname}${window.location.search}`;
    if (current === target) { lastViewName.current = view.name; return; }
    // Profile pages may rewrite /u/<wallet> to /u/<username> themselves.
    if (view.name === 'profile' && viewFromPath(window.location.pathname)?.name === 'profile' && lastViewName.current === 'profile') return;
    const changedPage = lastViewName.current !== view.name || view.name === 'profile';
    if (changedPage) window.history.pushState(null, '', target + (view.name === 'terminal' ? window.location.hash : ''));
    else window.history.replaceState(window.history.state, '', target);
    lastViewName.current = view.name;
  }, [activeToken.address, activeToken.chain, view]);

  useEffect(() => {
    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => {
      window.history.scrollRestoration = previousScrollRestoration;
    };
  }, []);

  useLayoutEffect(() => {
    const restoreScrollPosition = () => {
      if (isRestoringScrollRef.current) {
        window.scrollTo(0, scrollPositionRef.current);
      }
    };

    if (scrollPositionRef.current <= 0) {
      window.scrollTo(0, 0);
      return;
    }

    isRestoringScrollRef.current = true;
    const frame = window.requestAnimationFrame(restoreScrollPosition);
    const retryTimers = [250, 750, 1_200].map((delay) => window.setTimeout(restoreScrollPosition, delay));
    const finishTimer = window.setTimeout(() => {
      isRestoringScrollRef.current = false;
    }, 1_500);

    return () => {
      window.cancelAnimationFrame(frame);
      retryTimers.forEach(window.clearTimeout);
      window.clearTimeout(finishTimer);
    };
  }, [tokens.length]);

  useEffect(() => {
    let persistTimer: number | undefined;
    const persistScrollPosition = () => {
      window.clearTimeout(persistTimer);
      if (!isRestoringScrollRef.current) scrollPositionRef.current = window.scrollY;
      try {
        window.sessionStorage.setItem(PAGE_SCROLL_KEY, String(scrollPositionRef.current));
      } catch {
        // Session storage can be unavailable in restricted browser contexts.
      }
    };
    const handleScroll = () => {
      if (isRestoringScrollRef.current) return;
      scrollPositionRef.current = window.scrollY;
      window.clearTimeout(persistTimer);
      persistTimer = window.setTimeout(persistScrollPosition, 120);
    };
    const cancelScrollRestoration = () => {
      isRestoringScrollRef.current = false;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('pagehide', persistScrollPosition);
    window.addEventListener('wheel', cancelScrollRestoration, { passive: true });
    window.addEventListener('touchstart', cancelScrollRestoration, { passive: true });
    window.addEventListener('pointerdown', cancelScrollRestoration);
    return () => {
      window.clearTimeout(persistTimer);
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('pagehide', persistScrollPosition);
      window.removeEventListener('wheel', cancelScrollRestoration);
      window.removeEventListener('touchstart', cancelScrollRestoration);
      window.removeEventListener('pointerdown', cancelScrollRestoration);
    };
  }, []);

  return (
    <div className="app-shell flex min-h-screen w-full max-w-[100vw] min-w-0 flex-col overflow-x-clip bg-surface font-sans text-fg">
      <OkxHeader onNavigate={navigate} />

      {index.state === 'stale' && (
        <div role="alert" className="border-b border-warn/40 bg-warn/10 px-4 py-2 text-center text-xs font-semibold text-warn">
          Market data is delayed: the on-chain index is {formatLag(index.lagSeconds)} behind Base. Charts, trades and 24h stats may be out of date.
        </div>
      )}
      <main className="mx-auto min-w-0 w-full max-w-[100rem] flex-1 pb-20 lg:pb-3">
        {view.name === 'markets' && (
          <BasedMarketView onOpenTerminal={() => setIsTerminalOpen(true)} isWorkspaceOpen={isWorkspaceOpen} onToggleWorkspace={() => setIsWorkspaceOpen((open) => !open)} />
        )}
        {view.name === 'feed' && <Suspense fallback={<ViewFallback />}><FeedView /></Suspense>}
        {view.name === 'leaderboard' && <Suspense fallback={<ViewFallback />}><LeaderboardView /></Suspense>}
        {view.name === 'profile' && <Suspense fallback={<ViewFallback />}><ProfileView id={view.id} /></Suspense>}
        {isTerminalOpen && (
          <div id="terminal-workspace" className="min-w-0 px-2 pt-2 sm:px-3 xl:px-4">
            <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => setIsTerminalOpen(false)}
                className="inline-flex items-center gap-1 rounded-full border border-line bg-panel/70 py-1.5 pl-2 pr-3 font-semibold text-fg-soft transition hover:border-fg/20 hover:text-fg"
              >
                <ChevronLeft className="h-4 w-4 text-accent" />
                {t.markets}
              </button>
              <span className="text-subtle">/</span>
              <span className="truncate font-bold text-fg">${activeToken.symbol}</span>
            </nav>
            <ProView />
          </div>
        )}
      </main>

      {/* Modals & Overlays */}
      <Suspense fallback={null}>
        {isPortfolioOpen && <PortfolioModal onOpenSwap={() => setIsTerminalOpen(true)} />}
        {isSettingsOpen && <SettingsModal />}
        {isBiometricModalOpen && <BiometricLockModal />}
        {isProfileEditorOpen && <ProfileEditorModal />}
        {composer.open && <ThesisComposer />}
        {isWalletConnectModalOpen && <WalletConnectModal />}
      </Suspense>
      <NotificationToast />
      <ConsentGate />
      <PresenceTracker />
      <OrderWatcher />
      <BankrMascot />

      <nav aria-label="Main navigation" className="mobile-nav fixed bottom-0 left-0 right-auto z-40 w-screen max-w-[100vw] lg:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-5 items-end px-1 pb-[env(safe-area-inset-bottom)]">
          {([
            ['markets', t.markets, BarChart3],
            ['feed', 'Feed', Newspaper],
            ['terminal', 'Trade', CandlestickChart],
            ['leaderboard', 'Leaders', Trophy],
          ] as const).map(([name, label, Icon]) => {
            const active = view.name === name;
            if (name === 'terminal') {
              return (
                <button key={name} type="button" onClick={() => navigate({ name })} aria-current={active ? 'page' : undefined}
                  className="flex min-h-14 flex-col items-center justify-end gap-1 pb-1.5 text-[0.6875rem] font-bold text-fg">
                  <span className={`mobile-trade-btn -mt-5 flex h-12 w-12 items-center justify-center rounded-2xl transition active:scale-95 ${active ? 'ring-2 ring-accent/60' : ''}`}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className={active ? 'text-accent' : 'text-fg-soft'}>{label}</span>
                </button>
              );
            }
            return (
              <button key={name} type="button" onClick={() => navigate({ name })} aria-current={active ? 'page' : undefined}
                className={`relative flex min-h-14 flex-col items-center justify-center gap-1 text-[0.6875rem] font-bold transition ${active ? 'text-fg' : 'text-muted hover:text-fg'}`}>
                {active && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-gradient-to-r from-accent to-violet shadow-[0_0_10px_var(--bd-accent)]" />}
                <Icon className={`h-[1.15rem] w-[1.15rem] ${active ? 'text-accent' : ''}`} />
                <span>{label}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => {
              if (!wallet.isConnected) setIsWalletConnectModalOpen(true);
              else if (profile && sessionWallet) navigate({ name: 'profile', id: profile.username });
              else setIsPortfolioOpen(true);
            }}
            className={`flex min-h-14 flex-col items-center justify-center gap-1 text-[0.6875rem] font-bold ${view.name === 'profile' ? 'text-fg' : 'text-muted hover:text-fg'}`}
          >
            {wallet.isConnected
              ? <ProfileAvatar wallet={wallet.address.toLowerCase()} card={sessionWallet ? profile : null} size={20} />
              : <UserRound className="h-[1.15rem] w-[1.15rem]" />}
            <span>{wallet.isConnected ? (profile && sessionWallet ? 'Profile' : t.walletNav) : t.walletNav}</span>
          </button>
        </div>
      </nav>

      <footer className="site-footer w-full border-t border-line pb-16 text-xs text-muted lg:pb-0">
        <div className="mx-auto grid max-w-[100rem] gap-4 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end xl:px-8">
          <div className="min-w-0">
            <BrandWordmark size={26} textClassName="text-base" />
            <p className="mt-2 max-w-xl leading-relaxed text-muted">
              The trading terminal for verified Bankr launches on Base and Robinhood Chain. Anyone can launch a token through Bankr;
              listing is not an endorsement and nothing here is financial advice.
            </p>
          </div>
          <div className="flex flex-col gap-2 lg:items-end">
            <nav aria-label="Legal and documentation" className="flex flex-wrap items-center gap-x-4 gap-y-1 font-semibold [&>a]:py-1.5">
              <a href="/launches" className="hover:text-fg">All launches</a>
              <a href="/docs" className="hover:text-fg">Docs</a>
              <a href="/whitepaper" className="hover:text-fg">Whitepaper</a>
              <a href="/terms" className="hover:text-fg">Terms</a>
              <a href="/privacy" className="hover:text-fg">Privacy</a>
            </nav>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[0.6875rem] text-subtle">
              <span className={`flex items-center gap-1.5 ${networkStats.isOnline ? 'text-up' : 'text-warn'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${networkStats.isOnline ? 'bg-up' : 'bg-warn'}`} />
                Base {networkStats.isOnline ? `online · ${networkStats.rpcLatencyMs}ms` : 'RPC unavailable'}
              </span>
              <span>{tokens.length.toLocaleString('en-US')} tokens</span>
              <span>{t.footerRouting}</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export type InitialView = 'feed' | 'leaderboard' | { profile: string };

function startView(initialTokenAddress?: string, initialView?: InitialView): AppView {
  if (initialTokenAddress) return { name: 'terminal' };
  if (initialView === 'feed' || initialView === 'leaderboard') return { name: initialView };
  if (initialView && typeof initialView === 'object') return { name: 'profile', id: initialView.profile.toLowerCase() };
  return readTerminalOpen() ? { name: 'terminal' } : { name: 'markets' };
}

export default function App({ initialTokenAddress, initialTokenChain, initialView }: { initialTokenAddress?: string; initialTokenChain?: ChainKey; initialView?: InitialView }) {
  return (
    <AppProvider initialTokenAddress={initialTokenAddress} initialTokenChain={initialTokenChain}>
      <SocialProvider initialView={startView(initialTokenAddress, initialView)}>
        <MainLayout />
      </SocialProvider>
    </AppProvider>
  );
}
