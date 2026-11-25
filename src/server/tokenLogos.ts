import type { ChainKey } from '../config/chains';
import { runInBackground } from './background';
import { cachedDexProfile } from './dexProfiles';

// Logos for catalog tokens whose launch data has none (most tokens the on-chain index found).
// Looked up in order, then kept in bankrdex_token_logos so a restart does not repeat the work:
//   1. the paid DexScreener profile image (already cached by dexProfiles)
//   2. Bankr's launch record: GET api.bankr.bot/token-launches/{token} -> launch.imageUri
//   3. the token's metadata on IPFS (launch.metadataUri) -> "image"
// Many launches have no image at all; those are stored as null and checked again after a day.

const ADDRESS = /^0x[a-f0-9]{40}$/;
const IPFS_IMAGE = /^ipfs:\/\/(?:ipfs\/)?[A-Za-z0-9]{46,110}$/;
// ipfs.io and dweb.link no longer serve content to servers; Pinata does.
const IPFS_JSON_GATEWAY = 'https://gateway.pinata.cloud/ipfs/';
const FOUND_TTL_MS = 30 * 86_400_000;
const NONE_TTL_MS = 86_400_000;
const RETRY_MS = 30 * 60_000;
const DB_RELOAD_MS = 10 * 60_000;
// Lookups one background run may do (Bankr API + IPFS), and how many at a time.
const LOOKUPS_PER_RUN = 150;
const CONCURRENCY = 3;

interface LogoEntry {
  image: string | null;
  checkedAt: number;
}

const memory = new Map<string, LogoEntry>();
const keyOf = (chain: ChainKey, address: string) => `${chain}:${address.toLowerCase()}`;
let dbLoadedAt = 0;
let dbLoad: Promise<void> | null = null;
let running = false;

function supabase(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  const config = supabase();
  if (!config) throw new Error('Supabase is not configured.');
  return fetch(`${config.url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json', Accept: 'application/json', ...init.headers },
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  });
}

// https images, or ipfs://<cid> (served by /api/token-logo). Anything else is dropped.
export function usableImage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (IPFS_IMAGE.test(text)) return text;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && url.hostname.includes('.') && !url.pathname.includes('missing.png') ? url.toString() : null;
  } catch {
    return null;
  }
}

async function loadFromDb(): Promise<void> {
  if (!supabase()) return;
  try {
    for (let offset = 0; ; offset += 1_000) {
      const response = await rest(`bankrdex_token_logos?select=chain,token_address,image_url,checked_at&order=token_address&limit=1000&offset=${offset}`);
      if (!response.ok) return;
      const rows = await response.json() as { chain: ChainKey; token_address: string; image_url: string | null; checked_at: string }[];
      for (const row of rows) memory.set(keyOf(row.chain, row.token_address), { image: row.image_url, checkedAt: Date.parse(row.checked_at) || 0 });
      if (rows.length < 1_000) break;
    }
    dbLoadedAt = Date.now();
  } catch {
    // Table missing or database down: lookups still work, they just are not kept.
  }
}

async function save(chain: ChainKey, address: string, image: string | null, source: string | null): Promise<void> {
  memory.set(keyOf(chain, address), { image, checkedAt: Date.now() });
  if (!supabase()) return;
  try {
    await rest('bankrdex_token_logos?on_conflict=chain,token_address', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ chain, token_address: address, image_url: image, source, checked_at: new Date().toISOString() }]),
    });
  } catch {
    // Kept in memory for this process.
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'BankrDex/1.0' }, signal: AbortSignal.timeout(12_000), cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${new URL(url).hostname} answered ${response.status}.`);
  return response.json();
}

// One token: { image, source } when found, null when there is none; throws when a source failed.
export async function lookupLogo(chain: ChainKey, address: string): Promise<{ image: string; source: string } | null> {
  const dex = usableImage(cachedDexProfile(chain, address)?.imageUrl);
  if (dex) return { image: dex, source: 'dexscreener' };
  const payload = await fetchJson(`https://api.bankr.bot/token-launches/${address}`) as { launch?: { imageUri?: unknown; metadataUri?: unknown } } | null;
  const launch = payload?.launch;
  const bankr = usableImage(launch?.imageUri);
  if (bankr) return { image: bankr, source: 'bankr' };
  const metadata = typeof launch?.metadataUri === 'string' ? launch.metadataUri.trim() : '';
  if (IPFS_IMAGE.test(metadata)) {
    const json = await fetchJson(`${IPFS_JSON_GATEWAY}${metadata.replace(/^ipfs:\/\/(?:ipfs\/)?/, '')}`).catch(() => null) as { image?: unknown } | null;
    const image = usableImage(json?.image);
    if (image) return { image, source: 'metadata' };
  }
  return null;
}

const isDue = (entry: LogoEntry | undefined, now: number) =>
  !entry || now - entry.checkedAt > (entry.image ? FOUND_TTL_MS : NONE_TTL_MS);

async function lookupMany(items: [ChainKey, string][]): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const [chain, address] = items[next++];
      try {
        const found = await lookupLogo(chain, address);
        await save(chain, address, found?.image ?? null, found?.source ?? null);
      } catch {
        // A source was down: try again after RETRY_MS (not stored).
        memory.set(keyOf(chain, address), { image: null, checkedAt: Date.now() - NONE_TTL_MS + RETRY_MS });
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

// Catalog tokens with a logo filled in where the launch data had none. Uses what is known now and
// looks up the rest in the background; the catalog response never waits.
export function withLogos<T extends { address: string; chain: ChainKey; imageUrl?: string }>(tokens: T[]): T[] {
  const now = Date.now();
  if (now - dbLoadedAt > DB_RELOAD_MS && !dbLoad) {
    dbLoad = loadFromDb().finally(() => { dbLoad = null; });
    runInBackground(() => dbLoad ?? Promise.resolve());
  }
  const without: [ChainKey, string][] = [];
  const result = tokens.map((token) => {
    if (token.imageUrl) return token;
    const address = token.address.toLowerCase();
    if (!ADDRESS.test(address)) return token;
    without.push([token.chain, address]);
    const entry = memory.get(keyOf(token.chain, address));
    return entry?.image ? { ...token, imageUrl: entry.image } : token;
  });
  if (without.length > 0 && !running) {
    running = true;
    runInBackground(async () => {
      try {
        // Stored results first, so a restart does not look everything up again.
        if (dbLoad) await dbLoad;
        const due = without.filter(([chain, address]) => isDue(memory.get(keyOf(chain, address)), Date.now()));
        await lookupMany(due.slice(0, LOOKUPS_PER_RUN));
      } finally {
        running = false;
      }
    });
  }
  return result;
}
