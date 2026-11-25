import React, { useState } from 'react';

export type BrandName = 'bankrdex' | 'bankr' | 'okx' | 'binance' | 'base' | 'eth' | 'weth' | 'metamask' | 'uniswap' | 'dexscreener' | 'tether' | 'circle' | 'dai';
export type StablecoinSymbol = 'USDC' | 'USDT' | 'USDbC' | 'DAI';

const stablecoinLogoBrands: Record<StablecoinSymbol, BrandName> = {
  USDC: 'circle',
  USDT: 'tether',
  USDbC: 'circle',
  DAI: 'dai',
};

export function getStablecoinLogoBrand(symbol: StablecoinSymbol): BrandName {
  return stablecoinLogoBrands[symbol];
}

const TRUST_ASSETS = 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains';
const brandLogos: Record<BrandName, { label: string; src: string }> = {
  bankrdex: { label: 'BankrDex', src: '/sources/bankrdex-mark.svg' },
  bankr: { label: 'Bankr', src: '/sources/bankr.png' },
  okx: { label: 'OKX', src: 'https://cdn.simpleicons.org/okx/ffffff' },
  binance: { label: 'Binance', src: 'https://cdn.simpleicons.org/binance' },
  base: { label: 'Base', src: `${TRUST_ASSETS}/base/info/logo.png` },
  eth: { label: 'Ether', src: `${TRUST_ASSETS}/ethereum/info/logo.png` },
  weth: { label: 'WETH', src: 'https://coin-images.coingecko.com/coins/images/39810/large/weth.png' },
  tether: { label: 'Tether USD', src: `${TRUST_ASSETS}/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png` },
  circle: { label: 'USD Coin', src: `${TRUST_ASSETS}/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png` },
  dai: { label: 'Dai', src: `${TRUST_ASSETS}/ethereum/assets/0x6B175474E89094C44Da98b954EedeAC495271d0F/logo.png` },
  metamask: {
    label: 'MetaMask',
    src: 'https://images.ctfassets.net/clixtyxoaeas/4rnpEzy1ATWRKVBOLxZ1Fm/a74dc1eed36d23d7ea6030383a4d5163/MetaMask-icon-fox.svg',
  },
  uniswap: { label: 'Uniswap', src: 'https://cdn.simpleicons.org/uniswap' },
  dexscreener: { label: 'DexScreener', src: 'https://dexscreener.com/favicon.ico' },
};

interface BrandLogoProps {
  brand: BrandName;
  size?: number;
  className?: string;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({ brand, size = 20, className = '' }) => {
  const [hasError, setHasError] = useState(false);
  const asset = brandLogos[brand];

  if (hasError) {
    return (
      <span
        aria-label={`${asset.label} logo unavailable`}
        title={asset.label}
        style={{ width: size, height: size }}
        className={`inline-flex shrink-0 items-center justify-center rounded-full bg-neutral-800 text-[0.75rem] font-bold text-neutral-300 ${className}`}
      >
        {asset.label.slice(0, 1)}
      </span>
    );
  }

  return (
    <img
      src={asset.src}
      alt={`${asset.label} logo`}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setHasError(true)}
      className={`inline-block shrink-0 object-contain ${className}`}
    />
  );
};