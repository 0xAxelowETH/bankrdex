import { MarketHero } from './MarketHero';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  Info,
  RefreshCw,
  ChevronDown,
  Flame,
  ChevronLeft,
  ChevronRight,
  BadgeCheck,
  ExternalLink,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings2,
  SlidersHorizontal,
  Star,
  Wallet,
  X,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { shortenAddress } from '../utils/web3';
import { DexScreenerEmblem } from './DexScreenerEmblem';
import { OkxTokenLogo } from './OkxTokenLogo';
import { PairTokenLogo } from './PairTokenLogo';
import { mascotCheer } from './BankrMascot';
import { ChainEmblem } from './ChainEmblem';
import { QuickBuyAmount, QuickBuyButton } from './QuickBuy';
import { PulseView } from './PulseView';
import {
  activeFilterCount,
  deletePreset,
  EMPTY_FILTERS,
  readFilters,
  readPresets,
  readWatchlist,
  savePreset,
  toggleWatch,
  WATCHLIST_EVENT,
  watchKey,
  writeFilters,
  type MarketFilters,
} from '../utils/marketPrefs';
import { CHAIN_KEYS, CHAINS, explorerAddress, type ChainKey } from '../config/chains';
import { applyDexProfile, loadDexProfiles, type DexProfile } from '../services/dexProfiles';
import { hasSocialLinks, TokenSocialLinks } from './TokenSocialLinks';
import type { ActivityWindow, Token, TokenSource } from '../types';
import {
  BoughtAgo,
  numberFormat,
  BuyValueBadge,
  ChangeValue,
  compactCount,
  compactUsd,
  FlashValue,
  readPreference,
  Skeleton,
  SortHeader,
  TxnsValue,
  writePreference,
  type Density,
  type SortKey,
  type SortState,
  TokenAge,
  exactPrice,
  formatPrice,
} from './MarketTableParts';
import {
  BankrTokenStats,
  BinanceMarketPrice,
  fetchBankrRecentSales,
  fetchLaunchPage,
  fetchBuyValues,
  buySaleKey,
  type BuyValue,
  fetchBankrTokenStats,
  fetchLiveMarketPrices,
  type LivePriceSource,
  fetchMarketSources,
  type BankrMarketStat,
  resolveTokenPool,
} from '../services/tradingApis';

type MarketView = 'hot' | 'top' | 'new' | 'gainers' | 'recent-buys';
type Timeframe = '5m' | '1h' | '24h';
const MARKET_VIEW_SESSION_KEY = 'bankrdex-market-view';
// Featured tokens, in display order: pinned above every list, always shown and marked with the
// gold check. BankrDex (the terminal's own Bankr launch on Robinhood Chain), then BNKR, Bankr's own token.
const FEATURED_TOKEN_ADDRESSES = [
  '0x6b55f05f8acfd795baeaab3fcd4b62373f4c8ba3',
  '0x22af33fe49fd1fa80c7149773dde5890d3c76f3b',
];
const featuredRank = (token: Token) => {
  const index = FEATURED_TOKEN_ADDRESSES.indexOf(token.address.toLowerCase());
  return index === -1 ? FEATURED_TOKEN_ADDRESSES.length : index;
};
const isFeatured = (token: Token) => featuredRank(token) < FEATURED_TOKEN_ADDRESSES.length;
const EXTERNAL_REFRESH_MS = 30_000;
const FRESH_BUY_WINDOW_MS = 120_000;
const FRESH_BUY_ANIMATION_MS = 2_600;
const BIG_BUY_ANIMATION_MS = 3_800;
// Shark buys and above get the stronger highlight.
const BIG_BUY_USD = 1_000;
const BIG_BUY_FRESH_MS = 30_000;
// Bankr launches on several chains; the tabs switch between them.
type ChainFilter = 'all' | ChainKey;
const CHAIN_FILTERS: ChainFilter[] = ['all', ...CHAIN_KEYS];
const tokenChain = (token: Token): ChainKey => token.chain ?? 'base';
// Launched less than 24 hours ago (always listed, even before their first trade).
const NEW_LAUNCH_MS = 24 * 60 * 60 * 1000;
const isNewLaunch = (token: Token) => {
  const launchedAt = createdAtOf(token);
  return launchedAt > 0 && Date.now() - launchedAt < NEW_LAUNCH_MS;
};
// All launches: registry pages read per click while looking for tokens that traded in 24h.
const ARCHIVE_PAGES_PER_LOAD = 4;
const ARCHIVE_MIN_ACTIVE_ROWS = 10;
// Canonical Base addresses for symbols that memecoins commonly imitate.
const CANONICAL_SYMBOLS: Record<string, string[]> = {
  ETH: ['0x4200000000000000000000000000000000000006'],
  WETH: ['0x4200000000000000000000000000000000000006'],
  USDC: ['0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'],
  USDT: ['0xfde4c96c8593536e31f229ea8f37b2ada2699bb2'],
  USDBC: ['0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca'],
  DAI: ['0x50c5725949a6f0c72e6c4a641f24049a917db0cb'],
  CBBTC: ['0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf'],
  BTC: ['0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf'],
  BNKR: ['0x22af33fe49fd1fa80c7149773dde5890d3c76f3b'],
  AERO: ['0x940181a94a35a4569e4529a3cdfb74e38fd98631'],
  VIRTUAL: ['0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b'],
  DEGEN: ['0x4ed4e862860bed51a9570b96d89af5e1b0efefed'],
};
const isImitatedSymbol = (token: Token) => {
  const canonical = CANONICAL_SYMBOLS[token.symbol.trim().toUpperCase()];
  return Boolean(canonical && !canonical.includes(token.address.toLowerCase()));
};
const tokenSource = (token: Token): TokenSource => token.source ?? 'bankr';

type OptionalColumn = 'bought' | 'liq' | 'txns' | 'holders' | 'burned' | 'top10' | 'info';
const OPTIONAL_COLUMNS: { key: OptionalColumn; label: string; bankrOnly?: boolean }[] = [
  { key: 'bought', label: 'Bought … ago' },
  { key: 'liq', label: 'Liquidity' },
  { key: 'txns', label: 'Txns (buy / sell)' },
  { key: 'holders', label: 'Holders' },
  { key: 'burned', label: 'Burned', bankrOnly: true },
  { key: 'top10', label: 'Top 10 holders', bankrOnly: true },
  { key: 'info', label: 'DexScreener profile' },
];
const PAGE_SIZES = ['20', '50', '100'] as const;
const DENSITY_KEY = 'bankrdex-table-density';
const PAGE_SIZE_KEY = 'bankrdex-table-page-size';
const HIDDEN_COLUMNS_KEY = 'bankrdex-table-hidden-columns';
const BANNER_KEY = 'bankrdex-banner';

function readHiddenColumns(): Set<OptionalColumn> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(HIDDEN_COLUMNS_KEY) || '[]');
    const known = new Set(OPTIONAL_COLUMNS.map((column) => column.key));
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is OptionalColumn => known.has(value)) : []);
  } catch {
    return new Set();
  }
}

const ACTIVITY_WINDOWS: ActivityWindow[] = ['5m', '1h', '4h', '24h'];
const ACTIVITY_WINDOW_KEY = 'bankrdex-table-activity-window';

interface TokenMetrics {
  boughtAt: number;
  boughtExact: boolean;
  volume: number;
  buys: number;
  sells: number;
  txs: number;
  price: number;
  hasBinancePrice: boolean;
  mcap: number;
  liq: number;
  holders: number;
  holdersApprox: boolean;
}

// One place that decides which source wins for each displayed metric.
function tokenMetrics(
  token: Token,
  binance: BinanceMarketPrice | undefined,
  stats: BankrTokenStats | undefined,
  window: ActivityWindow = '24h',
  lastBuyAt = 0,
): TokenMetrics {
  const hasBinancePrice = Boolean(binance && binance.priceUsd > 0);
  // Per-window activity from Binance; 24h falls back to the pool snapshot values.
  const activity = binance?.activity[window] ?? token.activity?.[window];
  const fallback = window === '24h'
    ? { volumeUsd: token.volume24hUsd, buys: token.totalBuys24h, sells: token.totalSells24h, txs: token.totalTx24h }
    : null;
  const use = activity && (activity.txs > 0 || activity.volumeUsd > 0 || !fallback) ? activity : fallback;
  const lastTradeAt = binance?.lastTradeAt || token.lastTradeAt || 0;
  return {
    // A confirmed buy (Bankr sales feed) wins over the generic last-trade time.
    boughtAt: lastBuyAt || lastTradeAt,
    boughtExact: lastBuyAt > 0,
    volume: use?.volumeUsd ?? 0,
    buys: use?.buys ?? 0,
    sells: use?.sells ?? 0,
    txs: use?.txs ?? 0,
    price: hasBinancePrice ? binance!.priceUsd : token.priceUsd,
    hasBinancePrice,
    mcap: binance && binance.marketCapUsd > 0 ? binance.marketCapUsd : token.marketCapUsd,
    liq: token.liquidityUsd > 0 ? token.liquidityUsd : binance?.liquidityUsd ?? 0,
    holders: stats?.holderCount ?? (token.holders > 0 ? token.holders : 0),
    holdersApprox: Boolean(stats && stats.holderCount !== null && !stats.holdersComplete),
  };
}

// Hot is ranked within each source, so every launchpad has its own hot list.
const HOT_BADGE_COUNT_PER_SOURCE = 5;

interface HotScore {
  score: number;
  // 1-based position within its source; only set for badged tokens.
  rank?: number;
  chain: ChainKey;
  mcap: number;
  gain: number;
  txns: number;
}

// Percentile (0..1) of each value within the list; higher value = higher percentile.
function percentiles(values: number[]): number[] {
  if (values.length <= 1) return values.map(() => 1);
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const result = new Array<number>(values.length);
  order.forEach((item, rank) => { result[item.index] = rank / (values.length - 1); });
  return result;
}

// Flame marking the hottest tokens.
function HotCup({ hot }: { hot: HotScore }) {
  return (
    <span
      className="relative inline-flex shrink-0 items-center"
      title={`${hot.rank ? `#${hot.rank} hot on ${CHAINS[hot.chain].name} · ` : ''}Hot ${Math.round(hot.score * 100)}/100 · MCap top ${100 - Math.round(hot.mcap * 100)}% · gain top ${100 - Math.round(hot.gain * 100)}% · 24h txns top ${100 - Math.round(hot.txns * 100)}%`}
      aria-label={`Hot token${hot.rank ? ` #${hot.rank} on ${CHAINS[hot.chain].name}` : ''}, score ${Math.round(hot.score * 100)} of 100`}
      role="img"
    >
      <Flame className="hot-icon h-3.5 w-3.5 text-orange-400" />
      <span className="buy-steam buy-steam--mini" aria-hidden="true"><i /><i /><i /></span>
    </span>
  );
}

const formatTax = (value: number | null) => (value ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

// Token logo with its pair (quote) logo beside it, DexScreener style: token/token.
function TokenPairAvatar({ token, size, verified = false }: { token: Token; size: 'md' | 'lg'; verified?: boolean }) {
  const box = size === 'md' ? 'h-8 w-8' : 'h-10 w-10';
  return (
    <div className="flex shrink-0 items-end">
      <div className={`relative ${box}`}>
        <OkxTokenLogo logo={token.logo} symbol={token.symbol} name={token.name} size={size} className="relative z-10" />
        <ChainEmblem chain={tokenChain(token)} className="absolute -bottom-1 -left-1 z-30 border-2 border-surface" />
        {verified && (
          <BadgeCheck
            className="absolute -right-1 -top-1 z-30 h-4 w-4 rounded-full bg-surface text-amber-400"
            fill="rgba(251, 191, 36, 0.22)"
            aria-label="Verified BankrDex token"
            role="img"
          />
        )}
      </div>
      {token.quoteSymbol && (
        // One fixed medium size for every pair logo (WETH, image or letter fallback), placed beside
        // the token logo so it never covers it.
        <span
          title={`Paired with ${token.quoteSymbol}`}
          className="relative z-20 ml-1 inline-flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-raised ring-1 ring-line [&_*]:!h-full [&_*]:!w-full [&_*]:!rounded-full [&_*]:!border-0 [&_*]:!text-[0.5625rem]"
        >
          <PairTokenLogo symbol={token.quoteSymbol} address={token.quoteAddress} logo={token.quoteLogo} size="sm" />
        </span>
      )}
    </div>
  );
}

function sortValue(key: SortKey, token: Token, metrics: TokenMetrics): number {
  switch (key) {
    case 'price': return metrics.price;
    case 'change5m': return token.change5m;
    case 'change1h': return token.change1h;
    case 'change24h': return token.change24h;
    case 'mcap': return metrics.mcap;
    case 'liq': return metrics.liq;
    case 'volume': return metrics.volume;
    case 'txns': return metrics.txs;
    case 'holders': return metrics.holders;
    case 'age': return createdAtOf(token);
    case 'bought': return metrics.boughtAt;
  }
}

function readMarketView(): MarketView {
  try {
    const savedView = window.sessionStorage.getItem(MARKET_VIEW_SESSION_KEY);
    if (savedView === 'hot' || savedView === 'top' || savedView === 'new' || savedView === 'gainers' || savedView === 'recent-buys') {
      return savedView;
    }
  } catch {
    return 'top';
  }
  return 'top';
}

interface BasedMarketViewProps {
  onOpenTerminal: () => void;
  isWorkspaceOpen: boolean;
  onToggleWorkspace: () => void;
}

// Parsed launch time per ISO string; sorting by age parses each token once instead of on
// every comparison.
const createdAtCache = new Map<string, number>();
// Exact launch time when known (launchedAt, ms); createdAt is often a date without a time.
const createdAtOf = (token: Token) => {
  if (token.launchedAt && token.launchedAt > 0) return token.launchedAt;
  let value = createdAtCache.get(token.createdAt);
  if (value === undefined) {
    value = Date.parse(token.createdAt) || 0;
    if (createdAtCache.size > 20_000) createdAtCache.clear();
    createdAtCache.set(token.createdAt, value);
  }
  return value;
};


const formatMarketPrice = formatPrice;
const displayTokenAmount = (value: number) => numberFormat({
  notation: value >= 10_000 ? 'compact' : 'standard',
  maximumSignificantDigits: 4,
}).format(value);
// Dust burns (e.g. 0.000000012 tokens) read as a wall of zeros; treat under 1 token as none.
const MIN_DISPLAY_BURN = 1;
const LIVE_SNAPSHOT_MAX_AGE_MS = 60_000;
const MARKET_DATA_REFRESH_INTERVAL_MS = 20_000;
const TOKEN_STATS_REFRESH_MS = 5 * 60_000;
const RECENT_BUYS_REFRESH_INTERVAL_MS = 2_500;

export const BasedMarketView: React.FC<BasedMarketViewProps> = ({ onOpenTerminal, isWorkspaceOpen, onToggleWorkspace }) => {
  const {
    tokens,
    activeToken,
    recentBuyTimestamps,
    recordRecentBuy,
    setActiveToken,
    refreshTokenMarketData,
    refreshNetworkStats,
    setIsSettingsOpen,
    setIsPortfolioOpen,
    t,
  } = useApp();
  const [marketView, setMarketView] = useState<MarketView>(readMarketView);
  // ?q= prefills the search (used by the 404 page's search box).
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get('q')?.trim().slice(0, 100) ?? '');
  const [onlyGraduated, setOnlyGraduated] = useState(false);
  const [onlyLive, setOnlyLive] = useState(false);
  const [filters, setFiltersState] = useState<MarketFilters>(readFilters);
  const setFilters = (next: MarketFilters) => { setFiltersState(next); writeFilters(next); setPage(0); };
  const [presets, setPresets] = useState(readPresets);
  const [watchlist, setWatchlist] = useState(readWatchlist);
  const [showWatchlist, setShowWatchlist] = useState(false);
  const [layout, setLayout] = useState<'table' | 'pulse'>(() => readPreference('bankrdex-market-layout', ['table', 'pulse'] as const, 'table'));
  useEffect(() => {
    const sync = () => setWatchlist(readWatchlist());
    window.addEventListener(WATCHLIST_EVENT, sync);
    return () => window.removeEventListener(WATCHLIST_EVENT, sync);
  }, []);
  const [chainFilter, setChainFilter] = useState<ChainFilter>('all');
  // "All launches" tab: every Bankr launch on Base from the on-chain registry, loaded page by
  // page from the server (the regular tabs hold the actively traded catalog in memory).
  const [showAllLaunches, setShowAllLaunches] = useState(false);
  const [archive, setArchive] = useState<{ tokens: Token[]; next: number | null; status: 'idle' | 'loading' | 'error'; query: string }>(
    { tokens: [], next: null, status: 'idle', query: '' },
  );
  const archiveControllerRef = useRef<AbortController | null>(null);
  const loadArchivePage = async (query: string, before: number | null) => {
    archiveControllerRef.current?.abort();
    const controller = new AbortController();
    archiveControllerRef.current = controller;
    setArchive((current) => ({ ...current, status: 'loading', query }));
    try {
      // Most launches never trade, so one click reads up to a few registry pages until it has a
      // handful of tokens with 24h transactions (each page is one GeckoTerminal request).
      const loaded: Token[] = [];
      let cursor = before;
      let next: number | null = null;
      for (let round = 0; round < ARCHIVE_PAGES_PER_LOAD; round += 1) {
        const result = await fetchLaunchPage({ before: cursor, query }, controller.signal);
        if (controller.signal.aborted) return;
        if (result.total > 0 && !query) setLaunchTotal(result.total);
        loaded.push(...result.tokens);
        next = result.next;
        cursor = result.next;
        if (!next || loaded.filter((token) => token.totalTx24h > 0 || isNewLaunch(token)).length >= ARCHIVE_MIN_ACTIVE_ROWS) break;
      }
      setArchive((current) => ({
        tokens: before ? [...current.tokens, ...loaded.filter((token) => !current.tokens.some((known) => known.id === token.id))] : loaded,
        next,
        status: 'idle',
        query,
      }));
    } catch {
      if (!controller.signal.aborted) setArchive((current) => ({ ...current, status: 'error' }));
    }
  };
  // Size of the on-chain launch registry (every Bankr launch on Base), for the All launches tab.
  const [launchTotal, setLaunchTotal] = useState<number | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/bankr-launches?limit=1', { signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<{ total?: number; complete?: boolean }> : null)
      .then((payload) => {
        if (payload?.complete && typeof payload.total === 'number' && payload.total > 0) setLaunchTotal(payload.total);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  const [, setExternalTokens] = useState<Token[]>([]);
  const [bankrStats, setBankrStats] = useState<Record<string, BankrMarketStat>>({});
  // DexScreener profiles by chain:address. The image replaces the source logo and a paid profile's
  // links replace the launch links (see applyDexProfile).
  const [dexProfiles, setDexProfiles] = useState<Record<string, DexProfile>>({});
  const withDexProfile = (token: Token): Token => applyDexProfile(token, dexProfiles[`${tokenChain(token)}:${token.address.toLowerCase()}`]);
  const [externalStatus, setExternalStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [openingTokenId, setOpeningTokenId] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>('5m');
  const [openMenu, setOpenMenu] = useState<'view' | 'source' | 'timeframe' | 'filter' | null>(null);
  const [page, setPage] = useState(0);
  const [isSoftRefreshing, setIsSoftRefreshing] = useState(false);
  const [binancePricesByAddress, setBinancePricesByAddress] = useState<Record<string, BinanceMarketPrice>>({});
  const [binanceMarketStatus, setBinanceMarketStatus] = useState<'loading' | 'ready' | 'error' | 'paused'>('loading');
  const [priceSource, setPriceSource] = useState<LivePriceSource>('binance');
  const [tokenStatsByAddress, setTokenStatsByAddress] = useState<Record<string, BankrTokenStats>>({});
  const [selectedTopHoldersTokenId, setSelectedTopHoldersTokenId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState | null>(null);
  const [density, setDensity] = useState<Density>(() => readPreference<Density>(DENSITY_KEY, ['comfortable', 'compact'], 'compact'));
  const [pageSizeSetting, setPageSizeSetting] = useState(() => readPreference(PAGE_SIZE_KEY, PAGE_SIZES, '20'));
  const [hiddenColumns, setHiddenColumns] = useState<Set<OptionalColumn>>(readHiddenColumns);
  const [isDisclaimerOpen, setIsDisclaimerOpen] = useState(false);
  const [isBannerVisible, setIsBannerVisible] = useState(() => readPreference(BANNER_KEY, ['shown', 'hidden'], 'shown') === 'shown');
  const [isViewMenuOpen, setIsViewMenuOpen] = useState(false);
  // Tokens whose buy just arrived from the sales feed -> play the recent-buy animation once.
  const [freshBuys, setFreshBuys] = useState<Record<string, number>>({});
  // Latest Bankr buy per token (for its size) and the decoded values by sale key.
  const [latestSales, setLatestSales] = useState<Record<string, { key: string; timestamp: number; txHash: string }>>({});
  const [buyValues, setBuyValues] = useState<Record<string, BuyValue | null>>({});
  const requestedBuyKeysRef = useRef(new Set<string>());
  const [bigBuys, setBigBuys] = useState<Record<string, number>>({});
  // Size of the token's latest buy, only when it is the buy the Bought column shows.
  // 'loading' while the value of the shown buy is being read, so the cell keeps its place
  // instead of the badge vanishing until it arrives.
  const latestBuyValue = (tokenId: string, boughtAt: number) => {
    const sale = latestSales[tokenId];
    if (!sale || sale.timestamp !== boughtAt) return null;
    const value = buyValues[sale.key];
    if (value) return { ...value, txHash: sale.txHash };
    return value === undefined && requestedBuyKeysRef.current.has(sale.key) ? 'loading' as const : null;
  };
  const lastSeenBuysRef = useRef<Record<string, number> | null>(null);
  useEffect(() => {
    const previous = lastSeenBuysRef.current;
    lastSeenBuysRef.current = { ...recentBuyTimestamps };
    // First snapshot (page load) only establishes a baseline: no burst of animations.
    if (!previous || marketView !== 'recent-buys') return;
    const now = Date.now();
    const fresh = Object.entries(recentBuyTimestamps)
      .filter(([id, at]) => at > (previous[id] || 0) && now - at < FRESH_BUY_WINDOW_MS)
      .map(([id]) => id);
    if (fresh.length === 0) return;
    setFreshBuys((current) => ({ ...current, ...Object.fromEntries(fresh.map((id) => [id, now])) }));
    window.setTimeout(() => {
      setFreshBuys((current) => {
        const next = { ...current };
        fresh.forEach((id) => { if (next[id] === now) delete next[id]; });
        return next;
      });
    }, FRESH_BUY_ANIMATION_MS);
  }, [marketView, recentBuyTimestamps]);
  const [activityWindow, setActivityWindow] = useState<ActivityWindow>(() => readPreference(ACTIVITY_WINDOW_KEY, ACTIVITY_WINDOWS, '24h'));
  const pageSize = Number(pageSizeSetting);
  const isCompact = density === 'compact';
  const showColumn = (column: OptionalColumn) =>
    !hiddenColumns.has(column);
  const toggleColumn = (column: OptionalColumn) => setHiddenColumns((current) => {
    const next = new Set(current);
    if (next.has(column)) next.delete(column);
    else next.add(column);
    writePreference(HIDDEN_COLUMNS_KEY, JSON.stringify([...next]));
    return next;
  });
  const handleSort = (key: SortKey) => {
    setSort((current) => !current || current.key !== key
      ? { key, dir: 'desc' }
      : current.dir === 'desc' ? { key, dir: 'asc' } : null);
    setPage(0);
  };

  useEffect(() => {
    try {
      window.sessionStorage.setItem(MARKET_VIEW_SESSION_KEY, marketView);
    } catch {
      // Session storage can be unavailable in restricted browser contexts.
    }
  }, [marketView]);

  // Binance-hot Base tokens come from one shared, server-cached feed.
  useEffect(() => {
    let active = true;
    let controller: AbortController | undefined;
    const load = async () => {
      if (document.visibilityState !== 'visible') return;
      controller?.abort();
      controller = new AbortController();
      try {
        const { tokens: next, bankrStats } = await fetchMarketSources(controller.signal);
        if (!active) return;
        setExternalTokens(next);
        setBankrStats(Object.fromEntries(bankrStats.map((stat) => [stat.address, stat])));
        // Seed table prices for Bankr tokens; per-page Binance refreshes take precedence.
        setBinancePricesByAddress((previous) => ({ ...Object.fromEntries(bankrStats.map((stat) => [stat.address, stat])), ...previous }));
        setExternalStatus('ready');
      } catch (error) {
        if (active && !(error instanceof Error && error.name === 'AbortError')) setExternalStatus('error');
      }
    };
    void load();
    const intervalId = window.setInterval(load, EXTERNAL_REFRESH_MS);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(intervalId);
    };
  }, []);

  // Tokens without a single transaction in the last 24 hours are hidden from every tab (they stay
  // in the catalog and come back as soon as they trade again). Launches younger than 24 hours are
  // always listed, traded or not. Featured tokens are always listed (BNKR's pool is not on the
  // Bankr dex lists, so the catalog has no transaction count for it).
  const hasTrades24h = (token: Token) => {
    if (isFeatured(token) || isNewLaunch(token)) return true;
    const address = token.address.toLowerCase();
    const binance = binancePricesByAddress[address] ?? bankrStats[address];
    return token.totalTx24h > 0 || (binance?.activity?.['24h']?.txs ?? 0) > 0;
  };
  const activeTokens = useMemo(
    () => tokens.filter(hasTrades24h),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bankrStats, binancePricesByAddress, tokens],
  );
  const hiddenInactiveCount = tokens.length - activeTokens.length;

  const chainCounts = useMemo(() => {
    const counts: Record<ChainFilter, number> = { all: activeTokens.length, base: 0, robinhood: 0, arbitrum: 0, arc: 0 };
    activeTokens.forEach((token) => { counts[tokenChain(token)] += 1; });
    return counts;
  }, [activeTokens]);

  // Hot score, per chain: equal-weight percentile of market cap, price gain (avg of 1h and 24h change) and
  // 24h transactions (available for every source). Tokens without trades or market cap are not ranked.
  const hotScores = useMemo(() => {
    const groups = new Map<ChainKey, { id: string; mcap: number; gain: number; txns: number }[]>();
    for (const token of tokens) {
      const address = token.address.toLowerCase();
      const stat = bankrStats[address];
      const metrics = tokenMetrics(token, binancePricesByAddress[address] ?? stat, tokenStatsByAddress[address], '24h');
      if (metrics.mcap <= 0 || metrics.txs <= 0) continue;
      const chain = tokenChain(token);
      const rows = groups.get(chain) ?? [];
      // Catalog tokens off the current page have no snapshot changes; use the server's live stats.
      const change1h = token.change1h || stat?.change1h || 0;
      const change24h = token.change24h || stat?.change24h || 0;
      rows.push({ id: token.id, mcap: metrics.mcap, gain: (change1h + change24h) / 2, txns: metrics.txs });
      groups.set(chain, rows);
    }
    const scores = new Map<string, HotScore>();
    const badged = new Set<string>();
    groups.forEach((rows, chain) => {
      const mcap = percentiles(rows.map((row) => row.mcap));
      const gain = percentiles(rows.map((row) => row.gain));
      const txns = percentiles(rows.map((row) => row.txns));
      const ranked = rows
        .map((row, index) => ({ id: row.id, hot: { score: (mcap[index] + gain[index] + txns[index]) / 3, mcap: mcap[index], gain: gain[index], txns: txns[index], chain } as HotScore }))
        .sort((left, right) => right.hot.score - left.hot.score);
      ranked.forEach(({ id, hot }, index) => {
        if (index < HOT_BADGE_COUNT_PER_SOURCE) {
          hot.rank = index + 1;
          badged.add(id);
        }
        scores.set(id, hot);
      });
    });
    return { scores, badged };
  }, [binancePricesByAddress, bankrStats, tokenStatsByAddress, tokens]);

  const visibleTokens = useMemo(() => {
    const query = search.trim().toLowerCase();
    const pool = showWatchlist
      // Watched tokens stay listed even when they have not traded today.
      ? tokens.filter((token) => watchlist.has(watchKey(token)))
      : showAllLaunches
        ? archive.tokens.filter((token) => token.totalTx24h > 0 || isNewLaunch(token))
        : chainFilter === 'all' ? activeTokens : activeTokens.filter((token) => tokenChain(token) === chainFilter);
    const now = Date.now();
    const filtered = pool.filter((token) => {
      // The All launches search runs on the server (symbol prefix or exact address).
      if (query && !showAllLaunches && !`${token.name} ${token.symbol} ${token.address}`.toLowerCase().includes(query)) return false;
      if (onlyGraduated && !token.isGraduated) return false;
      if ((onlyLive || filters.livePoolOnly) && !token.poolAddress) return false;
      if (filters.hideFakeSymbols && isImitatedSymbol(token)) return false;
      if (filters.hasSocials && !hasSocialLinks(withDexProfile(token).socials)) return false;
      if (filters.ageMaxHours !== null) {
        const launchedAt = createdAtOf(token);
        if (!launchedAt || now - launchedAt > filters.ageMaxHours * 3_600_000) return false;
      }
      if (filters.mcapMin !== null || filters.mcapMax !== null || filters.liquidityMin !== null || filters.volumeMin !== null || filters.txnsMin !== null) {
        const address = token.address.toLowerCase();
        const metrics = tokenMetrics(token, binancePricesByAddress[address], tokenStatsByAddress[address], '24h');
        if (filters.mcapMin !== null && metrics.mcap < filters.mcapMin) return false;
        if (filters.mcapMax !== null && metrics.mcap > filters.mcapMax) return false;
        if (filters.liquidityMin !== null && metrics.liq < filters.liquidityMin) return false;
        if (filters.volumeMin !== null && metrics.volume < filters.volumeMin) return false;
        if (filters.txnsMin !== null && metrics.txs < filters.txnsMin) return false;
      }
      return true;
    });

    if (sort) {
      // Explicit column sort: missing values (0) always sink to the bottom.
      const valueOf = (token: Token) => sortValue(sort.key, token, tokenMetrics(
        token,
        binancePricesByAddress[token.address.toLowerCase()],
        tokenStatsByAddress[token.address.toLowerCase()],
        activityWindow,
        recentBuyTimestamps[token.id],
      ));
      return [...filtered]
        .map((token) => ({ token, value: valueOf(token) }))
        .sort((left, right) => {
          const leftMissing = !Number.isFinite(left.value) || left.value === 0;
          const rightMissing = !Number.isFinite(right.value) || right.value === 0;
          if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
          return sort.dir === 'desc' ? right.value - left.value : left.value - right.value;
        })
        .map(({ token }) => token);
    }
    // All launches keeps the registry order: newest launch first.
    if (showAllLaunches) return filtered;

    return [...filtered].sort((left, right) => {
      const featuredOrder = featuredRank(left) - featuredRank(right);
      if (featuredOrder !== 0) return featuredOrder;
      if (marketView === 'hot') {
        return (hotScores.scores.get(right.id)?.score ?? -1) - (hotScores.scores.get(left.id)?.score ?? -1);
      }
      if (marketView === 'new') {
        // Tokens without a launch time (NaN) would make the comparison inconsistent; they go last.
        const leftAt = createdAtOf(left);
        const rightAt = createdAtOf(right);
        return rightAt - leftAt || left.address.localeCompare(right.address);
      }
      if (marketView === 'recent-buys') {
        const leftBuyAt = recentBuyTimestamps[left.id] || 0;
        const rightBuyAt = recentBuyTimestamps[right.id] || 0;
        if (leftBuyAt !== rightBuyAt) return rightBuyAt - leftBuyAt;
      }
      if (marketView === 'gainers') {
        const field = timeframe === '5m' ? 'change5m' : timeframe === '1h' ? 'change1h' : 'change24h';
        return right[field] - left[field];
      }
      return right.volume24hUsd - left.volume24hUsd;
    });
  }, [activeTokens, activityWindow, archive.tokens, binancePricesByAddress, dexProfiles, filters, hotScores, marketView, onlyGraduated, onlyLive, recentBuyTimestamps, search, showAllLaunches, showWatchlist, sort, chainFilter, timeframe, tokenStatsByAddress, tokens, watchlist]);

  // Load (or re-query) the All launches tab; the search box is sent to the server, debounced.
  useEffect(() => {
    if (!showAllLaunches) return;
    const query = search.trim();
    const timer = window.setTimeout(() => {
      setPage(0);
      void loadArchivePage(query.length >= 2 ? query : '', null);
    }, archive.tokens.length === 0 ? 0 : 400);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAllLaunches, search]);

  const pageCount = Math.max(1, Math.ceil(visibleTokens.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const pageTokens = visibleTokens.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const pageTokensRef = useRef(pageTokens);
  pageTokensRef.current = pageTokens;
  const tokenRegistryRef = useRef(tokens);
  tokenRegistryRef.current = tokens;
  const tableBodyRef = useRef<HTMLTableSectionElement>(null);
  const previousRowPositionsRef = useRef(new Map<string, number>());
  const previousRowOrderRef = useRef('');
  const wasRecentBuyViewRef = useRef(false);
  const pageAddressKey = pageTokens.map((token) => token.address.toLowerCase()).sort().join(',');
  // Row order on screen; the row-move animation only needs to measure rows when it changes.
  const pageOrderKey = pageTokens.map((token) => token.id).join(',');
  // Bankr stats and pool snapshots only exist for Bankr tokens. All launches rows bring their own
  // one-shot market data, so the periodic refresh (which updates catalog tokens) skips them.
  const bankrPageTokens = showAllLaunches ? [] : pageTokens.filter((token) => tokenSource(token) === 'bankr');
  const bankrPageTokensRef = useRef(bankrPageTokens);
  bankrPageTokensRef.current = bankrPageTokens;
  const bankrPageAddressKey = bankrPageTokens.map((token) => token.address.toLowerCase()).sort().join(',');

  useEffect(() => {
    if (!pageAddressKey) {
      setBinanceMarketStatus('ready');
      return;
    }
    let active = true;
    let inFlight = false;
    let hasLoggedFailure = false;
    let controller: AbortController | undefined;

    const refreshPrices = async () => {
      if (!active || inFlight) return;
      if (document.visibilityState !== 'visible') {
        setBinanceMarketStatus('paused');
        return;
      }
      setBinanceMarketStatus((status) => status === 'paused' ? 'loading' : status);
      inFlight = true;
      controller = new AbortController();
      try {
        const { prices, source } = await fetchLiveMarketPrices(pageTokensRef.current, controller.signal);
        if (!active) return;
        setPriceSource(source);
        setBinancePricesByAddress((previous) => ({
          ...previous,
          ...Object.fromEntries(prices.map((price) => [price.address, price])),
        }));
        setBinanceMarketStatus('ready');
        if (hasLoggedFailure) console.info('Live market prices recovered.');
        hasLoggedFailure = false;
      } catch (error) {
        if (active && !(error instanceof Error && error.name === 'AbortError')) {
          // Log once per outage; the status pill already shows the ongoing state.
          if (!hasLoggedFailure) console.warn('Live market price refresh failed (Binance Web3 and OKX DEX):', error);
          hasLoggedFailure = true;
          setBinanceMarketStatus('error');
        }
      } finally {
        inFlight = false;
        controller = undefined;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refreshPrices();
    };

    void refreshPrices();
    const intervalId = window.setInterval(refreshPrices, MARKET_DATA_REFRESH_INTERVAL_MS);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [pageAddressKey]);

  // DexScreener profiles of the tokens on this page, per chain. Paid statuses the server could not
  // read yet (DexScreener rate limit) are asked again a few times.
  useEffect(() => {
    if (!pageAddressKey) return;
    let active = true;
    let timer: number | undefined;
    let attempts = 0;
    const load = async () => {
      attempts += 1;
      const byChain = new Map<ChainKey, string[]>();
      pageTokensRef.current.forEach((token) => {
        const chain = tokenChain(token);
        byChain.set(chain, [...(byChain.get(chain) ?? []), token.address.toLowerCase()]);
      });
      const results = await Promise.all([...byChain].map(([chain, addresses]) => loadDexProfiles(chain, addresses)
        .then((profiles) => Object.entries(profiles).map(([address, profile]) => [`${chain}:${address}`, profile] as const))
        .catch(() => [] as (readonly [string, DexProfile])[])));
      if (!active) return;
      const entries = results.flat();
      if (entries.length > 0) setDexProfiles((previous) => ({ ...previous, ...Object.fromEntries(entries) }));
      if (attempts <= 4 && entries.some(([, profile]) => profile.paid === null)) timer = window.setTimeout(() => void load(), 15_000);
    };
    void load();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [pageAddressKey]);

  useEffect(() => {
    if (!bankrPageAddressKey) return;
    let controller = new AbortController();
    // Stats arrive token by token; collect them and apply at most every 300 ms, so loading a
    // page re-renders the table a few times instead of once per token.
    const pending = new Map<string, BankrTokenStats>();
    let flushTimer: number | undefined;
    const flush = () => {
      flushTimer = undefined;
      if (pending.size === 0) return;
      const updates = [...pending.values()];
      pending.clear();
      setTokenStatsByAddress((previous) => {
        const next = { ...previous };
        updates.forEach((item) => { next[item.address] = item; });
        return next;
      });
    };
    const updateTokenStat = (item: BankrTokenStats) => {
      pending.set(item.address, item);
      flushTimer ??= window.setTimeout(flush, 300);
    };
    const load = () => {
      fetchBankrTokenStats(bankrPageTokensRef.current, controller.signal, updateTokenStat)
        .then((stats) => {
          stats.forEach((item) => pending.set(item.address, item));
          window.clearTimeout(flushTimer);
          flush();
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) console.error('Market token statistics refresh failed:', error);
        });
    };
    load();
    // Holder and burn figures expire after 5 minutes; re-check while the same page stays open.
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      controller.abort();
      controller = new AbortController();
      load();
    }, TOKEN_STATS_REFRESH_MS);
    return () => {
      controller.abort();
      window.clearInterval(intervalId);
      window.clearTimeout(flushTimer);
    };
  }, [bankrPageAddressKey]);

  useLayoutEffect(() => {
    const isRecentBuyView = marketView === 'recent-buys';
    const rows = Array.from(
      tableBodyRef.current?.querySelectorAll<HTMLTableRowElement>('tr[data-token-id]') || []
    );
    const order = rows.map((row) => row.dataset.tokenId || '').join(',');
    const shouldAnimate = isRecentBuyView && wasRecentBuyViewRef.current && order !== previousRowOrderRef.current;
    const moves: Array<{ row: HTMLTableRowElement; offset: number }> = [];
    const nextPositions = new Map<string, number>();

    if (!shouldAnimate) previousRowPositionsRef.current.clear();
    rows.forEach((row) => {
      const tokenId = row.dataset.tokenId;
      if (!tokenId) return;
      const top = row.getBoundingClientRect().top;
      const previousTop = previousRowPositionsRef.current.get(tokenId);
      if (shouldAnimate && previousTop !== undefined && Math.abs(previousTop - top) > 1) {
        moves.push({ row, offset: previousTop - top });
      }
      nextPositions.set(tokenId, top);
    });

    previousRowPositionsRef.current = nextPositions;
    previousRowOrderRef.current = order;
    wasRecentBuyViewRef.current = isRecentBuyView;

    if (moves.length === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    moves.forEach(({ row, offset }) => {
      row.style.transition = 'none';
      row.style.transform = `translateY(${offset}px)`;
    });
    const animationFrame = window.requestAnimationFrame(() => {
      moves.forEach(({ row }) => {
        row.style.transition = 'transform 420ms cubic-bezier(0.2, 0.8, 0.2, 1)';
        row.style.transform = 'translateY(0)';
        row.addEventListener('transitionend', () => {
          row.style.transition = '';
          row.style.transform = '';
        }, { once: true });
      });
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [marketView, pageOrderKey]);

  useEffect(() => {
    if (!pageAddressKey) return;
    let active = true;
    let refreshing = false;
    let intervalId: number | undefined;

    const refreshVisiblePage = async () => {
      if (!active || refreshing || document.visibilityState !== 'visible') return;
      refreshing = true;
      try {
        await refreshTokenMarketData(bankrPageTokensRef.current);
      } finally {
        refreshing = false;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refreshVisiblePage();
    };

    void refreshVisiblePage();
    intervalId = window.setInterval(refreshVisiblePage, MARKET_DATA_REFRESH_INTERVAL_MS);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [pageAddressKey, refreshTokenMarketData]);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    let refreshAfterCurrentRequest = false;
    let consecutiveFailures = 0;
    let hasLoggedFailure = false;
    let timerId: number | undefined;
    let controller: AbortController | undefined;

    const scheduleRefresh = (delay: number) => {
      window.clearTimeout(timerId);
      timerId = window.setTimeout(() => void refreshRecentSales(), delay);
    };

    const refreshRecentSales = async () => {
      if (!active || inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;
      const requestController = new AbortController();
      controller = requestController;
      try {
        const sales = await fetchBankrRecentSales(requestController.signal);
        if (!active) return;
        consecutiveFailures = 0;
        hasLoggedFailure = false;

        const tokenIdsByPair = new Map<string, string>();
        tokenRegistryRef.current.forEach((token) => {
          if (token.poolAddress) {
            tokenIdsByPair.set(`${token.address.toLowerCase()}:${token.poolAddress.toLowerCase()}`, token.id);
          }
        });
        const latestBuysByToken = new Map<string, number>();
        const latestSaleByToken = new Map<string, (typeof sales)[number]>();
        sales.forEach((sale) => {
          const tokenId = tokenIdsByPair.get(`${sale.tokenAddress}:${sale.poolAddress}`);
          if (!tokenId) return;
          latestBuysByToken.set(tokenId, Math.max(latestBuysByToken.get(tokenId) || 0, sale.timestamp));
          const previous = latestSaleByToken.get(tokenId);
          if (!previous || sale.timestamp > previous.timestamp) latestSaleByToken.set(tokenId, sale);
        });
        latestBuysByToken.forEach((timestamp, tokenId) => recordRecentBuy(tokenId, timestamp));

        const withRefs = [...latestSaleByToken.entries()].flatMap(([tokenId, sale]) => (
          sale.txHash && sale.logIndex !== undefined ? [{ tokenId, sale: { ...sale, txHash: sale.txHash, logIndex: sale.logIndex } }] : []
        ));
        // Only replace the state when a newer sale arrived; a fresh object every poll (2.5 s)
        // re-rendered the whole table even when nothing changed.
        setLatestSales((current) => {
          let next: typeof current | null = null;
          withRefs.forEach(({ tokenId, sale }) => {
            const key = buySaleKey(sale);
            if ((current[tokenId]?.timestamp || 0) <= sale.timestamp && current[tokenId]?.key !== key) {
              next ??= { ...current };
              next[tokenId] = { key, timestamp: sale.timestamp, txHash: sale.txHash };
            }
          });
          return next ?? current;
        });
        const missing = withRefs.filter(({ sale }) => !requestedBuyKeysRef.current.has(buySaleKey(sale)));
        if (missing.length > 0) {
          missing.forEach(({ sale }) => requestedBuyKeysRef.current.add(buySaleKey(sale)));
          void fetchBuyValues(missing.map(({ sale }) => sale)).then((values) => {
            if (!active) return;
            // Values that could not be read yet (null, or a failed batch) are retried on a later
            // refresh; until then the cell shows nothing rather than a spinner forever.
            const unresolved: Record<string, null> = {};
            missing.forEach(({ sale }) => {
              const key = buySaleKey(sale);
              if (!values[key]) {
                requestedBuyKeysRef.current.delete(key);
                unresolved[key] = null;
              }
            });
            setBuyValues((current) => ({ ...current, ...unresolved, ...values }));
            const now = Date.now();
            const big = missing.filter(({ sale }) => {
              const value = values[buySaleKey(sale)];
              return value?.usd != null && value.usd >= BIG_BUY_USD && now - sale.timestamp < BIG_BUY_FRESH_MS;
            }).map(({ tokenId }) => tokenId);
            if (big.length === 0) return;
            mascotCheer();
            setBigBuys((current) => ({ ...current, ...Object.fromEntries(big.map((id) => [id, now])) }));
            window.setTimeout(() => {
              setBigBuys((current) => {
                const next = { ...current };
                big.forEach((id) => { if (next[id] === now) delete next[id]; });
                return next;
              });
            }, BIG_BUY_ANIMATION_MS);
          }).catch(() => {
            missing.forEach(({ sale }) => requestedBuyKeysRef.current.delete(buySaleKey(sale)));
            setBuyValues((current) => ({ ...current, ...Object.fromEntries(missing.map(({ sale }) => [buySaleKey(sale), null])) }));
          });
        }
      } catch (error) {
        if (active && !(error instanceof Error && error.name === 'AbortError')) {
          consecutiveFailures = Math.min(consecutiveFailures + 1, 8);
          if (!hasLoggedFailure) {
            console.warn('Bankr recent buys refresh failed:', error);
            hasLoggedFailure = true;
          }
        }
      } finally {
        if (controller === requestController) controller = undefined;
        inFlight = false;
        if (active && document.visibilityState === 'visible') {
          const retryDelay = Math.min(
            15_000,
            (marketView === 'recent-buys' ? RECENT_BUYS_REFRESH_INTERVAL_MS : 15_000) * 2 ** Math.min(consecutiveFailures, 3)
          );
          scheduleRefresh(refreshAfterCurrentRequest ? 0 : retryDelay);
        }
        refreshAfterCurrentRequest = false;
      }
    };

    const handleVisibilityChange = () => {
      window.clearTimeout(timerId);
      if (document.visibilityState === 'hidden') {
        controller?.abort();
      } else if (inFlight) {
        refreshAfterCurrentRequest = true;
      } else {
        void refreshRecentSales();
      }
    };

    void refreshRecentSales();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      active = false;
      window.clearTimeout(timerId);
      controller?.abort();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [marketView, recordRecentBuy]);

  const handleSoftRefresh = async () => {
    if (isSoftRefreshing) return;
    setIsSoftRefreshing(true);
    try {
      await Promise.all([
        refreshTokenMarketData(pageTokensRef.current, true),
        refreshNetworkStats(),
      ]);
    } finally {
      setIsSoftRefreshing(false);
    }
  };

  const changeMarketView = (view: MarketView) => {
    setMarketView(view);
    setSort(null);
    setPage(0);
    setOpenMenu(null);
  };

  const changeTimeframe = (value: Timeframe) => {
    setTimeframe(value);
    setPage(0);
    setOpenMenu(null);
  };

  const selectToken = async (token: Token) => {
    if (token.externalSource === 'market' && !token.isGraduated) {
      // Still on the launchpad bonding curve: DEX aggregators cannot route it yet.
      if (token.externalUrl) window.open(token.externalUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    if (token.externalSource === 'market' && !token.poolAddress) {
      setOpeningTokenId(token.id);
      try {
        const pool = await resolveTokenPool(token.address);
        if (pool) token = { ...token, poolAddress: pool.poolAddress ?? token.poolAddress, quoteSymbol: token.quoteSymbol ?? pool.quoteSymbol };
      } catch {
        // Swaps work without a pool; only the chart needs it.
      } finally {
        setOpeningTokenId(null);
      }
    }
    setActiveToken(withDexProfile(token));
    onOpenTerminal();
  };
  const selectedTopHoldersToken = tokens.find((token) => token.id === selectedTopHoldersTokenId);
  const selectedTopHolders = selectedTopHoldersToken
    ? tokenStatsByAddress[selectedTopHoldersToken.address.toLowerCase()]?.topHolders || []
    : [];

  return (
    <div className={`grid min-h-[calc(100vh-3.5rem)] grid-cols-1 ${isWorkspaceOpen ? 'lg:grid-cols-[260px_minmax(0,1fr)]' : ''}`}>
      {isWorkspaceOpen && <>
        <button
          aria-label="Close pairs menu"
          onClick={onToggleWorkspace}
          className="fixed inset-x-0 top-14 bottom-16 z-20 bg-black/65 lg:hidden"
        />
        <aside className="fixed left-0 top-14 bottom-16 z-30 flex w-[17.5rem] max-w-[calc(100vw-2rem)] flex-col border-r border-line bg-sunken shadow-2xl lg:sticky lg:inset-auto lg:top-14 lg:h-[calc(100vh-3.5rem)] lg:w-auto lg:max-w-none lg:shadow-none">
        <div aria-hidden="true" className="page-hero hidden h-[8rem] shrink-0 border-b border-line lg:block" />
        <div className="flex items-center justify-between border-b border-line px-4 py-4">
          <span className="text-sm font-bold uppercase tracking-[0.12em] text-fg">Workspace</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setIsSettingsOpen(true)} className="rounded p-1 text-muted hover:bg-raised hover:text-fg" title="Settings">
              <Settings2 className="h-4 w-4" />
            </button>
            <button onClick={onToggleWorkspace} aria-label="Close pairs menu" className="rounded p-1 text-muted hover:bg-raised hover:text-fg" title="Close pairs menu">
              <PanelLeftClose className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="border-b border-line p-2">
          <button
            onClick={() => { setOnlyGraduated(false); setOnlyLive(false); setPage(0); }}
            className="flex w-full items-center gap-2 rounded px-3 py-2.5 text-left text-sm font-semibold text-fg hover:bg-raised"
          >
            <Star className="h-3.5 w-3.5 text-accent" />
            All pairs
            <span className="ml-auto text-[0.75rem] text-muted">{tokens.length}</span>
          </button>
          <button
            onClick={() => setIsPortfolioOpen(true)}
            className="flex w-full items-center gap-2 rounded px-3 py-2.5 text-left text-sm font-semibold text-muted hover:bg-raised hover:text-fg"
          >
            <Wallet className="h-3.5 w-3.5" />
            Positions
          </button>
          <button
            onClick={() => { setOnlyLive(true); setPage(0); }}
            className="flex w-full items-center gap-2 rounded px-3 py-2.5 text-left text-sm font-semibold text-muted hover:bg-raised hover:text-fg"
          >
            <Bell className="h-3.5 w-3.5" />
            Live pools
          </button>
        </div>
        <div className="mt-auto border-t border-line p-4 text-xs leading-relaxed text-subtle">
          Base<br />
          Live market feed<br />
          {tokens.length.toLocaleString('en-US')} tracked pairs
        </div>
        </aside>
      </>}

      <section className="min-w-0 bg-surface">
        {isBannerVisible && (
          <MarketHero onOpenToken={(token) => void selectToken(token)} onHide={() => { setIsBannerVisible(false); writePreference(BANNER_KEY, 'hidden'); }} />
        )}
        <div role="tablist" aria-label="Chain" className="scrollbar-none flex items-center gap-1 overflow-x-auto border-b border-line px-3 py-2 sm:px-4">
          {CHAIN_FILTERS.filter((option) => option === 'all' || chainCounts[option] > 0 || chainFilter === option).map((option) => {
            const selected = !showAllLaunches && !showWatchlist && chainFilter === option;
            return (
              <button
                key={option}
                role="tab"
                aria-selected={selected}
                onClick={() => { setShowAllLaunches(false); setShowWatchlist(false); setChainFilter(option); setPage(0); }}
                className={`flex h-8 shrink-0 items-center gap-1.5 rounded-xl px-3 text-xs font-bold transition ${option === 'all'
                  ? selected ? 'nav-active text-fg' : 'text-muted hover:bg-raised/60 hover:text-fg'
                  : `chain-tab chain-${option} ${selected ? '' : 'text-muted hover:bg-raised/60 hover:text-fg'}`}`}
              >
                {option !== 'all' && <ChainEmblem chain={option} className="h-3.5 w-3.5" />}
                {option === 'all' ? 'All chains' : CHAINS[option].name}
                <span className={`chain-count rounded-md bg-sunken px-1.5 py-0.5 font-mono text-[0.625rem] ${selected && option === 'all' ? 'text-accent' : 'text-subtle'}`}>
                  {chainCounts[option].toLocaleString('en-US')}
                </span>
              </button>
            );
          })}
          <span className="mx-1 h-4 w-px shrink-0 bg-line" aria-hidden="true" />
          <button
            role="tab"
            aria-selected={showWatchlist}
            onClick={() => { setShowWatchlist(true); setShowAllLaunches(false); setPage(0); }}
            title="Tokens you starred (kept in this browser)"
            className={`flex h-8 shrink-0 items-center gap-1.5 rounded-xl px-3 text-xs font-bold transition ${showWatchlist ? 'nav-active text-fg' : 'text-muted hover:bg-raised/60 hover:text-fg'}`}
          >
            <Star className="h-3.5 w-3.5 text-amber-400" fill={showWatchlist ? 'currentColor' : 'none'} />
            Watchlist
            <span className="rounded-md bg-sunken px-1.5 py-0.5 font-mono text-[0.625rem] text-subtle">{watchlist.size}</span>
          </button>
          <button
            role="tab"
            aria-selected={showAllLaunches && !showWatchlist}
            onClick={() => { setShowAllLaunches(true); setShowWatchlist(false); setSort(null); setPage(0); }}
            title="Every Bankr launch on Base, newest first, including tokens that no longer trade."
            className={`flex h-8 shrink-0 items-center gap-1.5 rounded-xl px-3 text-xs font-bold transition ${showAllLaunches && !showWatchlist ? 'nav-active text-fg' : 'text-muted hover:bg-raised/60 hover:text-fg'}`}
          >
            <ChainEmblem chain="base" className="h-3.5 w-3.5" />
            All launches
            {launchTotal !== null && (
              <span className="rounded-md bg-sunken px-1.5 py-0.5 font-mono text-[0.625rem] text-subtle">{launchTotal.toLocaleString('en-US')}</span>
            )}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5 sm:px-4">
          {!isWorkspaceOpen && <button onClick={onToggleWorkspace} className="bd-control px-2.5" title="Open pairs menu"><PanelLeftOpen className="h-4 w-4" /><span className="hidden sm:inline">Pairs</span></button>}
          <div className="relative">
          <button onClick={() => setOpenMenu(openMenu === 'view' ? null : 'view')} aria-expanded={openMenu === 'view'} className="bd-control font-bold text-fg">
            {!sort && (marketView === 'recent-buys' || marketView === 'hot') && (
              <span className="relative mr-0.5 inline-flex" aria-hidden="true">
                <Flame className="hot-icon h-3.5 w-3.5 text-orange-400" />
                <span className="buy-steam buy-steam--mini"><i /><i /><i /></span>
              </span>
            )}
            {sort ? 'Custom sort' : marketView === 'hot' ? 'Hot' : marketView === 'top' ? 'Top' : marketView === 'new' ? 'New' : marketView === 'gainers' ? 'Gainers' : 'Recent Buys'}
            {!sort && marketView === 'recent-buys' && <span className="ml-1 h-1.5 w-1.5 animate-pulse rounded-full bg-up" aria-label="live" />}
            <ChevronDown className="h-3 w-3 text-muted" />
          </button>
          {openMenu === 'view' && <div className="menu-pop absolute left-0 top-full z-30 mt-1.5 w-48 rounded-2xl border border-line bg-panel p-1.5 shadow-2xl shadow-black/50">
            {(['recent-buys', 'hot', 'top', 'new', 'gainers'] as const).map((view) => <button key={view} onClick={() => changeMarketView(view)} title={view === 'hot' ? 'Ranked by market cap, price gain and transactions' : undefined} className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-semibold hover:bg-raised hover:text-fg ${!sort && marketView === view ? 'bg-raised text-fg' : 'text-muted'}`}>{view === 'hot' && <Flame className="h-3 w-3 text-orange-400" />}{view === 'recent-buys' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-up" aria-hidden="true" />}{view === 'hot' ? 'Hot tokens' : view === 'top' ? 'Top volume' : view === 'new' ? 'New pairs' : view === 'gainers' ? 'Gainers' : 'Recent buys'}</button>)}
          </div>}
          </div>
          <div className="bd-seg" role="group" aria-label="Layout">
            {(['table', 'pulse'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => { setLayout(value); writePreference('bankrdex-market-layout', value); }}
                aria-pressed={layout === value}
              >
                {value === 'table' ? 'Table' : 'Pulse'}
              </button>
            ))}
          </div>
          <QuickBuyAmount />
          {marketView === 'gainers' && !sort && <div className="relative">
          <button
            onClick={() => setOpenMenu(openMenu === 'timeframe' ? null : 'timeframe')}
            aria-expanded={openMenu === 'timeframe'}
            className="bd-control"
          >
            {timeframe} <ChevronDown className="h-3 w-3" />
          </button>
          {openMenu === 'timeframe' && <div className="menu-pop absolute left-0 top-full z-30 mt-1.5 w-24 rounded-2xl border border-line bg-panel p-1.5 shadow-2xl shadow-black/50">
            {(['5m', '1h', '24h'] as const).map((value) => <button key={value} onClick={() => changeTimeframe(value)} className={`block w-full rounded-xl px-2.5 py-1.5 text-left text-xs font-semibold hover:bg-raised hover:text-fg ${timeframe === value ? 'bg-raised text-fg' : 'text-muted'}`}>{value}</button>)}
          </div>}
          </div>}
          <div className="relative">
          <button
            onClick={() => setOpenMenu(openMenu === 'filter' ? null : 'filter')}
            aria-expanded={openMenu === 'filter'}
            className={`bd-control ${onlyLive || activeFilterCount(filters) > 0 ? 'is-active' : ''}`}
          >
            <Settings2 className="h-3.5 w-3.5" />
            Filter {(onlyLive || activeFilterCount(filters) > 0) && <span className="rounded-md bg-accent px-1.5 text-[0.6875rem] font-extrabold text-black">{activeFilterCount(filters) + (onlyLive ? 1 : 0)}</span>}
          </button>
          {openMenu === 'filter' && <FilterMenu
            filters={filters}
            presets={presets}
            onChange={setFilters}
            onSavePreset={(name) => setPresets(savePreset(name, filters))}
            onDeletePreset={(name) => setPresets(deletePreset(name))}
            onReset={() => { setFilters(EMPTY_FILTERS); setOnlyLive(false); setOnlyGraduated(false); }}
          />}
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsViewMenuOpen((open) => !open)}
              aria-expanded={isViewMenuOpen}
              className="bd-control"
              title="Table display options"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Columns</span>
            </button>
            {isViewMenuOpen && (
              <div className="menu-pop absolute left-0 top-full z-30 mt-1.5 w-64 space-y-3 rounded-2xl border border-line bg-panel p-3.5 text-xs shadow-2xl shadow-black/50">
                <div>
                  <p className="mb-1.5 font-semibold uppercase tracking-wide text-subtle">Density</p>
                  <div className="grid grid-cols-2 gap-1">
                    {(['compact', 'comfortable'] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => { setDensity(value); writePreference(DENSITY_KEY, value); }}
                        aria-pressed={density === value}
                        className={`rounded-xl border px-2 py-1.5 font-semibold capitalize ${density === value ? 'border-accent/60 bg-accent/10 text-fg' : 'border-line text-muted hover:text-fg'}`}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 font-semibold uppercase tracking-wide text-subtle">Columns</p>
                  {OPTIONAL_COLUMNS.map((column) => (
                    <label key={column.key} className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1 text-muted hover:text-fg">
                      <input type="checkbox" className="accent-[var(--bd-accent)]" checked={!hiddenColumns.has(column.key)} onChange={() => toggleColumn(column.key)} />
                      {column.label}
                    </label>
                  ))}
                </div>
                <label className="flex items-center gap-2 border-t border-line pt-2 text-muted">
                  <input
                    type="checkbox"
                    checked={isBannerVisible}
                    onChange={(event) => { setIsBannerVisible(event.target.checked); writePreference(BANNER_KEY, event.target.checked ? 'shown' : 'hidden'); }}
                  />
                  Show banner
                </label>
              </div>
            )}
          </div>
          <div role="group" aria-label="Volume and transactions window" className="bd-seg">
            <span className="hidden items-center px-1.5 text-[0.6875rem] font-semibold text-subtle lg:inline-flex">Vol/Txns</span>
            {ACTIVITY_WINDOWS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={activityWindow === value}
                onClick={() => { setActivityWindow(value); writePreference(ACTIVITY_WINDOW_KEY, value); }}
              >
                {value}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void handleSoftRefresh()}
            disabled={isSoftRefreshing}
            aria-label={t.refreshMarketData}
            title={t.refreshPageData}
            className="bd-control px-2.5 disabled:cursor-wait disabled:opacity-70"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isSoftRefreshing ? 'animate-spin text-accent' : ''}`} />
            <span className="hidden sm:inline">{isSoftRefreshing ? 'Refreshing…' : 'Refresh'}</span>
          </button>
          <span
            role="status"
            className={`hidden items-center gap-1.5 text-[0.75rem] lg:inline-flex ${binanceMarketStatus === 'error' ? 'text-amber-300' : binanceMarketStatus === 'paused' ? 'text-subtle' : 'text-accent'}`}
            title={binanceMarketStatus === 'error'
              ? 'Live prices (Binance Web3 and OKX DEX) are unavailable; pool snapshot prices remain visible.'
              : `${marketView === 'recent-buys' ? 'Recent buys from the Bankr sales feed (2.5s); ' : ''}Prices every 20s from ${priceSource === 'okx' ? 'OKX DEX (Binance Web3 is unreachable from this server)' : priceSource === 'binance+okx' ? 'Binance Web3 (Base) and OKX DEX (other chains)' : 'Binance Web3'}; pool data from the on-chain index and GeckoTerminal.`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${binanceMarketStatus === 'error' ? 'bg-amber-300' : binanceMarketStatus === 'loading' ? 'animate-pulse bg-amber-300' : binanceMarketStatus === 'paused' ? 'bg-subtle' : 'bg-accent'}`} />
            {binanceMarketStatus === 'error' ? 'Prices unavailable' : binanceMarketStatus === 'loading' ? 'Connecting…' : binanceMarketStatus === 'paused' ? 'Paused' : `Live · ${priceSource === 'okx' ? 'OKX' : 'Binance'} · 20s`}
          </span>
          <div className="ml-auto flex w-full min-w-0 items-center justify-end gap-2 sm:w-auto">
            <div className="relative min-w-0 flex-1 sm:flex-none">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" />
              <input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
                placeholder="Filter this list…"
                aria-label="Filter the token list by name, symbol or address"
                className="bd-input w-full pl-8 pr-2 text-sm sm:w-52"
              />
            </div>
          </div>
        </div>

        <div role="note" className="border-b border-line bg-warn/[0.04] px-3 py-1.5 text-[0.75rem] leading-relaxed text-fg-soft sm:px-4">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Info className="h-3.5 w-3.5 shrink-0 text-warn" aria-hidden="true" />
            <span className="font-semibold text-warn">Disclaimer</span>
            <span className="text-muted">
              Verified Bankr launches only · tokens without a trade in 24h are hidden
              {showAllLaunches
                ? ` (${Math.max(0, archive.tokens.length - archive.tokens.filter((token) => token.totalTx24h > 0 || isNewLaunch(token)).length).toLocaleString('en-US')} of ${archive.tokens.length.toLocaleString('en-US')} loaded)`
                : hiddenInactiveCount > 0 ? ` (${hiddenInactiveCount.toLocaleString('en-US')} now)` : ''}
              {' '}· not financial advice
            </span>
            <button type="button" onClick={() => setIsDisclaimerOpen((open) => !open)} aria-expanded={isDisclaimerOpen} className="font-semibold text-warn hover:underline">
              {isDisclaimerOpen ? 'Hide details' : 'Details'}
            </button>
          </div>
          {isDisclaimerOpen && (
            <p className="mt-1.5 max-w-5xl text-muted">
              Only verified Bankr launches are listed: on-chain, Bankr is the token&apos;s Doppler integrator with Bankr&apos;s
              launch setup, or Bankr&apos;s own launch records list it. Other launchpads that use the same pools are left out.
              Tokens older than 24 hours with no transaction in the last 24 hours are hidden; new launches (under 24 hours)
              are always shown. Hidden tokens are not deleted and reappear as soon as they trade again. Transaction counts
              come from the on-chain index, GeckoTerminal and Binance Web3 and can lag by a few minutes. Anyone can launch a
              token through Bankr; being listed here is not an endorsement. Check the contract and liquidity before trading,
              and only trade what you can afford to lose.
            </p>
          )}
        </div>

        {layout === 'pulse' ? (
          <PulseView tokens={tokens} onSelect={(token) => void selectToken(token)} launchedAtOf={createdAtOf} />
        ) : (
        <>
        {/* Desktop / tablet table */}
        <div className="hidden overflow-x-auto lg:block xl:overflow-x-visible">
          <table className="w-full min-w-[60rem] border-separate border-spacing-0 text-left font-mono text-[0.8125rem] tabular-nums">
            <thead className="text-[0.6875rem] uppercase tracking-[0.1em] text-subtle xl:sticky xl:top-14 xl:z-20">
              <tr className="mkt-head [&>th]:border-b [&>th]:border-line [&>th]:font-bold">
                <th scope="col" className="sticky left-0 z-20 px-3 py-2 text-left">
                  <button type="button" onClick={() => handleSort('age')} className={`inline-flex items-center gap-1 uppercase tracking-[0.1em] hover:text-fg ${sort?.key === 'age' ? 'text-fg' : ''}`} title="Sort by age">
                    Token / Age {sort?.key === 'age' && (sort.dir === 'desc' ? '↓' : '↑')}
                  </button>
                </th>
                <SortHeader label="Price" sortKey="price" sort={sort} onSort={handleSort} />
                {showColumn('bought') && <SortHeader label="Bought" sortKey="bought" sort={sort} onSort={handleSort} title="Last buy (Bankr, with a green dot) or last trade (other sources). The buy size (🦐 to 🐋) is shown for Bankr buys in the live sales feed; older buys and other sources show the time only. Click to sort." />}
                <SortHeader label="5m" sortKey="change5m" sort={sort} onSort={handleSort} />
                <SortHeader label="1h" sortKey="change1h" sort={sort} onSort={handleSort} />
                <SortHeader label="24h" sortKey="change24h" sort={sort} onSort={handleSort} />
                <SortHeader label="MCap" sortKey="mcap" sort={sort} onSort={handleSort} />
                {showColumn('liq') && <SortHeader label="Liq" sortKey="liq" sort={sort} onSort={handleSort} />}
                <SortHeader label={`Vol ${activityWindow}`} sortKey="volume" sort={sort} onSort={handleSort} />
                {showColumn('txns') && <SortHeader label={`Txns ${activityWindow}`} sortKey="txns" sort={sort} onSort={handleSort} />}
                {showColumn('holders') && <SortHeader label="Holders" sortKey="holders" sort={sort} onSort={handleSort} />}
                {showColumn('burned') && <th scope="col" className="px-2 py-2 text-right">Burned</th>}
                {showColumn('top10') && <th scope="col" className="px-2 py-2 text-center">Top 10</th>}
                {showColumn('info') && <th scope="col" className="px-2 py-2 text-center">Info</th>}
                <th scope="col" className="px-3 py-2 text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody ref={tableBodyRef}>
              {pageTokens.length === 0 && (externalStatus === 'loading' || tokens.length === 0)
                ? Array.from({ length: 8 }, (_, index) => (
                    <tr key={`skeleton-${index}`} className="[&>td]:border-b [&>td]:border-line">
                      <td className="px-3 py-2.5"><div className="flex items-center gap-2"><Skeleton className="h-8 w-8 rounded-full" /><Skeleton className="h-3 w-28" /></div></td>
                      {Array.from({ length: 8 }, (__, cell) => <td key={cell} className="px-2 py-2.5 text-right"><Skeleton /></td>)}
                      <td />
                    </tr>
                  ))
                : pageTokens.map((token, index) => {
                const isActive = token.id === activeToken.id;
                const address = token.address.toLowerCase();
                const shown = withDexProfile(token);
                const stats = tokenStatsByAddress[address];
                const metrics = tokenMetrics(token, binancePricesByAddress[address], stats, activityWindow, recentBuyTimestamps[token.id]);
                const isMarketDataFresh = Boolean(
                  token.liveSnapshotAt && Date.now() - token.liveSnapshotAt < LIVE_SNAPSHOT_MAX_AGE_MS
                );
                const hasMarketData = isMarketDataFresh || [
                  metrics.price, metrics.mcap, metrics.liq, token.volume24hUsd, token.totalTx24h,
                ].some((value) => Number.isFinite(value) && value > 0);
                const isLoadingCell = !hasMarketData && binanceMarketStatus === 'loading';
                const isBonding = token.externalSource === 'market' && !token.isGraduated;
                const rowBg = isActive ? 'bg-raised/80' : index % 2 ? 'bg-surface-2' : 'bg-surface';
                const cellY = isCompact ? 'py-1' : 'py-2';
                const metric = (value: number) => isLoadingCell ? <Skeleton /> : hasMarketData && value > 0 ? <FlashValue value={value}>{compactUsd(value)}</FlashValue> : <span className="text-subtle">—</span>;
                return (
                  <tr
                    key={token.id}
                    data-token-id={token.id}
                    onClick={() => void selectToken(token)}
                    className={`${rowBg} mkt-row group cursor-pointer [&>td]:border-b [&>td]:border-line/60 ${freshBuys[token.id] ? 'buy-flash' : ''} ${bigBuys[token.id] ? 'big-buy-flash' : ''}`}
                  >
                    <td className={`${rowBg} sticky left-0 z-10 px-3 ${cellY}`}>
                      <div className="flex min-w-[15rem] items-center gap-2.5">
                        <WatchStar token={token} watched={watchlist.has(watchKey(token))} />
                        <span className="relative shrink-0">
                          <TokenPairAvatar token={shown} size={isCompact ? 'md' : 'lg'} verified={isFeatured(token)} />
                          {freshBuys[token.id] && <span key={freshBuys[token.id]} className="buy-steam" aria-hidden="true"><i /><i /><i /></span>}
                        </span>
                        <div className="min-w-0 font-sans">
                          <div className="flex items-center gap-1.5 truncate">
                            {hotScores.badged.has(token.id) && <HotCup hot={hotScores.scores.get(token.id)!} />}
                            <span className="text-sm font-bold text-fg">${token.symbol}</span>
                            {token.quoteSymbol && <span className="text-[0.75rem] font-semibold text-subtle">/ {token.quoteSymbol}</span>}
                          </div>
                          <div className="max-w-[16rem] truncate text-[0.75rem] leading-4 text-muted" title={token.name || undefined}>{token.name || '—'}</div>
                          <div className="flex flex-wrap items-center gap-1.5 text-[0.75rem] text-subtle">
                            <span className="rounded-md bg-raised px-1.5 font-mono font-semibold"><TokenAge at={createdAtOf(token)} /></span>
                            <span className="font-mono">{shortenAddress(token.address)}</span>
                            <TokenSocialLinks socials={shown.socials} symbol={token.symbol} />
                            {((token.audit.buyTax ?? 0) > 0 || (token.audit.sellTax ?? 0) > 0) && (
                              <span title="Buy / sell tax charged by the token contract" className="rounded border border-amber-400/40 px-1 font-semibold text-amber-300">
                                Tax {formatTax(token.audit.buyTax)}/{formatTax(token.audit.sellTax)}%
                              </span>
                            )}
                            {isBonding && (
                              <span title="Still on the launchpad bonding curve; trade it on the launchpad." className="rounded border border-sky-400/40 px-1 font-semibold text-sky-300">
                                Bonding {Math.round(token.bondingCurveProgress)}%
                              </span>
                            )}
                            {isImitatedSymbol(token) && (
                              <span title="Same symbol as a major asset but a different contract. Check the address before trading." className="rounded border border-down/50 bg-down/10 px-1 font-semibold text-down">
                                Fake symbol?
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className={`px-2 ${cellY} text-right font-semibold text-fg`} title={`${exactPrice(metrics.price)} · ${metrics.hasBinancePrice ? 'price from Binance Web3' : 'last pool snapshot price'}`}>
                      {isLoadingCell ? <Skeleton /> : metrics.price > 0 ? <FlashValue value={metrics.price}>{formatMarketPrice(metrics.price)}</FlashValue> : <span className="text-subtle">—</span>}
                    </td>
                    {showColumn('bought') && (
                      <td className={`px-2 ${cellY} text-right text-[0.75rem]`}>
                        {freshBuys[token.id] && <span key={freshBuys[token.id]} className="buy-pop mr-1.5 inline-block rounded-full bg-up px-1.5 py-px font-sans text-[0.6875rem] font-extrabold text-black">+BUY</span>}
                        {(() => {
                          const buyValue = latestBuyValue(token.id, metrics.boughtAt);
                          return buyValue
                            ? (
                              <span className="inline-flex flex-col items-end leading-tight">
                                {buyValue === 'loading'
                                  ? <Skeleton className="my-0.5 h-3 w-12" />
                                  : <BuyValueBadge value={buyValue} />}
                                <BoughtAgo at={metrics.boughtAt} exact={metrics.boughtExact} />
                              </span>
                            )
                            : <BoughtAgo at={metrics.boughtAt} exact={metrics.boughtExact} />;
                        })()}
                      </td>
                    )}
                    <td className={`px-2 ${cellY} text-right`}>{isLoadingCell ? <Skeleton className="h-3 w-10" /> : <ChangeValue value={token.change5m} available={hasMarketData} />}</td>
                    <td className={`px-2 ${cellY} text-right`}>{isLoadingCell ? <Skeleton className="h-3 w-10" /> : <ChangeValue value={token.change1h} available={hasMarketData} />}</td>
                    <td className={`px-2 ${cellY} text-right font-semibold`}>{isLoadingCell ? <Skeleton className="h-3 w-10" /> : <ChangeValue value={token.change24h} available={hasMarketData} />}</td>
                    <td className={`px-2 ${cellY} text-right font-semibold text-fg`}>{metric(metrics.mcap)}</td>
                    {showColumn('liq') && (
                      <td className={`px-2 ${cellY} text-right text-fg-soft`} title="Pool liquidity, and how deep it is compared to the market cap">
                        {metric(metrics.liq)}
                        {!isLoadingCell && metrics.liq > 0 && metrics.mcap > 0 && (
                          <span className={`block text-[0.6875rem] ${metrics.liq / metrics.mcap < 0.03 ? 'text-warn' : 'text-subtle'}`}>
                            {Math.min(999, (metrics.liq / metrics.mcap) * 100).toFixed(metrics.liq / metrics.mcap < 0.1 ? 1 : 0)}% of MC
                          </span>
                        )}
                      </td>
                    )}
                    <td className={`px-2 ${cellY} text-right text-fg`}>{metric(metrics.volume)}</td>
                    {showColumn('txns') && (
                      <td className={`px-2 ${cellY} text-right`}>
                        {isLoadingCell ? <Skeleton /> : <TxnsValue buys={metrics.buys} sells={metrics.sells} total={metrics.txs} available={hasMarketData} />}
                      </td>
                    )}
                    {showColumn('holders') && (
                      <td
                        className={`px-2 ${cellY} text-right text-fg-soft`}
                        title={stats?.holderCount != null
                          ? 'Holder count indexed by GeckoTerminal; it may lag the chain slightly.'
                          : 'Holder count from the token source.'}
                      >
                        {metrics.holders > 0 ? `${metrics.holdersApprox ? '~' : ''}${compactCount(metrics.holders)}` : <span className="text-subtle">—</span>}
                      </td>
                    )}
                    {showColumn('burned') && (
                      <td
                        className={`px-2 ${cellY} text-right text-fg-soft`}
                        title={stats?.burnUpdatedAt
                          ? `Tokens sent to the burn address (fee burns and buybacks). Updated ${new Date(stats.burnUpdatedAt).toLocaleString()}.`
                          : 'Tokens held by the 0x…dEaD burn address, read on-chain.'}
                      >
                        {stats?.burnedAmount == null
                          ? <span className="text-subtle">—</span>
                          : Number(stats.burnedAmount) < MIN_DISPLAY_BURN
                            ? <span title="Less than 1 token has been sent to the burn address" className="whitespace-nowrap rounded border border-line px-1.5 py-0.5 font-sans text-[0.6875rem] text-subtle">Not burned yet</span>
                            : displayTokenAmount(Number(stats.burnedAmount))}
                      </td>
                    )}
                    {showColumn('top10') && (
                      <td className={`px-2 ${cellY} text-center`}>
                        {stats?.topHolders.length ? (
                          <button
                            type="button"
                            onClick={(event) => { event.stopPropagation(); setSelectedTopHoldersTokenId(token.id); }}
                            className="rounded-lg border border-line px-2 py-0.5 text-[0.75rem] font-semibold text-accent hover:border-accent/60"
                            aria-label={`View top 10 holders for ${token.symbol}`}
                          >
                            {stats.top10Share != null ? `${stats.top10Share.toFixed(1)}%` : 'View'}
                          </button>
                        ) : stats?.top10Share != null ? (
                          <span
                            title="Share of supply held by the 10 largest wallets (GeckoTerminal). Includes the pool and vesting contracts."
                            className={`text-[0.75rem] ${stats.top10Share >= 50 ? 'text-amber-300' : 'text-fg-soft'}`}
                          >
                            {stats.top10Share.toFixed(1)}%
                          </span>
                        ) : <span className="text-subtle">—</span>}
                      </td>
                    )}
                    {showColumn('info') && (
                      <td className={`px-2 ${cellY}`}>
                        <div className="flex items-center justify-center gap-1.5">
                          <DexScreenerEmblem token={token} minimal />
                        </div>
                      </td>
                    )}
                    <td className={`px-3 ${cellY} text-right`}>
                      <div className="flex items-center justify-end gap-1">
                        <QuickBuyButton token={token} />
                        <button
                          type="button"
                          onClick={(event) => { event.stopPropagation(); void selectToken(token); }}
                          disabled={openingTokenId === token.id}
                          title={`Trade ${token.symbol} on ${CHAINS[tokenChain(token)].name}`}
                          className="btn-trade inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-3 py-1 font-sans text-[0.75rem] font-extrabold disabled:opacity-60"
                        >
                          Trade
                          {isBonding && <ExternalLink className="h-3 w-3" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <ul className="grid grid-cols-1 gap-2 px-2 py-2 md:grid-cols-2 md:px-3 lg:hidden">
          {pageTokens.length === 0 && (externalStatus === 'loading' || tokens.length === 0) && Array.from({ length: 6 }, (_, index) => (
            <li key={`card-skeleton-${index}`} className="bd-card flex items-center gap-3 p-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2"><Skeleton className="h-3 w-24" /><Skeleton className="h-3 w-40" /></div>
            </li>
          ))}
          {pageTokens.map((token) => {
            const address = token.address.toLowerCase();
            const shown = withDexProfile(token);
            const metrics = tokenMetrics(token, binancePricesByAddress[address], tokenStatsByAddress[address], activityWindow, recentBuyTimestamps[token.id]);
            const hasMarketData = [metrics.price, metrics.mcap, token.volume24hUsd].some((value) => value > 0);
            const isBonding = token.externalSource === 'market' && !token.isGraduated;
            const buyShare = metrics.buys + metrics.sells > 0 ? (metrics.buys / (metrics.buys + metrics.sells)) * 100 : null;
            const buyValue = metrics.boughtAt > 0 ? latestBuyValue(token.id, metrics.boughtAt) : null;
            return (
              <li key={token.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => void selectToken(token)}
                  onKeyDown={(event) => { if (event.key === 'Enter') void selectToken(token); }}
                  className={`bd-card p-3 transition active:scale-[0.99] active:bg-raised ${token.id === activeToken.id ? 'border-accent/40' : ''} ${freshBuys[token.id] ? 'buy-flash-card' : ''} ${bigBuys[token.id] ? 'big-buy-flash-card' : ''}`}
                >
                  <div className="flex items-center gap-2.5">
                    <WatchStar token={token} watched={watchlist.has(watchKey(token))} />
                    <span className="relative shrink-0">
                      <TokenPairAvatar token={shown} size="lg" verified={isFeatured(token)} />
                      {freshBuys[token.id] && <span key={freshBuys[token.id]} className="buy-steam" aria-hidden="true"><i /><i /><i /></span>}
                      {freshBuys[token.id] && <span key={`pop-${freshBuys[token.id]}`} className="buy-pop absolute -right-2 -top-2 z-40 rounded-full bg-up px-1 text-[0.625rem] font-extrabold text-black">+BUY</span>}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1 truncate text-sm font-bold text-fg">
                        {hotScores.badged.has(token.id) && <HotCup hot={hotScores.scores.get(token.id)!} />}
                        <span className="truncate">${token.symbol}</span>
                        {token.quoteSymbol && <span className="shrink-0 text-[0.6875rem] font-semibold text-subtle">/ {token.quoteSymbol}</span>}
                      </div>
                      <div className="flex min-w-0 items-center gap-1.5 text-[0.75rem] leading-4 text-muted">
                        <span className="truncate">{token.name || '—'}</span>
                        <TokenSocialLinks socials={shown.socials} symbol={token.symbol} className="shrink-0 flex-nowrap" />
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-mono text-sm font-bold text-fg" title={exactPrice(metrics.price)}>{metrics.price > 0 ? formatMarketPrice(metrics.price) : '—'}</div>
                      <div className="mt-0.5"><ChangeValue value={token.change24h} available={hasMarketData} className="text-[0.75rem]" /></div>
                    </div>
                  </div>
                  <dl className="mt-2.5 grid grid-cols-4 gap-1.5 font-mono text-[0.75rem]">
                    {([
                      ['MCap', compactUsd(metrics.mcap)],
                      [`Vol ${activityWindow}`, compactUsd(metrics.volume)],
                      ['Liq', compactUsd(metrics.liq)],
                      ['Age', <TokenAge key="age" at={createdAtOf(token)} />],
                    ] as const).map(([label, value]) => (
                      <div key={label} className="min-w-0 rounded-lg bg-sunken/60 px-2 py-1">
                        <dt className="truncate font-sans text-[0.625rem] font-bold uppercase tracking-wider text-subtle">{label}</dt>
                        <dd className="truncate font-semibold text-fg-soft">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-2 flex items-center gap-2 text-[0.6875rem] text-muted">
                    {buyShare !== null ? (
                      <span className="flex min-w-0 flex-1 items-center gap-1.5" title={`${metrics.buys} buys / ${metrics.sells} sells (${activityWindow})`}>
                        <span className="text-up">{compactCount(metrics.buys)}</span>
                        <span className="ratio-bar min-w-8 flex-1"><span style={{ width: `${buyShare}%` }} /></span>
                        <span className="text-down">{compactCount(metrics.sells)}</span>
                      </span>
                    ) : <span className="flex-1 text-subtle">No trades in {activityWindow}</span>}
                    {buyValue && buyValue !== 'loading' && <BuyValueBadge value={buyValue} compact />}
                    {metrics.boughtAt > 0 && <BoughtAgo at={metrics.boughtAt} exact={metrics.boughtExact} compact />}
                    {isBonding && <span className="text-sky-300">Bonding {Math.round(token.bondingCurveProgress)}%</span>}
                    {isImitatedSymbol(token) && <span className="text-down">Fake?</span>}
                    <QuickBuyButton token={token} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-panel/60 px-3 py-2.5 font-mono text-[0.75rem] text-muted sm:px-4">
          <span>
            {visibleTokens.length === 0 ? 'No tokens' : `${currentPage * pageSize + 1}-${Math.min((currentPage + 1) * pageSize, visibleTokens.length)} of ${visibleTokens.length.toLocaleString('en-US')}`}
          </span>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5">
              <span className="hidden sm:inline">Rows</span>
              <select
                value={pageSizeSetting}
                onChange={(event) => {
                  const value = event.target.value as (typeof PAGE_SIZES)[number];
                  setPageSizeSetting(value);
                  writePreference(PAGE_SIZE_KEY, value);
                  setPage(0);
                }}
                aria-label="Rows per page"
                className="rounded-lg border border-line bg-raised px-1.5 py-1 text-fg"
              >
                {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
            <button
              onClick={() => setPage((value) => Math.max(0, value - 1))}
              disabled={currentPage === 0}
              className="rounded-lg border border-line p-1.5 text-muted hover:border-accent/50 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Previous token page"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span>{currentPage + 1} / {pageCount}{showAllLaunches && archive.next ? '+' : ''}</span>
            <button
              onClick={() => {
                // All launches: the last loaded page fetches the next one from the server first.
                if (showAllLaunches && currentPage >= pageCount - 1 && archive.next) {
                  void loadArchivePage(archive.query, archive.next).then(() => setPage((value) => value + 1));
                  return;
                }
                setPage((value) => Math.min(pageCount - 1, value + 1));
              }}
              disabled={showAllLaunches ? archive.status === 'loading' || (currentPage >= pageCount - 1 && !archive.next) : currentPage >= pageCount - 1}
              className="rounded-lg border border-line p-1.5 text-muted hover:border-accent/50 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Next token page"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        </>
        )}
        {selectedTopHoldersToken && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            onClick={() => setSelectedTopHoldersTokenId(null)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="market-top-holders-title"
              className="w-full max-w-xl rounded-xl border border-line bg-panel p-4 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-3 flex items-start justify-between gap-4">
                <div>
                  <h2 id="market-top-holders-title" className="text-base font-bold text-white">
                    Top 10 holders · ${selectedTopHoldersToken.symbol}
                  </h2>
                  <p className="mt-1 text-xs text-muted">
                    Holder balances reported by Bankr
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedTopHoldersTokenId(null)}
                  className="rounded p-1 text-muted hover:bg-raised hover:text-white"
                  aria-label="Close top holders"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {selectedTopHolders.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">
                  Holder data is not available for this token yet.
                </p>
              ) : (
                <ol className="max-h-[60vh] divide-y divide-line overflow-y-auto">
                  {selectedTopHolders.map((holder, index) => (
                    <li key={holder.address} className="flex items-center gap-3 py-2.5 text-xs">
                      <span className="w-6 text-right font-mono text-subtle">{index + 1}</span>
                      <div className="min-w-0 flex-1">
                        <a
                          href={explorerAddress(selectedTopHoldersToken?.chain, holder.address)}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-fg-soft hover:text-accent"
                        >
                          {holder.label || shortenAddress(holder.address)}
                        </a>
                        {holder.label && (
                          <div className="truncate font-mono text-[0.75rem] text-subtle">
                            {shortenAddress(holder.address)}
                          </div>
                        )}
                      </div>
                      <span className="font-mono text-white">{displayTokenAmount(Number(holder.balance))}</span>
                      <span className="w-16 text-right font-mono text-muted">
                        {holder.share === null ? '—' : `${holder.share.toFixed(2)}%`}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
};

function WatchStar({ token, watched }: { token: Token; watched: boolean }) {
  return (
    <button
      type="button"
      onClick={(event) => { event.stopPropagation(); toggleWatch(token); }}
      aria-pressed={watched}
      aria-label={watched ? `Remove ${token.symbol} from watchlist` : `Add ${token.symbol} to watchlist`}
      title={watched ? 'Remove from watchlist' : 'Add to watchlist'}
      className={`shrink-0 rounded p-0.5 ${watched ? 'text-amber-400' : 'text-subtle hover:text-amber-300'}`}
    >
      <Star className="h-3.5 w-3.5" fill={watched ? 'currentColor' : 'none'} />
    </button>
  );
}

const FILTER_FIELDS: { key: keyof MarketFilters; label: string; unit: string; placeholder: string }[] = [
  { key: 'mcapMin', label: 'Min market cap', unit: '$', placeholder: '10000' },
  { key: 'mcapMax', label: 'Max market cap', unit: '$', placeholder: '5000000' },
  { key: 'liquidityMin', label: 'Min liquidity', unit: '$', placeholder: '5000' },
  { key: 'volumeMin', label: 'Min 24h volume', unit: '$', placeholder: '1000' },
  { key: 'txnsMin', label: 'Min 24h txns', unit: '#', placeholder: '20' },
  { key: 'ageMaxHours', label: 'Max age', unit: 'h', placeholder: '24' },
];

function FilterMenu({ filters, presets, onChange, onSavePreset, onDeletePreset, onReset }: {
  filters: MarketFilters;
  presets: Record<string, MarketFilters>;
  onChange: (filters: MarketFilters) => void;
  onSavePreset: (name: string) => void;
  onDeletePreset: (name: string) => void;
  onReset: () => void;
}) {
  const [presetName, setPresetName] = useState('');
  const setNumber = (key: keyof MarketFilters, raw: string) => {
    const value = raw.trim() === '' ? null : Number(raw.replace(/[^0-9.]/g, ''));
    onChange({ ...filters, [key]: value !== null && Number.isFinite(value) ? value : null });
  };
  const toggle = (key: 'hasSocials' | 'hideFakeSymbols' | 'livePoolOnly') => onChange({ ...filters, [key]: !filters[key] });
  return (
    <div className="menu-pop absolute left-0 top-full z-30 mt-1.5 w-[19rem] space-y-3 rounded-2xl border border-line bg-panel p-3.5 text-xs shadow-2xl shadow-black/50">
      <div className="grid grid-cols-2 gap-2">
        {FILTER_FIELDS.map((field) => (
          <label key={field.key} className="block text-muted">
            <span className="mb-0.5 block">{field.label} <span className="text-subtle">({field.unit})</span></span>
            <input
              inputMode="decimal"
              value={(filters[field.key] as number | null) ?? ''}
              placeholder={field.placeholder}
              onChange={(event) => setNumber(field.key, event.target.value)}
              className="w-full rounded-lg border border-line bg-sunken px-2 py-1.5 font-mono text-fg outline-none focus:border-accent"
            />
          </label>
        ))}
      </div>
      <div className="space-y-1">
        <label className="flex items-center gap-2 text-muted"><input type="checkbox" checked={filters.hasSocials} onChange={() => toggle('hasSocials')} /> Has socials (X, Telegram, Discord, website…)</label>
        <label className="flex items-center gap-2 text-muted"><input type="checkbox" checked={filters.hideFakeSymbols} onChange={() => toggle('hideFakeSymbols')} /> Hide fake symbols (ETH, USDC, BNKR…)</label>
        <label className="flex items-center gap-2 text-muted"><input type="checkbox" checked={filters.livePoolOnly} onChange={() => toggle('livePoolOnly')} /> Has a live pool</label>
      </div>
      <div className="border-t border-line pt-2">
        <p className="mb-1 font-semibold uppercase tracking-wide text-subtle">Presets</p>
        <div className="mb-2 flex flex-wrap gap-1">
          {Object.keys(presets).length === 0 && <span className="text-subtle">None saved yet.</span>}
          {Object.entries(presets).map(([name, preset]) => (
            <span key={name} className="inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5">
              <button type="button" onClick={() => onChange(preset)} className="text-fg-soft hover:text-fg">{name}</button>
              <button type="button" onClick={() => onDeletePreset(name)} aria-label={`Delete preset ${name}`} className="text-subtle hover:text-down">×</button>
            </span>
          ))}
        </div>
        <div className="flex gap-1">
          <input value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="Preset name" className="min-w-0 flex-1 rounded-lg border border-line bg-sunken px-2 py-1.5 text-fg outline-none focus:border-accent" />
          <button type="button" disabled={!presetName.trim()} onClick={() => { onSavePreset(presetName); setPresetName(''); }} className="btn-trade rounded-lg px-3 py-1.5 font-extrabold disabled:opacity-40">Save</button>
        </div>
      </div>
      <button type="button" onClick={onReset} className="w-full rounded-xl border border-line py-1.5 font-semibold text-muted hover:border-down/50 hover:text-fg">Reset filters</button>
    </div>
  );
}
