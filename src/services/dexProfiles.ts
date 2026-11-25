import type { ChainKey } from '../config/chains';
import type { Token, TokenSocials } from '../types';

// Browser side of /api/dex-profile (see src/server/dexProfiles.ts): DexScreener logo, banner, paid
// status and, for paid profiles, the links the team registered with DexScreener.

export interface DexProfileSocials {
  twitter?: string;
  telegram?: string;
  discord?: string;
  farcaster?: string;
  website?: string;
  links?: { label: string; url: string }[];
}

export interface DexProfile {
  paid: boolean | null;
  paidType?: 'tokenProfile' | 'communityTakeover';
  imageUrl?: string;
  headerUrl?: string;
  socials?: DexProfileSocials;
}

const ADDRESS = /^0x[a-f0-9]{40}$/;
const BATCH = 30;
const KNOWN_TTL_MS = 10 * 60_000;
// Paid status still unknown (the server is waiting on DexScreener's rate limit): ask again soon.
const UNKNOWN_TTL_MS = 15_000;
const BATCH_DELAY_MS = 40;

const cache = new Map<string, { profile: DexProfile; at: number }>();
const inFlight = new Map<string, Promise<void>>();
const keyOf = (chain: ChainKey, address: string) => `${chain}:${address.toLowerCase()}`;
const isFresh = (hit: { profile: DexProfile; at: number }) =>
  Date.now() - hit.at < (hit.profile.paid === null ? UNKNOWN_TTL_MS : KNOWN_TTL_MS);

export function cachedDexProfile(chain: ChainKey, address: string): DexProfile | undefined {
  return cache.get(keyOf(chain, address))?.profile;
}

async function fetchBatch(chain: ChainKey, addresses: string[]): Promise<void> {
  const response = await fetch(`/api/dex-profile?chain=${chain}&addresses=${addresses.join(',')}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`DexScreener profiles failed (${response.status}).`);
  const payload = await response.json() as { profiles?: Record<string, DexProfile> };
  const now = Date.now();
  for (const address of addresses) {
    const profile = payload.profiles?.[address];
    if (profile) cache.set(keyOf(chain, address), { profile, at: now });
  }
}

// Profiles for tokens of one chain, 30 per request; fresh cached profiles are not requested again
// and tokens already being requested share that request.
export async function loadDexProfiles(chain: ChainKey, addresses: string[]): Promise<Record<string, DexProfile>> {
  const unique = [...new Set(addresses.map((address) => address.toLowerCase()).filter((address) => ADDRESS.test(address)))];
  const waits: Promise<void>[] = [];
  const missing: string[] = [];
  for (const address of unique) {
    const key = keyOf(chain, address);
    const hit = cache.get(key);
    if (hit && isFresh(hit)) continue;
    const pending = inFlight.get(key);
    if (pending) waits.push(pending);
    else missing.push(address);
  }
  for (let index = 0; index < missing.length; index += BATCH) {
    const batch = missing.slice(index, index + BATCH);
    const request = fetchBatch(chain, batch).catch(() => undefined).finally(() => {
      batch.forEach((address) => inFlight.delete(keyOf(chain, address)));
    });
    batch.forEach((address) => inFlight.set(keyOf(chain, address), request));
    waits.push(request);
  }
  await Promise.allSettled(waits);
  const profiles: Record<string, DexProfile> = {};
  for (const address of unique) {
    const profile = cachedDexProfile(chain, address);
    if (profile) profiles[address] = profile;
  }
  return profiles;
}

// Single-token lookups made in the same moment (one per table row or panel) share one request.
const queued = new Map<ChainKey, Set<string>>();
let flush: Promise<void> | undefined;

export function loadDexProfile(chain: ChainKey, address: string): Promise<DexProfile | undefined> {
  const key = keyOf(chain, address);
  const hit = cache.get(key);
  if (hit && isFresh(hit)) return Promise.resolve(hit.profile);
  const pending = inFlight.get(key);
  if (pending) return pending.then(() => cachedDexProfile(chain, address));
  const set = queued.get(chain) ?? new Set<string>();
  set.add(address.toLowerCase());
  queued.set(chain, set);
  flush ??= new Promise<void>((resolve) => setTimeout(resolve, BATCH_DELAY_MS)).then(async () => {
    const batches = [...queued];
    queued.clear();
    flush = undefined;
    await Promise.allSettled(batches.map(([batchChain, addresses]) => loadDexProfiles(batchChain, [...addresses])));
  });
  return flush.then(() => cachedDexProfile(chain, address));
}

export const dexSocialsOf = (socials: DexProfileSocials): TokenSocials => ({ ...socials, source: 'dexscreener' });

const hasLinks = (socials: DexProfileSocials | undefined) =>
  Boolean(socials && (socials.twitter || socials.telegram || socials.discord || socials.farcaster || socials.website || socials.links?.length));

// The token as BankrDex shows it. A paid DexScreener profile supplies the links, replacing the ones
// given at launch (unless the profile lists none); any DexScreener image replaces the source logo.
export function applyDexProfile(token: Token, profile: DexProfile | undefined): Token {
  if (!profile) return token;
  let next = token;
  if (profile.imageUrl && token.logo !== profile.imageUrl) next = { ...next, logo: profile.imageUrl };
  if (profile.paid && hasLinks(profile.socials)) {
    const socials = dexSocialsOf(profile.socials!);
    if (JSON.stringify(token.socials) !== JSON.stringify(socials)) next = { ...next, socials };
  }
  if (profile.paid !== null && next.dexscreenerPaidInfo.hasPaid !== profile.paid) {
    next = {
      ...next,
      dexscreenerPaidInfo: {
        ...next.dexscreenerPaidInfo,
        hasPaid: profile.paid,
        paidType: !profile.paid ? 'unpaid' : profile.paidType === 'communityTakeover' ? 'community_takeover' : 'enhanced_profile',
        hasBanner: profile.headerUrl ? true : next.dexscreenerPaidInfo.hasBanner,
      },
    };
  }
  return next;
}
