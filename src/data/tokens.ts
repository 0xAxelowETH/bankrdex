import { Token, TradingThesis } from '../types';

// Last-resort active token while the Bankr catalog loads: BNKR, Bankr's own token on Base.
// Market values are zero until the live snapshot arrives; nothing here is displayed as live data.
export const INITIAL_TOKENS: Token[] = [
  {
    id: 'bankr-bnkr-22af',
    name: 'BankrCoin',
    symbol: 'BNKR',
    address: '0x22af33fe49fd1fa80c7149773dde5890d3c76f3b',
    poolAddress: '0xaec085e5a5ce8d96a7bdd3eb3a62445d4f6ce703',
    quoteAddress: '0x4200000000000000000000000000000000000006',
    quoteSymbol: 'WETH',
    priceUsd: 0,
    priceEth: 0,
    change5m: 0,
    change1h: 0,
    change24h: 0,
    volume24hUsd: 0,
    liquidityUsd: 0,
    marketCapUsd: 0,
    bondingCurveProgress: 100,
    isGraduated: true,
    totalBuys24h: 0,
    totalSells24h: 0,
    totalTx24h: 0,
    holders: 0,
    creator: '',
    createdAt: '',
    logo: 'https://coin-images.coingecko.com/coins/images/52626/large/bankr-static.png',
    description: 'BNKR is the token of Bankr, the AI agent that trades and launches tokens on Base.',
    socials: { twitter: 'https://x.com/bankrbot', website: 'https://bankr.bot' },
    audit: {
      isHoneypot: null,
      buyTax: null,
      sellTax: null,
      isMintable: null,
      isLpLocked: null,
      contractVerified: null,
      riskScore: 'UNKNOWN',
    },
    dexscreenerPaidInfo: {
      hasPaid: null,
      paidType: 'unknown',
      socialsCount: 2,
      hasBanner: null,
      hasCustomIcon: true,
      verifiedBadge: null,
      dexUrl: 'https://dexscreener.com/base/0x22af33fe49fd1fa80c7149773dde5890d3c76f3b',
    },
  },
];

// Trading theses are hidden (FEATURES.tradingThesis) until they have a shared backend.
export const INITIAL_THESES: TradingThesis[] = [];
