import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Target, TrendingDown, TrendingUp, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useSocial } from '../../context/SocialContext';
import { postThesis, riskReward, THESIS_TIMEFRAMES, TIMEFRAME_LABEL, type Stance, type ThesisTimeframe } from '../../services/social';
import { OkxTokenLogo } from '../OkxTokenLogo';
import { formatPrice } from './SocialBits';

const toInput = (value: number) => (value > 0 ? Number(value.toPrecision(4)).toString() : '');

export const ThesisComposer: React.FC = () => {
  const { activeToken } = useApp();
  const { composer, closeComposer, bumpTheses, profile } = useSocial();
  const price = activeToken.priceUsd;
  const [stance, setStance] = useState<Stance>(composer.thesis?.stance ?? 'bullish');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [timeframe, setTimeframe] = useState<ThesisTimeframe>('1w');
  const [entry, setEntry] = useState(toInput(price));
  const [target, setTarget] = useState(toInput(price * 2));
  const [stop, setStop] = useState(toInput(price * 0.7));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Flip suggested levels when the stance changes.
  useEffect(() => {
    if (!(price > 0)) return;
    setEntry(toInput(price));
    setTarget(toInput(stance === 'bullish' ? price * 2 : price * 0.5));
    setStop(toInput(stance === 'bullish' ? price * 0.7 : price * 1.3));
  }, [price, stance]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeComposer(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [closeComposer]);

  const levels = { entry: Number(entry) || null, target: Number(target) || null, stop: Number(stop) || null };
  const ratio = riskReward(stance, levels.entry, levels.target, levels.stop);
  const upside = levels.entry && levels.target ? (levels.target / levels.entry - 1) * 100 : null;
  const downside = levels.entry && levels.stop ? (levels.stop / levels.entry - 1) * 100 : null;
  const bullish = stance === 'bullish';
  const chain = activeToken.chain ?? 'base';

  const marker = useMemo(() => {
    // Where entry and current price sit between stop and target, for the mini range bar.
    const { stop: low, target: high } = bullish ? levels : { stop: levels.target, target: levels.stop };
    if (!low || !high || high <= low) return null;
    const at = (value: number | null) => value ? Math.min(100, Math.max(0, ((value - low) / (high - low)) * 100)) : null;
    return { entry: at(levels.entry), now: at(price) };
  }, [bullish, levels, price]);

  if (!composer.open) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await postThesis({ chain, tokenAddress: activeToken.address, stance, title, content, timeframe, entryPrice: levels.entry, targetPrice: levels.target, stopPrice: levels.stop });
      bumpTheses();
      closeComposer();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not publish the thesis.');
    } finally {
      setBusy(false);
    }
  };

  const input = 'w-full rounded-xl border border-line bg-sunken/60 px-3 py-2.5 text-sm text-fg outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20';
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="New thesis">
      <button type="button" aria-label="Close" className="absolute inset-0 cursor-default" onClick={closeComposer} />
      <form onSubmit={submit} className="relative flex max-h-[94dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-line bg-panel shadow-2xl shadow-black/60 sm:rounded-3xl">
        <div className={`flex items-center justify-between gap-3 border-b border-line px-5 py-4 ${bullish ? 'bg-gradient-to-r from-up/10 to-transparent' : 'bg-gradient-to-r from-down/10 to-transparent'}`}>
          <div className="flex min-w-0 items-center gap-3">
            <OkxTokenLogo logo={activeToken.logo} symbol={activeToken.symbol} name={activeToken.name} size="lg" />
            <div className="min-w-0">
              <h2 className="truncate text-base font-extrabold text-fg">New thesis · ${activeToken.symbol}</h2>
              <p className="text-xs text-muted">Now {formatPrice(price)} · posting as @{profile?.username}</p>
            </div>
          </div>
          <button type="button" onClick={closeComposer} aria-label="Close" className="rounded-full p-1.5 text-muted hover:bg-raised hover:text-fg"><X className="h-4 w-4" /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Stance">
            {(['bullish', 'bearish'] as const).map((option) => (
              <button key={option} type="button" role="radio" aria-checked={stance === option} onClick={() => setStance(option)}
                className={`flex items-center justify-center gap-2 rounded-2xl border py-3 text-sm font-extrabold transition ${stance === option
                  ? option === 'bullish' ? 'border-up/60 bg-up/15 text-up shadow-[0_0_24px_-8px_var(--bd-up)]' : 'border-down/60 bg-down/15 text-down shadow-[0_0_24px_-8px_var(--bd-down)]'
                  : 'border-line text-muted hover:text-fg'}`}>
                {option === 'bullish' ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                {option === 'bullish' ? 'Bullish · long' : 'Bearish · short'}
              </button>
            ))}
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-fg-soft">Title</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} required minLength={3} maxLength={100} placeholder={bullish ? 'Volume breakout, next leg to 2x' : 'Supply unlock incoming, fading the pump'} className={input} />
          </label>
          <label className="block">
            <span className="mb-1 flex justify-between text-xs font-semibold text-fg-soft">Your reasoning <span className="font-normal text-subtle">{content.length}/2000</span></span>
            <textarea value={content} onChange={(event) => setContent(event.target.value)} required maxLength={2000} rows={5} placeholder="Catalysts, on-chain flows, holders, chart levels… Why now?" className={`${input} resize-y`} />
          </label>

          <div>
            <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-fg-soft"><Target className="h-3.5 w-3.5 text-accent" /> Trade plan (USD price)</span>
            <div className="grid grid-cols-3 gap-2">
              {([['Entry', entry, setEntry, 'text-warn'], ['Target', target, setTarget, 'text-up'], ['Stop', stop, setStop, 'text-down']] as const).map(([label, value, setter, color]) => (
                <label key={label} className="block">
                  <span className={`mb-0.5 block text-[0.6875rem] font-bold uppercase tracking-wider ${color}`}>{label}</span>
                  <input value={value} onChange={(event) => setter(event.target.value.replace(/[^0-9.e-]/g, ''))} inputMode="decimal" className={`${input} font-mono`} />
                </label>
              ))}
            </div>
            {marker && (
              <div className="mt-3">
                <div className="relative h-2 rounded-full bg-gradient-to-r from-down/70 via-warn/60 to-up/70">
                  {marker.entry !== null && <span className="absolute top-1/2 h-4 w-1 -translate-y-1/2 rounded bg-warn" style={{ left: `${marker.entry}%` }} title="Entry" />}
                  {marker.now !== null && <span className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-panel bg-fg" style={{ left: `${marker.now}%` }} title="Now" />}
                </div>
                <div className="mt-1 flex justify-between text-[0.6875rem] text-subtle"><span>{bullish ? 'Stop' : 'Target'}</span><span>● now</span><span>{bullish ? 'Target' : 'Stop'}</span></div>
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {upside !== null && <span className={`rounded-full px-2 py-0.5 font-bold ${bullish ? 'bg-up/10 text-up' : 'bg-down/10 text-down'}`}>Target {upside >= 0 ? '+' : ''}{upside.toFixed(1)}%</span>}
              {downside !== null && <span className="rounded-full bg-raised px-2 py-0.5 font-bold text-fg-soft">Stop {downside >= 0 ? '+' : ''}{downside.toFixed(1)}%</span>}
              {ratio !== null && <span className={`rounded-full px-2 py-0.5 font-bold ${ratio >= 2 ? 'bg-accent/15 text-accent' : 'bg-raised text-muted'}`}>R:R {ratio.toFixed(2)}</span>}
            </div>
          </div>

          <div>
            <span className="mb-1.5 block text-xs font-semibold text-fg-soft">Timeframe</span>
            <div className="flex flex-wrap gap-1.5">
              {THESIS_TIMEFRAMES.map((option) => (
                <button key={option} type="button" onClick={() => setTimeframe(option)} aria-pressed={timeframe === option}
                  className={`rounded-full px-3 py-1 text-xs font-bold transition ${timeframe === option ? 'bg-accent text-black' : 'border border-line text-muted hover:text-fg'}`}>
                  {TIMEFRAME_LABEL[option]}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[0.6875rem] leading-relaxed text-subtle">Theses are public opinions, not financial advice. The price at posting is recorded from the on-chain index so performance is tracked honestly.</p>
          {error && <p role="alert" className="rounded-xl border border-down/40 bg-down/10 px-3 py-2 text-xs text-down">{error}</p>}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-line px-5 py-3">
          <button type="button" onClick={closeComposer} className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-fg-soft hover:bg-raised">Cancel</button>
          <button type="submit" disabled={busy} className="btn-gradient inline-flex items-center gap-2 rounded-xl px-5 py-2 text-sm font-extrabold text-white disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Publish thesis
          </button>
        </div>
      </form>
    </div>
  );
};
