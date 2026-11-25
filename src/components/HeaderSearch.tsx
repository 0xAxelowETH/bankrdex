import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Flame, Search, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useSocial } from '../context/SocialContext';
import type { Token } from '../types';
import { OkxTokenLogo } from './OkxTokenLogo';
import { ChainEmblem } from './ChainEmblem';
import { ChangeValue, compactUsd, exactPrice, formatPrice } from './MarketTableParts';

const MAX_RESULTS = 8;

const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

function rank(token: Token, query: string): number {
  const symbol = token.symbol.toLowerCase();
  const name = token.name.toLowerCase();
  const address = token.address.toLowerCase();
  if (query.startsWith('0x')) return address.startsWith(query) ? 5 : 0;
  if (symbol === query) return 4;
  if (symbol.startsWith(query)) return 3;
  if (symbol.includes(query)) return 2;
  if (name.includes(query)) return 1;
  return 0;
}

// Header token search: "/" or Ctrl/Cmd+K focuses it, arrows move, Enter opens the token page.
// With an empty box it lists the most traded tokens.
export const HeaderSearch: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { tokens, setActiveToken } = useApp();
  const { navigate } = useSocial();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const shortcut = (event.key === '/' && !isTypingTarget(event.target)) || (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey));
      if (!shortcut) return;
      event.preventDefault();
      inputRef.current?.focus();
      setOpen(true);
    };
    const onPointer = (event: MouseEvent) => { if (!boxRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, []);

  const results = useMemo(() => {
    const text = query.trim().toLowerCase();
    const live = tokens.filter((token) => !token.externalSource);
    if (!text) {
      return [...live].sort((left, right) => (right.totalTx24h || 0) - (left.totalTx24h || 0)).slice(0, MAX_RESULTS);
    }
    return live
      .map((token) => ({ token, score: rank(token, text) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || (right.token.volume24hUsd || 0) - (left.token.volume24hUsd || 0))
      .slice(0, MAX_RESULTS)
      .map((item) => item.token);
  }, [query, tokens]);

  useEffect(() => setCursor(0), [query]);

  const openToken = (token: Token) => {
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
    setActiveToken(token);
    navigate({ name: 'terminal' });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setCursor((value) => Math.min(results.length - 1, value + 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setCursor((value) => Math.max(0, value - 1)); }
    else if (event.key === 'Enter' && results[cursor]) { event.preventDefault(); openToken(results[cursor]); }
    else if (event.key === 'Escape') { setOpen(false); inputRef.current?.blur(); }
  };

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search token, symbol or 0x…"
        aria-label="Search tokens"
        aria-expanded={open}
        aria-controls="header-search-results"
        role="combobox"
        aria-autocomplete="list"
        className="bd-input w-full pl-9 pr-16 text-sm"
      />
      {query ? (
        <button type="button" onClick={() => { setQuery(''); inputRef.current?.focus(); }} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-subtle hover:text-fg">
          <X className="h-3.5 w-3.5" />
        </button>
      ) : (
        <span className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 items-center gap-1 lg:flex" aria-hidden="true">
          <span className="kbd">/</span>
        </span>
      )}
      {open && (
        <div id="header-search-results" role="listbox" className="menu-pop absolute left-0 right-0 top-[calc(100%+0.4rem)] z-50 min-w-[22rem] overflow-hidden rounded-2xl border border-line bg-panel p-1.5 shadow-2xl shadow-black/60">
          <div className="flex items-center gap-1.5 px-2.5 pb-1.5 pt-1 bd-label">
            {query.trim() ? `${results.length} match${results.length === 1 ? '' : 'es'}` : <><Flame className="h-3 w-3 text-orange-400" /> Most traded today</>}
          </div>
          {results.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted">No token matches “{query.trim()}”.</p>
          ) : results.map((token, index) => (
            <button
              key={`${token.chain ?? 'base'}:${token.address}`}
              type="button"
              role="option"
              aria-selected={index === cursor}
              onMouseEnter={() => setCursor(index)}
              onClick={() => openToken(token)}
              className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition ${index === cursor ? 'bg-raised' : ''}`}
            >
              <span className="relative shrink-0">
                <OkxTokenLogo logo={token.logo} symbol={token.symbol} name={token.name} size="sm" />
                <ChainEmblem chain={token.chain ?? 'base'} className="absolute -bottom-1 -right-1 h-3 w-3 border border-panel" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-fg">${token.symbol}</span>
                <span className="block truncate text-[0.6875rem] text-muted">{token.name || '—'} · MC {compactUsd(token.marketCapUsd)}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-mono text-xs font-semibold text-fg" title={exactPrice(token.priceUsd)}>{formatPrice(token.priceUsd)}</span>
                <span className="mt-0.5 block text-[0.6875rem]"><ChangeValue value={token.change24h} available={token.volume24hUsd > 0} /></span>
              </span>
            </button>
          ))}
          <div className="mt-1 flex items-center justify-between border-t border-line px-2.5 pb-0.5 pt-2 text-[0.6875rem] text-subtle">
            <span className="flex items-center gap-1"><span className="kbd">↑</span><span className="kbd">↓</span> move <span className="kbd ml-1">↵</span> open</span>
            <span className="flex items-center gap-1"><span className="kbd">Ctrl</span><span className="kbd">K</span></span>
          </div>
        </div>
      )}
    </div>
  );
};
