// Per-browser market preferences: the watchlist and the advanced table filters (with named
// presets). Stored in localStorage; every read tolerates missing or blocked storage.
import type { Token } from '../types';

const WATCHLIST_KEY = 'bankrdex-watchlist';
const FILTERS_KEY = 'bankrdex-filters';
const PRESETS_KEY = 'bankrdex-filter-presets';
export const WATCHLIST_EVENT = 'bankrdex:watchlist';

export const watchKey = (token: Pick<Token, 'address' | 'chain'>) => `${token.chain ?? 'base'}:${token.address.toLowerCase()}`;

export function readWatchlist(): Set<string> {
  try {
    const value = JSON.parse(window.localStorage.getItem(WATCHLIST_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && /^[a-z]+:0x[a-f0-9]{40}$/.test(item)) : []);
  } catch {
    return new Set();
  }
}

export function toggleWatch(token: Pick<Token, 'address' | 'chain'>): Set<string> {
  const list = readWatchlist();
  const key = watchKey(token);
  if (list.has(key)) list.delete(key);
  else list.add(key);
  try {
    window.localStorage.setItem(WATCHLIST_KEY, JSON.stringify([...list].slice(-500)));
  } catch {
    // Watchlist stays for this session only.
  }
  window.dispatchEvent(new Event(WATCHLIST_EVENT));
  return list;
}

export interface MarketFilters {
  mcapMin: number | null;
  mcapMax: number | null;
  liquidityMin: number | null;
  volumeMin: number | null;
  ageMaxHours: number | null;
  txnsMin: number | null;
  hasSocials: boolean;
  hideFakeSymbols: boolean;
  livePoolOnly: boolean;
}

export const EMPTY_FILTERS: MarketFilters = {
  mcapMin: null,
  mcapMax: null,
  liquidityMin: null,
  volumeMin: null,
  ageMaxHours: null,
  txnsMin: null,
  hasSocials: false,
  hideFakeSymbols: false,
  livePoolOnly: false,
};

const numberOrNull = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

function parseFilters(value: unknown): MarketFilters {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    mcapMin: numberOrNull(raw.mcapMin),
    mcapMax: numberOrNull(raw.mcapMax),
    liquidityMin: numberOrNull(raw.liquidityMin),
    volumeMin: numberOrNull(raw.volumeMin),
    ageMaxHours: numberOrNull(raw.ageMaxHours),
    txnsMin: numberOrNull(raw.txnsMin),
    hasSocials: raw.hasSocials === true,
    hideFakeSymbols: raw.hideFakeSymbols === true,
    livePoolOnly: raw.livePoolOnly === true,
  };
}

export function readFilters(): MarketFilters {
  try {
    return parseFilters(JSON.parse(window.localStorage.getItem(FILTERS_KEY) ?? 'null'));
  } catch {
    return EMPTY_FILTERS;
  }
}

export function writeFilters(filters: MarketFilters): void {
  try {
    window.localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
  } catch {
    // Filters apply for this session only.
  }
}

export const activeFilterCount = (filters: MarketFilters) =>
  Object.entries(filters).filter(([, value]) => value !== null && value !== false).length;

export function readPresets(): Record<string, MarketFilters> {
  try {
    const value = JSON.parse(window.localStorage.getItem(PRESETS_KEY) ?? '{}') as Record<string, unknown>;
    return Object.fromEntries(Object.entries(value).slice(0, 20).map(([name, filters]) => [name.slice(0, 30), parseFilters(filters)]));
  } catch {
    return {};
  }
}

export function savePreset(name: string, filters: MarketFilters): Record<string, MarketFilters> {
  const presets = { ...readPresets(), [name.trim().slice(0, 30)]: filters };
  try {
    window.localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
  } catch {
    // Presets stay for this session only.
  }
  return presets;
}

export function deletePreset(name: string): Record<string, MarketFilters> {
  const presets = readPresets();
  delete presets[name];
  try {
    window.localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
  } catch {
    // ignore
  }
  return presets;
}
