import type { ChainKey } from '../config/chains';
import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo, ReactNode } from 'react';
import {
  Token,
  Language,
  WalletState,
  PortfolioAsset,
  Trade,
  PushAlert,
  TradingThesis,
  BaseNetworkStats,
  PendingPlatformFee,
} from '../types';
import { INITIAL_TOKENS, INITIAL_THESES } from '../data/tokens';
import { translations } from '../utils/translations';
import {
  BASE_CHAIN_ID_DEC,
  BASE_STABLECOINS,
  getBaseStablecoin,
  Eip1193Provider,
  connectInjectedWeb3,
  fetchLiveBaseStats,
  fetchAddressEthBalance,
  executeFeeProtectedAggregatorSwap,
  payPendingPlatformFee as submitPendingPlatformFee,
  sendPreparedTransaction,
  type PreparedTransaction,
} from '../utils/web3';
import { readPendingPlatformFees } from '../utils/platformFees';
import type { FeeProtectedSwapTransactions } from '../services/tradingApis';
import { applyDexProfile } from '../services/dexProfiles';
import { useDexProfile } from '../components/useDexProfile';
import {
  isBiometricEnrolled,
  setBiometricEnrolled,
  authenticateWithBiometrics,
  enrollBiometrics,
  verifyPin,
  type PinCheckResult,
} from '../utils/biometric';
import { sound } from '../utils/sound';
import { getWalletConnectProvider, toEip1193Provider, WalletConnectProvider } from '../utils/walletConnect';
import { fetchAddressTokenBalance, fetchWalletTokenHoldings } from '../services/walletPortfolio';
import {
  fetchBankrTokens,
  fetchNewBankrTokens,
  fetchExternalMarketTokens,
  fetchBankrTokenByAddress,
  resolveTokenPool,
  fetchBankrPoolSnapshot,
  fetchBankrPoolTrades,
  enrichTokenMarketData,
  getInitialBankrTokens,
  BankrTab,
} from '../services/tradingApis';

interface AppContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  theme: AppTheme;
  setTheme: (theme: AppTheme) => void;
  t: (typeof translations)['en'];

  // Tokens
  tokens: Token[];
  activeToken: Token;
  setActiveToken: (token: Token) => void;
  pendingSwapTokenToSell: Token | null;
  setPendingSwapTokenToSell: (token: Token | null) => void;
  refreshBankrTokens: (tab?: BankrTab) => Promise<void>;
  refreshTokenMarketData: (tokens: Token[], force?: boolean) => Promise<void>;

  // Wallet
  wallet: WalletState;
  connectWallet: (type: 'injected', provider?: Eip1193Provider) => Promise<boolean>;
  connectByCustomAddress: (address: string) => Promise<boolean>;
  disconnectWallet: () => void;
  portfolio: PortfolioAsset[];
  totalPortfolioValueUsd: number;
  totalPnlUsd: number;
  totalPnlPercentage: number;
  isPortfolioRefreshing: boolean;
  portfolioError: string | null;
  portfolioLastSyncedAt: number | null;
  refreshPortfolio: () => Promise<void>;

  // Live Base network stats
  networkStats: BaseNetworkStats;
  refreshNetworkStats: () => Promise<void>;

  // Thesis
  theses: TradingThesis[];
  activeThesis: TradingThesis | null;
  setActiveThesis: (thesis: TradingThesis | null) => void;
  createThesis: (thesis: Omit<TradingThesis, 'id' | 'likes' | 'createdAt'>) => void;
  likeThesis: (thesisId: string) => void;

  // Trading & Settings
  slippage: number;
  setSlippage: (s: number) => void;
  gasSpeed: number; // 3 = normal, 5 = fast, 7 = turbo
  setGasSpeed: (g: number) => void;
  oneClickEnabled: boolean;
  setOneClickEnabled: (enabled: boolean) => void;
  soundEnabled: boolean;
  setSoundEnabled: (enabled: boolean) => void;

  // Trades
  recentTrades: Trade[];
  pendingPlatformFees: PendingPlatformFee[];
  payPendingPlatformFee: (feeId: string) => Promise<string>;
  recentBuyTimestamps: Record<string, number>;
  recordRecentBuy: (tokenId: string, timestamp: number) => void;
  refreshActivePoolData: () => Promise<boolean>;
  // Signs and sends a prepared transaction (e.g. a Bankr fee claim) from the connected wallet.
  sendWalletTransaction: (transaction: PreparedTransaction, chain?: ChainKey) => Promise<{ txHash: string; succeeded: boolean }>;
  // Raw request to the connected wallet (e.g. eth_signTypedData_v4 for a Permit2 permit).
  walletRequest: (method: string, params?: unknown[]) => Promise<unknown>;
  executeTrade: (
    tokenId: string,
    type: 'buy' | 'sell',
    ethAmount: number,
    tokenAmount: number,
    payTokenAddress?: string,
    payTokenAmount?: number,
    slippageTolerancePercent?: number,
    poolAddress?: string,
    onProgress?: (message: string) => void,
    swapTransactions?: FeeProtectedSwapTransactions,
    receiveTokenAddress?: string
  ) => Promise<{ success: boolean; message: string; txHash?: string; feeTxHash?: string; pendingPlatformFee?: PendingPlatformFee }>;

  // Biometrics
  isBiometricLocked: boolean;
  isBiometricEnrolledState: boolean;
  requireBiometricThreshold: number; // ETH threshold
  unlockWalletWithBiometrics: () => Promise<boolean>;
  unlockWithPin: (pin: string) => Promise<PinCheckResult>;
  enableBiometrics: () => Promise<boolean>;
  disableBiometrics: () => void;
  triggerBiometricLock: () => void;

  // Alerts & Notifications
  alerts: PushAlert[];
  addAlert: (alert: Omit<PushAlert, 'id' | 'timestamp' | 'read'>) => void;
  markAlertsAsRead: () => void;
  clearAlerts: () => void;

  // UI state & Modals
  isSidebarOpen: boolean;
  setIsSidebarOpen: (open: boolean) => void;
  isPortfolioOpen: boolean;
  setIsPortfolioOpen: (open: boolean) => void;
  isSettingsOpen: boolean;
  setIsSettingsOpen: (open: boolean) => void;
  isBiometricModalOpen: boolean;
  setIsBiometricModalOpen: (open: boolean) => void;
  isThesisModalOpen: boolean;
  setIsThesisModalOpen: (open: boolean) => void;
  isWalletConnectModalOpen: boolean;
  setIsWalletConnectModalOpen: (open: boolean) => void;
  pendingTradeAction: (() => void) | null;
  setPendingTradeAction: (action: (() => void) | null) => void;
}

const AppContext = createContext<AppContextType | null>(null);
const ACTIVE_TOKEN_SESSION_KEY = 'bankrdex-active-token';
const NEW_TOKENS_POLL_MS = 15_000;
// The full catalog is ~1.4 MB per download; new launches arrive via the fast poll above, so the
// full list only needs an occasional refresh (keeps bandwidth within the hosting quota).
const REGISTRY_REFRESH_MS = 5 * 60_000;
const MARKET_SNAPSHOT_REUSE_MS = 15_000;
const WALLET_PROVIDER_STORAGE_KEY = 'bankrdex-wallet-provider';
const LANGUAGE_STORAGE_KEY = 'bankrdex-language';
const THEME_STORAGE_KEY = 'bankrdex-theme';

export type AppTheme = 'dark' | 'light';

function readThemePreference(): AppTheme {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function readLanguagePreference(): Language {
  try {
    const language = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return language === 'zh' || language === 'ja' || language === 'ko' || language === 'en'
      ? language
      : 'en';
  } catch {
    return 'en';
  }
}

function readPersistedActiveToken(): Token | null {
  try {
    const savedToken = window.sessionStorage.getItem(ACTIVE_TOKEN_SESSION_KEY);
    if (!savedToken) return null;

    const token = JSON.parse(savedToken) as Partial<Token>;
    if (
      typeof token.id === 'string' &&
      typeof token.address === 'string' &&
      typeof token.name === 'string' &&
      typeof token.symbol === 'string' &&
      typeof token.priceUsd === 'number' &&
      typeof token.priceEth === 'number'
    ) {
      // The pair logo is re-read from the live pool; a saved one may predate a fix and be wrong.
      const { quoteLogo: _staleQuoteLogo, ...rest } = token;
      return rest as Token;
    }
  } catch {
    return null;
  }
  return null;
}

export const AppProvider: React.FC<{ children: ReactNode; initialTokenAddress?: string; initialTokenChain?: ChainKey }> = ({ children, initialTokenAddress, initialTokenChain = 'base' }) => {
  // A /token/<address>?chain=<chain> link names one token on one chain.
  const isUrlToken = (token: Token, address: string) =>
    token.address.toLowerCase() === address && (token.chain ?? 'base') === initialTokenChain;
  const [lang, setLang] = useState<Language>(readLanguagePreference);
  const [theme, setTheme] = useState<AppTheme>(readThemePreference);

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
    } catch {
      // Language selection remains active for this session if storage is unavailable.
    }
  }, [lang]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Theme selection remains active for this session if storage is unavailable.
    }
  }, [theme]);

  const initialBankrTokens = useRef(getInitialBankrTokens('trending'));
  const [tokens, setTokens] = useState<Token[]>(initialBankrTokens.current);
  const tokenRegistryAddressKey = useMemo(
    () => tokens.map((token) => token.address.toLowerCase()).sort().join(','),
    [tokens]
  );
  const [activeToken, setActiveToken] = useState<Token>(() => {
    const fromUrl = initialTokenAddress
      ? initialBankrTokens.current.find((token) => isUrlToken(token, initialTokenAddress))
      : undefined;
    const persisted = readPersistedActiveToken();
    return fromUrl
      ?? (persisted && (!initialTokenAddress || isUrlToken(persisted, initialTokenAddress)) ? persisted : null)
      ?? initialBankrTokens.current[0]
      ?? INITIAL_TOKENS[0];
  });
  // A /token/[address] link selects that token once it appears in the live token list.
  const pendingUrlTokenRef = useRef(
    initialTokenAddress && !isUrlToken(activeToken, initialTokenAddress) ? initialTokenAddress : null
  );
  useEffect(() => {
    const address = pendingUrlTokenRef.current;
    if (!address) return;
    const match = tokens.find((token) => isUrlToken(token, address));
    if (match) {
      pendingUrlTokenRef.current = null;
      setActiveToken(match);
    }
  }, [tokens]);
  // Links to Binance-hot Base tokens are not in the Bankr catalog:
  // look them up in the external market feed once, and resolve a pool for the chart.
  useEffect(() => {
    const address = pendingUrlTokenRef.current;
    if (!address) return;
    let active = true;
    void (async () => {
      try {
        const external = initialTokenChain === 'base'
          ? (await fetchExternalMarketTokens()).find((token) => token.address.toLowerCase() === address)
          : undefined;
        if (!active || pendingUrlTokenRef.current !== address) return;
        if (!external) {
          // A Bankr launch outside the market catalog (no recent trading): load it on its own.
          const launched = await fetchBankrTokenByAddress(address, undefined, initialTokenChain).catch(() => null);
          if (!active || !launched || pendingUrlTokenRef.current !== address) return;
          const [withMarket] = await enrichTokenMarketData([launched]).catch(() => [launched]);
          if (!active || pendingUrlTokenRef.current !== address) return;
          pendingUrlTokenRef.current = null;
          setActiveToken(withMarket);
          return;
        }
        const pool = external.isGraduated ? await resolveTokenPool(address).catch(() => null) : null;
        if (!active || pendingUrlTokenRef.current !== address) return;
        pendingUrlTokenRef.current = null;
        setActiveToken(pool ? { ...external, poolAddress: pool.poolAddress ?? external.poolAddress, quoteSymbol: pool.quoteSymbol ?? external.quoteSymbol } : external);
      } catch {
        // Unknown address: keep the default token.
      }
    })();
    return () => { active = false; };
  }, []);
  // The active token's DexScreener profile: its image replaces the source logo, and a paid
  // profile's links replace the launch links. Re-applied when a catalog refresh restores the
  // original values (applyDexProfile returns the same token when nothing changes).
  const activeDexProfile = useDexProfile(activeToken);
  useEffect(() => {
    if (!activeDexProfile) return;
    const address = activeToken.address.toLowerCase();
    setActiveToken((current) => current.address.toLowerCase() === address ? applyDexProfile(current, activeDexProfile) : current);
  }, [activeDexProfile, activeToken.address, activeToken.logo, activeToken.socials]);
  const [pendingSwapTokenToSell, setPendingSwapTokenToSell] = useState<Token | null>(null);

  // Live Base network stats
  const [networkStats, setNetworkStats] = useState<BaseNetworkStats>({
    blockNumber: 0,
    gasPriceGwei: 0,
    ethPriceUsd: 0,
    rpcLatencyMs: 0,
    isOnline: false,
    lastUpdated: Date.now(),
  });

  // Thesis
  const [theses, setTheses] = useState<TradingThesis[]>(INITIAL_THESES);
  const [activeThesis, setActiveThesis] = useState<TradingThesis | null>(INITIAL_THESES[0] ?? null);

  // Sidebar & Navigation
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);

  // Wallet
  const [wallet, setWallet] = useState<WalletState>({
      isConnected: false,
      address: '',
      type: 'none',
      ethBalance: 0,
      stablecoinBalances: {},
      networkId: BASE_CHAIN_ID_DEC,
      isBiometricProtected: isBiometricEnrolled(),
  });
  const walletProviderRef = useRef<Eip1193Provider | null>(null);
  const walletRestoreStartedRef = useRef(false);

  // Portfolio tracking
  const [portfolio, setPortfolio] = useState<PortfolioAsset[]>([]);
  const [isPortfolioRefreshing, setIsPortfolioRefreshing] = useState(false);
  const [portfolioError, setPortfolioError] = useState<string | null>(null);
  const [portfolioLastSyncedAt, setPortfolioLastSyncedAt] = useState<number | null>(null);
  const portfolioScanIdRef = useRef(0);
  const portfolioScanInProgressRef = useRef(false);
  const tokenRegistryRef = useRef(tokens);
  const observedBuyCountsRef = useRef(new Map<string, number>());

  useEffect(() => {
    tokenRegistryRef.current = tokens;
  }, [tokens]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(ACTIVE_TOKEN_SESSION_KEY, JSON.stringify(activeToken));
    } catch {
      // Session storage can be unavailable in restricted browser contexts.
    }
  }, [activeToken]);

  // Settings
  const [slippage, setSlippage] = useState<number>(1.0); // 1.0% default
  const [gasSpeed, setGasSpeed] = useState<number>(5); // 5 Gwei fast default
  const [oneClickEnabled, setOneClickEnabled] = useState<boolean>(true);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  // Biometrics
  const [isBiometricEnrolledState, setIsBiometricEnrolledState] = useState<boolean>(() => isBiometricEnrolled());
  const [isBiometricLocked, setIsBiometricLocked] = useState<boolean>(false);
  const [requireBiometricThreshold] = useState<number>(1.0); // 1.0 ETH threshold

  // Modals
  const [isPortfolioOpen, setIsPortfolioOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isBiometricModalOpen, setIsBiometricModalOpen] = useState(false);
  const [isThesisModalOpen, setIsThesisModalOpen] = useState(false);
  const [isWalletConnectModalOpen, setIsWalletConnectModalOpen] = useState(false);
  const [pendingTradeAction, setPendingTradeAction] = useState<(() => void) | null>(null);

  // Trades
  const [recentTrades, setRecentTrades] = useState<Trade[]>([]);
  const [pendingPlatformFees, setPendingPlatformFees] = useState<PendingPlatformFee[]>([]);
  const [recentBuyTimestamps, setRecentBuyTimestamps] = useState<Record<string, number>>({});
  const refreshActivePoolDataRef = useRef<() => Promise<boolean>>(async () => false);

  useEffect(() => {
    setPendingPlatformFees(readPendingPlatformFees());
  }, []);

  const payPendingPlatformFee = useCallback(async (feeId: string): Promise<string> => {
    const fee = pendingPlatformFees.find((item) => item.id === feeId);
    if (!fee) throw new Error('Pending fee not found.');
    if (!walletProviderRef.current || !wallet.address) {
      throw new Error('Connect the wallet that performed the swap to pay the pending fee.');
    }
    try {
      const result = await submitPendingPlatformFee(fee, walletProviderRef.current, wallet.address);
      return result.feeTxHash;
    } finally {
      setPendingPlatformFees(readPendingPlatformFees());
    }
  }, [pendingPlatformFees, wallet.address]);

  const refreshActivePoolData = useCallback(() => refreshActivePoolDataRef.current(), []);

  const recordRecentBuy = useCallback((tokenId: string, timestamp: number) => {
    setRecentBuyTimestamps((previous) => {
      if (timestamp <= (previous[tokenId] || 0)) return previous;
      return { ...previous, [tokenId]: timestamp };
    });
  }, []);

  // Alerts
  const [alerts, setAlerts] = useState<PushAlert[]>([]);

  // Sync sound setting
  useEffect(() => {
    sound.setEnabled(soundEnabled);
  }, [soundEnabled]);

  // Refresh live on-chain stats from Base JSON-RPC and the ETH price feed
  const refreshNetworkStats = useCallback(async () => {
    try {
      const stats = await fetchLiveBaseStats();
      setNetworkStats(stats);
    } catch (e) {
      console.warn('Base network stats fetch error:', e);
    }
  }, []);

  useEffect(() => {
    refreshNetworkStats();
    const interval = setInterval(refreshNetworkStats, 15_000);
    return () => clearInterval(interval);
  }, [refreshNetworkStats]);

  // Fetch real on-chain Bankr tokens from Bankr API with tab sorting
  const refreshBankrTokens = useCallback(async (selectedTab: BankrTab = 'trending') => {
    try {
      const liveTokens = await fetchBankrTokens(selectedTab);
      if (liveTokens && liveTokens.length > 0) {
        const mergeRegistryToken = (token: Token, previous?: Token): Token => {
          if (!previous) return token;
          return {
            ...token,
            priceUsd: token.priceUsd > 0 ? token.priceUsd : previous.priceUsd,
            priceEth: token.priceEth > 0 ? token.priceEth : previous.priceEth,
            change5m: token.change5m !== 0 ? token.change5m : previous.change5m,
            change1h: token.change1h !== 0 ? token.change1h : previous.change1h,
            change24h: token.change24h !== 0 ? token.change24h : previous.change24h,
            totalBuys24h: token.totalBuys24h !== 0 ? token.totalBuys24h : previous.totalBuys24h,
            totalSells24h: token.totalSells24h !== 0 ? token.totalSells24h : previous.totalSells24h,
            totalTx24h: token.totalTx24h !== 0 ? token.totalTx24h : previous.totalTx24h,
            liquidityUsd: token.liquidityUsd > 0 ? token.liquidityUsd : previous.liquidityUsd,
            volume24hUsd: token.volume24hUsd > 0 ? token.volume24hUsd : previous.volume24hUsd,
            marketCapUsd: token.marketCapUsd > 0 ? token.marketCapUsd : previous.marketCapUsd,
            liveSnapshotAt: previous.liveSnapshotAt,
            // A response from before the server loaded DexScreener profiles keeps the known ones.
            socials: token.socials?.source === 'dexscreener' || previous.socials?.source !== 'dexscreener' ? token.socials : previous.socials,
            logo: previous.logo && /(^|\.)dexscreener\.com\//.test(previous.logo.replace(/^https:\/\//, '')) ? previous.logo : token.logo,
            dexscreenerPaidInfo: token.dexscreenerPaidInfo.hasPaid !== null ? token.dexscreenerPaidInfo : previous.dexscreenerPaidInfo,
          };
        };
        setTokens((previousTokens) => {
          const previousByAddress = new Map(previousTokens.map((token) => [token.address.toLowerCase(), token]));
          const merged = liveTokens.map((token) => mergeRegistryToken(token, previousByAddress.get(token.address.toLowerCase())));
          // Keep launches the fast new-token poll added that this (older) catalog copy lacks yet.
          const catalogNewest = liveTokens.reduce((latest, token) => Math.max(latest, Date.parse(token.createdAt) || 0), 0);
          const liveAddresses = new Set(liveTokens.map((token) => token.address.toLowerCase()));
          const newerLaunches = previousTokens.filter((token) =>
            !liveAddresses.has(token.address.toLowerCase()) && (Date.parse(token.createdAt) || 0) > catalogNewest
          );
          return newerLaunches.length > 0 ? [...newerLaunches, ...merged] : merged;
        });
        setActiveToken((prev) => {
          const matchingToken = liveTokens.find((token) => token.address.toLowerCase() === prev.address.toLowerCase());
          return matchingToken ? mergeRegistryToken(matchingToken, prev) : prev.externalSource ? prev : liveTokens[0];
        });
      }
    } catch (err) {
      console.info('Live Bankr tokens sync note:', err);
    }
  }, []);

  const refreshTokenMarketData = useCallback(async (selectedTokens: Token[], force = false) => {
    if (selectedTokens.length === 0) return;
    const previousByAddress = new Map(tokenRegistryRef.current.map((token) => [token.address.toLowerCase(), token]));
    const tokensNeedingRefresh = selectedTokens.filter((token) => {
      const previous = previousByAddress.get(token.address.toLowerCase());
      return force || !previous?.liveSnapshotAt || Date.now() - previous.liveSnapshotAt >= MARKET_SNAPSHOT_REUSE_MS;
    });
    if (tokensNeedingRefresh.length === 0) return;

    try {
      const enrichedTokens = await enrichTokenMarketData(tokensNeedingRefresh);
      const enrichedByAddress = new Map(enrichedTokens.map((token) => [token.address.toLowerCase(), token]));
      const observedBuyCounts = new Map(observedBuyCountsRef.current);
      const newlyBoughtTokenIds: string[] = [];

      for (const token of enrichedTokens) {
        const address = token.address.toLowerCase();
        const previousToken = previousByAddress.get(address);
        const hasFreshSnapshot = Boolean(
          token.liveSnapshotAt && token.liveSnapshotAt !== previousToken?.liveSnapshotAt
        );
        if (!hasFreshSnapshot) continue;

        const previousBuyCount = observedBuyCounts.get(address);
        if (previousBuyCount !== undefined && token.totalBuys24h > previousBuyCount) {
          newlyBoughtTokenIds.push(token.id);
        }
        observedBuyCounts.set(address, token.totalBuys24h);
      }

      observedBuyCountsRef.current = observedBuyCounts;
      if (newlyBoughtTokenIds.length > 0) {
        const observedAt = Date.now();
        setRecentBuyTimestamps((previous) => {
          const next = { ...previous };
          newlyBoughtTokenIds.forEach((tokenId) => {
            next[tokenId] = Math.max(next[tokenId] || 0, observedAt);
          });
          return next;
        });
      }

      setTokens((previous) => previous.map((token) => enrichedByAddress.get(token.address.toLowerCase()) || token));
      setActiveToken((previous) => enrichedByAddress.get(previous.address.toLowerCase()) || previous);
    } catch (error) {
      console.info('Market data refresh failed; retaining last successful values:', error);
    }
  }, []);

  const refreshPortfolio = useCallback(async () => {
    if (!wallet.isConnected || !wallet.address || wallet.networkId !== BASE_CHAIN_ID_DEC) return;
    if (portfolioScanInProgressRef.current) return;

    const scanId = ++portfolioScanIdRef.current;
    portfolioScanInProgressRef.current = true;
    setIsPortfolioRefreshing(true);
    setPortfolioError(null);

    try {
      const ethBalancePromise = fetchAddressEthBalance(wallet.address).then((ethBalance) => {
        if (scanId === portfolioScanIdRef.current) {
          setWallet((previous) => previous.address === wallet.address ? { ...previous, ethBalance } : previous);
        }
      });
      const stablecoinBalancesPromise = Promise.all(BASE_STABLECOINS.map(async ({ address, symbol }) => {
        try {
          const balance = await fetchAddressTokenBalance(wallet.address, address);
          if (scanId === portfolioScanIdRef.current) {
            setWallet((previous) => previous.address === wallet.address
              ? {
                  ...previous,
                  stablecoinBalances: {
                    ...previous.stablecoinBalances,
                    [address.toLowerCase()]: balance,
                  },
                }
              : previous);
          }
        } catch (error) {
          console.warn(`${symbol} balance refresh failed:`, error);
        }
      }));
      const [holdings] = await Promise.all([
        fetchWalletTokenHoldings(wallet.address, tokenRegistryRef.current),
        ethBalancePromise,
        stablecoinBalancesPromise,
      ]);
      if (scanId !== portfolioScanIdRef.current) return;

      setPortfolio(holdings.map(({ token, balance }) => ({
        tokenId: token.id,
        symbol: token.symbol,
        name: token.name,
        logo: token.logo,
        balance,
        avgBuyPriceUsd: token.priceUsd,
        currentPriceUsd: token.priceUsd,
        currentValueUsd: token.priceUsd > 0 ? balance * token.priceUsd : 0,
        pnlUsd: 0,
        pnlPercentage: 0,
      })));
      setPortfolioLastSyncedAt(Date.now());
    } catch (error) {
      if (scanId === portfolioScanIdRef.current) {
        console.warn('Wallet portfolio scan failed:', error);
        setPortfolioError('Token balances could not be loaded. Check your network connection and try again.');
      }
    } finally {
      if (scanId === portfolioScanIdRef.current) {
        portfolioScanInProgressRef.current = false;
        setIsPortfolioRefreshing(false);
      }
    }
  }, [tokenRegistryAddressKey, wallet.address, wallet.isConnected, wallet.networkId]);

  useEffect(() => {
    if (!wallet.isConnected || wallet.networkId !== BASE_CHAIN_ID_DEC) {
      portfolioScanIdRef.current += 1;
      portfolioScanInProgressRef.current = false;
      setPortfolio([]);
      setIsPortfolioRefreshing(false);
      setPortfolioError(null);
      setPortfolioLastSyncedAt(null);
      return;
    }

    void refreshPortfolio();
    const intervalId = window.setInterval(() => void refreshPortfolio(), 300_000);
    return () => window.clearInterval(intervalId);
  }, [wallet.address, wallet.isConnected, wallet.networkId, refreshPortfolio]);

  useEffect(() => {
    let timeoutId: number | undefined;
    let active = true;
    let lastFullRefreshAt = 0;

    const refreshRegistry = async () => {
      if (!active || document.visibilityState !== 'visible') return;
      lastFullRefreshAt = Date.now();
      await refreshBankrTokens('trending');
      if (active) timeoutId = window.setTimeout(refreshRegistry, REGISTRY_REFRESH_MS);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      window.clearTimeout(timeoutId);
      const dueIn = lastFullRefreshAt + REGISTRY_REFRESH_MS - Date.now();
      // Returning to the tab: only re-download the full list when it is due; new launches are
      // fetched right away through the small poll.
      if (dueIn <= 0) {
        void refreshRegistry();
      } else {
        timeoutId = window.setTimeout(refreshRegistry, dueIn);
        void pollNewTokens();
      }
    };

    void refreshRegistry();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Fast path for new launches: add tokens launched after the newest one already listed.
    const pollNewTokens = async () => {
      if (!active || document.visibilityState !== 'visible') return;
      const newest = tokenRegistryRef.current.reduce((latest, token) => Math.max(latest, Date.parse(token.createdAt) || 0), 0);
      if (newest <= 0) return;
      try {
        const fresh = await fetchNewBankrTokens(newest);
        if (!active || fresh.length === 0) return;
        setTokens((previous) => {
          const known = new Set(previous.map((token) => token.address.toLowerCase()));
          const added = fresh.filter((token) => !known.has(token.address.toLowerCase()));
          return added.length > 0 ? [...added, ...previous] : previous;
        });
      } catch {
        // The full registry refresh will still pick the token up.
      }
    };
    const newTokensIntervalId = window.setInterval(() => void pollNewTokens(), NEW_TOKENS_POLL_MS);
    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.clearInterval(newTokensIntervalId);
    };
  }, [refreshBankrTokens]);

  const ethPriceRef = useRef(networkStats.ethPriceUsd);
  useEffect(() => {
    ethPriceRef.current = networkStats.ethPriceUsd;
  }, [networkStats.ethPriceUsd]);

  useEffect(() => {
    const poolAddress = activeToken.poolAddress;
    const tokenAddress = activeToken.address.toLowerCase();
    const tokenChain = activeToken.chain ?? 'base';
    if (!poolAddress) {
      refreshActivePoolDataRef.current = async () => false;
      return;
    }

    let isActive = true;
    let isFetching = false;
    let inFlightUpdate: Promise<boolean> | undefined;
    let timeoutId: number | undefined;
    let controller: AbortController | undefined;

    const updatePoolData = (): Promise<boolean> => {
      if (!isActive || document.visibilityState !== 'visible') return Promise.resolve(false);
      if (inFlightUpdate) return inFlightUpdate;
      isFetching = true;
      controller = new AbortController();

      const request = (async (): Promise<boolean> => {
        try {
          const [snapshotResult, tradesResult] = await Promise.allSettled([
            fetchBankrPoolSnapshot(poolAddress, tokenAddress, controller!.signal, tokenChain),
            fetchBankrPoolTrades(poolAddress, tokenAddress, controller!.signal, tokenChain),
          ]);

          if (!isActive) return false;

          if (snapshotResult.status === 'fulfilled' && snapshotResult.value) {
            const snapshot = snapshotResult.value;
            const updateToken = (token: Token): Token => ({
              ...token,
              priceUsd: snapshot.priceUsd,
              priceEth: snapshot.priceUsd / Math.max(ethPriceRef.current, 1),
              marketCapUsd: snapshot.marketCapUsd ?? token.marketCapUsd,
              liveSnapshotAt: Date.now(),
              poolTokenIsBase: snapshot.poolTokenIsBase,
              quoteLogo: snapshot.quoteLogo ?? token.quoteLogo,
              liquidityUsd: snapshot.liquidityUsd,
              volume24hUsd: snapshot.volume24hUsd,
              change5m: snapshot.change5m ?? token.change5m,
              change1h: snapshot.change1h ?? token.change1h,
              change24h: snapshot.change24h ?? token.change24h,
              totalBuys24h: snapshot.totalBuys24h ?? token.totalBuys24h,
              totalSells24h: snapshot.totalSells24h ?? token.totalSells24h,
              totalTx24h: snapshot.totalTx24h ?? token.totalTx24h,
            });

            setTokens((previous) => previous.map((token) =>
              token.address.toLowerCase() === tokenAddress ? updateToken(token) : token
            ));
            setActiveToken((previous) =>
              previous.address.toLowerCase() === tokenAddress ? updateToken(previous) : previous
            );
          }

          if (tradesResult.status !== 'fulfilled') return false;

          const ethPriceUsd = Math.max(ethPriceRef.current, 1);
          const trades: Trade[] = tradesResult.value.map((trade) => {
            const amountEth = trade.amountUsd / ethPriceUsd;
            return {
              id: trade.id,
              tokenId: activeToken.id,
              type: trade.type,
              priceUsd: trade.priceUsd,
              amountToken: trade.amountToken,
              amountEth,
              amountUsd: trade.amountUsd,
              wallet: trade.wallet,
              timestamp: trade.timestamp,
              txHash: trade.txHash,
            };
          });

          setRecentTrades(trades);
          const latestBuyAt = trades.reduce((latest, trade) =>
            trade.type === 'buy' ? Math.max(latest, trade.timestamp) : latest, 0);
          if (latestBuyAt > 0) {
            setRecentBuyTimestamps((previous) => ({
              ...previous,
              [activeToken.id]: Math.max(previous[activeToken.id] || 0, latestBuyAt),
            }));
          }
          return true;
        } catch {
          return false;
        } finally {
          isFetching = false;
          inFlightUpdate = undefined;
          if (isActive && document.visibilityState === 'visible') {
            timeoutId = window.setTimeout(() => void updatePoolData(), 60_000);
          }
        }
      })();

      inFlightUpdate = request;
      return request;
    };

    const refreshCurrentPoolData = () => {
      window.clearTimeout(timeoutId);
      return updatePoolData();
    };
    refreshActivePoolDataRef.current = refreshCurrentPoolData;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !isFetching) {
        window.clearTimeout(timeoutId);
        void updatePoolData();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    void updatePoolData();

    return () => {
      isActive = false;
      if (refreshActivePoolDataRef.current === refreshCurrentPoolData) {
        refreshActivePoolDataRef.current = async () => false;
      }
      window.clearTimeout(timeoutId);
      controller?.abort();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [activeToken.id, activeToken.address, activeToken.poolAddress, activeToken.symbol]);

  // Add alert helper
  const addAlert = useCallback(
    (alert: Omit<PushAlert, 'id' | 'timestamp' | 'read'>) => {
      const newAlert: PushAlert = {
        ...alert,
        id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        read: false,
      };
      setAlerts((prev) => [newAlert, ...prev.slice(0, 19)]);
    },
    []
  );

  const markAlertsAsRead = useCallback(() => {
    setAlerts((prev) => prev.map((a) => ({ ...a, read: true })));
  }, []);

  const clearAlerts = useCallback(() => {
    setAlerts([]);
  }, []);

  // Connect wallet via injected Web3 (MetaMask, Trust, Binance Web3)
  const connectWallet = useCallback(async (_type: 'injected', provider?: Eip1193Provider) => {
    const account = await connectInjectedWeb3(provider);
    if (!account) return false;
    walletProviderRef.current = provider || (typeof window === 'undefined' ? null : window.okxwallet || window.ethereum || null);
    try {
      window.localStorage.setItem(WALLET_PROVIDER_STORAGE_KEY, provider ? 'walletconnect' : 'injected');
    } catch {
      // Wallet restoration is best-effort when browser storage is unavailable.
    }
    setWallet({
      isConnected: true,
      address: account.address,
      type: 'injected',
      ethBalance: account.ethBalance,
      stablecoinBalances: {},
      networkId: account.networkId,
      isBiometricProtected: isBiometricEnrolled(),
    });
    sound.playSuccess();
    return true;
  }, []);

  // Connect by entering any real Base address (queries the balance on-chain via Base RPC)
  const connectByCustomAddress = useCallback(async (address: string): Promise<boolean> => {
    if (!address.startsWith('0x') || address.length !== 42) {
      return false;
    }
    const onChainBal = await fetchAddressEthBalance(address);
    setWallet({
      isConnected: true,
      address,
      type: 'injected',
      ethBalance: onChainBal,
      stablecoinBalances: {},
      networkId: BASE_CHAIN_ID_DEC,
      isBiometricProtected: isBiometricEnrolled(),
    });
    try {
      localStorage.setItem('bankrdex_wallet_addr', address);
      localStorage.removeItem(WALLET_PROVIDER_STORAGE_KEY);
    } catch {
      // Address watching still works when browser storage is unavailable.
    }
    sound.playSuccess();
    return true;
  }, []);

  const disconnectWallet = useCallback(() => {
    const activeProvider = walletProviderRef.current;
    walletProviderRef.current = null;
    if (activeProvider?.disconnect) void activeProvider.disconnect().catch(() => undefined);
    try {
      window.localStorage.removeItem(WALLET_PROVIDER_STORAGE_KEY);
      window.localStorage.removeItem('bankrdex_wallet_addr');
    } catch {
      // Browser storage may be unavailable.
    }
    setWallet({
      isConnected: false,
      address: '',
      type: 'none',
      ethBalance: 0,
      stablecoinBalances: {},
      networkId: BASE_CHAIN_ID_DEC,
      isBiometricProtected: false,
    });
  }, []);

  useEffect(() => {
    if (walletRestoreStartedRef.current) return;
    walletRestoreStartedRef.current = true;

    const restoreWalletSession = async () => {
      let provider: Eip1193Provider | null = null;
      let walletConnectSession: WalletConnectProvider | null = null;
      let savedProvider: string | null = null;
      try {
        savedProvider = window.localStorage.getItem(WALLET_PROVIDER_STORAGE_KEY);
      } catch {
        // Restore injected wallets even when browser storage is unavailable.
      }

      if (savedProvider === 'walletconnect') {
        try {
          walletConnectSession = await getWalletConnectProvider();
          if (!walletConnectSession.session) {
            window.localStorage.removeItem(WALLET_PROVIDER_STORAGE_KEY);
            return;
          }
          provider = toEip1193Provider(walletConnectSession);
        } catch (error) {
          console.warn('WalletConnect session restore failed:', error);
          return;
        }
      } else if (savedProvider === 'injected' || !savedProvider) {
        provider = window.okxwallet || window.ethereum || null;
      }

      if (!provider) return;

      try {
        let accounts: string[] = [];
        try {
          const requestedAccounts = await provider.request({ method: 'eth_accounts' });
          if (Array.isArray(requestedAccounts)) accounts = requestedAccounts as string[];
        } catch {
          accounts = [];
        }
        if (accounts.length === 0) accounts = walletConnectSession?.accounts || [];
        if (!accounts[0]) return;

        let chainId: unknown;
        try {
          chainId = await provider.request({ method: 'eth_chainId' });
        } catch {
          chainId = walletConnectSession?.chainId;
        }
        const parsedChainId = typeof chainId === 'string'
          ? chainId.startsWith('0x') ? Number.parseInt(chainId, 16) : Number(chainId)
          : Number(chainId);
        const networkId = Number.isFinite(parsedChainId) && parsedChainId > 0
          ? parsedChainId
          : walletConnectSession?.chainId || BASE_CHAIN_ID_DEC;

        const address = accounts[0];
        let ethBalance = 0;
        try {
          const balanceHex = (await provider.request({
            method: 'eth_getBalance',
            params: [address, 'latest'],
          })) as string;
          ethBalance = Number(BigInt(balanceHex)) / 1e18;
        } catch {
          ethBalance = await fetchAddressEthBalance(address);
        }
        walletProviderRef.current = provider;
        setWallet({
          isConnected: true,
          address,
          type: 'injected',
          ethBalance,
          stablecoinBalances: {},
          networkId,
          isBiometricProtected: isBiometricEnrolled(),
        });
      } catch (error) {
        console.warn('Wallet session restore failed:', error);
      }
    };

    void restoreWalletSession();
  }, []);

  useEffect(() => {
    if (wallet.type !== 'injected') return;
    const provider = walletProviderRef.current || (typeof window === 'undefined' ? undefined : window.okxwallet || window.ethereum);
    if (!provider?.on) return;

    const handleAccountsChanged = (accounts: unknown) => {
      const nextAddress = Array.isArray(accounts) ? String(accounts[0] || '') : '';
      if (!nextAddress) {
        disconnectWallet();
        return;
      }
      void fetchAddressEthBalance(nextAddress).then((ethBalance) => {
        setWallet((previous) => ({
          ...previous,
          address: nextAddress,
          ethBalance,
          isConnected: true,
        }));
      });
    };

    const handleChainChanged = (chainId: unknown) => {
      const numericChainId = typeof chainId === 'string'
        ? chainId.startsWith('0x') ? Number.parseInt(chainId, 16) : Number(chainId)
        : Number(chainId);
      if (numericChainId !== BASE_CHAIN_ID_DEC) disconnectWallet();
    };

    const handleProviderDisconnect = () => {
      if (walletProviderRef.current === provider) disconnectWallet();
    };

    provider.on('accountsChanged', handleAccountsChanged);
    provider.on('chainChanged', handleChainChanged);
    provider.on('disconnect', handleProviderDisconnect);
    provider.on('session_delete', handleProviderDisconnect);
    return () => {
      provider.removeListener?.('accountsChanged', handleAccountsChanged);
      provider.removeListener?.('chainChanged', handleChainChanged);
      provider.removeListener?.('disconnect', handleProviderDisconnect);
      provider.removeListener?.('session_delete', handleProviderDisconnect);
    };
  }, [disconnectWallet, wallet.type]);

  // Thesis management
  const createThesis = useCallback(
    (newTh: Omit<TradingThesis, 'id' | 'likes' | 'createdAt'>) => {
      const created: TradingThesis = {
        ...newTh,
        id: `th-${Date.now()}`,
        likes: 1,
        createdAt: Date.now(),
      };
      setTheses((prev) => [created, ...prev]);
      setActiveThesis(created);
      sound.playSuccess();
      addAlert({
        title: `New trading thesis: $${created.tokenSymbol}`,
        message: `${created.author} published a thesis: "${created.title}" with a target of $${created.targetPriceUsd}`,
        type: 'pump',
      });
    },
    [addAlert]
  );

  const likeThesis = useCallback((thesisId: string) => {
    setTheses((prev) =>
      prev.map((th) => (th.id === thesisId ? { ...th, likes: th.likes + 1 } : th))
    );
  }, []);

  // Biometrics handlers
  const completeUnlock = useCallback(() => {
    setIsBiometricLocked(false);
    setIsBiometricModalOpen(false);
    sound.playSuccess();
    if (pendingTradeAction) {
      pendingTradeAction();
      setPendingTradeAction(null);
    }
  }, [pendingTradeAction]);

  const unlockWalletWithBiometrics = useCallback(async (): Promise<boolean> => {
    const success = await authenticateWithBiometrics();
    if (success) completeUnlock();
    return success;
  }, [completeUnlock]);

  const unlockWithPin = useCallback(async (pin: string): Promise<PinCheckResult> => {
    const result = await verifyPin(pin);
    if (result.ok) completeUnlock();
    return result;
  }, [completeUnlock]);

  const enableBiometrics = useCallback(async (): Promise<boolean> => {
    const success = await enrollBiometrics();
    if (success) {
      setBiometricEnrolled(true);
      setIsBiometricEnrolledState(true);
      setWallet((prev) => ({ ...prev, isBiometricProtected: true }));
      sound.playSuccess();
      return true;
    }
    return false;
  }, []);

  const disableBiometrics = useCallback(() => {
    setBiometricEnrolled(false);
    setIsBiometricEnrolledState(false);
    setIsBiometricLocked(false);
    setWallet((prev) => ({ ...prev, isBiometricProtected: false }));
  }, []);

  const triggerBiometricLock = useCallback(() => {
    setIsBiometricLocked(true);
    setIsBiometricModalOpen(true);
  }, []);

  const sendWalletTransaction = useCallback(async (transaction: PreparedTransaction, chain: ChainKey = 'base') => {
    const provider = walletProviderRef.current || (typeof window === 'undefined' ? undefined : window.okxwallet || window.ethereum);
    if (!provider || !wallet.isConnected || wallet.type === 'internal' || !wallet.address) {
      throw new Error('Connect a Base wallet first.');
    }
    return sendPreparedTransaction(provider, wallet.address, transaction, chain);
  }, [wallet.address, wallet.isConnected, wallet.type]);

  const walletRequest = useCallback(async (method: string, params: unknown[] = []) => {
    const provider = walletProviderRef.current || (typeof window === 'undefined' ? undefined : window.okxwallet || window.ethereum);
    if (!provider || !wallet.isConnected || !wallet.address) throw new Error('Connect a Base wallet first.');
    return provider.request({ method, params });
  }, [wallet.address, wallet.isConnected]);

  // Execute trade (Swap ETH <-> Token with real Web3 execution)
  const executeTrade = useCallback(
    async (
      tokenId: string,
      type: 'buy' | 'sell',
      ethAmount: number,
      tokenAmount: number,
      payTokenAddress?: string,
      payTokenAmount?: number,
      _slippageTolerancePercent?: number,
      _poolAddress?: string,
      onProgress?: (message: string) => void,
      swapTransactions?: FeeProtectedSwapTransactions,
      receiveTokenAddress?: string
    ): Promise<{ success: boolean; message: string; txHash?: string; feeTxHash?: string; pendingPlatformFee?: PendingPlatformFee }> => {
      if (!wallet.isConnected || !wallet.address) {
        return {
          success: false,
          message: 'Connect a ETH wallet before swapping.',
        };
      }
      if (!swapTransactions || swapTransactions.feeIncluded !== true) {
        return {
          success: false,
          message: 'Swap cancelled: this route cannot include the 0.1% fee in the same transaction. No transaction was sent.',
        };
      }

      const currentToken = tokens.find((t) => t.id === tokenId) || activeToken;
      const outputAddress = receiveTokenAddress || (type === 'buy' ? currentToken.address : 'native');
      const inputAmount = payTokenAmount ?? (type === 'sell' ? tokenAmount : ethAmount);
      const stablecoin = getBaseStablecoin(payTokenAddress);
      const outputStablecoin = type === 'sell' ? getBaseStablecoin(outputAddress) : undefined;
      const payToken = payTokenAddress
        ? tokens.find((token) => token.address.toLowerCase() === payTokenAddress.toLowerCase())
        : null;
      const outputPortfolioToken = type === 'sell' && outputAddress.toLowerCase() !== 'native' && !outputStablecoin
        ? tokens.find((token) => token.address.toLowerCase() === outputAddress.toLowerCase()) ||
          (currentToken.quoteAddress?.toLowerCase() === outputAddress.toLowerCase()
            ? {
                id: `pair-${outputAddress.toLowerCase()}`,
                symbol: currentToken.quoteSymbol || 'PAIR',
                name: currentToken.quoteSymbol || 'Pair token',
                address: outputAddress,
                logo: currentToken.quoteLogo || '',
                priceUsd: currentToken.quoteSymbol && ['USDT', 'USDC', 'USDBC', 'DAI'].includes(currentToken.quoteSymbol.toUpperCase())
                  ? 1
                  : 0,
              }
            : null)
        : null;
      const payBalance = stablecoin
        ? wallet.stablecoinBalances[stablecoin.address.toLowerCase()] ?? 0
        : payToken
          ? (portfolio.find((asset) => asset.tokenId === payToken.id)?.balance ?? 0)
          : 0;
      const payTokenSymbol = payToken?.symbol || stablecoin?.symbol || '';
      const gasPriceGwei = Number.isFinite(networkStats.gasPriceGwei) && networkStats.gasPriceGwei > 0 ? networkStats.gasPriceGwei : 0.01;
      const gasLimitUnits = payTokenAddress ? 420_000 : 260_000;
      const estimatedGasEth = (gasPriceGwei * gasLimitUnits) / 1e9;

      // Check biometric requirement for large trades
      if (wallet.isBiometricProtected && ethAmount >= requireBiometricThreshold && isBiometricLocked) {
        setIsBiometricModalOpen(true);
        return {
          success: false,
          message: translations[lang].requireAuthForTrade,
        };
      }

      const nativeInputAmount = type === 'buy' && !payTokenAddress ? ethAmount : 0;
      if (wallet.ethBalance < estimatedGasEth + nativeInputAmount) {
        return {
          success: false,
          message: translations[lang].insufficientFunds,
        };
      }

      if (type === 'buy' && payTokenAddress && payBalance < inputAmount) {
        return {
          success: false,
          message: `Insufficient ${payTokenSymbol || 'token'} balance for this swap.`,
        };
      }

      if (type === 'sell') {
        const tokenBalance = portfolio.find((asset) => asset.tokenId === tokenId)?.balance ?? 0;
        if (tokenBalance < inputAmount) {
          return {
            success: false,
            message: `Insufficient ${currentToken.symbol} balance for this swap.`,
          };
        }
      }

      if (wallet.ethBalance < estimatedGasEth) {
        return {
          success: false,
          message: translations[lang].insufficientFunds,
        };
      }

      // Real Web3 execution on Base
      const web3Result = await executeFeeProtectedAggregatorSwap(
        swapTransactions,
        wallet.address,
        outputAddress,
        walletProviderRef.current || undefined,
        onProgress
      );

      if (!web3Result.success) {
        return {
          success: false,
          message: web3Result.message,
          txHash: web3Result.txHash,
          feeTxHash: web3Result.feeTxHash,
        };
      }
      setPendingPlatformFees(readPendingPlatformFees());
      const creditedTokenAmount = type === 'buy'
        ? web3Result.outputAmount ?? tokenAmount
        : tokenAmount;
      const receivedAmount = web3Result.outputAmount ??
        (outputAddress.toLowerCase() === 'native' ? ethAmount : 0);
      const creditedEthAmount = type === 'sell' && outputAddress.toLowerCase() === 'native'
        ? web3Result.outputAmount ?? ethAmount
        : ethAmount;
      const walletEthReceived = type === 'sell' && outputAddress.toLowerCase() === 'native'
        ? web3Result.outputAmount ?? ethAmount
        : 0;
      const actualSwapGasEth = web3Result.swapGasEth ?? estimatedGasEth;
      const actualFeeGasEth = web3Result.feeGasEth ?? 0;

      // Update wallet balance
      setWallet((prev) => ({
        ...prev,
        stablecoinBalances: {
          ...prev.stablecoinBalances,
          ...(type === 'buy' && stablecoin
            ? {
                [stablecoin.address.toLowerCase()]: Math.max(
                  0,
                  (prev.stablecoinBalances[stablecoin.address.toLowerCase()] ?? 0) - inputAmount
                ),
              }
            : {}),
          ...(type === 'sell' && outputStablecoin
            ? {
                [outputStablecoin.address.toLowerCase()]:
                  (prev.stablecoinBalances[outputStablecoin.address.toLowerCase()] ?? 0) + receivedAmount,
              }
            : {}),
        },
        ethBalance:
          type === 'buy'
            ? Math.max(0, prev.ethBalance - (payTokenAddress ? 0 : ethAmount) - actualSwapGasEth - actualFeeGasEth)
            : prev.ethBalance + walletEthReceived - actualSwapGasEth - actualFeeGasEth,
      }));

      // Update portfolio
      setPortfolio((prev) => {
        const portfolioAfterPayment = type === 'buy' && payToken && !stablecoin
          ? prev.map((asset) =>
              asset.tokenId === payToken.id
                ? { ...asset, balance: Math.max(0, asset.balance - inputAmount) }
                : asset
            )
          : prev;
        const existing = portfolioAfterPayment.find((p) => p.tokenId === tokenId);
        if (type === 'buy') {
          if (existing) {
            const newBal = existing.balance + creditedTokenAmount;
            const newAvg = (existing.balance * existing.avgBuyPriceUsd + creditedTokenAmount * currentToken.priceUsd) / newBal;
            return portfolioAfterPayment.map((p) =>
              p.tokenId === tokenId
                ? {
                    ...p,
                    balance: newBal,
                    avgBuyPriceUsd: newAvg,
                    currentPriceUsd: currentToken.priceUsd,
                    currentValueUsd: newBal * currentToken.priceUsd,
                    pnlUsd: newBal * (currentToken.priceUsd - newAvg),
                    pnlPercentage: ((currentToken.priceUsd - newAvg) / newAvg) * 100,
                  }
                : p
            );
          } else {
            return [
              ...portfolioAfterPayment,
              {
                tokenId,
                symbol: currentToken.symbol,
                name: currentToken.name,
                logo: currentToken.logo,
                balance: creditedTokenAmount,
                avgBuyPriceUsd: currentToken.priceUsd,
                currentPriceUsd: currentToken.priceUsd,
                currentValueUsd: creditedTokenAmount * currentToken.priceUsd,
                pnlUsd: 0,
                pnlPercentage: 0,
              },
            ];
          }
        } else {
          const newBal = Math.max(0, (existing?.balance ?? 0) - tokenAmount);
          const remainingPortfolio = !existing
            ? prev
            : newBal === 0
              ? prev.filter((p) => p.tokenId !== tokenId)
              : prev.map((p) =>
            p.tokenId === tokenId
              ? {
                  ...p,
                  balance: newBal,
                  currentPriceUsd: currentToken.priceUsd,
                  currentValueUsd: newBal * currentToken.priceUsd,
                  pnlUsd: newBal * (currentToken.priceUsd - p.avgBuyPriceUsd),
                  pnlPercentage: ((currentToken.priceUsd - p.avgBuyPriceUsd) / p.avgBuyPriceUsd) * 100,
                }
              : p
          );
          if (!outputPortfolioToken) return remainingPortfolio;
          const receivedAsset = remainingPortfolio.find((asset) => asset.tokenId === outputPortfolioToken.id);
          if (receivedAsset) {
            const nextBalance = receivedAsset.balance + receivedAmount;
            return remainingPortfolio.map((asset) =>
              asset.tokenId === outputPortfolioToken.id
                ? {
                    ...asset,
                    balance: nextBalance,
                    currentPriceUsd: outputPortfolioToken.priceUsd,
                    currentValueUsd: nextBalance * outputPortfolioToken.priceUsd,
                  }
                : asset
            );
          }
          return [
            ...remainingPortfolio,
            {
              tokenId: outputPortfolioToken.id,
              symbol: outputPortfolioToken.symbol,
              name: outputPortfolioToken.name,
              logo: outputPortfolioToken.logo,
              balance: receivedAmount,
              avgBuyPriceUsd: outputPortfolioToken.priceUsd,
              currentPriceUsd: outputPortfolioToken.priceUsd,
              currentValueUsd: receivedAmount * outputPortfolioToken.priceUsd,
              pnlUsd: 0,
              pnlPercentage: 0,
            },
          ];
        }
      });

      // Sound feedback
      if (type === 'buy') {
        sound.playBuy();
      } else {
        sound.playSell();
      }

      // Add to live trade log
      const newTrade: Trade = {
        id: `tx-${Date.now()}`,
        tokenId,
        type,
        priceUsd: currentToken.priceUsd,
        amountToken: creditedTokenAmount,
        amountEth: creditedEthAmount,
        amountUsd: creditedEthAmount * networkStats.ethPriceUsd,
        wallet: wallet.address || '0x4f12...b901',
        timestamp: Date.now(),
        txHash: web3Result.txHash,
      };

      setRecentTrades((prev) => [newTrade, ...prev.slice(0, 49)]);
      if (type === 'buy') {
        setRecentBuyTimestamps((previous) => ({
          ...previous,
          [tokenId]: Math.max(previous[tokenId] || 0, newTrade.timestamp),
        }));
      }

      return {
        success: true,
        txHash: web3Result.txHash,
        feeTxHash: web3Result.feeTxHash,
        pendingPlatformFee: web3Result.pendingPlatformFee,
        message: `${type === 'buy' ? 'Bought' : 'Sold'} ${creditedTokenAmount.toLocaleString('en-US')} $${currentToken.symbol} confirmed on Base.${web3Result.message ? ` ${web3Result.message}` : ''}`,
      };
    },
    [
      wallet,
      tokens,
      activeToken,
      lang,
      connectWallet,
      isBiometricLocked,
      requireBiometricThreshold,
      addAlert,
      networkStats.ethPriceUsd,
      slippage,
    ]
  );

  // Compute portfolio totals
  const totalPortfolioValueUsd =
    portfolio.reduce((sum, item) => {
      const currentTokenPrice = tokens.find((token) => token.id === item.tokenId)?.priceUsd;
      return sum + item.balance * (currentTokenPrice || item.currentPriceUsd);
    }, 0) +
    wallet.ethBalance * networkStats.ethPriceUsd +
    Object.values(wallet.stablecoinBalances).reduce((sum, balance) => sum + balance, 0);
  const totalPnlUsd = portfolio.reduce((sum, item) => sum + item.pnlUsd, 0);
  const totalInvested = portfolio.reduce((sum, item) => sum + item.balance * item.avgBuyPriceUsd, 0);
  const totalPnlPercentage = totalInvested > 0 ? (totalPnlUsd / totalInvested) * 100 : 0;

  return (
    <AppContext.Provider
      value={{
        lang,
        setLang,
        theme,
        setTheme,
        t: translations[lang],
        tokens,
        activeToken,
        setActiveToken,
        pendingSwapTokenToSell,
        setPendingSwapTokenToSell,
        refreshBankrTokens,
        refreshTokenMarketData,
        wallet,
        connectWallet,
        connectByCustomAddress,
        disconnectWallet,
        portfolio,
        totalPortfolioValueUsd,
        totalPnlUsd,
        totalPnlPercentage,
        isPortfolioRefreshing,
        portfolioError,
        portfolioLastSyncedAt,
        refreshPortfolio,
        networkStats,
        refreshNetworkStats,
        theses,
        activeThesis,
        setActiveThesis,
        createThesis,
        likeThesis,
        slippage,
        setSlippage,
        gasSpeed,
        setGasSpeed,
        oneClickEnabled,
        setOneClickEnabled,
        soundEnabled,
        setSoundEnabled,
        recentTrades,
        pendingPlatformFees,
        payPendingPlatformFee,
        recentBuyTimestamps,
        recordRecentBuy,
        refreshActivePoolData,
        sendWalletTransaction,
        walletRequest,
        executeTrade,
        isBiometricLocked,
        isBiometricEnrolledState,
        requireBiometricThreshold,
        unlockWalletWithBiometrics,
        unlockWithPin,
        enableBiometrics,
        disableBiometrics,
        triggerBiometricLock,
        alerts,
        addAlert,
        markAlertsAsRead,
        clearAlerts,
        isSidebarOpen,
        setIsSidebarOpen,
        isPortfolioOpen,
        setIsPortfolioOpen,
        isSettingsOpen,
        setIsSettingsOpen,
        isBiometricModalOpen,
        setIsBiometricModalOpen,
        isThesisModalOpen,
        setIsThesisModalOpen,
        isWalletConnectModalOpen,
        setIsWalletConnectModalOpen,
        pendingTradeAction,
        setPendingTradeAction,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
