import React from 'react';
import { ArrowDown, ChevronDown, ExternalLink, Loader2 } from 'lucide-react';
import { OkxTokenLogo } from '../OkxTokenLogo';

// Building blocks shared by the direct (Uniswap V4) and the aggregator (OKX / Binance) swap panels.

export type Side = 'buy' | 'sell';

export interface SwapIntent {
  direction: Side;
  // Changes on every request so the same direction can be requested twice.
  nonce: number;
}

export const SideTabs: React.FC<{ side: Side; onChange: (side: Side) => void; buyDisabled?: boolean }> = ({ side, onChange, buyDisabled }) => (
  <div className="grid grid-cols-2 gap-1 rounded-xl bg-sunken p-1" role="tablist" aria-label="Buy or sell">
    {(['buy', 'sell'] as const).map((option) => (
      <button
        key={option}
        type="button"
        role="tab"
        aria-selected={side === option}
        disabled={option === 'buy' && buyDisabled}
        onClick={() => onChange(option)}
        className={`rounded-lg py-2 text-sm font-extrabold capitalize transition ${side === option
          ? option === 'buy' ? 'bg-up text-black shadow-[0_6px_18px_-8px_var(--bd-up)]' : 'bg-down text-white shadow-[0_6px_18px_-8px_var(--bd-down)]'
          : 'text-muted hover:text-fg'} disabled:opacity-40`}
      >
        {option}
      </button>
    ))}
  </div>
);

// Token / asset badge in an amount field; with onClick it opens a picker.
export const TokenChip: React.FC<{ symbol: string; logo?: string; name?: string; onClick?: () => void; pickerLabel?: string }> = ({ symbol, logo, name, onClick, pickerLabel }) => {
  const content = (
    <>
      <OkxTokenLogo logo={logo ?? ''} symbol={symbol} name={name ?? symbol} size="xs" />
      <span className="max-w-[7rem] truncate">{symbol}</span>
      {onClick && <ChevronDown className="h-3.5 w-3.5 text-muted" />}
    </>
  );
  const className = 'inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-panel py-1 pl-1 pr-2.5 text-sm font-extrabold text-fg';
  return onClick
    ? <button type="button" onClick={onClick} aria-label={pickerLabel ?? `Change ${symbol}`} title={pickerLabel} className={`${className} transition hover:border-accent/60 hover:bg-raised`}>{content}</button>
    : <span className={className}>{content}</span>;
};

export const AmountField: React.FC<{
  label: string;
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  loading?: boolean;
  token: { symbol: string; logo?: string; name?: string };
  onTokenClick?: () => void;
  tokenPickerLabel?: string;
  balance?: string | null;
  onMax?: () => void;
  usd?: number | null;
  error?: string;
}> = ({ label, value, onChange, readOnly, loading, token, onTokenClick, tokenPickerLabel, balance, onMax, usd, error }) => (
  <div className={`rounded-2xl border bg-sunken/70 px-3.5 py-3 transition focus-within:border-accent/70 ${error ? 'border-down/60' : 'border-line'}`}>
    <div className="flex items-center justify-between text-xs text-muted">
      <span className="font-semibold">{label}</span>
      {balance !== undefined && (
        <button type="button" onClick={onMax} disabled={!onMax} className="font-mono hover:text-fg disabled:cursor-default disabled:hover:text-muted">
          Balance: {balance ?? '…'}{onMax && <span className="ml-1 font-sans font-bold text-accent">MAX</span>}
        </button>
      )}
    </div>
    <div className="mt-1.5 flex items-center gap-3">
      {loading ? (
        <span className="flex h-9 flex-1 items-center"><Loader2 className="h-5 w-5 animate-spin text-muted" /></span>
      ) : (
        <input
          inputMode="decimal"
          value={value}
          readOnly={readOnly}
          onChange={(event) => onChange?.(event.target.value.replace(',', '.').replace(/[^0-9.]/g, ''))}
          placeholder="0.0"
          aria-label={label}
          className="h-9 min-w-0 flex-1 bg-transparent font-mono text-2xl font-bold text-fg outline-none placeholder:text-subtle/60"
        />
      )}
      <TokenChip {...token} onClick={onTokenClick} pickerLabel={tokenPickerLabel} />
    </div>
    <div className="mt-1 flex min-h-4 justify-between text-[0.6875rem]">
      <span className="text-down">{error}</span>
      {usd !== null && usd !== undefined && usd > 0 && <span className="font-mono text-subtle">≈ ${usd.toLocaleString('en-US', { maximumFractionDigits: usd >= 100 ? 0 : 2 })}</span>}
    </div>
  </div>
);

export const PresetRow: React.FC<{ items: { label: string; onClick: () => void; disabled?: boolean }[] }> = ({ items }) => (
  <div className="mt-2 grid grid-cols-4 gap-1.5">
    {items.map((item) => (
      <button
        key={item.label}
        type="button"
        onClick={item.onClick}
        disabled={item.disabled}
        className="rounded-lg border border-line bg-panel py-1.5 font-mono text-xs font-semibold text-fg-soft transition hover:border-accent/60 hover:text-fg disabled:opacity-40"
      >
        {item.label}
      </button>
    ))}
  </div>
);

export const FlipDivider: React.FC<{ onFlip?: () => void }> = ({ onFlip }) => (
  <div className="relative my-1.5 flex justify-center">
    <button
      type="button"
      onClick={onFlip}
      disabled={!onFlip}
      aria-label="Switch buy and sell"
      className="z-10 -my-3 flex h-8 w-8 items-center justify-center rounded-xl border-4 border-panel bg-raised text-fg-soft transition hover:text-fg disabled:cursor-default"
    >
      <ArrowDown className="h-4 w-4" />
    </button>
  </div>
);

export const DetailRows: React.FC<{ rows: [React.ReactNode, React.ReactNode][] }> = ({ rows }) => (
  <dl className="mt-3 space-y-1.5 rounded-xl border border-line/70 bg-sunken/40 px-3 py-2.5 text-xs">
    {rows.map(([label, value], index) => (
      <div key={index} className="flex items-center justify-between gap-3">
        <dt className="text-muted">{label}</dt>
        <dd className="text-right font-mono text-fg-soft">{value}</dd>
      </div>
    ))}
  </dl>
);

export const SlippagePicker: React.FC<{ value: number; options: number[]; onChange: (value: number) => void }> = ({ value, options, onChange }) => (
  <span className="inline-flex gap-0.5 rounded-lg bg-sunken p-0.5">
    {options.map((option) => (
      <button
        key={option}
        type="button"
        onClick={() => onChange(option)}
        aria-pressed={value === option}
        className={`rounded-md px-1.5 py-0.5 font-mono text-[0.6875rem] font-bold transition ${value === option ? 'bg-accent text-black' : 'text-muted hover:text-fg'}`}
      >
        {option}%
      </button>
    ))}
  </span>
);

export const SwapButton: React.FC<{ side: Side; busy?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }> = ({ side, busy, disabled, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled || busy}
    className={`mt-3 flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-[0.95rem] font-extrabold transition active:scale-[0.99] disabled:opacity-50 ${side === 'buy'
      ? 'bg-gradient-to-r from-emerald-400 to-up text-black shadow-[0_10px_30px_-12px_var(--bd-up)]'
      : 'bg-gradient-to-r from-rose-500 to-down text-white shadow-[0_10px_30px_-12px_var(--bd-down)]'}`}
  >
    {busy && <Loader2 className="h-4 w-4 animate-spin" />}
    {children}
  </button>
);

export const StatusLine: React.FC<{ status: { kind: 'working' | 'done' | 'error'; message: string; txHash?: string } | null; explorerUrl?: (hash: string) => string }> = ({ status, explorerUrl }) => {
  if (!status) return null;
  return (
    <p role="status" className={`mt-2.5 flex items-start gap-1.5 rounded-xl px-3 py-2 text-xs ${status.kind === 'done' ? 'bg-up/10 text-up' : status.kind === 'error' ? 'bg-down/10 text-down' : 'bg-raised text-muted'}`}>
      {status.kind === 'working' && <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />}
      <span className="min-w-0">
        {status.message}
        {status.txHash && explorerUrl && (
          <a href={explorerUrl(status.txHash)} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center gap-0.5 font-bold underline">
            View <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </span>
    </p>
  );
};

export const formatTokenAmount = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (value >= 1) return value.toLocaleString('en-US', { maximumFractionDigits: 4 });
  return value.toPrecision(4);
};
