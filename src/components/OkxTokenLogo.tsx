import React, { useState, useEffect, useRef } from 'react';

interface OkxTokenLogoProps {
  logo?: string;
  symbol: string;
  name?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  onImageError?: () => void;
}

// Bankr launch artwork: ipfs://<cid>
const IPFS_LOGO = /^ipfs:\/\/(?:ipfs\/)?([A-Za-z0-9]{46,110})$/;

export const OkxTokenLogo: React.FC<OkxTokenLogoProps> = ({
  logo,
  symbol,
  name,
  size = 'md',
  className = '',
  onImageError,
}) => {
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);
  const [hasError, setHasError] = useState<boolean>(false);
  const [visibleLogo, setVisibleLogo] = useState<string | null>(null);
  const logoRef = useRef<HTMLDivElement>(null);
  const previousSymbol = useRef(symbol);
  const resolvedSrcRef = useRef(resolvedSrc);
  const onImageErrorRef = useRef(onImageError);
  resolvedSrcRef.current = resolvedSrc;
  onImageErrorRef.current = onImageError;

  useEffect(() => {
    if (!logo || !IPFS_LOGO.test(logo)) return;

    const element = logoRef.current;
    if (!element) return;

    if (typeof IntersectionObserver === 'undefined') {
      setVisibleLogo(logo);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisibleLogo(logo);
        observer.disconnect();
      }
    }, { rootMargin: '128px' });

    observer.observe(element);
    return () => observer.disconnect();
  }, [logo]);

  useEffect(() => {
    let isMounted = true;
    setHasError(false);
    if (previousSymbol.current !== symbol) {
      previousSymbol.current = symbol;
      setResolvedSrc(null);
    }

    const loadImage = (src: string) => {
      const image = new Image();
      image.onload = () => {
        if (!isMounted) return;
        setResolvedSrc(src);
      };
      image.onerror = () => {
        if (!isMounted) return;
        onImageErrorRef.current?.();
      };
      image.src = src;
    };

    if (!logo) {
      return () => {
        isMounted = false;
      };
    }

    if (/^(data:|https?:\/\/)/i.test(logo)) {
      if (logo !== resolvedSrcRef.current) loadImage(logo);
      return () => {
        isMounted = false;
      };
    }

    const ipfs = IPFS_LOGO.exec(logo);
    if (ipfs) {
      if (visibleLogo !== logo) {
        return () => {
          isMounted = false;
        };
      }

      // Fetched from IPFS and CDN-cached by the server; loadImage falls back to the badge on 404.
      const src = `/api/token-logo/${ipfs[1]}`;
      if (src !== resolvedSrcRef.current) loadImage(src);
    }

    return () => {
      isMounted = false;
    };
  }, [logo, visibleLogo, symbol]);

  const sizeClasses = {
    xs: 'w-4 h-4 text-[0.75rem] rounded-md',
    sm: 'w-6 h-6 text-xs rounded-lg',
    md: 'w-8 h-8 text-sm rounded-xl',
    lg: 'w-10 h-10 text-base rounded-xl',
    xl: 'w-12 h-12 text-lg rounded-2xl',
  };

  // Deterministic color generation based on symbol
  const getSymbolGradient = (sym: string) => {
    let hash = 0;
    for (let i = 0; i < sym.length; i++) {
      hash = sym.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    return `linear-gradient(135deg, hsl(${hue}, 65%, 22%) 0%, hsl(${(hue + 40) % 360}, 75%, 12%) 100%)`;
  };

  if (resolvedSrc && !hasError) {
    return (
      <img
        src={resolvedSrc}
        alt={symbol}
        loading="lazy"
        decoding="async"
        onError={() => {
          setHasError(true);
          onImageError?.();
        }}
        className={`${sizeClasses[size]} object-cover bg-raised border border-line shrink-0 ${className}`}
      />
    );
  }

  // Fallback: OKX Web3 Geometric Symbol Badge
  return (
    <div
      ref={logoRef}
      style={{ background: getSymbolGradient(symbol) }}
      className={`${sizeClasses[size]} border border-white/10 flex items-center justify-center font-bold text-white font-mono shrink-0 select-none shadow-sm ${className}`}
      title={name || symbol}
    >
      <span>{symbol.slice(0, 2).toUpperCase()}</span>
    </div>
  );
};
