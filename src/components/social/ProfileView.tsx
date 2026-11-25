import React, { useEffect, useState } from 'react';
import { Activity, CalendarDays, Check, Copy, ExternalLink, Globe, Heart, Lightbulb, Loader2, Pencil, UserX } from 'lucide-react';
import { useSocial } from '../../context/SocialContext';
import { fetchFollows, fetchProfilePage, imageUrl, type FollowEntry, type Profile, type WalletSummary } from '../../services/social';
import { explorerAddress } from '../../config/chains';
import { FollowButton } from './FollowButton';
import { formatUsd, ProfileAvatar, TraderLabel, walletGradient } from './SocialBits';
import { SocialTrades } from './SocialTrades';
import { ThesisList } from './ThesisList';

type Tab = 'theses' | 'trades' | 'followers' | 'following';

const Stat: React.FC<{ label: string; value: string; tone?: 'up' | 'down' | 'none' }> = ({ label, value, tone = 'none' }) => (
  <div className="rounded-2xl border border-line bg-sunken/40 px-3 py-2.5">
    <div className="text-[0.625rem] font-bold uppercase tracking-wider text-subtle">{label}</div>
    <div className={`mt-0.5 font-mono text-base font-black ${tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : 'text-fg'}`}>{value}</div>
  </div>
);

const FollowList: React.FC<{ id: string; type: 'followers' | 'following' }> = ({ id, type }) => {
  const [entries, setEntries] = useState<FollowEntry[] | null>(null);
  useEffect(() => {
    let active = true;
    setEntries(null);
    fetchFollows(id, type).then((result) => { if (active) setEntries(result.entries); }).catch(() => { if (active) setEntries([]); });
    return () => { active = false; };
  }, [id, type]);
  if (!entries) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted" /></div>;
  if (entries.length === 0) return <p className="rounded-2xl border border-dashed border-line p-8 text-center text-sm text-muted">{type === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}</p>;
  return (
    <ul className="divide-y divide-line/70 overflow-hidden rounded-2xl border border-line bg-panel">
      {entries.map((entry) => (
        <li key={entry.wallet} className="flex items-center justify-between gap-3 px-4 py-3">
          <TraderLabel wallet={entry.wallet} card={entry.profile} size={36} showAddress />
          <FollowButton wallet={entry.wallet} />
        </li>
      ))}
    </ul>
  );
};

export const ProfileView: React.FC<{ id: string }> = ({ id }) => {
  const { wallet: me, profile: myProfile, setIsProfileEditorOpen, navigate } = useSocial();
  const [data, setData] = useState<{ wallet: string; profile: Profile | null; summary: WalletSummary } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('theses');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    fetchProfilePage(id)
      .then((result) => {
        if (!active) return;
        setData(result);
        if (!result.profile) setTab('trades');
        // Keep the address bar on the username once it is known.
        if (result.profile && id !== result.profile.username) window.history.replaceState(window.history.state, '', `/u/${result.profile.username}`);
      })
      .catch((problem: unknown) => { if (active) setError(problem instanceof Error ? problem.message : 'Could not load this trader.'); });
    return () => { active = false; };
  }, [id, myProfile?.avatarVersion, myProfile?.bannerVersion, myProfile?.username, myProfile?.bio]);

  if (error) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-20 text-center">
        <UserX className="h-10 w-10 text-subtle" />
        <h1 className="text-xl font-black text-fg">Trader not found</h1>
        <p className="text-sm text-muted">{error}</p>
        <button type="button" onClick={() => navigate({ name: 'leaderboard' })} className="rounded-xl border border-line px-4 py-2 text-sm font-bold text-fg hover:bg-raised">Browse the leaderboard</button>
      </div>
    );
  }
  if (!data) return <div className="mx-auto max-w-5xl px-4 py-6"><div className="h-64 animate-pulse rounded-3xl bg-panel" /></div>;

  const { wallet, profile, summary } = data;
  const isMe = me === wallet;
  const banner = profile ? imageUrl(wallet, 'banner', profile.bannerVersion) : null;
  const stats = summary.stats7d ?? summary.stats24h;
  const pnl = stats?.pnl_usd ?? null;
  const tabs: [Tab, string, number | null][] = [
    ['theses', 'Theses', summary.theses],
    ['trades', 'Trades', null],
    ['followers', 'Followers', summary.followers],
    ['following', 'Following', summary.following],
  ];
  const copy = async () => {
    try { await navigator.clipboard.writeText(wallet); setCopied(true); window.setTimeout(() => setCopied(false), 1_500); } catch { /* blocked */ }
  };

  return (
    <div className="mx-auto max-w-5xl px-3 py-4 sm:px-4">
      <div className="overflow-hidden rounded-3xl border border-line bg-panel">
        <div className="relative h-36 sm:h-52" style={{ background: banner ? undefined : walletGradient(wallet, profile?.accent) }}>
          {banner && <img src={banner} alt="" className="h-full w-full object-cover" />}
          <div className="absolute inset-0 bg-gradient-to-t from-panel/90 via-transparent to-transparent" />
        </div>
        <div className="relative px-4 pb-5 sm:px-6">
          <div className="-mt-12 flex flex-wrap items-end justify-between gap-3 sm:-mt-14">
            <ProfileAvatar wallet={wallet} card={profile} size={104} className="ring-4 ring-panel" />
            <div className="flex items-center gap-2 pb-1">
              {isMe
                ? <button type="button" onClick={() => setIsProfileEditorOpen(true)} className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-sm font-extrabold text-fg hover:bg-raised"><Pencil className="h-4 w-4" /> Edit profile</button>
                : <FollowButton wallet={wallet} size="md" onChange={(following, followers) => setData({ ...data, summary: { ...summary, isFollowing: following, followers } })} />}
            </div>
          </div>
          <div className="mt-3">
            <h1 className="text-2xl font-black tracking-tight text-fg">{profile ? (profile.displayName || `@${profile.username}`) : 'Trader'}</h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
              {profile && <span className="font-semibold">@{profile.username}</span>}
              <button type="button" onClick={() => void copy()} className="inline-flex items-center gap-1 font-mono text-xs hover:text-fg">
                {wallet.slice(0, 6)}…{wallet.slice(-4)} {copied ? <Check className="h-3 w-3 text-up" /> : <Copy className="h-3 w-3" />}
              </button>
              <a href={explorerAddress('base', wallet)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs hover:text-fg">Basescan <ExternalLink className="h-3 w-3" /></a>
              {profile && <span className="inline-flex items-center gap-1 text-xs"><CalendarDays className="h-3 w-3" /> Joined {new Date(profile.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>}
            </div>
            {profile?.bio && <p className="mt-2 max-w-2xl whitespace-pre-line text-sm text-fg-soft">{profile.bio}</p>}
            {!profile && <p className="mt-2 text-sm text-muted">This wallet has no BankrDex profile. Its trades come from the on-chain index.</p>}
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {profile?.x && <a href={`https://x.com/${profile.x}`} target="_blank" rel="noopener noreferrer nofollow" className="social-chip">𝕏 @{profile.x}</a>}
              {profile?.farcaster && <a href={`https://farcaster.xyz/${profile.farcaster}`} target="_blank" rel="noopener noreferrer nofollow" className="social-chip">⌐◨ {profile.farcaster}</a>}
              {profile?.website && <a href={profile.website} target="_blank" rel="noopener noreferrer nofollow ugc" className="social-chip"><Globe className="h-3 w-3" /> {new URL(profile.website).hostname}</a>}
            </div>
            <div className="mt-2 flex gap-4 text-sm">
              <button type="button" onClick={() => setTab('followers')} className="hover:underline"><b className="text-fg">{summary.followers}</b> <span className="text-muted">followers</span></button>
              <button type="button" onClick={() => setTab('following')} className="hover:underline"><b className="text-fg">{summary.following}</b> <span className="text-muted">following</span></button>
              <span className="inline-flex items-center gap-1 text-muted"><Heart className="h-3.5 w-3.5 text-pink-400" /><b className="text-fg">{summary.likesReceived}</b> likes</span>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label={`Est. PnL · ${summary.stats7d ? '7d' : '24h'}`} value={formatUsd(pnl, true)} tone={pnl === null ? 'none' : pnl >= 0 ? 'up' : 'down'} />
            <Stat label="Volume" value={formatUsd(stats?.volume_usd ?? null)} />
            <Stat label="Trades" value={stats ? `${stats.buys}B / ${stats.sells}S` : '—'} />
            <Stat label="Win rate" value={stats && stats.tokens ? `${Math.round((stats.wins / stats.tokens) * 100)}%` : '—'} />
          </div>
        </div>
      </div>

      <div className="mt-4 flex gap-1 overflow-x-auto scrollbar-none border-b border-line" role="tablist">
        {tabs.filter(([key]) => profile || key === 'trades' || key === 'followers').map(([key, label, count]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`relative inline-flex shrink-0 items-center gap-1.5 px-3 pb-3 pt-1 text-sm font-extrabold ${tab === key ? 'text-fg' : 'text-muted hover:text-fg'}`}>
            {key === 'theses' && <Lightbulb className="h-4 w-4" />}{key === 'trades' && <Activity className="h-4 w-4" />}
            {label}{count !== null && <span className="text-xs text-subtle">{count}</span>}
            {tab === key && <span className="tab-underline" />}
          </button>
        ))}
      </div>
      <div className="mt-4">
        {tab === 'theses' && <ThesisList query={{ author: wallet, sort: 'new' }} showToken emptyTitle={isMe ? 'You have not posted a thesis yet' : 'No theses yet'} emptyHint={isMe ? 'Open any token terminal and press “New thesis”.' : undefined} />}
        {tab === 'trades' && <SocialTrades scope="wallet" wallet={wallet} showTrader={false} emptyText="No Bankr-token trades in the last 14 days." />}
        {(tab === 'followers' || tab === 'following') && <FollowList id={wallet} type={tab} />}
      </div>
    </div>
  );
};
