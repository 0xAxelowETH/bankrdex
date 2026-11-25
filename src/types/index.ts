import type { ChainKey } from '../config/chains';

export type Language = 'en' | 'zh' | 'ja' | 'ko';

export type TokenSource = 'bankr' | 'binance';

export type ActivityWindow = '5m' | '1h' | '4h' | '24h';
export interface ActivityStats {
  volumeUsd: number;
  buys: number;
  sells: number;
  txs: number;
}
export type TokenActivity = Partial<Record<ActivityWindow, ActivityStats>>;
export interface TokenSocials {
  twitter?: string;
  telegram?: string;
  website?: string;
  discord?: string;
  farcaster?: string;
  // Further links (docs, Warpcast page, …) from a DexScreener profile.
  links?: { label: string; url: string }[];
  // 'dexscreener' when the links come from the token's paid DexScreener profile, which then
  // replaces the links given at launch.
  source?: 'dexscreener' | 'launch';
}


// How BankrDex confirmed the token is a Bankr launch (see src/server/bankrVerification.ts).
export type BankrVerification = 'official' | 'bankr-api' | 'registry' | 'onchain';

export interface BankrLaunchInfo {
  verifiedBy?: BankrVerification;
  launchType?: string;
  creatorX?: { username: string; avatar?: string };
  feeRecipient?: string;
  feeRecipientX?: { username: string; avatar?: string };
  tweetUrl?: string;
  txHash?: string;
}

export interface Token {
  id: string;
  // Chain the token lives on (Bankr launches on Base, Robinhood, Arbitrum and Arc). Missing = Base.
  chain?: ChainKey;
  name: string;
  symbol: string;
  address: string;
  poolAddress?: string;
  quoteAddress?: string;
  quoteSymbol?: string;
  quoteLogo?: string;
  poolTokenIsBase?: boolean;
  priceUsd: number;
  priceEth: number;
  change5m: number;
  change1h: number;
  change24h: number;
  volume24hUsd: number;
  liquidityUsd: number;
  marketCapUsd: number;
  liveSnapshotAt?: number;
  bondingCurveProgress: number; // 0-100% Doppler price-discovery progress (Bankr launches trade on Uniswap V4 from block one)
  isGraduated: boolean;
  totalBuys24h: number;
  totalSells24h: number;
  totalTx24h: number;
  holders: number;
  creator: string;
  createdAt: string;
  // Launch time in ms (Bankr launch record or pool creation).
  launchedAt?: number;
  logo: string;
  description: string;
  // 'market' = listed from the Binance Web3 hot feed on Base rather than Bankr.
  externalSource?: 'okx' | 'market';
  // Bankr launch details: creator / fee recipient X profiles, launch tweet and transaction.
  bankr?: BankrLaunchInfo;
  source?: TokenSource;
  externalUrl?: string;
  socials?: TokenSocials;
  // Volume / buys / sells per window, from Binance Web3 price-info.
  activity?: TokenActivity;
  // Last on-chain trade (buy or sell) in ms, from Binance Web3.
  lastTradeAt?: number;
  audit: {
    isHoneypot: boolean | null;
    buyTax: number | null;
    sellTax: number | null;
    isMintable: boolean | null;
    isLpLocked: boolean | null;
    contractVerified: boolean | null;
    riskScore: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
  };
  dexscreenerPaidInfo: {
    hasPaid: boolean | null;
    paidType: 'enhanced_profile' | 'community_takeover' | 'token_boost' | 'unpaid' | 'unknown';
    socialsCount: number;
    hasBanner: boolean | null;
    hasCustomIcon: boolean | null;
    verifiedBadge: boolean | null;
    dexUrl: string;
  };
}

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isUp: boolean;
}

export interface Trade {
  id: string;
  tokenId: string;
  type: 'buy' | 'sell';
  priceUsd: number;
  amountToken: number;
  amountEth: number;
  amountUsd: number;
  wallet: string;
  timestamp: number;
  txHash: string;
}

export interface PendingPlatformFee {
  id: string;
  walletAddress: string;
  feeTokenAddress: string;
  amountRaw: string;
  amount: string;
  decimals: number;
  swapTxHash: string;
  createdAt: number;
  feeTxHash?: string;
}

export interface PortfolioAsset {
  tokenId: string;
  symbol: string;
  name: string;
  logo: string;
  balance: number;
  avgBuyPriceUsd: number;
  currentPriceUsd: number;
  currentValueUsd: number;
  pnlUsd: number;
  pnlPercentage: number;
}

export interface WalletState {
  isConnected: boolean;
  address: string;
  type: 'injected' | 'internal' | 'none'; // MetaMask or Built-in fast sniper wallet
  ethBalance: number;
  stablecoinBalances: Record<string, number>;
  networkId: number; // 8453 for Base mainnet
  isBiometricProtected: boolean;
}

export interface PushAlert {
  id: string;
  title: string;
  message: string;
  type: 'pump' | 'dump' | 'whale' | 'trade' | 'security';
  timestamp: number;
  read: boolean;
}

export interface TradingThesis {
  id: string;
  tokenId: string;
  tokenSymbol: string;
  title: string;
  author: string;
  stance: 'bullish' | 'bearish';
  entryPriceUsd: number;
  targetPriceUsd: number;
  stopLossUsd: number;
  timeframe: string;
  content: string;
  likes: number;
  createdAt: number;
}

export interface BaseNetworkStats {
  blockNumber: number;
  gasPriceGwei: number;
  ethPriceUsd: number;
  rpcLatencyMs: number;
  isOnline: boolean;
  lastUpdated: number;
}
