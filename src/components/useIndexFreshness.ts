import { useSyncExternalStore } from 'react';

// How far the on-chain index (charts, trades, 24h stats on Base) is behind the chain, polled from
// /api/market/freshness by one shared timer for every component that asks.
export type IndexState = 'live' | 'delayed' | 'stale' | 'unknown';
export interface IndexFreshness {
  state: IndexState;
  lagSeconds: number | null;
}

const POLL_MS = 30_000;
// Up to 90 s behind is normal (blocks are read in batches); past 10 minutes the data is stale.
const LIVE_LAG_S = 90;
const STALE_LAG_S = 600;

let snapshot: IndexFreshness = { state: 'unknown', lagSeconds: null };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

async function poll() {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  let next: IndexFreshness;
  try {
    const response = await fetch('/api/market/freshness', { cache: 'no-store' });
    // 503: no index on this deployment; charts then come from other sources, nothing to warn about.
    if (!response.ok) next = { state: response.status === 503 ? 'unknown' : 'stale', lagSeconds: null };
    else {
      const body = await response.json() as { lagSeconds?: number | null };
      const lag = typeof body.lagSeconds === 'number' ? body.lagSeconds : null;
      next = { lagSeconds: lag, state: lag === null ? 'unknown' : lag <= LIVE_LAG_S ? 'live' : lag < STALE_LAG_S ? 'delayed' : 'stale' };
    }
  } catch {
    next = { state: 'unknown', lagSeconds: null };
  }
  if (next.state !== snapshot.state || next.lagSeconds !== snapshot.lagSeconds) {
    snapshot = next;
    listeners.forEach((listener) => listener());
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    void poll();
    timer = setInterval(() => void poll(), POLL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

export function useIndexFreshness(): IndexFreshness {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

export function formatLag(seconds: number | null): string {
  if (seconds === null) return 'unknown';
  if (seconds < 120) return `${Math.round(seconds)}s`;
  if (seconds < 7_200) return `${Math.round(seconds / 60)}m`;
  if (seconds < 172_800) return `${Math.round(seconds / 3_600)}h`;
  return `${Math.round(seconds / 86_400)}d`;
}
