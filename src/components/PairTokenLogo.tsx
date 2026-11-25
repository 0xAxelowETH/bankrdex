import React, { useEffect, useRef, useState } from 'react';
import { getAddress, isAddress } from 'viem';
import { BrandLogo } from './BrandLogo';
import { OkxTokenLogo } from './OkxTokenLogo';

interface CachedPairLogo {
  expiresAt: number;
  url: string;
}

interface DexScreenerTokenPair {
  baseToken?: { address?: string };
  info?: { imageUrl?: string };
}

const PAIR_LOGO_CACHE_PREFIX = 'bankrdex-pair-logo:';
const PAIR_LOGO_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PAIR_LOGO_NEGATIVE_CACHE_TTL_MS = 60_000;
const TRUST_WALLET_LOGO_BASE = 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets';
const pairLogoCache = new Map<string, CachedPairLogo>();
const pairLogoRequests = new Map<string, Promise<string | null>>();

type PairLogoSource = 'metadata' | 'dexscreener' | 'trustwallet' | 'none';

function getDexScreenerLogo(address: string): Promise<string | null> {
  const normalizedAddress = address.toLowerCase();
  const memoryCache = pairLogoCache.get(normalizedAddress);
  if (memoryCache && memoryCache.expiresAt > Date.now()) {
    return Promise.resolve(memoryCache.url || null);
  }
  if (memoryCache) {
    pairLogoCache.delete(normalizedAddress);
  }

  try {
    const saved = window.sessionStorage.getItem(`${PAIR_LOGO_CACHE_PREFIX}${normalizedAddress}`);
    if (saved) {
      const cached = JSON.parse(saved) as CachedPairLogo;
      if (cached.expiresAt > Date.now() && /^https:\/\//i.test(cached.url)) {
        pairLogoCache.set(normalizedAddress, cached);
        return Promise.resolve(cached.url);
      }
      window.sessionStorage.removeItem(`${PAIR_LOGO_CACHE_PREFIX}${normalizedAddress}`);
    }
  } catch {
    // Continue with the network request if session storage is unavailable.
  }

  const pendingRequest = pairLogoRequests.get(normalizedAddress);
  if (pendingRequest) return pendingRequest;

  const request = fetch(`https://api.dexscreener.com/tokens/v1/base/${encodeURIComponent(normalizedAddress)}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(5_000),
  }).then(async (response) => {
    if (!response.ok) return null;
    const pairs = await response.json() as DexScreenerTokenPair[];
    const matchingPair = Array.isArray(pairs)
      ? pairs.find((pair) => pair.baseToken?.address?.toLowerCase() === normalizedAddress && pair.info?.imageUrl)
      : undefined;
    return typeof matchingPair?.info?.imageUrl === 'string' ? matchingPair.info.imageUrl : null;
  }).catch(() => null).then((url) => {
    pairLogoCache.set(normalizedAddress, {
      expiresAt: Date.now() + (url ? PAIR_LOGO_CACHE_TTL_MS : PAIR_LOGO_NEGATIVE_CACHE_TTL_MS),
      url: url || '',
    });
    if (url) {
      try {
        window.sessionStorage.setItem(`${PAIR_LOGO_CACHE_PREFIX}${normalizedAddress}`, JSON.stringify({
          expiresAt: Date.now() + PAIR_LOGO_CACHE_TTL_MS,
          url,
        } satisfies CachedPairLogo));
      } catch {
        // Keep the in-memory result when session storage is unavailable.
      }
    }
    return url;
  }).finally(() => {
    pairLogoRequests.delete(normalizedAddress);
  });

  pairLogoRequests.set(normalizedAddress, request);
  return request;
}

interface PairTokenLogoProps {
  symbol?: string;
  address?: string;
  logo?: string;
  size?: 'xs' | 'sm';
  className?: string;
  refreshKey?: number;
}

export const PairTokenLogo: React.FC<PairTokenLogoProps> = ({ symbol, address, logo, size = 'xs', className = '', refreshKey = 0 }) => {
  const logoRef = useRef<HTMLSpanElement>(null);
  const [isNearViewport, setIsNearViewport] = useState(false);
  const [resolvedLogo, setResolvedLogo] = useState(logo || '');
  const [logoSource, setLogoSource] = useState<PairLogoSource>(logo ? 'metadata' : address ? 'dexscreener' : 'none');
  const previousRefreshKey = useRef(refreshKey);
  const quoteSymbol = symbol?.trim() || 'WETH';
  const trustWalletLogo = address && isAddress(address)
    ? `${TRUST_WALLET_LOGO_BASE}/${getAddress(address)}/logo.png`
    : '';

  useEffect(() => {
    setResolvedLogo(logo || '');
    setLogoSource(logo ? 'metadata' : address ? 'dexscreener' : 'none');
  }, [address, logo]);

  useEffect(() => {
    if (previousRefreshKey.current === refreshKey) return;
    previousRefreshKey.current = refreshKey;
    if (logoSource === 'none' && address) setLogoSource('dexscreener');
  }, [address, logo, logoSource, refreshKey]);

  useEffect(() => {
    const element = logoRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setIsNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsNearViewport(true);
        observer.disconnect();
      }
    }, { rootMargin: '128px' });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!address || !isNearViewport || logoSource !== 'dexscreener') return;
    let isActive = true;

    void getDexScreenerLogo(address).then((fallbackLogo) => {
      if (!isActive) return;
      if (fallbackLogo) {
        setResolvedLogo(fallbackLogo);
        return;
      }
      setResolvedLogo(trustWalletLogo);
      setLogoSource(trustWalletLogo ? 'trustwallet' : 'none');
    });

    return () => {
      isActive = false;
    };
  }, [address, isNearViewport, logoSource, trustWalletLogo]);

  if (quoteSymbol.toUpperCase() === 'WETH') {
    return <BrandLogo brand="weth" size={size === 'xs' ? 18 : 26} className={`rounded-full ${className}`} />;
  }

  return (
    <span ref={logoRef} className={`inline-flex ${className}`}>
      <OkxTokenLogo
        key={address?.toLowerCase() || quoteSymbol.toUpperCase()}
        logo={resolvedLogo}
        symbol={quoteSymbol}
        name={quoteSymbol}
        size={size}
        onImageError={() => {
          if (logoSource === 'metadata') {
            setResolvedLogo('');
            setLogoSource(address ? 'dexscreener' : 'none');
          } else if (logoSource === 'dexscreener') {
            setResolvedLogo(trustWalletLogo);
            setLogoSource(trustWalletLogo ? 'trustwallet' : 'none');
          } else if (logoSource === 'trustwallet') {
            setResolvedLogo('');
            setLogoSource('none');
          }
        }}
      />
    </span>
  );
};