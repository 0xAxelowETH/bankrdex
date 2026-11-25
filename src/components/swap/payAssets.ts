import { CHAINS, type ChainKey } from '../../config/chains';
import type { Token } from '../../types';

// What a trade can be paid with (buys) or paid out in (sells), per chain: the native coin, the
// token's pool pair token, stablecoins and the chain's main tokens. Aggregator routes can use any
// of them; the direct pool route only takes the pool's own pair (ETH or the pair token).
export type PayAssetGroup = 'native' | 'pair' | 'stable' | 'main';

export interface PayAsset {
  // 'native' or a lowercase token address.
  address: string;
  symbol: string;
  name: string;
  logo?: string;
  group: PayAssetGroup;
  // Fixed USD price (stablecoins) or 'eth' for ETH-priced assets; otherwise read from the catalog.
  usd?: number | 'eth';
}

const TRUST = 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains';
export const ETH_LOGO = `${TRUST}/ethereum/info/logo.png`;
const USDC_LOGO = `${TRUST}/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png`;
const USDT_LOGO = `${TRUST}/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png`;
const DAI_LOGO = `${TRUST}/ethereum/assets/0x6B175474E89094C44Da98b954EedeAC495271d0F/logo.png`;
const WETH_LOGO = 'https://coin-images.coingecko.com/coins/images/39810/large/weth.png';
const CBBTC_LOGO = 'https://coin-images.coingecko.com/coins/images/40143/large/cbbtc.webp';

const STABLES: Partial<Record<ChainKey, PayAsset[]>> = {
  base: [
    { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', symbol: 'USDC', name: 'USD Coin', logo: USDC_LOGO, group: 'stable', usd: 1 },
    { address: '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2', symbol: 'USDT', name: 'Tether USD', logo: USDT_LOGO, group: 'stable', usd: 1 },
    { address: '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca', symbol: 'USDbC', name: 'USD Base Coin', logo: USDC_LOGO, group: 'stable', usd: 1 },
    { address: '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', symbol: 'DAI', name: 'Dai', logo: DAI_LOGO, group: 'stable', usd: 1 },
  ],
  // Robinhood Chain: Global Dollar (Paxos) is the deep stablecoin (USDG/WETH pools of ~$20M+).
  // Other "USD" tokens there are not routed at $1 by OKX, and USDC pools are tiny, so they are left out.
  robinhood: [
    { address: '0x5fc5360d0400a0fd4f2af552add042d716f1d168', symbol: 'USDG', name: 'Global Dollar', logo: 'https://coin-images.coingecko.com/coins/images/51281/large/GDN_USDG_Token_200x200.png', group: 'stable', usd: 1 },
  ],
  arbitrum: [
    { address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', symbol: 'USDC', name: 'USD Coin', logo: USDC_LOGO, group: 'stable', usd: 1 },
    { address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', symbol: 'USDT', name: 'Tether USD', logo: USDT_LOGO, group: 'stable', usd: 1 },
  ],
};

const MAIN: Partial<Record<ChainKey, PayAsset[]>> = {
  base: [
    { address: '0x22af33fe49fd1fa80c7149773dde5890d3c76f3b', symbol: 'BNKR', name: 'BankrCoin', group: 'main' },
    { address: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf', symbol: 'cbBTC', name: 'Coinbase Wrapped BTC', logo: CBBTC_LOGO, group: 'main' },
  ],
};

export const PAY_GROUP_LABEL: Record<PayAssetGroup, string> = {
  native: 'Native coin',
  pair: 'Pool pair token',
  stable: 'Stablecoins',
  main: 'Main tokens',
};

export function payAssetsFor(token: Token, catalog: Token[]): PayAsset[] {
  const chain = token.chain ?? 'base';
  const config = CHAINS[chain];
  const self = token.address.toLowerCase();
  const weth = config.wrappedNative.address.toLowerCase();
  const fromCatalog = (address: string) => catalog.find((item) => (item.chain ?? 'base') === chain && item.address.toLowerCase() === address);
  const list: PayAsset[] = [
    { address: 'native', symbol: config.nativeSymbol, name: config.nativeName, logo: config.nativeSymbol === 'ETH' ? ETH_LOGO : config.logo, group: 'native', usd: config.nativeSymbol === 'ETH' ? 'eth' : 1 },
  ];
  const quote = token.quoteAddress?.toLowerCase();
  if (quote && quote !== weth && quote !== self) {
    list.push({ address: quote, symbol: token.quoteSymbol || 'PAIR', name: `${token.symbol}'s pool pair`, logo: token.quoteLogo || fromCatalog(quote)?.logo, group: 'pair' });
  }
  list.push(...(STABLES[chain] ?? []));
  list.push({ address: weth, symbol: config.wrappedNative.symbol, name: `Wrapped ${config.nativeName}`, logo: WETH_LOGO, group: 'main', usd: 'eth' });
  for (const asset of MAIN[chain] ?? []) list.push({ ...asset, logo: asset.logo ?? fromCatalog(asset.address)?.logo });
  const seen = new Set<string>();
  return list.filter((asset) => asset.address !== self && !seen.has(asset.address) && seen.add(asset.address));
}

// USD price of an asset, or null when unknown.
export function payAssetUsd(asset: PayAsset, ethPriceUsd: number, catalog: Token[], chain: ChainKey): number | null {
  if (asset.usd === 'eth') return ethPriceUsd > 0 ? ethPriceUsd : null;
  if (typeof asset.usd === 'number') return asset.usd;
  const item = catalog.find((token) => (token.chain ?? 'base') === chain && token.address.toLowerCase() === asset.address);
  return item && item.priceUsd > 0 ? item.priceUsd : null;
}
