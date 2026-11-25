import React, { useState } from 'react';
import { ArrowRight, Flame, Lightbulb, Radio, Sparkles, Trophy, UserRound, Users } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useSocial } from '../../context/SocialContext';
import { imageUrl } from '../../services/social';
import { LeaderboardTable } from './LeaderboardView';
import { ProfileAvatar, walletGradient } from './SocialBits';
import { SocialTrades } from './SocialTrades';
import { ThesisList } from './ThesisList';

type FeedTab = 'latest' | 'top' | 'following' | 'trades';

const TABS: { key: FeedTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'latest', label: 'Latest', icon: Sparkles },
  { key: 'top', label: 'Top', icon: Flame },
  { key: 'following', label: 'Following', icon: Users },
  { key: 'trades', label: 'Live trades', icon: Radio },
];

export const ProfileCta: React.FC = () => {
  const { wallet, profile, ensureProfile, navigate, isSigningIn } = useSocial();
  const { wallet: connected } = useApp();
  if (profile && wallet) {
    const banner = imageUrl(wallet, 'banner', profile.bannerVersion);
    return (
      <div className="overflow-hidden rounded-2xl border border-line bg-panel">
        <div className="h-16" style={{ background: banner ? `center / cover url(${banner})` : walletGradient(wallet, profile.accent) }} />
        <div className="-mt-7 px-4 pb-4">
          <ProfileAvatar wallet={wallet} card={profile} size={56} ring />
          <div className="mt-1.5 font-extrabold text-fg">{profile.displayName || `@${profile.username}`}</div>
          <div className="text-xs text-muted">@{profile.username}</div>
          <button type="button" onClick={() => navigate({ name: 'profile', id: profile.username })} className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-line py-2 text-xs font-bold text-fg hover:bg-raised">
            View profile <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="cta-card relative overflow-hidden rounded-2xl border border-accent/30 p-4">
      <UserRound className="h-6 w-6 text-accent" />
      <h3 className="mt-2 font-extrabold text-fg">Claim your trader name</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted">Pick a username and avatar, post theses, follow the best wallets and show up on the leaderboard. Sign-in is a free signature, no gas.</p>
      <button type="button" onClick={() => void ensureProfile()} disabled={isSigningIn} className="btn-gradient mt-3 w-full rounded-xl py-2 text-sm font-extrabold text-white disabled:opacity-60">
        {!connected.isConnected ? 'Connect wallet' : wallet ? 'Create profile' : isSigningIn ? 'Check your wallet…' : 'Sign in with wallet'}
      </button>
    </div>
  );
};

export const FeedView: React.FC = () => {
  const { navigate } = useSocial();
  const [tab, setTab] = useState<FeedTab>('latest');
  return (
    <div className="mx-auto grid max-w-6xl gap-5 px-3 py-5 sm:px-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0">
        <div className="page-hero mb-4 rounded-3xl border border-line p-5 sm:p-6">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 text-[0.6875rem] font-extrabold uppercase tracking-wider text-accent"><Lightbulb className="h-3.5 w-3.5" /> Community</span>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-fg sm:text-3xl">Theses & trades from Bankr degens</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">Calls with entry, target and stop, tracked against the on-chain price. Open any token terminal to write your own.</p>
        </div>

        <div className="sticky top-14 z-20 -mx-3 mb-4 border-b border-line bg-surface/85 px-3 backdrop-blur-xl sm:mx-0 sm:rounded-2xl sm:border sm:px-2">
          <div className="flex gap-1 overflow-x-auto scrollbar-none py-1.5" role="tablist">
            {TABS.map(({ key, label, icon: Icon }) => (
              <button key={key} role="tab" aria-selected={tab === key} type="button" onClick={() => setTab(key)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-extrabold transition ${tab === key ? 'bg-raised text-fg shadow-inner' : 'text-muted hover:text-fg'}`}>
                <Icon className={`h-4 w-4 ${tab === key ? 'text-accent' : ''}`} /> {label}
                {key === 'trades' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-up" />}
              </button>
            ))}
          </div>
        </div>

        {tab === 'latest' && <ThesisList query={{ sort: 'new' }} showToken emptyHint="Be the first: open a token and press “New thesis”." />}
        {tab === 'top' && <ThesisList query={{ sort: 'top' }} showToken emptyTitle="No liked theses this month" />}
        {tab === 'following' && (
          <div className="space-y-5">
            <ThesisList query={{ feed: 'following', sort: 'new' }} showToken emptyTitle="Nothing from people you follow yet" emptyHint="Follow traders from the leaderboard or a thesis to fill this feed." />
            <div>
              <h2 className="mb-2 flex items-center gap-1.5 text-sm font-extrabold text-fg"><Radio className="h-4 w-4 text-up" /> Trades by wallets you follow</h2>
              <SocialTrades scope="following" emptyText="Follow traders to see their swaps here as they happen." />
            </div>
          </div>
        )}
        {tab === 'trades' && <SocialTrades scope="community" emptyText="No trades from BankrDex profiles yet. Create yours and your swaps appear here." />}
      </div>

      <aside className="space-y-4 lg:sticky lg:top-[4.5rem] lg:self-start">
        <ProfileCta />
        <div className="rounded-2xl border border-line bg-panel p-3">
          <div className="mb-2 flex items-center justify-between px-1">
            <h3 className="flex items-center gap-1.5 text-sm font-extrabold text-fg"><Trophy className="h-4 w-4 text-warn" /> Top traders · 24h</h3>
            <button type="button" onClick={() => navigate({ name: 'leaderboard' })} className="text-xs font-bold text-accent hover:underline">See all</button>
          </div>
          <LeaderboardTable window="24h" sort="pnl" limit={6} compact />
        </div>
      </aside>
    </div>
  );
};
