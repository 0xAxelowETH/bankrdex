import React, { useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { TokenSocialLinks } from './TokenSocialLinks';
import { useApp } from '../context/AppContext';
import { shortenAddress } from '../utils/web3';
import { SourceEmblem, TOKEN_SOURCES } from './SourceEmblem';
import { chainByKey, dexscreenerUrl, explorerToken } from '../config/chains';
import { ChainEmblem } from './ChainEmblem';
import { BankrVerifiedBadge, VERIFICATION_TEXT } from './BankrVerifiedBadge';

// Fills the desktop column under the swap panel with the facts traders check before buying.
export const TokenInfoCard: React.FC = () => {
  const { activeToken: token } = useApp();
  const [copied, setCopied] = useState(false);
  const source = token.source ?? 'bankr';
  const created = Date.parse(token.createdAt);
  const description = token.description?.trim();

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(token.address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable (insecure context); the address stays selectable.
    }
  };

  const rows: [string, React.ReactNode][] = [
    ['Chain', <span key="chain" className={`chain-${token.chain ?? 'base'} chain-text inline-flex items-center gap-1.5 font-semibold`}><ChainEmblem chain={token.chain ?? 'base'} />{chainByKey(token.chain).name}</span>],
    ['Source', <span key="source" className="inline-flex items-center gap-1.5"><SourceEmblem source={source} variant="icon" />{TOKEN_SOURCES[source].label}</span>],
    ['Bankr launch', token.bankr?.verifiedBy || token.externalSource
      ? <span key="verified" title={token.bankr?.verifiedBy ? VERIFICATION_TEXT[token.bankr.verifiedBy].long : undefined}><BankrVerifiedBadge token={token} /></span>
      : '—'],
    ['Contract', (
      <button key="contract" type="button" onClick={() => void copyAddress()} className="inline-flex items-center gap-1 font-mono hover:text-fg" title="Copy contract address">
        {shortenAddress(token.address)}
        {copied ? <Check className="h-3 w-3 text-up" /> : <Copy className="h-3 w-3" />}
      </button>
    )],
    ['Pair', token.quoteSymbol ? `${token.symbol} / ${token.quoteSymbol}` : '—'],
    ['Launched', Number.isFinite(created) ? new Date(created).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'],
  ];
  if (token.holders > 0) rows.push(['Holders', token.holders.toLocaleString('en-US')]);

  const links = [
    { label: 'Explorer', url: explorerToken(token.chain, token.address) },
    { label: 'DexScreener', url: token.dexscreenerPaidInfo?.dexUrl || dexscreenerUrl(token.chain, token.address) },
    ...(token.externalUrl ? [{ label: TOKEN_SOURCES[source].label, url: token.externalUrl }] : []),
  ];

  return (
    <section aria-label={`About ${token.symbol}`} className="bd-card p-4 text-xs">
      <h3 className="mb-3 text-sm font-bold text-fg">About ${token.symbol}</h3>
      <dl className="space-y-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3">
            <dt className="text-muted">{label}</dt>
            <dd className="text-right text-fg-soft">{value}</dd>
          </div>
        ))}
      </dl>
      {token.socials && (
        <div className="mt-3 border-t border-line pt-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="bd-label">Socials</span>
            <span className="text-[0.6875rem] text-subtle">{token.socials.source === 'dexscreener' ? 'From the paid DexScreener profile' : 'From the launch'}</span>
          </div>
          <TokenSocialLinks socials={token.socials} symbol={token.symbol} variant="button" withLinks />
        </div>
      )}
      {description && (
        <p className="mt-3 line-clamp-4 border-t border-line pt-3 leading-relaxed text-muted" title={description}>
          {description}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
        {links.map((link) => (
          <a
            key={link.label}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 font-semibold text-fg-soft hover:border-accent/60 hover:text-fg"
          >
            {link.label}
            <ExternalLink className="h-3 w-3" />
          </a>
        ))}
      </div>
    </section>
  );
};
