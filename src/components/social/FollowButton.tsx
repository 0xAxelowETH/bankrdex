import React, { useEffect, useState } from 'react';
import { Loader2, UserCheck, UserPlus } from 'lucide-react';
import { useSocial } from '../../context/SocialContext';
import { fetchFollows, setFollow } from '../../services/social';

// Wallets the signed-in user follows, loaded once per session and shared by every button.
let followingFor: string | null = null;
let following = new Set<string>();
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

function loadFollowing(wallet: string): Promise<void> {
  if (followingFor === wallet && !loading) return Promise.resolve();
  if (followingFor === wallet && loading) return loading;
  followingFor = wallet;
  following = new Set();
  loading = fetchFollows(wallet, 'following')
    .then(({ entries }) => { following = new Set(entries.map((entry) => entry.wallet)); })
    .catch(() => undefined)
    .finally(() => { loading = null; notify(); });
  return loading;
}

export function useIsFollowing(target: string): boolean {
  const { wallet } = useSocial();
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((tick) => tick + 1);
    listeners.add(listener);
    if (wallet) void loadFollowing(wallet);
    return () => { listeners.delete(listener); };
  }, [wallet]);
  return Boolean(wallet && followingFor === wallet && following.has(target.toLowerCase()));
}

export const FollowButton: React.FC<{ wallet: string; size?: 'sm' | 'md'; onChange?: (following: boolean, followers: number) => void }> = ({ wallet: target, size = 'sm', onChange }) => {
  const { wallet, ensureProfile } = useSocial();
  const isFollowing = useIsFollowing(target);
  const [busy, setBusy] = useState(false);
  if (wallet && wallet === target.toLowerCase()) return null;

  const toggle = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (busy || !await ensureProfile()) return;
    setBusy(true);
    try {
      const result = await setFollow(target, !isFollowing);
      if (result.following) following.add(target.toLowerCase()); else following.delete(target.toLowerCase());
      notify();
      onChange?.(result.following, result.followers);
    } finally {
      setBusy(false);
    }
  };

  const padding = size === 'md' ? 'px-4 py-2 text-sm' : 'px-3 py-1 text-xs';
  return (
    <button type="button" onClick={(event) => void toggle(event)} aria-pressed={isFollowing}
      className={`group inline-flex shrink-0 items-center gap-1.5 rounded-full font-extrabold transition ${padding} ${isFollowing
        ? 'border border-line bg-raised text-fg hover:border-down/50 hover:text-down'
        : 'bg-fg text-surface hover:opacity-90'}`}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isFollowing ? <UserCheck className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}
      {isFollowing ? <><span className="group-hover:hidden">Following</span><span className="hidden group-hover:inline">Unfollow</span></> : 'Follow'}
    </button>
  );
};
