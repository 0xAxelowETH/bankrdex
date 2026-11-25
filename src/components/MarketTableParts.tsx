import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

export type SortKey =
  | 'price' | 'change5m' | 'change1h' | 'change24h' | 'mcap' | 'liq' | 'volume' | 'txns' | 'holders' | 'age' | 'bought';
export interface SortState { key: SortKey; dir: 'asc' | 'desc' }
export type Density = 'comfortable' | 'compact';

// Building an Intl.NumberFormat is far slower than using one; the table formats hundreds of
// values per render, so formatters are created once and reused.
const formatterCache = new Map<string, Intl.NumberFormat>();
export function numberFormat(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = JSON.stringify(options);
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', options);
    formatterCache.set(key, formatter);
  }
  return formatter;
}

export const compactUsd = (value: number) => value > 0
  ? `$${numberFormat({ notation: 'compact', maximumFractionDigits: 2 }).format(value)}`
  : '—';
export const compactCount = (value: number) =>
  numberFormat({ notation: 'compact', maximumFractionDigits: 1 }).format(value);

const SUBSCRIPT_DIGITS = '₀₁₂₃₄₅₆₇₈₉';
const subscript = (value: number) => String(value).split('').map((digit) => SUBSCRIPT_DIGITS[Number(digit)]).join('');

// USD price for tables and headers. Prices under $0.0001 collapse their leading zeros into a
// subscript count, DexScreener style: 0.000000222507 -> $0.0₆2225.
export function formatPrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  if (value >= 1_000) return `$${numberFormat({ maximumFractionDigits: 0 }).format(value)}`;
  if (value >= 1) return `$${numberFormat({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
  if (value >= 0.0001) return `$${numberFormat({ maximumSignificantDigits: 4 }).format(value)}`;
  const [mantissa, exponent] = value.toExponential(3).split('e');
  const zeros = -Number(exponent) - 1;
  const digits = mantissa.replace('.', '').replace(/0+$/, '') || '0';
  return `$0.0${subscript(zeros)}${digits}`;
}

// Full-precision price for tooltips.
export const exactPrice = (value: number) => (Number.isFinite(value) && value > 0 ? `$${numberFormat({ maximumSignificantDigits: 8 }).format(value)}` : '');

export function SortHeader({ label, sortKey, sort, onSort, className = '', title }: {
  label: string;
  sortKey: SortKey;
  sort: SortState | null;
  onSort: (key: SortKey) => void;
  className?: string;
  title?: string;
}) {
  const active = sort?.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.dir === 'desc' ? ArrowDown : ArrowUp;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === 'desc' ? 'descending' : 'ascending') : 'none'}
      className={`px-2 py-2 text-right ${className}`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        title={title ?? `Sort by ${label}`}
        className={`inline-flex items-center gap-1 uppercase tracking-[0.1em] hover:text-fg ${active ? 'text-fg' : ''}`}
      >
        {label}
        <Icon className={`h-3 w-3 ${active ? 'text-accent' : 'opacity-40'}`} />
      </button>
    </th>
  );
}

// Briefly highlights a value when it changes between refreshes, so live updates are visible.
export function FlashValue({ value, children, className = '' }: { value: number; children: React.ReactNode; className?: string }) {
  const previous = useRef(value);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  useEffect(() => {
    if (value === previous.current) return;
    setFlash(value > previous.current ? 'up' : 'down');
    previous.current = value;
    const id = window.setTimeout(() => setFlash(null), 700);
    return () => window.clearTimeout(id);
  }, [value]);
  return (
    <span className={`rounded px-0.5 transition-colors duration-700 ${flash === 'up' ? 'bg-up/20' : flash === 'down' ? 'bg-down/20' : ''} ${className}`}>
      {children}
    </span>
  );
}

export const changeTone = (value: number) => (value > 0 ? 'chg-up' : value < 0 ? 'chg-down' : 'chg-flat');
export const formatChange = (value: number) =>
  `${value >= 0 ? '+' : ''}${Math.abs(value) >= 1000 ? compactCount(value) : value.toFixed(2)}%`;

// Percentage change as a tinted pill; moves of 50% or more get a stronger tint.
export function ChangeValue({ value, available, className = '' }: { value: number; available: boolean; className?: string }) {
  if (!available || !Number.isFinite(value)) return <span className="text-subtle">—</span>;
  return (
    <span className={`chg ${changeTone(value)} ${Math.abs(value) >= 50 ? 'chg-hot' : ''} ${className}`}>
      <FlashValue value={value}>{formatChange(value)}</FlashValue>
    </span>
  );
}

export function TxnsValue({ buys, sells, total, available }: { buys: number; sells: number; total: number; available: boolean }) {
  if (!available || total <= 0) return <span className="text-subtle">—</span>;
  // Some sources only report the total (no buy / sell split).
  if (buys + sells === 0) return <span className="whitespace-nowrap text-[0.75rem] font-semibold text-fg" title={`${total.toLocaleString('en-US')} transactions`}>{compactCount(total)}</span>;
  const buyShare = buys + sells > 0 ? (buys / (buys + sells)) * 100 : 50;
  return (
    <div className="ml-auto flex w-full max-w-[8rem] flex-col items-end gap-1" title={`${buys.toLocaleString('en-US')} buys / ${sells.toLocaleString('en-US')} sells (${Math.round(buyShare)}% buys)`}>
      <span className="whitespace-nowrap text-[0.75rem]">
        <span className="font-semibold text-fg">{compactCount(total)}</span>
        <span className="ml-1.5 text-up">{compactCount(buys)}</span>
        <span className="text-subtle">/</span>
        <span className="text-down">{compactCount(sells)}</span>
      </span>
      <span className="ratio-bar w-full" aria-hidden="true">
        <span style={{ width: `${buyShare}%` }} />
      </span>
    </div>
  );
}

const relative = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
};

// One shared 1-second clock for every "… ago" label instead of one timer per table row.
const clockListeners = new Set<() => void>();
let clockTimer: number | undefined;
let clockNow = Date.now();
function subscribeClock(listener: () => void) {
  clockListeners.add(listener);
  if (clockTimer === undefined) {
    clockNow = Date.now();
    clockTimer = window.setInterval(() => {
      clockNow = Date.now();
      clockListeners.forEach((notify) => notify());
    }, 1000);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && clockTimer !== undefined) {
      window.clearInterval(clockTimer);
      clockTimer = undefined;
    }
  };
}
const noClock = () => () => undefined;

// Current time, but the component only re-renders when `bucket(now)` changes: labels in seconds
// update every second, labels in minutes or hours only when that unit changes.
function useClock(at: number): number {
  useSyncExternalStore(
    at ? subscribeClock : noClock,
    () => {
      const age = clockNow - at;
      return age < 60_000 ? Math.floor(clockNow / 1000) : age < 3_600_000 ? Math.floor(age / 60_000) : Math.floor(age / 3_600_000) * 1e6;
    },
    () => 0,
  );
  return clockNow;
}

// Token age: minutes, then hours and minutes for the first day, then whole days.
export function formatTokenAge(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) {
    const rest = minutes % 60;
    return `${Math.floor(minutes / 60)}h${rest ? ` ${rest}m` : ''}`;
  }
  return `${Math.floor(minutes / (24 * 60))}d`;
}

// Re-renders once a minute while the label shows minutes (first 24 hours), hourly after that.
function useAgeClock(at: number): number {
  useSyncExternalStore(
    at ? subscribeClock : noClock,
    () => {
      const age = clockNow - at;
      return age < 86_400_000 ? Math.floor(clockNow / 60_000) : Math.floor(clockNow / 3_600_000);
    },
    () => 0,
  );
  return clockNow;
}

export function TokenAge({ at }: { at: number }) {
  const now = useAgeClock(at);
  if (!at) return <span className="text-subtle">—</span>;
  const age = now - at;
  return (
    <span className={age < 3_600_000 ? 'text-up' : undefined} title={`Launched ${new Date(at).toLocaleString()}`}>
      {formatTokenAge(age)}
    </span>
  );
}

// "12s ago". `exact` = a confirmed buy; otherwise the last trade (buy or sell) is shown and
// labelled as such.
export function BoughtAgo({ at, exact, compact = false }: { at: number; exact: boolean; compact?: boolean }) {
  const now = useClock(at);
  if (!at) return <span className="text-subtle">—</span>;
  const age = now - at;
  const tone = age < 60_000 ? 'text-up' : age < 3_600_000 ? 'text-fg-soft' : 'text-subtle';
  return (
    <span
      className={`whitespace-nowrap ${tone}`}
      title={`${exact ? 'Last buy' : 'Last trade (buy or sell)'} · ${new Date(at).toLocaleString()}`}
    >
      {!compact && exact && age < 60_000 && <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-up align-middle" />}
      {relative(age)} ago
    </span>
  );
}

// Buy size tiers for the Bought column; adjust the thresholds (USD, inclusive lower bound) here.
export const BUY_TIERS = [
  { min: 5_000, emoji: '🐋', label: 'Whale', className: 'font-bold text-amber-300' },
  { min: 1_000, emoji: '🦈', label: 'Shark', className: 'font-bold text-violet-300' },
  { min: 250, emoji: '🐬', label: 'Dolphin', className: 'text-sky-300' },
  { min: 50, emoji: '🐟', label: 'Fish', className: 'text-fg' },
  { min: 0, emoji: '🦐', label: 'Shrimp', className: 'text-muted' },
] as const;

export const buyTier = (usd: number) => BUY_TIERS.find((tier) => usd >= tier.min) ?? BUY_TIERS[BUY_TIERS.length - 1];

export interface BuyValueInfo {
  usd: number | null;
  quoteAmount: number;
  quoteSymbol: string;
  isDev: boolean;
  txHash: string;
}

const compactAmount = (value: number) => numberFormat({
  notation: value >= 10_000 ? 'compact' : 'standard',
  maximumSignificantDigits: value >= 1 ? 3 : 2,
}).format(value);

export const formatBuyUsd = (usd: number) => (usd < 1 ? '<$1' : `$${compactAmount(usd)}`);

// Size of the latest buy: tier emoji + USD (or the quote amount when it has no USD price).
// Values are estimates at the current quote price, so the tooltip says so.
export function BuyValueBadge({ value, compact = false }: { value: BuyValueInfo; compact?: boolean }) {
  const tier = value.usd === null ? null : buyTier(value.usd);
  const amount = `${compactAmount(value.quoteAmount)} ${value.quoteSymbol}`;
  const title = [
    value.isDev ? 'Bought by the token creator (dev)' : tier ? `${tier.label} buy` : 'Buy',
    value.usd === null ? amount : `${amount} (~$${value.usd.toLocaleString('en-US', { maximumFractionDigits: 2 })})`,
    'Estimated at the current price · not investment advice',
    'Click to view on BaseScan',
  ].join(' · ');
  return (
    <a
      href={`https://basescan.org/tx/${value.txHash}`}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      aria-label={title}
      onClick={(event) => event.stopPropagation()}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded hover:underline ${tier?.className ?? 'text-muted'}`}
    >
      {value.isDev && (
        <span className="rounded border border-amber-500/50 bg-amber-500/10 px-1 font-sans text-[0.625rem] font-bold uppercase text-amber-300">Dev</span>
      )}
      {tier && <span aria-hidden="true">{tier.emoji}</span>}
      <span>{value.usd === null ? (compact ? compactAmount(value.quoteAmount) : amount) : formatBuyUsd(value.usd)}</span>
    </a>
  );
}

export function Skeleton({ className = 'h-3 w-14' }: { className?: string }) {
  return <span aria-hidden="true" className={`inline-block animate-pulse rounded bg-raised ${className}`} />;
}

export function readPreference<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return value && (allowed as readonly string[]).includes(value) ? value as T : fallback;
  } catch {
    return fallback;
  }
}

export function writePreference(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Preference stays for this session only.
  }
}
