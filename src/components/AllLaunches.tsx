'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Loader2, Search } from 'lucide-react';
import { formatTokenAge } from './MarketTableParts';

// Every Bankr launch on Base, newest first, from the on-chain registry (/api/bankr-launches).
// The market table only shows tokens with trading activity; this list includes all of them.

interface LaunchItem {
  address: string;
  name: string | null;
  symbol: string | null;
  quoteSymbol: string;
  block: number;
  launchedAt: number;
  txHash: string;
}

interface LaunchPage {
  launches: LaunchItem[];
  total: number;
  next: number | null;
  complete: boolean;
  excluded?: number;
}

const PAGE_SIZE = 50;

const age = (ms: number) => ms ? formatTokenAge(Date.now() - ms) : '—';

async function fetchPage(before: number | null, query: string, signal: AbortSignal): Promise<LaunchPage> {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (before) params.set('before', String(before));
  if (query) params.set('q', query);
  const response = await fetch(`/api/bankr-launches?${params}`, { headers: { Accept: 'application/json' }, signal });
  if (!response.ok) throw new Error(`The launch registry is unavailable (${response.status}).`);
  return response.json() as Promise<LaunchPage>;
}

export function AllLaunches() {
  const [items, setItems] = useState<LaunchItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [complete, setComplete] = useState(true);
  const [excluded, setExcluded] = useState(0);
  const [next, setNext] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [state, setState] = useState<'loading' | 'idle' | 'error'>('loading');
  const [error, setError] = useState('');
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async (before: number | null, search: string) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState('loading');
    try {
      const page = await fetchPage(before, search, controller.signal);
      setItems((current) => before ? [...current, ...page.launches] : page.launches);
      setTotal(page.total >= 0 ? page.total : null);
      setComplete(page.complete);
      setExcluded(page.excluded ?? 0);
      setNext(page.next);
      setState('idle');
    } catch (loadError) {
      if (controller.signal.aborted) return;
      setError(loadError instanceof Error ? loadError.message : 'Unable to load launches.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load(null, submitted);
    return () => controllerRef.current?.abort();
  }, [load, submitted]);

  const hourAgo = Date.now() - 3_600_000;
  const lastHour = items.filter((item) => item.launchedAt > hourAgo).length;
  const lastHourCapped = items.length > 0 && items[items.length - 1].launchedAt > hourAgo;
  const newest = items[0]?.launchedAt ?? 0;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
      <section className="page-hero mb-4 rounded-3xl border border-line p-5 sm:p-6">
        <div className="relative z-10 grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-[0.6875rem] font-extrabold uppercase tracking-wider text-accent">
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-up" /> On-chain registry
            </span>
            <h1 className="font-display mt-2 text-2xl font-bold tracking-tight sm:text-3xl">All Bankr launches</h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">
              Every token launched with Bankr on Base, read from the chain (Doppler Airlock), newest first. Search by
              contract address; symbol search needs the Supabase import.
            </p>
            <p className="mt-1 max-w-2xl text-xs text-subtle">
              Each launch is checked on-chain: Bankr as the Doppler integrator, plus Bankr&apos;s fee split or Bankr&apos;s Doppler hook.
            </p>
            {!complete && (
              <p className="mt-1 text-xs text-warn">
                Only launches seen since this server started are listed. Import the full history into Supabase to see all of them (see README).
              </p>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 lg:w-[32rem]">
            {([
              [submitted ? 'Matches' : 'Verified launches', total !== null ? total : '—', 'text-fg'],
              ['Look-alikes cut', excluded > 0 ? excluded.toLocaleString('en-US') : '—', 'text-warn'],
              ['Last hour', items.length > 0 && !submitted ? `${lastHour}${lastHourCapped ? '+' : ''}` : '—', 'text-accent'],
            ] as const).map(([label, value, tone]) => (
              <div key={label} className="hero-stat min-w-0 rounded-2xl px-3 py-2.5">
                <div className="bd-label truncate">{label}</div>
                <div className={`mt-1 truncate font-mono text-[0.95rem] font-extrabold sm:text-lg ${tone}`} title={typeof value === 'number' ? value.toLocaleString('en-US') : undefined}>
                  {typeof value === 'number'
                    ? <><span className="sm:hidden">{value.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 2 })}</span><span className="hidden sm:inline">{value.toLocaleString('en-US')}</span></>
                    : value}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">
          {newest > 0 && !submitted ? <>Newest launch <strong className="text-fg">{age(newest)}</strong> ago · </> : null}
          {items.length.toLocaleString('en-US')} loaded
        </p>
        <form
          onSubmit={(event) => { event.preventDefault(); setSubmitted(query.trim()); }}
          className="flex w-full items-center gap-2 sm:w-auto"
          role="search"
        >
          <label className="relative flex-1 sm:w-80">
            <span className="sr-only">Search by symbol or contract address</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Symbol or 0x address"
              className="bd-input w-full pl-9 pr-3 text-sm"
            />
          </label>
          <button type="submit" className="btn-gradient h-9 rounded-xl px-4 text-sm font-extrabold">Search</button>
        </form>
      </div>

      <div className="bd-card overflow-x-auto">
        <table className="w-full text-sm sm:min-w-[40rem]">
          <thead className="border-b border-line text-left text-[0.6875rem] uppercase tracking-[0.1em] text-subtle">
            <tr>
              <th scope="col" className="px-3 py-2">Token</th>
              <th scope="col" className="hidden px-3 py-2 sm:table-cell">Pair</th>
              <th scope="col" className="hidden px-3 py-2 sm:table-cell">Contract</th>
              <th scope="col" className="px-3 py-2 text-right">Age</th>
              <th scope="col" className="px-3 py-2 text-right"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.address} className="border-b border-line/60 transition-colors last:border-0 hover:bg-raised/60">
                <td className="px-3 py-2">
                  <span className="block max-w-[11rem] truncate font-semibold text-fg sm:max-w-none">{item.symbol ? `$${item.symbol}` : '—'}</span>
                  <span className="block max-w-[11rem] truncate text-xs text-muted sm:max-w-[18rem]" title={item.name ?? undefined}>{item.name || '—'}<span className="font-mono text-subtle sm:hidden"> · {item.address.slice(0, 6)}…{item.address.slice(-3)}</span></span>
                </td>
                <td className="hidden px-3 py-2 text-fg-soft sm:table-cell">{item.quoteSymbol}</td>
                <td className="hidden px-3 py-2 font-mono text-xs text-muted sm:table-cell">{item.address.slice(0, 8)}…{item.address.slice(-6)}</td>
                <td className="px-3 py-2 text-right" title={item.launchedAt ? new Date(item.launchedAt).toLocaleString() : undefined}>
                  <span className={`rounded-md px-1.5 py-0.5 font-mono text-xs font-semibold ${item.launchedAt > hourAgo ? 'bg-accent/10 text-accent' : 'bg-raised text-fg-soft'}`}>{age(item.launchedAt)}</span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-2">
                    <a href={`https://basescan.org/tx/${item.txHash}`} target="_blank" rel="noopener noreferrer" aria-label={`Launch transaction of ${item.symbol ?? item.address}`} className="hidden h-8 w-8 items-center justify-center rounded-lg text-subtle hover:bg-raised hover:text-fg sm:inline-flex">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <Link href={`/token/${item.address}`} className="btn-trade rounded-lg px-3 py-1 text-xs font-extrabold">Trade</Link>
                  </div>
                </td>
              </tr>
            ))}
            {state !== 'loading' && items.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-muted">{state === 'error' ? error : 'No launches found.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex justify-center">
        {state === 'loading' ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted" aria-label="Loading launches" />
        ) : state === 'error' && items.length > 0 ? (
          <button type="button" onClick={() => void load(next, submitted)} className="rounded-lg border border-line px-4 py-2 text-sm text-down">Retry</button>
        ) : next ? (
          <button type="button" onClick={() => void load(next, submitted)} className="bd-control px-5 font-bold">Load more</button>
        ) : null}
      </div>
    </main>
  );
}
