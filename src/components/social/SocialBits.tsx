import React, { useEffect, useState } from 'react';
import { BadgeCheck } from 'lucide-react';
import { fetchProfileCards, imageUrl, type ProfileCard } from '../../services/social';
import { useSocial } from '../../context/SocialContext';
import { shortenAddress } from '../../utils/web3';

// Two hues derived from the wallet, so wallets without an avatar still look distinct.
export function walletGradient(wallet: string, accent?: string | null): string {
  const seed = parseInt(wallet.slice(2, 8) || '0', 16);
  const hue = seed % 360;
  if (accent) return `linear-gradient(135deg, ${accent}, hsl(${(hue + 40) % 360} 70% 45%))`;
  return `linear-gradient(135deg, hsl(${hue} 75% 55%), hsl(${(hue + 70) % 360} 70% 40%))`;
}

export const ProfileAvatar: React.FC<{
  wallet: string;
  card?: Pick<ProfileCard, 'username' | 'displayName' | 'avatarVersion' | 'accent'> | null;
  size?: number;
  className?: string;
  ring?: boolean;
}> = ({ wallet, card, size = 32, className = '', ring = false }) => {
  const [failed, setFailed] = useState(false);
  const src = card ? imageUrl(wallet, 'avatar', card.avatarVersion) : null;
  useEffect(() => setFailed(false), [src]);
  const label = (card?.displayName || card?.username || wallet.slice(2, 4)).slice(0, 2).toUpperCase();
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-black text-white ${ring ? 'ring-2 ring-surface' : ''} ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.36), background: walletGradient(wallet, card?.accent) }}
      aria-hidden="true"
    >
      {src && !failed
        ? <img src={src} alt="" width={size} height={size} loading="lazy" className="h-full w-full object-cover" onError={() => setFailed(true)} />
        : <span className="drop-shadow">{label}</span>}
    </span>
  );
};

// Profile cards for a list of wallets (trades, leaderboards); null for wallets without one.
export function useProfileCards(wallets: string[]): Record<string, ProfileCard | null> {
  const [cards, setCards] = useState<Record<string, ProfileCard | null>>({});
  const key = [...new Set(wallets.map((wallet) => wallet.toLowerCase()))].sort().join(',');
  useEffect(() => {
    if (!key) return;
    let active = true;
    void fetchProfileCards(key.split(',')).then((result) => { if (active) setCards(result); });
    return () => { active = false; };
  }, [key]);
  return cards;
}

// "@username" with avatar (or a short address) that opens the trader's page.
export const TraderLabel: React.FC<{
  wallet: string;
  card?: ProfileCard | null;
  size?: number;
  showAddress?: boolean;
  className?: string;
}> = ({ wallet, card, size = 20, showAddress = false, className = '' }) => {
  const { navigate } = useSocial();
  const target = card?.username ?? wallet.toLowerCase();
  return (
    <a
      href={`/u/${target}`}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        navigate({ name: 'profile', id: target });
      }}
      className={`group inline-flex min-w-0 items-center gap-1.5 ${className}`}
      title={card ? `@${card.username} · ${wallet}` : wallet}
    >
      <ProfileAvatar wallet={wallet} card={card} size={size} />
      {card ? (
        <span className="min-w-0 truncate font-sans font-bold text-fg group-hover:text-accent">
          {card.displayName || `@${card.username}`}
          {card.displayName && <span className="ml-1 font-medium text-subtle">@{card.username}</span>}
          {showAddress && <span className="ml-1 font-mono text-subtle">{shortenAddress(wallet)}</span>}
        </span>
      ) : (
        <span className="truncate font-mono text-muted group-hover:text-accent">{shortenAddress(wallet)}</span>
      )}
    </a>
  );
};

export const ProfileBadge: React.FC<{ className?: string }> = ({ className = '' }) => (
  <BadgeCheck className={`h-3.5 w-3.5 text-accent ${className}`} aria-label="BankrDex profile" />
);

export function formatUsd(value: number | null | undefined, signed = false): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const sign = signed ? (value > 0 ? '+' : value < 0 ? '−' : '') : value < 0 ? '−' : '';
  const absolute = Math.abs(value);
  if (absolute > 0 && absolute < 0.01) return `${sign}<$0.01`;
  const text = absolute >= 1e6 ? `${(absolute / 1e6).toFixed(2)}M` : absolute >= 1e3 ? `${(absolute / 1e3).toFixed(1)}K` : absolute.toFixed(absolute >= 100 ? 0 : 2);
  return `${sign}$${text}`;
}

// Prices of new tokens are tiny: keep 4 significant digits.
export function formatPrice(value: number | null | undefined): string {
  if (!value || !Number.isFinite(value)) return '—';
  if (value >= 1) return `$${value.toLocaleString('en-US', { maximumFractionDigits: 4 })}`;
  return `$${value.toPrecision(4).replace(/0+$/, '').replace(/\.$/, '')}`;
}

export const ACCENTS = ['#c3ff2e', '#4d8dff', '#8b5cf6', '#ec4899', '#f97316', '#f5c542', '#22c55e', '#14b8a6', '#06b6d4', '#ef4444', '#a3a3a3'];
