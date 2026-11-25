// Social data for BankrDex: profiles (username, avatar, banner), follows, trading theses with
// likes and comments, and trader results from the swap index. Stored in Supabase (migration
// 20261010030000_social.sql); API routes check the signed-in wallet before calling a write.
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { CHAIN_KEYS, type ChainKey } from '../config/chains';

export const WALLET_PATTERN = /^0x[0-9a-f]{40}$/;
export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const IMAGE_KINDS = ['avatar', 'banner'] as const;
export type ImageKind = (typeof IMAGE_KINDS)[number];
export const THESIS_TIMEFRAMES = ['24h', '3d', '1w', '1m', '3m'] as const;

export class SocialError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

class DbError extends Error {
  constructor(public readonly status: number, public readonly code: string | undefined, message: string) {
    super(message);
  }
}

function config(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

export const isSocialConfigured = () => config() !== null;

async function rest<T>(path: string, init: RequestInit & { prefer?: string } = {}): Promise<T> {
  const supabase = config();
  if (!supabase) throw new SocialError('Profiles and theses need a database: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.', 503);
  const { prefer, ...rest } = init;
  const response = await fetch(`${supabase.url}/rest/v1/${path}`, {
    ...rest,
    headers: {
      apikey: supabase.key,
      Authorization: `Bearer ${supabase.key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
      ...rest.headers,
    },
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { code?: string; message?: string } | null;
    throw new DbError(response.status, body?.code, body?.message ?? `Database request failed (${response.status}).`);
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

const rpc = <T>(name: string, args: Record<string, unknown>) => rest<T>(`rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });

// ---- Profiles ----------------------------------------------------------------------------------

export interface ProfileCard {
  wallet: string;
  username: string;
  displayName: string | null;
  avatarVersion: number;
  accent: string | null;
}

export interface Profile extends ProfileCard {
  bio: string | null;
  x: string | null;
  farcaster: string | null;
  website: string | null;
  bannerVersion: number;
  createdAt: string;
}

interface ProfileRow {
  wallet: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  accent: string | null;
  x_handle: string | null;
  farcaster: string | null;
  website: string | null;
  avatar_version: number;
  banner_version: number;
  created_at: string;
}

const PROFILE_COLUMNS = 'wallet,username,display_name,bio,accent,x_handle,farcaster,website,avatar_version,banner_version,created_at';

const toProfile = (row: ProfileRow): Profile => ({
  wallet: row.wallet,
  username: row.username,
  displayName: row.display_name,
  bio: row.bio,
  accent: row.accent,
  x: row.x_handle,
  farcaster: row.farcaster,
  website: row.website,
  avatarVersion: row.avatar_version,
  bannerVersion: row.banner_version,
  createdAt: row.created_at,
});

export const toCard = (profile: Profile): ProfileCard => ({
  wallet: profile.wallet,
  username: profile.username,
  displayName: profile.displayName,
  avatarVersion: profile.avatarVersion,
  accent: profile.accent,
});

// Names that would let someone pass as BankrDex, Bankr or staff.
const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'api', 'bankr', 'bankrbot', 'bankrdex', 'base', 'dev', 'developer', 'docs', 'feed',
  'help', 'launches', 'leaderboard', 'login', 'logout', 'me', 'mod', 'moderator', 'null', 'official', 'privacy',
  'profile', 'root', 'security', 'settings', 'signin', 'signup', 'staff', 'support', 'system', 'team', 'terms',
  'token', 'tokens', 'u', 'undefined', 'uniswap', 'wallet',
]);
const IMPERSONATION = /(official|support|admin|moderator|staff)|^(bankr|bankrdex|bankrbot)_?(team|dev|app)?$/;

export function usernameProblem(username: string): string | null {
  if (!USERNAME_PATTERN.test(username)) return 'Use 3–20 characters: a–z, 0–9 or _.';
  if (RESERVED_USERNAMES.has(username) || IMPERSONATION.test(username)) return 'That username is reserved.';
  return null;
}

// Strips control characters (keeping line breaks where allowed) and squeezes whitespace.
function cleanText(value: string, multiline: boolean): string {
  const withoutControls = value.replace(multiline ? /[\u0000-\u0009\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/g : /[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '');
  return multiline
    ? withoutControls.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
    : withoutControls.replace(/\s+/g, ' ').trim();
}

const optionalText = (max: number, multiline = false) => z
  .string()
  .max(max * 4)
  .transform((value) => cleanText(value, multiline))
  .pipe(z.string().max(max, `At most ${max} characters.`))
  .transform((value) => value || null)
  .nullable()
  .optional();

const optionalPattern = (pattern: RegExp, message: string, normalize: (value: string) => string) => z
  .string()
  .max(240)
  .transform((value) => normalize(value.trim()))
  .refine((value) => value === '' || pattern.test(value), message)
  .transform((value) => value || null)
  .nullable()
  .optional();

export const profileInputSchema = z.object({
  username: z.string().max(40).transform((value) => value.trim().replace(/^@/, '').toLowerCase())
    .superRefine((value, context) => {
      const problem = usernameProblem(value);
      if (problem) context.addIssue({ code: 'custom', message: problem });
    }),
  displayName: optionalText(32),
  bio: optionalText(160, true),
  accent: optionalPattern(/^#[0-9a-f]{6}$/, 'Pick a color from the list.', (value) => value.toLowerCase()),
  x: optionalPattern(/^[A-Za-z0-9_]{1,15}$/, 'X handles are 1–15 letters, numbers or _.', (value) =>
    value.replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '').replace(/^@/, '').replace(/\/.*$/, '')),
  farcaster: optionalPattern(/^[a-z0-9][a-z0-9.-]{0,31}$/, 'Farcaster names use a–z, 0–9, "-" or ".".', (value) =>
    value.replace(/^https?:\/\/(www\.)?(warpcast|farcaster)\.(com|xyz)\//i, '').replace(/^@/, '').replace(/\/.*$/, '').toLowerCase()),
  website: z.string().max(240).transform((value) => value.trim())
    .transform((value, context) => {
      if (!value) return null;
      try {
        const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
        if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.') || url.href.length > 200) throw new Error('bad');
        return url.href;
      } catch {
        context.addIssue({ code: 'custom', message: 'Use an https:// link.' });
        return z.NEVER;
      }
    })
    .nullable()
    .optional(),
});

export type ProfileInput = z.infer<typeof profileInputSchema>;

export async function getProfile(wallet: string): Promise<Profile | null> {
  const key = wallet.toLowerCase();
  if (!WALLET_PATTERN.test(key)) return null;
  const rows = await rest<ProfileRow[]>(`bankrdex_profiles?select=${PROFILE_COLUMNS}&wallet=eq.${key}&hidden=is.false`);
  return rows[0] ? toProfile(rows[0]) : null;
}

export async function getProfileByUsername(username: string): Promise<Profile | null> {
  const key = username.toLowerCase().replace(/^@/, '');
  if (!USERNAME_PATTERN.test(key)) return null;
  const rows = await rest<ProfileRow[]>(`bankrdex_profiles?select=${PROFILE_COLUMNS}&username=eq.${key}&hidden=is.false`);
  return rows[0] ? toProfile(rows[0]) : null;
}

export async function getProfileCards(wallets: string[]): Promise<Record<string, ProfileCard>> {
  const list = [...new Set(wallets.map((wallet) => wallet.toLowerCase()).filter((wallet) => WALLET_PATTERN.test(wallet)))].slice(0, 200);
  if (list.length === 0) return {};
  const rows = await rest<ProfileRow[]>(`bankrdex_profiles?select=${PROFILE_COLUMNS}&hidden=is.false&wallet=in.(${list.join(',')})`);
  return Object.fromEntries(rows.map((row) => [row.wallet, toCard(toProfile(row))]));
}

export async function searchProfiles(query: string, limit = 8): Promise<ProfileCard[]> {
  const term = query.toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_]/g, '').slice(0, 20);
  if (!term) return [];
  const rows = await rest<ProfileRow[]>(
    `bankrdex_profiles?select=${PROFILE_COLUMNS}&hidden=is.false&username=like.${term}*&order=username.asc&limit=${Math.min(Math.max(limit, 1), 20)}`,
  );
  return rows.map((row) => toCard(toProfile(row)));
}

export async function isUsernameFree(username: string, wallet?: string): Promise<boolean> {
  const rows = await rest<{ wallet: string }[]>(`bankrdex_profiles?select=wallet&username=eq.${username}`);
  return rows.length === 0 || rows[0].wallet === wallet?.toLowerCase();
}

export async function saveProfile(wallet: string, input: ProfileInput): Promise<Profile> {
  const row = {
    wallet: wallet.toLowerCase(),
    username: input.username,
    display_name: input.displayName ?? null,
    bio: input.bio ?? null,
    accent: input.accent ?? null,
    x_handle: input.x ?? null,
    farcaster: input.farcaster ?? null,
    website: input.website ?? null,
    updated_at: new Date().toISOString(),
  };
  try {
    const rows = await rest<ProfileRow[]>(`bankrdex_profiles?on_conflict=wallet&select=${PROFILE_COLUMNS}`, {
      method: 'POST',
      body: JSON.stringify(row),
      prefer: 'resolution=merge-duplicates,return=representation',
    });
    return toProfile(rows[0]);
  } catch (error) {
    if (error instanceof DbError && error.code === '23505') throw new SocialError('That username is taken.', 409);
    if (error instanceof DbError && error.code === '23514') throw new SocialError('Some profile fields are not valid.', 400);
    throw error;
  }
}

// ---- Images -----------------------------------------------------------------------------------

export const IMAGE_LIMITS: Record<ImageKind, number> = { avatar: 200 * 1024, banner: 500 * 1024 };

// Only raster formats, recognised by their first bytes (never trust the Content-Type alone).
export function sniffImage(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

export async function saveImage(wallet: string, kind: ImageKind, mime: string, bytes: Uint8Array): Promise<number> {
  const key = wallet.toLowerCase();
  await rest('bankrdex_profile_images?on_conflict=wallet,kind', {
    method: 'POST',
    body: JSON.stringify({ wallet: key, kind, mime, data: `\\x${Buffer.from(bytes).toString('hex')}`, updated_at: new Date().toISOString() }),
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
  // Seconds since epoch: always grows, so image URLs carrying it can be cached forever.
  const version = Math.floor(Date.now() / 1000);
  await rest(`bankrdex_profiles?wallet=eq.${key}`, { method: 'PATCH', body: JSON.stringify({ [`${kind}_version`]: version }), prefer: 'return=minimal' });
  return version;
}

export async function deleteImage(wallet: string, kind: ImageKind): Promise<void> {
  const key = wallet.toLowerCase();
  await rest(`bankrdex_profile_images?wallet=eq.${key}&kind=eq.${kind}`, { method: 'DELETE', prefer: 'return=minimal' });
  await rest(`bankrdex_profiles?wallet=eq.${key}`, { method: 'PATCH', body: JSON.stringify({ [`${kind}_version`]: 0 }), prefer: 'return=minimal' });
}

export async function getImage(wallet: string, kind: ImageKind): Promise<{ mime: string; data: Buffer } | null> {
  const key = wallet.toLowerCase();
  if (!WALLET_PATTERN.test(key)) return null;
  const rows = await rest<{ mime: string; data: string }[]>(`bankrdex_profile_images?select=mime,data&wallet=eq.${key}&kind=eq.${kind}`);
  const row = rows[0];
  if (!row || typeof row.data !== 'string' || !row.data.startsWith('\\x')) return null;
  return { mime: row.mime, data: Buffer.from(row.data.slice(2), 'hex') };
}

// ---- Sign-in nonces ---------------------------------------------------------------------------

export async function issueNonce(): Promise<string> {
  const nonce = randomBytes(16).toString('hex');
  await rest('bankrdex_auth_nonces', { method: 'POST', body: JSON.stringify({ nonce }), prefer: 'return=minimal' });
  if (Math.random() < 0.05) {
    const stale = new Date(Date.now() - 60 * 60_000).toISOString();
    void rest(`bankrdex_auth_nonces?created_at=lt.${encodeURIComponent(stale)}`, { method: 'DELETE', prefer: 'return=minimal' }).catch(() => undefined);
  }
  return nonce;
}

// True once per issued nonce, within 10 minutes of issuing it.
export async function consumeNonce(nonce: string): Promise<boolean> {
  if (!/^[A-Za-z0-9]{16,64}$/.test(nonce)) return false;
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const rows = await rest<{ nonce: string }[]>(`bankrdex_auth_nonces?nonce=eq.${nonce}&created_at=gt.${encodeURIComponent(since)}`, {
    method: 'DELETE',
    prefer: 'return=representation',
  });
  return rows.length === 1;
}

// ---- Follows ----------------------------------------------------------------------------------

export async function setFollow(follower: string, followee: string, follow: boolean): Promise<number> {
  const from = follower.toLowerCase();
  const to = followee.toLowerCase();
  if (!WALLET_PATTERN.test(to)) throw new SocialError('Unknown wallet.');
  if (from === to) throw new SocialError('You cannot follow yourself.');
  if (follow) {
    await rest('bankrdex_follows?on_conflict=follower,followee', {
      method: 'POST',
      body: JSON.stringify({ follower: from, followee: to }),
      prefer: 'resolution=ignore-duplicates,return=minimal',
    });
  } else {
    await rest(`bankrdex_follows?follower=eq.${from}&followee=eq.${to}`, { method: 'DELETE', prefer: 'return=minimal' });
  }
  const rows = await rest<{ follower: string }[]>(`bankrdex_follows?select=follower&followee=eq.${to}&limit=100000`);
  return rows.length;
}

export async function followedWallets(wallet: string): Promise<string[]> {
  const rows = await rest<{ followee: string }[]>(`bankrdex_follows?select=followee&follower=eq.${wallet.toLowerCase()}&order=created_at.desc&limit=1000`);
  return rows.map((row) => row.followee);
}

export interface FollowEntry {
  wallet: string;
  followedAt: string;
  profile: ProfileCard | null;
}

export async function listFollows(wallet: string, direction: 'followers' | 'following', limit = 100): Promise<FollowEntry[]> {
  const key = wallet.toLowerCase();
  const filter = direction === 'followers' ? `followee=eq.${key}` : `follower=eq.${key}`;
  const rows = await rest<{ follower: string; followee: string; created_at: string }[]>(
    `bankrdex_follows?select=follower,followee,created_at&${filter}&order=created_at.desc&limit=${Math.min(Math.max(limit, 1), 200)}`,
  );
  const wallets = rows.map((row) => (direction === 'followers' ? row.follower : row.followee));
  const cards = await getProfileCards(wallets);
  return rows.map((row, index) => ({ wallet: wallets[index], followedAt: row.created_at, profile: cards[wallets[index]] ?? null }));
}

// ---- Theses -----------------------------------------------------------------------------------

const price = z.coerce.number().positive().finite().max(1e12).nullable().optional();

export const thesisInputSchema = z.object({
  chain: z.enum(CHAIN_KEYS as [ChainKey, ...ChainKey[]]).default('base'),
  tokenAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Unknown token.').transform((value) => value.toLowerCase()),
  stance: z.enum(['bullish', 'bearish']),
  title: z.string().max(400).transform((value) => cleanText(value, false)).pipe(z.string().min(3, 'Give it a title (3+ characters).').max(100)),
  content: z.string().max(8_000).transform((value) => cleanText(value, true)).pipe(z.string().min(1, 'Write your thesis.').max(2_000)),
  timeframe: z.enum(THESIS_TIMEFRAMES),
  entryPrice: price,
  targetPrice: price,
  stopPrice: price,
}).superRefine((value, context) => {
  const { entryPrice: entry, targetPrice: target, stopPrice: stop, stance } = value;
  const bullish = stance === 'bullish';
  if (entry && target && (bullish ? target <= entry : target >= entry)) {
    context.addIssue({ code: 'custom', path: ['targetPrice'], message: bullish ? 'A bullish target sits above the entry.' : 'A bearish target sits below the entry.' });
  }
  if (entry && stop && (bullish ? stop >= entry : stop <= entry)) {
    context.addIssue({ code: 'custom', path: ['stopPrice'], message: bullish ? 'A bullish stop sits below the entry.' : 'A bearish stop sits above the entry.' });
  }
});

export type ThesisInput = z.infer<typeof thesisInputSchema>;

export interface Thesis {
  id: string;
  chain: ChainKey;
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string | null;
  stance: 'bullish' | 'bearish';
  title: string;
  content: string;
  timeframe: (typeof THESIS_TIMEFRAMES)[number];
  entryPrice: number | null;
  targetPrice: number | null;
  stopPrice: number | null;
  priceAtPost: number | null;
  priceNow: number | null;
  likeCount: number;
  commentCount: number;
  liked: boolean;
  createdAt: string;
  author: ProfileCard | null;
}

export interface ThesisQuery {
  viewer?: string | null;
  token?: string | null;
  author?: string | null;
  following?: boolean;
  sort?: 'new' | 'top';
  before?: string | null;
  offset?: number;
  limit?: number;
  id?: string | null;
}

export function listTheses(query: ThesisQuery): Promise<Thesis[]> {
  return rpc<Thesis[]>('bankrdex_theses_feed', {
    p_viewer: query.viewer ?? null,
    p_token: query.token ?? null,
    p_author: query.author ?? null,
    p_following: Boolean(query.following),
    p_sort: query.sort === 'top' ? 'top' : 'new',
    p_before: query.before ?? null,
    p_offset: Math.max(0, Math.floor(query.offset ?? 0)),
    p_limit: Math.min(Math.max(Math.floor(query.limit ?? 20), 1), 50),
    p_id: query.id ?? null,
  });
}

export async function getThesis(id: string, viewer?: string | null): Promise<Thesis | null> {
  if (!UUID_PATTERN.test(id)) return null;
  const rows = await listTheses({ id, viewer, limit: 1 });
  return rows[0] ?? null;
}

export async function createThesis(
  wallet: string,
  input: ThesisInput,
  token: { symbol: string; name: string | null },
  priceAtPost: number | null,
): Promise<Thesis> {
  const rows = await rest<{ id: string }[]>('bankrdex_theses?select=id', {
    method: 'POST',
    body: JSON.stringify({
      author: wallet.toLowerCase(),
      chain: input.chain,
      token_address: input.tokenAddress,
      token_symbol: cleanText(token.symbol, false).slice(0, 32) || '?',
      token_name: token.name ? cleanText(token.name, false).slice(0, 80) : null,
      stance: input.stance,
      title: input.title,
      content: input.content,
      timeframe: input.timeframe,
      entry_price: input.entryPrice ?? null,
      target_price: input.targetPrice ?? null,
      stop_price: input.stopPrice ?? null,
      price_at_post: priceAtPost && priceAtPost > 0 && Number.isFinite(priceAtPost) ? priceAtPost : null,
    }),
    prefer: 'return=representation',
  });
  const thesis = await getThesis(rows[0].id, wallet);
  if (!thesis) throw new SocialError('The thesis was saved but could not be read back.', 500);
  return thesis;
}

export async function hideThesis(id: string, wallet: string): Promise<boolean> {
  if (!UUID_PATTERN.test(id)) return false;
  const rows = await rest<{ id: string }[]>(`bankrdex_theses?id=eq.${id}&author=eq.${wallet.toLowerCase()}&select=id`, {
    method: 'PATCH',
    body: JSON.stringify({ hidden: true }),
    prefer: 'return=representation',
  });
  return rows.length === 1;
}

export async function setLike(id: string, wallet: string, like: boolean): Promise<{ liked: boolean; likeCount: number } | null> {
  if (!UUID_PATTERN.test(id)) return null;
  return rpc('bankrdex_set_like', { p_thesis: id, p_wallet: wallet.toLowerCase(), p_like: like });
}

export interface ThesisComment {
  id: string;
  thesisId: string;
  content: string;
  createdAt: string;
  author: ProfileCard | null;
}

export function listComments(id: string): Promise<ThesisComment[]> {
  if (!UUID_PATTERN.test(id)) return Promise.resolve([]);
  return rpc<ThesisComment[]>('bankrdex_thesis_comments_list', { p_thesis: id, p_limit: 200 });
}

export const commentInputSchema = z.object({
  content: z.string().max(2_000).transform((value) => cleanText(value, true)).pipe(z.string().min(1, 'Write a comment.').max(500, 'At most 500 characters.')),
});

export async function addComment(id: string, wallet: string, content: string): Promise<ThesisComment | null> {
  if (!UUID_PATTERN.test(id)) return null;
  return rpc<ThesisComment | null>('bankrdex_add_comment', { p_thesis: id, p_wallet: wallet.toLowerCase(), p_content: content });
}

export async function deleteComment(commentId: string, wallet: string): Promise<boolean> {
  if (!UUID_PATTERN.test(commentId)) return false;
  return Boolean(await rpc<boolean>('bankrdex_delete_comment', { p_comment: commentId, p_wallet: wallet.toLowerCase() }));
}

// ---- Trading results (swap index) --------------------------------------------------------------

export interface TraderResult {
  trader: string;
  volume_usd: number;
  trades: number;
  buys: number;
  sells: number;
  tokens: number;
  wins: number;
  pnl_usd: number;
  best_token: string | null;
  best_token_pnl: number | null;
  last_trade_at: string | null;
}

export interface LeaderboardRow {
  wallet: string;
  volumeUsd: number;
  trades: number;
  buys: number;
  sells: number;
  tokens: number;
  wins: number;
  pnlUsd: number;
  bestToken: string | null;
  bestTokenSymbol: string | null;
  bestTokenPnl: number | null;
  lastTradeAt: string | null;
  followers: number;
  profile: ProfileCard | null;
}

const leaderboardCache = new Map<string, { at: number; rows: Promise<LeaderboardRow[]> }>();

export function getLeaderboard(hours: number, sort: 'pnl' | 'volume', limit = 50): Promise<LeaderboardRow[]> {
  const key = `${hours}:${sort}:${limit}`;
  const cached = leaderboardCache.get(key);
  if (cached && Date.now() - cached.at < 60_000) return cached.rows;
  const rows = rpc<LeaderboardRow[]>('bankrdex_leaderboard', { p_hours: hours, p_sort: sort, p_limit: limit });
  leaderboardCache.set(key, { at: Date.now(), rows });
  rows.catch(() => leaderboardCache.delete(key));
  return rows;
}

export interface SocialTrade {
  txHash: string;
  trader: string;
  tokenAddress: string;
  tokenSymbol: string | null;
  tokenName: string | null;
  isBuy: boolean;
  tokenAmount: number;
  priceUsd: number | null;
  volumeUsd: number | null;
  ts: string;
  profile: ProfileCard | null;
}

// wallets = null: trades from every wallet that has a BankrDex profile.
export function getSocialTrades(wallets: string[] | null, limit = 50, before?: string | null): Promise<SocialTrade[]> {
  return rpc<SocialTrade[]>('bankrdex_social_trades', {
    p_wallets: wallets ? wallets.map((wallet) => wallet.toLowerCase()).filter((wallet) => WALLET_PATTERN.test(wallet)) : null,
    p_limit: Math.min(Math.max(limit, 1), 100),
    p_before: before ?? null,
  });
}

export interface WalletSummary {
  followers: number;
  following: number;
  theses: number;
  likesReceived: number;
  isFollowing: boolean;
  stats24h: TraderResult | null;
  stats7d: TraderResult | null;
}

export function getWalletSummary(wallet: string, viewer?: string | null): Promise<WalletSummary> {
  return rpc<WalletSummary>('bankrdex_wallet_summary', { p_wallet: wallet.toLowerCase(), p_viewer: viewer?.toLowerCase() ?? null });
}

export const imageUrlPath = (wallet: string, kind: ImageKind, version: number) =>
  version > 0 ? `/api/social/image/${wallet.toLowerCase()}/${kind}?v=${version}` : null;
