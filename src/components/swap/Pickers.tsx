import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { CHAIN_KEYS, CHAINS, type ChainKey } from '../../config/chains';
import type { Token } from '../../types';
import { OkxTokenLogo } from '../OkxTokenLogo';
import { ChainEmblem } from '../ChainEmblem';
import { ChangeValue, compactUsd, exactPrice, formatPrice } from '../MarketTableParts';
import { PAY_GROUP_LABEL, type PayAsset, type PayAssetGroup } from './payAssets';

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/65 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}
        className="menu-pop bd-card flex max-h-[85dvh] w-full max-w-md flex-col overflow-hidden rounded-b-none sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h3 className="text-sm font-bold text-fg">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-muted hover:bg-raised hover:text-fg"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

const GROUP_ORDER: PayAssetGroup[] = ['native', 'pair', 'stable', 'main'];

// Pay-with (buys) / receive-in (sells) asset list, grouped. Assets the current route cannot use
// are still listed; picking one lets the caller switch to a route that can.
export function PayAssetPicker({ title, assets, selected, balances, onSelect, onClose, unsupported, unsupportedHint }: {
  title: string;
  assets: PayAsset[];
  selected: string;
  balances?: Record<string, string>;
  onSelect: (asset: PayAsset) => void;
  onClose: () => void;
  unsupported?: Set<string>;
  unsupportedHint?: string;
}) {
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="overflow-y-auto p-2">
        {GROUP_ORDER.map((group) => {
          const items = assets.filter((asset) => asset.group === group);
          if (items.length === 0) return null;
          return (
            <div key={group} className="mb-1">
              <div className="bd-label px-2.5 pb-1 pt-2">{PAY_GROUP_LABEL[group]}</div>
              {items.map((asset) => {
                const off = unsupported?.has(asset.address);
                return (
                  <button key={asset.address} type="button" onClick={() => { onSelect(asset); onClose(); }}
                    className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-raised ${selected === asset.address ? 'bg-raised' : ''}`}>
                    <OkxTokenLogo logo={asset.logo} symbol={asset.symbol} name={asset.name} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-fg">{asset.symbol}</span>
                      <span className="block truncate text-[0.6875rem] text-muted">{off && unsupportedHint ? unsupportedHint : asset.name}</span>
                    </span>
                    {balances?.[asset.address] && <span className="font-mono text-xs text-fg-soft">{balances[asset.address]}</span>}
                    {selected === asset.address && <Check className="h-4 w-4 text-accent" />}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

const MAX_ROWS = 80;

// Token list for the token side of a swap. Picking one makes it the active token, so the whole
// terminal (header, chart, trades, safety) switches to it.
export function TokenPicker({ current, onSelect, onClose }: { current: Token; onSelect: (token: Token) => void; onClose: () => void }) {
  const { tokens } = useApp();
  const [query, setQuery] = useState('');
  const [chain, setChain] = useState<'all' | ChainKey>(current.chain ?? 'base');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const chains = useMemo(() => CHAIN_KEYS.filter((key) => tokens.some((token) => (token.chain ?? 'base') === key && !token.externalSource)), [tokens]);
  const list = useMemo(() => {
    const text = query.trim().toLowerCase();
    return tokens
      .filter((token) => !token.externalSource && (chain === 'all' || (token.chain ?? 'base') === chain))
      .filter((token) => !text || (text.startsWith('0x')
        ? token.address.toLowerCase().startsWith(text)
        : token.symbol.toLowerCase().includes(text) || token.name.toLowerCase().includes(text)))
      .sort((left, right) => {
        if (text) {
          const exact = Number(right.symbol.toLowerCase() === text) - Number(left.symbol.toLowerCase() === text);
          if (exact) return exact;
          const prefix = Number(right.symbol.toLowerCase().startsWith(text)) - Number(left.symbol.toLowerCase().startsWith(text));
          if (prefix) return prefix;
        }
        return (right.volume24hUsd || 0) - (left.volume24hUsd || 0);
      })
      .slice(0, MAX_ROWS);
  }, [chain, query, tokens]);
  const isCurrent = (token: Token) => token.address.toLowerCase() === current.address.toLowerCase() && (token.chain ?? 'base') === (current.chain ?? 'base');

  return (
    <Sheet title="Select a token" onClose={onClose}>
      <div className="space-y-2 border-b border-line p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
          <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, symbol or 0x address" aria-label="Search tokens" className="bd-input w-full pl-9 pr-3 text-sm" />
        </div>
        <div className="scrollbar-none flex gap-1 overflow-x-auto" role="tablist" aria-label="Chain">
          {(['all', ...chains] as const).map((key) => (
            <button key={key} type="button" role="tab" aria-selected={chain === key} onClick={() => setChain(key)}
              className={`flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-bold transition ${key === 'all'
                ? chain === key ? 'nav-active text-fg' : 'text-muted hover:text-fg'
                : `chain-tab chain-${key} ${chain === key ? '' : 'text-muted hover:text-fg'}`}`}>
              {key !== 'all' && <ChainEmblem chain={key} className="h-3.5 w-3.5" />}
              {key === 'all' ? 'All chains' : CHAINS[key].name}
            </button>
          ))}
        </div>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {list.length === 0 && <li className="px-3 py-8 text-center text-xs text-muted">No token matches “{query.trim()}”.</li>}
        {list.map((token) => (
          <li key={`${token.chain ?? 'base'}:${token.address}`}>
            <button type="button" onClick={() => { onSelect(token); onClose(); }}
              className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-raised ${isCurrent(token) ? 'bg-raised' : ''}`}>
              <span className="relative shrink-0">
                <OkxTokenLogo logo={token.logo} symbol={token.symbol} name={token.name} size="md" />
                <ChainEmblem chain={token.chain ?? 'base'} className="absolute -bottom-1 -right-1 h-3.5 w-3.5 border border-panel" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-fg">${token.symbol}</span>
                <span className="block truncate text-[0.6875rem] text-muted">{token.name || '—'} · MC {compactUsd(token.marketCapUsd)} · Liq {compactUsd(token.liquidityUsd)}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-mono text-xs font-semibold text-fg" title={exactPrice(token.priceUsd)}>{formatPrice(token.priceUsd)}</span>
                <span className="mt-0.5 block text-[0.6875rem]"><ChangeValue value={token.change24h} available={token.volume24hUsd > 0} /></span>
              </span>
              {isCurrent(token) && <Check className="h-4 w-4 shrink-0 text-accent" />}
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
