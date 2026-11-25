// Browser client for /api/social: wallet sign-in, profiles, follows, theses, leaderboard and the
// social trade feed. The session lives in an httpOnly cookie set by the server.
import type { ChainKey } from '../config/chains';

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

export interface ProfileInput {
  username: string;
  displayName?: string | null;
  bio?: string | null;
  accent?: string | null;
  x?: string | null;
  farcaster?: string | null;
  website?: string | null;
}

export type Stance = 'bullish' | 'bearish';
export const THESIS_TIMEFRAMES = ['24h', '3d', '1w', '1m', '3m'] as const;
export type ThesisTimeframe = (typeof THESIS_TIMEFRAMES)[number];
export const TIMEFRAME_LABEL: Record<ThesisTimeframe, string> = { '24h': '24 hours', '3d': '3 days', '1w': '1 week', '1m': '1 month', '3m': '3 months' };

export interface Thesis {
  id: string;
  chain: ChainKey;
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string | null;
  stance: Stance;
  title: string;
  content: string;
  timeframe: ThesisTimeframe;
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

export interface ThesisInput {
  chain: ChainKey;
  tokenAddress: string;
  stance: Stance;
  title: string;
  content: string;
  timeframe: ThesisTimeframe;
  entryPrice?: number | null;
  targetPrice?: number | null;
  stopPrice?: number | null;
}

export interface ThesisComment {
  id: string;
  thesisId: string;
  content: string;
  createdAt: string;
  author: ProfileCard | null;
}

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

export interface WalletSummary {
  followers: number;
  following: number;
  theses: number;
  likesReceived: number;
  isFollowing: boolean;
  stats24h: TraderResult | null;
  stats7d: TraderResult | null;
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

export interface FollowEntry {
  wallet: string;
  followedAt: string;
  profile: ProfileCard | null;
}

export class SocialApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/social/${path}`, {
    credentials: 'same-origin',
    ...init,
    headers: init.body && !(init.body instanceof Blob) ? { 'Content-Type': 'application/json', ...init.headers } : init.headers,
  });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new SocialApiError(body.error || `Request failed (${response.status}).`, response.status);
  return body;
}

const send = <T>(path: string, method: string, body?: unknown) =>
  api<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

// ---- Session ----

export const fetchMe = () => api<{ wallet: string | null; profile: Profile | null }>('me');

// Sign-In with Ethereum: the wallet signs a readable message (no transaction, no gas).
export async function signInWithWallet(address: string, signMessage: (message: string) => Promise<string>) {
  const { nonce } = await api<{ nonce: string }>('auth/nonce');
  const { createSiweMessage } = await import('viem/siwe');
  const message = createSiweMessage({
    address: address as `0x${string}`,
    chainId: 8453,
    domain: window.location.host,
    nonce,
    uri: window.location.origin,
    version: '1',
    issuedAt: new Date(),
    statement: 'Sign in to BankrDex to post theses, follow traders and edit your profile. This does not send a transaction or cost gas.',
  });
  const signature = await signMessage(message);
  return send<{ wallet: string; profile: Profile | null }>('auth/verify', 'POST', { message, signature });
}

export const signOut = () => send<{ ok: true }>('auth/logout', 'POST');

// ---- Profiles ----

export const saveProfile = (input: ProfileInput) => send<{ profile: Profile }>('me', 'PUT', input);
export const checkUsername = (username: string) =>
  api<{ available: boolean; reason?: string }>(`username?u=${encodeURIComponent(username)}`);

export async function uploadImage(kind: 'avatar' | 'banner', blob: Blob) {
  return api<{ version: number }>(`me/image/${kind}`, { method: 'POST', body: blob, headers: { 'Content-Type': blob.type } });
}
export const removeImage = (kind: 'avatar' | 'banner') => send<{ version: number }>(`me/image/${kind}`, 'DELETE');
export const imageUrl = (wallet: string, kind: 'avatar' | 'banner', version: number) =>
  version > 0 ? `/api/social/image/${wallet.toLowerCase()}/${kind}?v=${version}` : null;

export const fetchProfilePage = (id: string) =>
  api<{ wallet: string; profile: Profile | null; summary: WalletSummary }>(`profiles/${encodeURIComponent(id)}`);
export const fetchFollows = (id: string, type: 'followers' | 'following') =>
  api<{ entries: FollowEntry[] }>(`profiles/${encodeURIComponent(id)}/follows?type=${type}`);
export const searchProfiles = (query: string) => api<{ results: ProfileCard[] }>(`profiles?q=${encodeURIComponent(query)}`);
export const setFollow = (wallet: string, follow: boolean) => send<{ following: boolean; followers: number }>('follow', 'POST', { wallet, follow });

// Profile cards for many wallets (trade labels), batched and cached for the page's lifetime.
const cardCache = new Map<string, ProfileCard | null>();
const cardWaiters = new Map<string, Promise<void>>();
export async function fetchProfileCards(wallets: string[]): Promise<Record<string, ProfileCard | null>> {
  const keys = [...new Set(wallets.map((wallet) => wallet.toLowerCase()).filter((wallet) => /^0x[0-9a-f]{40}$/.test(wallet)))];
  const missing = keys.filter((wallet) => !cardCache.has(wallet) && !cardWaiters.has(wallet));
  for (let index = 0; index < missing.length; index += 150) {
    const chunk = missing.slice(index, index + 150);
    const request = api<{ profiles: Record<string, ProfileCard> }>(`profiles?wallets=${chunk.join(',')}`)
      .then(({ profiles }) => { chunk.forEach((wallet) => cardCache.set(wallet, profiles[wallet] ?? null)); })
      .catch(() => undefined)
      .finally(() => chunk.forEach((wallet) => cardWaiters.delete(wallet)));
    chunk.forEach((wallet) => cardWaiters.set(wallet, request));
  }
  await Promise.all(keys.map((wallet) => cardWaiters.get(wallet)).filter(Boolean));
  return Object.fromEntries(keys.map((wallet) => [wallet, cardCache.get(wallet) ?? null]));
}
export function rememberProfileCard(card: ProfileCard) {
  cardCache.set(card.wallet.toLowerCase(), card);
}

// ---- Theses ----

export interface ThesisQuery {
  token?: string;
  author?: string;
  feed?: 'following';
  sort?: 'new' | 'top';
  before?: string;
  offset?: number;
  limit?: number;
}

export function fetchTheses(query: ThesisQuery) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => { if (value !== undefined && value !== '') params.set(key, String(value)); });
  return api<{ theses: Thesis[]; needsSignIn?: boolean }>(`theses?${params}`);
}
export const postThesis = (input: ThesisInput) => send<{ thesis: Thesis }>('theses', 'POST', input);
export const deleteThesis = (id: string) => send<{ ok: true }>(`theses/${id}`, 'DELETE');
export const likeThesis = (id: string, like: boolean) => send<{ liked: boolean; likeCount: number }>(`theses/${id}/like`, 'POST', { like });
export const fetchComments = (id: string) => api<{ comments: ThesisComment[] }>(`theses/${id}/comments`);
export const postComment = (id: string, content: string) => send<{ comment: ThesisComment }>(`theses/${id}/comments`, 'POST', { content });
export const deleteComment = (id: string, commentId: string) => send<{ ok: true }>(`theses/${id}/comments?comment=${commentId}`, 'DELETE');

// ---- Trading ----

export const fetchLeaderboard = (window: '24h' | '7d', sort: 'pnl' | 'volume') =>
  api<{ rows: LeaderboardRow[] }>(`leaderboard?window=${window}&sort=${sort}`);

export function fetchSocialTrades(scope: 'community' | 'following' | 'wallet', options: { wallet?: string; before?: string; limit?: number } = {}) {
  const params = new URLSearchParams({ scope });
  if (options.wallet) params.set('wallet', options.wallet);
  if (options.before) params.set('before', options.before);
  if (options.limit) params.set('limit', String(options.limit));
  return api<{ trades: SocialTrade[]; needsSignIn?: boolean; following?: number }>(`trades?${params}`);
}

// ---- Thesis maths shared by cards and the composer ----

// Move since posting, from the thesis author's point of view (bearish theses win when price falls).
export function thesisPerformance(thesis: Pick<Thesis, 'stance' | 'priceAtPost' | 'priceNow'>): number | null {
  if (!thesis.priceAtPost || !thesis.priceNow) return null;
  const move = (thesis.priceNow / thesis.priceAtPost - 1) * 100;
  return thesis.stance === 'bullish' ? move : -move;
}

export function thesisStatus(thesis: Pick<Thesis, 'stance' | 'targetPrice' | 'stopPrice' | 'priceNow'>): 'target' | 'stopped' | 'open' {
  const { stance, targetPrice, stopPrice, priceNow } = thesis;
  if (!priceNow) return 'open';
  const bullish = stance === 'bullish';
  if (targetPrice && (bullish ? priceNow >= targetPrice : priceNow <= targetPrice)) return 'target';
  if (stopPrice && (bullish ? priceNow <= stopPrice : priceNow >= stopPrice)) return 'stopped';
  return 'open';
}

export function riskReward(stance: Stance, entry?: number | null, target?: number | null, stop?: number | null): number | null {
  if (!entry || !target || !stop) return null;
  const reward = stance === 'bullish' ? target - entry : entry - target;
  const risk = stance === 'bullish' ? entry - stop : stop - entry;
  return reward > 0 && risk > 0 ? reward / risk : null;
}

export const timeAgo = (iso: string) => {
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
};
