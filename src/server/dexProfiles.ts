import { CHAINS, type ChainKey } from '../config/chains';
import { runInBackground } from './background';

// DexScreener token profiles: logo, banner, links and whether the token has a paid profile.
//   info  GET api.dexscreener.com/tokens/v1/{chain}/{a,b,…}  30 tokens per request, 300 req/min.
//         A pair carries `info` (image, websites, socials) once the token's profile was set up.
//   paid  GET api.dexscreener.com/orders/v1/{chain}/{token}   60 req/min.
//         Paid = an approved Enhanced Token Info ("tokenProfile") or Community Takeover order.
// `info` alone is not proof of payment (a token can keep it after its orders were cancelled), so
// the orders are read for every token that has `info`; tokens without `info` cannot be paid.
// Links from a paid profile are the ones the team or community registered with DexScreener.

export interface DexLink {
  label: string;
  url: string;
}

export interface DexSocials {
  twitter?: string;
  telegram?: string;
  discord?: string;
  farcaster?: string;
  website?: string;
  // Further websites and socials (docs, Warpcast page, TikTok, …).
  links?: DexLink[];
}

export type DexPaidType = 'tokenProfile' | 'communityTakeover';

export interface DexProfile {
  // true / false once the orders were read; null while unknown (not read yet or the read failed).
  paid: boolean | null;
  paidType?: DexPaidType;
  imageUrl?: string;
  headerUrl?: string;
  // Only set for paid profiles.
  socials?: DexSocials;
}

interface DexInfo {
  imageUrl?: string;
  headerUrl?: string;
  socials?: DexSocials;
}

const ADDRESS = /^0x[a-f0-9]{40}$/;
const BATCH = 30;
const INFO_TTL_MS = 15 * 60_000;
const PAID_TTL_MS = 60 * 60_000;
const PAID_RETRY_MS = 5 * 60_000;
// orders/v1 allows 60 requests a minute per IP.
const ORDERS_INTERVAL_MS = 1_100;
// Paid checks one background catalog refresh may queue (about 45 s of orders requests).
const BACKGROUND_PAID_CHECKS = 40;
const MAX_LINKS = 6;
const MAX_ENTRIES = 20_000;

const infoCache = new Map<string, { info: DexInfo | null; at: number }>();
const paidCache = new Map<string, { paid: boolean | null; paidType?: DexPaidType; at: number }>();
const cacheKey = (chain: ChainKey, address: string) => `${chain}:${address}`;

function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && url.hostname.includes('.') ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

const dexImage = (value: unknown) => {
  const url = httpsUrl(value);
  return url && /(^|\.)dexscreener\.com$/.test(new URL(url).hostname) ? url : undefined;
};

const SOCIAL_FIELDS: Record<string, keyof Omit<DexSocials, 'website' | 'links'>> = {
  twitter: 'twitter',
  x: 'twitter',
  telegram: 'telegram',
  discord: 'discord',
  farcaster: 'farcaster',
  warpcast: 'farcaster',
};

const label = (value: unknown, fallback: string) => {
  const text = typeof value === 'string' ? value.trim().slice(0, 24) : '';
  return text ? text[0].toUpperCase() + text.slice(1) : fallback;
};

// `info` of a DexScreener pair -> logo, banner and https links (other schemes are dropped).
export function parseDexInfo(raw: unknown): DexInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as { imageUrl?: unknown; header?: unknown; websites?: unknown; socials?: unknown };
  const socials: DexSocials = {};
  const links: DexLink[] = [];
  for (const item of Array.isArray(record.socials) ? record.socials as { type?: unknown; url?: unknown }[] : []) {
    const url = httpsUrl(item?.url);
    if (!url) continue;
    const field = SOCIAL_FIELDS[String(item?.type ?? '').toLowerCase()];
    if (field && !socials[field]) socials[field] = url;
    else links.push({ label: label(item?.type, 'Link'), url });
  }
  for (const item of Array.isArray(record.websites) ? record.websites as { label?: unknown; url?: unknown }[] : []) {
    const url = httpsUrl(item?.url);
    if (!url) continue;
    if (!socials.website) socials.website = url;
    else links.push({ label: label(item?.label, 'Website'), url });
  }
  if (links.length > 0) socials.links = links.slice(0, MAX_LINKS);
  const imageUrl = dexImage(record.imageUrl);
  const headerUrl = dexImage(record.header);
  const hasSocials = Object.keys(socials).length > 0;
  if (!imageUrl && !headerUrl && !hasSocials) return null;
  return { imageUrl, headerUrl, socials: hasSocials ? socials : undefined };
}

// orders/v1 response ({ orders: [...] } or a bare array) -> paid profile or not.
export function paidFromOrders(payload: unknown): { paid: boolean; paidType?: DexPaidType } {
  const orders = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { orders?: unknown } | null)?.orders) ? (payload as { orders: unknown[] }).orders : [];
  const approved = new Set(orders
    .filter((order) => String((order as { status?: unknown })?.status ?? '').toLowerCase() === 'approved')
    .map((order) => String((order as { type?: unknown })?.type ?? '').toLowerCase()));
  if (approved.has('tokenprofile')) return { paid: true, paidType: 'tokenProfile' };
  if (approved.has('communitytakeover')) return { paid: true, paidType: 'communityTakeover' };
  return { paid: false };
}

function prune(cache: Map<string, unknown>) {
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
}

async function loadInfo(chain: ChainKey, addresses: string[]): Promise<void> {
  for (let index = 0; index < addresses.length; index += BATCH) {
    const batch = addresses.slice(index, index + BATCH);
    try {
      const response = await fetch(`https://api.dexscreener.com/tokens/v1/${CHAINS[chain].dexscreenerChain}/${batch.join(',')}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`DexScreener tokens failed (${response.status}).`);
      const pairs: unknown = await response.json();
      const found = new Map<string, DexInfo>();
      for (const pair of Array.isArray(pairs) ? pairs : []) {
        const record = (pair ?? {}) as { baseToken?: { address?: unknown }; info?: unknown };
        const base = typeof record.baseToken?.address === 'string' ? record.baseToken.address.toLowerCase() : '';
        if (!base || found.has(base)) continue;
        const info = parseDexInfo(record.info);
        if (info) found.set(base, info);
      }
      const now = Date.now();
      for (const address of batch) infoCache.set(cacheKey(chain, address), { info: found.get(address) ?? null, at: now });
    } catch (error) {
      // Stale entries stay in use; missing ones are retried on the next request.
      console.warn('DexScreener profiles unavailable:', error instanceof Error ? error.message : error);
    }
  }
  prune(infoCache);
}

// ---- Paid checks: one orders request at a time, spaced for the rate limit. Requests made for a
// visitor (high) go before background catalog refreshes (low).
type Priority = 'high' | 'low';
interface PaidJob {
  chain: ChainKey;
  address: string;
  done: Promise<void>;
  resolve: () => void;
}
const queues: Record<Priority, PaidJob[]> = { high: [], low: [] };
const queuedJobs = new Map<string, { job: PaidJob; priority: Priority }>();
let pumping = false;
let lastOrdersAt = 0;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function readPaid(chain: ChainKey, address: string): Promise<void> {
  const key = cacheKey(chain, address);
  try {
    const response = await fetch(`https://api.dexscreener.com/orders/v1/${CHAINS[chain].dexscreenerChain}/${address}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`DexScreener orders failed (${response.status}).`);
    paidCache.set(key, { ...paidFromOrders(await response.json()), at: Date.now() });
  } catch {
    // Keep what was known and try again after PAID_RETRY_MS.
    const previous = paidCache.get(key);
    paidCache.set(key, { paid: previous?.paid ?? null, paidType: previous?.paidType, at: Date.now() - PAID_TTL_MS + PAID_RETRY_MS });
  }
  prune(paidCache);
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const job = queues.high.shift() ?? queues.low.shift();
      if (!job) break;
      const wait = lastOrdersAt + ORDERS_INTERVAL_MS - Date.now();
      if (wait > 0) await sleep(wait);
      lastOrdersAt = Date.now();
      await readPaid(job.chain, job.address);
      queuedJobs.delete(cacheKey(job.chain, job.address));
      job.resolve();
    }
  } finally {
    pumping = false;
  }
}

function queuePaidCheck(chain: ChainKey, address: string, priority: Priority): Promise<void> {
  const key = cacheKey(chain, address);
  const queued = queuedJobs.get(key);
  if (queued) {
    // A visitor now needs a token the background queued: move it to the front line.
    if (priority === 'high' && queued.priority === 'low') {
      const index = queues.low.indexOf(queued.job);
      if (index >= 0) {
        queues.low.splice(index, 1);
        queues.high.push(queued.job);
        queued.priority = 'high';
      }
    }
    return queued.job.done;
  }
  let resolve!: () => void;
  const done = new Promise<void>((settle) => { resolve = settle; });
  const job: PaidJob = { chain, address, done, resolve };
  queuedJobs.set(key, { job, priority });
  queues[priority].push(job);
  void pump();
  return done;
}

const needsPaidCheck = (chain: ChainKey, address: string, now: number) => {
  const key = cacheKey(chain, address);
  if (!infoCache.get(key)?.info) return false;
  const paid = paidCache.get(key);
  return !paid || now - paid.at > PAID_TTL_MS;
};

function profileOf(chain: ChainKey, address: string): DexProfile {
  const key = cacheKey(chain, address);
  const entry = infoCache.get(key);
  if (!entry) return { paid: null };
  if (!entry.info) return { paid: false };
  const paid = paidCache.get(key);
  return {
    paid: paid?.paid ?? null,
    paidType: paid?.paid ? paid.paidType : undefined,
    imageUrl: entry.info.imageUrl,
    headerUrl: entry.info.headerUrl,
    socials: paid?.paid ? entry.info.socials : undefined,
  };
}

const uniqueAddresses = (addresses: string[]) => [...new Set(addresses.map((address) => address.toLowerCase()).filter((address) => ADDRESS.test(address)))];

// Profiles for one chain. Waits up to `waitMs` for paid checks that are not cached yet; the rest
// come back as paid: null and are answered by a later request.
export async function getDexProfiles(chain: ChainKey, addresses: string[], waitMs = 0): Promise<Record<string, DexProfile>> {
  const unique = uniqueAddresses(addresses);
  const now = Date.now();
  const stale = unique.filter((address) => {
    const hit = infoCache.get(cacheKey(chain, address));
    return !hit || now - hit.at > INFO_TTL_MS;
  });
  if (stale.length > 0) await loadInfo(chain, stale);
  const checks = unique
    .filter((address) => needsPaidCheck(chain, address, Date.now()))
    .map((address) => queuePaidCheck(chain, address, 'high'));
  if (checks.length > 0 && waitMs > 0) await Promise.race([Promise.allSettled(checks), sleep(waitMs)]);
  return Object.fromEntries(unique.map((address) => [address, profileOf(chain, address)]));
}

// Profile from the cache only (no requests).
export function cachedDexProfile(chain: ChainKey, address: string): DexProfile | undefined {
  const key = cacheKey(chain, address.toLowerCase());
  return infoCache.has(key) ? profileOf(chain, address.toLowerCase()) : undefined;
}

let backgroundRefresh = false;

// Catalog tokens with the links of their paid DexScreener profile (`dexSocials`, `dexPaid`), read
// from the cache so the catalog never waits on DexScreener. Missing or stale profiles are loaded
// in the background and show up in a later response.
export function withDexSocials<T extends { address: string; chain: ChainKey; imageUrl?: string }>(tokens: T[]): (T & { dexSocials?: DexSocials; dexPaid?: DexPaidType })[] {
  const now = Date.now();
  const staleInfo = new Map<ChainKey, string[]>();
  const unpaidChecked: [ChainKey, string][] = [];
  const result = tokens.map((token) => {
    const address = token.address.toLowerCase();
    const key = cacheKey(token.chain, address);
    const hit = infoCache.get(key);
    if (!hit || now - hit.at > INFO_TTL_MS) staleInfo.set(token.chain, [...(staleInfo.get(token.chain) ?? []), address]);
    else if (needsPaidCheck(token.chain, address, now)) unpaidChecked.push([token.chain, address]);
    const profile = hit ? profileOf(token.chain, address) : undefined;
    // A DexScreener image replaces the launch logo (the browser does the same), so every view
    // shows one logo per token.
    const withImage = profile?.imageUrl ? { ...token, imageUrl: profile.imageUrl } : token;
    return profile?.paid ? { ...withImage, dexPaid: profile.paidType, ...(profile.socials ? { dexSocials: profile.socials } : {}) } : withImage;
  });
  if ((staleInfo.size > 0 || unpaidChecked.length > 0) && !backgroundRefresh) {
    backgroundRefresh = true;
    runInBackground(async () => {
      try {
        for (const [chain, addresses] of staleInfo) await loadInfo(chain, addresses);
        const pending = [...unpaidChecked, ...[...staleInfo].flatMap(([chain, addresses]) => addresses.map((address) => [chain, address] as [ChainKey, string]))]
          .filter(([chain, address]) => needsPaidCheck(chain, address, Date.now()))
          .slice(0, BACKGROUND_PAID_CHECKS);
        await Promise.allSettled(pending.map(([chain, address]) => queuePaidCheck(chain, address, 'low')));
      } finally {
        backgroundRefresh = false;
      }
    });
  }
  return result;
}
