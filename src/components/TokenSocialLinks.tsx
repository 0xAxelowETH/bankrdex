import React from 'react';
import { Globe, Link2 } from 'lucide-react';
import type { TokenSocials } from '../types';
import { BrandLogo } from './BrandLogo';

type SocialKind = 'twitter' | 'telegram' | 'discord' | 'farcaster' | 'website';

const SOCIAL_KINDS: SocialKind[] = ['twitter', 'telegram', 'discord', 'farcaster', 'website'];
const LABELS: Record<SocialKind, string> = { twitter: 'X', telegram: 'Telegram', discord: 'Discord', farcaster: 'Farcaster', website: 'Website' };
// Simple Icons (CC0) in public/socials, drawn as masks so they take the text color.
const ICONS: Partial<Record<SocialKind, string>> = {
  twitter: '/socials/x.svg',
  telegram: '/socials/telegram.svg',
  discord: '/socials/discord.svg',
  farcaster: '/socials/farcaster.svg',
};

export function SocialIcon({ kind, className = 'h-3 w-3' }: { kind: SocialKind; className?: string }) {
  const icon = ICONS[kind];
  if (!icon) return <Globe className={className} aria-hidden="true" />;
  const mask = `url(${icon})`;
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 bg-current ${className}`}
      style={{ WebkitMaskImage: mask, maskImage: mask, WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat', WebkitMaskPosition: 'center', maskPosition: 'center', WebkitMaskSize: 'contain', maskSize: 'contain' }}
    />
  );
}

export const hasSocialLinks = (socials: TokenSocials | undefined) =>
  Boolean(socials && SOCIAL_KINDS.some((kind) => socials[kind]));

// A token's social links. `inline`: tiny icons for table rows; `button`: bordered icon buttons for
// the token page, optionally with the profile's extra links and a DexScreener source mark.
export function TokenSocialLinks({ socials, symbol, variant = 'inline', withLinks = false, showSource = false, className = '' }: {
  socials: TokenSocials | undefined;
  symbol: string;
  variant?: 'inline' | 'button';
  withLinks?: boolean;
  showSource?: boolean;
  className?: string;
}) {
  const entries = SOCIAL_KINDS.flatMap((kind) => (socials?.[kind] ? [{ kind, url: socials[kind] as string }] : []));
  const extra = withLinks ? socials?.links ?? [] : [];
  if (entries.length === 0 && extra.length === 0) return null;
  const fromDex = socials?.source === 'dexscreener';
  const source = fromDex ? ' · from the paid DexScreener profile' : '';
  const button = variant === 'inline'
    ? 'inline-flex h-4 w-4 items-center justify-center rounded text-muted hover:bg-raised hover:text-fg'
    : 'inline-flex h-7 w-7 items-center justify-center rounded-lg border border-line bg-sunken/40 text-muted transition hover:border-fg/20 hover:text-fg';
  const icon = variant === 'inline' ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5';
  const stop = (event: React.MouseEvent) => event.stopPropagation();
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
      {entries.map(({ kind, url }) => (
        <a
          key={kind}
          href={url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          title={`${symbol} on ${LABELS[kind]}${source}`}
          aria-label={`${symbol} on ${LABELS[kind]}`}
          onClick={stop}
          className={button}
        >
          <SocialIcon kind={kind} className={icon} />
        </a>
      ))}
      {extra.map((link) => (
        <a
          key={link.url}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          title={`${link.label}${source}`}
          onClick={stop}
          className="inline-flex h-7 items-center gap-1 rounded-lg border border-line bg-sunken/40 px-2 text-[0.75rem] font-semibold text-muted transition hover:border-fg/20 hover:text-fg"
        >
          <Link2 className="h-3 w-3" /> {link.label}
        </a>
      ))}
      {showSource && fromDex && (
        <span title="Links from the token's paid DexScreener profile" className="inline-flex items-center gap-1 rounded-md bg-up/10 px-1.5 py-0.5 text-[0.625rem] font-bold text-up">
          <BrandLogo brand="dexscreener" size={10} /> DexScreener
        </span>
      )}
    </span>
  );
}
