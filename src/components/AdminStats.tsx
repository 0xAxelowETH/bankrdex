'use client';

import { useCallback, useEffect, useState } from 'react';

const KEY_STORAGE = 'bankrdex-admin-key';
const REFRESH_MS = 10_000;

interface Stats {
  onlineNow: number;
  today: number;
  last7d: number;
  last30d: number;
  allTime: number;
  newToday: number;
  walletsToday: number;
  walletsAllTime: number;
  daily: { day: string; visitors: number; new: number }[];
}

const count = (value: number) => value.toLocaleString('en-US');

function readKey(): string {
  try {
    return window.sessionStorage.getItem(KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

function forgetKey() {
  try {
    window.sessionStorage.removeItem(KEY_STORAGE);
  } catch {
    // Storage unavailable: nothing to forget.
  }
}

// Operator-only dashboard for the anonymous visitor statistics. The key stays in this tab only.
export function AdminStats() {
  const [key, setKey] = useState('');
  const [draft, setDraft] = useState('');
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  useEffect(() => { setKey(readKey()); }, []);

  const load = useCallback(async (secret: string) => {
    try {
      const response = await fetch('/api/admin/stats', {
        headers: { Authorization: `Bearer ${secret}` },
        cache: 'no-store',
      });
      const payload = await response.json() as Stats & { error?: string };
      if (response.status === 401) {
        forgetKey();
        setKey('');
        setError('Wrong key.');
        return;
      }
      if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
      setStats(payload);
      setError(null);
      setUpdatedAt(Date.now());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Statistics are unavailable.');
    }
  }, []);

  useEffect(() => {
    if (!key) return;
    void load(key);
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(key);
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [key, load]);

  if (!key) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface px-4 text-fg">
        <form
          className="w-full max-w-sm space-y-3 rounded-xl border border-line bg-raised p-5"
          onSubmit={(event) => {
            event.preventDefault();
            const secret = draft.trim();
            if (!secret) return;
            try {
              window.sessionStorage.setItem(KEY_STORAGE, secret);
            } catch {
              // Keep the key in memory only.
            }
            setError(null);
            setKey(secret);
          }}
        >
          <h1 className="text-base font-bold">BankrDex visitor stats</h1>
          <label htmlFor="admin-key" className="block text-xs text-muted">Admin key</label>
          <input
            id="admin-key"
            type="password"
            autoComplete="off"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
          {error && <p className="text-xs text-down">{error}</p>}
          <button type="submit" className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-bold text-black">Open</button>
        </form>
      </main>
    );
  }

  const maxDaily = Math.max(1, ...(stats?.daily.map((day) => day.visitors) ?? [0]));
  const tiles: { label: string; value: number | undefined; hint?: string; live?: boolean }[] = [
    { label: 'Online now', value: stats?.onlineNow, hint: 'Active in the last 2 minutes', live: true },
    { label: 'Today', value: stats?.today, hint: 'Unique visitors since 00:00 UTC' },
    { label: 'New today', value: stats?.newToday, hint: 'First visit today' },
    { label: 'Last 7 days', value: stats?.last7d },
    { label: 'Last 30 days', value: stats?.last30d },
    { label: 'All time', value: stats?.allTime },
    { label: 'Wallets today', value: stats?.walletsToday, hint: 'Connected a wallet' },
    { label: 'Wallets all time', value: stats?.walletsAllTime },
  ];

  return (
    <main className="min-h-screen bg-surface px-4 py-6 text-fg">
      <div className="mx-auto max-w-4xl space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-bold">BankrDex visitor stats</h1>
          <div className="flex items-center gap-3 text-xs text-muted">
            {updatedAt && <span>Updated {new Date(updatedAt).toLocaleTimeString()} · every 10s</span>}
            <button
              type="button"
              onClick={() => {
                forgetKey();
                setKey('');
                setStats(null);
              }}
              className="rounded border border-line px-2 py-1 hover:bg-raised"
            >
              Lock
            </button>
          </div>
        </header>

        {error && <p className="rounded-lg border border-line bg-raised px-3 py-2 text-sm text-down">{error}</p>}

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Totals">
          {tiles.map((tile) => (
            <div key={tile.label} className="rounded-xl border border-line bg-raised p-3" title={tile.hint}>
              <p className="flex items-center gap-1.5 text-xs text-muted">
                {tile.live && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-up" aria-hidden="true" />}
                {tile.label}
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{tile.value === undefined ? '…' : count(tile.value)}</p>
            </div>
          ))}
        </section>

        <section className="rounded-xl border border-line bg-raised p-4" aria-labelledby="daily-title">
          <h2 id="daily-title" className="text-sm font-bold">Unique visitors per day (UTC, last 14 days)</h2>
          {stats && stats.daily.length > 0 ? (
            <ol className="mt-4 flex h-44 items-end gap-1.5">
              {stats.daily.map((day) => (
                <li
                  key={day.day}
                  className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
                  title={`${day.day}: ${day.visitors} visitors, ${day.new} new`}
                >
                  <span className="text-[0.625rem] tabular-nums text-muted">{day.visitors}</span>
                  <span
                    className="flex w-full flex-col justify-end overflow-hidden rounded-t bg-accent/25"
                    style={{ height: `${(day.visitors / maxDaily) * 100}%` }}
                  >
                    <span className="w-full bg-accent" style={{ height: `${day.visitors ? (day.new / day.visitors) * 100 : 0}%` }} />
                  </span>
                  <span className="text-[0.625rem] text-subtle">{day.day.slice(5)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-sm text-muted">{stats ? 'No visits recorded yet.' : 'Loading…'}</p>
          )}
          <p className="mt-3 flex items-center gap-3 text-[0.6875rem] text-muted">
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-accent" />New</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-accent/25" />Returning</span>
          </p>
        </section>

        <p className="text-xs text-subtle">
          One visitor = one browser (all its tabs), merged across devices when the same wallet is connected.
          Bots are excluded. Visitors are counted only after accepting the Terms and Privacy Policy.
        </p>
      </div>
    </main>
  );
}
