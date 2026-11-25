import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toHex } from 'viem';
import { useApp } from './AppContext';
import { fetchMe, rememberProfileCard, signInWithWallet, signOut as apiSignOut, type Profile, type Thesis } from '../services/social';

// Where the app is: market list, token terminal, social pages. Each has its own URL.
export type AppView =
  | { name: 'markets' }
  | { name: 'terminal' }
  | { name: 'feed' }
  | { name: 'leaderboard' }
  | { name: 'profile'; id: string };

export function viewFromPath(pathname: string): AppView | null {
  if (pathname === '/feed') return { name: 'feed' };
  if (pathname === '/leaderboard') return { name: 'leaderboard' };
  const profile = /^\/u\/([^/]+)$/.exec(pathname);
  if (profile) return { name: 'profile', id: decodeURIComponent(profile[1]).toLowerCase() };
  if (pathname.startsWith('/token/')) return { name: 'terminal' };
  if (pathname === '/') return { name: 'markets' };
  return null;
}

interface SocialContextType {
  wallet: string | null;
  profile: Profile | null;
  isLoading: boolean;
  isSigningIn: boolean;
  signInError: string | null;
  signIn: () => Promise<boolean>;
  signOut: () => Promise<void>;
  setProfile: (profile: Profile | null) => void;
  // Resolves true when the user can post/like/follow; otherwise starts whatever step is missing
  // (connect wallet → sign in → create profile) and resolves false.
  ensureProfile: () => Promise<boolean>;
  isProfileEditorOpen: boolean;
  setIsProfileEditorOpen: (open: boolean) => void;
  composer: { open: boolean; thesis?: Partial<Thesis> };
  openComposer: (preset?: Partial<Thesis>) => void;
  closeComposer: () => void;
  // Bumped after posting so open lists reload.
  thesesVersion: number;
  bumpTheses: () => void;
  view: AppView;
  navigate: (view: AppView) => void;
}

const SocialContext = createContext<SocialContextType | null>(null);

export function SocialProvider({ children, initialView }: { children: ReactNode; initialView: AppView }) {
  const { wallet, walletRequest, setIsWalletConnectModalOpen, addAlert } = useApp();
  const [session, setSession] = useState<{ wallet: string | null; profile: Profile | null }>({ wallet: null, profile: null });
  const [isLoading, setIsLoading] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [isProfileEditorOpen, setIsProfileEditorOpen] = useState(false);
  const [composer, setComposer] = useState<{ open: boolean; thesis?: Partial<Thesis> }>({ open: false });
  const [thesesVersion, setThesesVersion] = useState(0);
  const [view, setView] = useState<AppView>(initialView);
  const wasConnected = useRef(false);

  useEffect(() => {
    fetchMe()
      .then((me) => setSession({ wallet: me.wallet, profile: me.profile }))
      .catch(() => undefined)
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    if (session.profile) rememberProfileCard(session.profile);
  }, [session.profile]);

  const signOut = useCallback(async () => {
    setSession({ wallet: null, profile: null });
    await apiSignOut().catch(() => undefined);
  }, []);

  // A session belongs to one wallet: switching or disconnecting the wallet signs out.
  useEffect(() => {
    const address = wallet.isConnected ? wallet.address.toLowerCase() : '';
    if (session.wallet && wasConnected.current && (!address || address !== session.wallet)) void signOut();
    if (session.wallet && address && address !== session.wallet && !wasConnected.current) void signOut();
    wasConnected.current = Boolean(address);
  }, [session.wallet, signOut, wallet.address, wallet.isConnected]);

  // Resolves the signed-in profile state, or null when sign-in did not happen.
  const startSignIn = useCallback(async (): Promise<{ hasProfile: boolean } | null> => {
    if (!wallet.isConnected || !wallet.address) {
      setIsWalletConnectModalOpen(true);
      return null;
    }
    setIsSigningIn(true);
    setSignInError(null);
    try {
      const address = wallet.address;
      const result = await signInWithWallet(address, async (message) =>
        String(await walletRequest('personal_sign', [toHex(message), address])));
      setSession({ wallet: result.wallet, profile: result.profile });
      if (!result.profile) setIsProfileEditorOpen(true);
      return { hasProfile: Boolean(result.profile) };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sign-in failed.';
      setSignInError(/reject|denied|cancel/i.test(message) ? 'Signature cancelled.' : message);
      if (!/reject|denied|cancel/i.test(message)) addAlert({ title: 'Sign-in failed', message, type: 'security' });
      return null;
    } finally {
      setIsSigningIn(false);
    }
  }, [addAlert, setIsWalletConnectModalOpen, wallet.address, wallet.isConnected, walletRequest]);

  const signIn = useCallback(async () => (await startSignIn()) !== null, [startSignIn]);

  const ensureProfile = useCallback(async () => {
    if (session.wallet && session.profile) return true;
    if (!session.wallet) return (await startSignIn())?.hasProfile ?? false;
    setIsProfileEditorOpen(true);
    return false;
  }, [session.profile, session.wallet, startSignIn]);

  const navigate = useCallback((next: AppView) => {
    setView(next);
    window.scrollTo({ top: 0 });
  }, []);

  // Back/forward between social pages and the market list.
  useEffect(() => {
    const onPop = () => {
      const next = viewFromPath(window.location.pathname);
      if (next) setView(next);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const value = useMemo<SocialContextType>(() => ({
    wallet: session.wallet,
    profile: session.profile,
    isLoading,
    isSigningIn,
    signInError,
    signIn,
    signOut,
    setProfile: (profile) => setSession((current) => ({ ...current, profile })),
    ensureProfile,
    isProfileEditorOpen,
    setIsProfileEditorOpen,
    composer,
    openComposer: (thesis) => {
      void ensureProfile().then((ok) => { if (ok) setComposer({ open: true, thesis }); });
    },
    closeComposer: () => setComposer({ open: false }),
    thesesVersion,
    bumpTheses: () => setThesesVersion((version) => version + 1),
    view,
    navigate,
  }), [composer, ensureProfile, isLoading, isProfileEditorOpen, isSigningIn, navigate, session, signIn, signInError, signOut, thesesVersion, view]);

  return <SocialContext.Provider value={value}>{children}</SocialContext.Provider>;
}

export function useSocial(): SocialContextType {
  const context = useContext(SocialContext);
  if (!context) throw new Error('useSocial must be used inside SocialProvider');
  return context;
}
