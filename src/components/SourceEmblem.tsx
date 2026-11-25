import React from 'react';
import type { TokenSource } from '../types';

export const TOKEN_SOURCES: Record<TokenSource, { label: string; icon: string; url: string; tint: string }> = {
  bankr: { label: 'Bankr', icon: '/sources/bankr.png', url: 'https://bankr.bot', tint: 'border-sky-400/40' },
  binance: { label: 'Binance Web3', icon: '/sources/binance.svg', url: 'https://web3.binance.com', tint: 'border-yellow-400/40' },
};

interface SourceEmblemProps {
  source: TokenSource;
  // 'icon' for tight spots (token avatar corner), 'chip' for icon + label.
  variant?: 'icon' | 'chip';
  className?: string;
}

export const SourceEmblem: React.FC<SourceEmblemProps> = ({ source, variant = 'chip', className = '' }) => {
  const meta = TOKEN_SOURCES[source];
  const title = `Listed on ${meta.label}`;
  if (variant === 'icon') {
    return (
      <img
        src={meta.icon}
        alt={meta.label}
        title={title}
        width={16}
        height={16}
        className={`h-4 w-4 rounded-full border bg-sunken object-contain ${meta.tint} ${className}`}
      />
    );
  }
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded border bg-sunken px-1.5 py-0.5 text-[0.75rem] font-semibold text-fg-soft ${meta.tint} ${className}`}>
      <img src={meta.icon} alt="" width={12} height={12} className="h-3 w-3 rounded-sm object-contain" />
      {meta.label}
    </span>
  );
};
