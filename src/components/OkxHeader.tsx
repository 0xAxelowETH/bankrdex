import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { useSocial, type AppView } from '../context/SocialContext';
import { shortenAddress } from '../utils/web3';
import {
  BarChart3,
  BriefcaseBusiness,
  CandlestickChart,
  Check,
  ChevronDown,
  Copy,
  LogIn,
  LogOut,
  Moon,
  Newspaper,
  Pencil,
  Rocket,
  Settings2,
  Sun,
  Trophy,
  UserRound,
  Volume2,
  VolumeX,
  Wallet,
} from 'lucide-react';
import { BrandWordmark } from './BrandMark';
import { HeaderSearch } from './HeaderSearch';
import { MarketStrip } from './MarketStrip';
import { LanguageSelector } from './LanguageSelector';
import { ProfileAvatar } from './social/SocialBits';

const NAV: { key: AppView['name']; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'markets', label: 'Markets', icon: BarChart3 },
  { key: 'terminal', label: 'Trade', icon: CandlestickChart },
  { key: 'feed', label: 'Feed', icon: Newspaper },
  { key: 'leaderboard', label: 'Leaderboard', icon: Trophy },
];

function UserMenu() {
  const { wallet, disconnectWallet, setIsPortfolioOpen, t } = useApp();
  const { wallet: session, profile, signIn, signOut, isSigningIn, setIsProfileEditorOpen, navigate } = useSocial();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const signedIn = Boolean(session && session === wallet.address.toLowerCase());

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(wallet.address); setCopied(true); window.setTimeout(() => setCopied(false), 1_500); } catch { /* blocked */ }
  };
  const item = 'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-semibold text-fg-soft hover:bg-raised hover:text-fg';

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="menu"
        className="flex items-center gap-2 rounded-full border border-line bg-panel/80 py-1 pl-1 pr-2.5 transition hover:border-fg/20">
        <ProfileAvatar wallet={wallet.address.toLowerCase()} card={signedIn ? profile : null} size={28} />
        <span className="hidden min-w-0 text-left leading-tight sm:block">
          <span className="block max-w-[8.5rem] truncate text-xs font-extrabold text-fg">{signedIn && profile ? `@${profile.username}` : shortenAddress(wallet.address)}</span>
          <span className="block font-mono text-[0.6875rem] text-muted">{wallet.ethBalance.toLocaleString('en-US', { maximumFractionDigits: 4 })} ETH</span>
        </span>
        <ChevronDown className={`h-3.5 w-3.5 text-muted transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div role="menu" className="menu-pop absolute right-0 top-[calc(100%+0.5rem)] z-50 w-72 overflow-hidden rounded-2xl border border-line bg-panel p-2 shadow-2xl shadow-black/50">
          <div className="mb-1 flex items-center gap-3 rounded-xl bg-sunken/50 p-3">
            <ProfileAvatar wallet={wallet.address.toLowerCase()} card={signedIn ? profile : null} size={40} />
            <div className="min-w-0">
              <div className="truncate font-extrabold text-fg">{signedIn && profile ? (profile.displayName || `@${profile.username}`) : 'Your wallet'}</div>
              <button type="button" onClick={() => void copy()} className="inline-flex items-center gap-1 font-mono text-xs text-muted hover:text-fg">
                {shortenAddress(wallet.address)} {copied ? <Check className="h-3 w-3 text-up" /> : <Copy className="h-3 w-3" />}
              </button>
            </div>
          </div>
          {!signedIn && (
            <button type="button" role="menuitem" disabled={isSigningIn} onClick={() => { void signIn(); setOpen(false); }} className="btn-gradient my-1 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-extrabold text-white disabled:opacity-60">
              <LogIn className="h-4 w-4" /> {isSigningIn ? 'Check your wallet…' : 'Sign in to create a profile'}
            </button>
          )}
          {signedIn && profile && (
            <button type="button" role="menuitem" onClick={() => { navigate({ name: 'profile', id: profile.username }); setOpen(false); }} className={item}><UserRound className="h-4 w-4" /> My profile</button>
          )}
          {signedIn && (
            <button type="button" role="menuitem" onClick={() => { setIsProfileEditorOpen(true); setOpen(false); }} className={item}><Pencil className="h-4 w-4" /> {profile ? 'Edit profile' : 'Create profile'}</button>
          )}
          <button type="button" role="menuitem" onClick={() => { setIsPortfolioOpen(true); setOpen(false); }} className={item}><BriefcaseBusiness className="h-4 w-4" /> {t.portfolio}</button>
          <div className="my-1 h-px bg-line" />
          {signedIn && <button type="button" role="menuitem" onClick={() => { void signOut(); setOpen(false); }} className={item}><LogOut className="h-4 w-4" /> Sign out of profile</button>}
          <button type="button" role="menuitem" onClick={() => { disconnectWallet(); setOpen(false); }} className={`${item} text-down hover:text-down`}><Wallet className="h-4 w-4" /> {t.disconnectWallet}</button>
        </div>
      )}
    </div>
  );
}

export const OkxHeader: React.FC<{ onNavigate: (view: AppView) => void }> = ({ onNavigate }) => {
  const { wallet, setIsWalletConnectModalOpen, t, soundEnabled, setSoundEnabled, theme, setTheme, setIsSettingsOpen } = useApp();
  const { view } = useSocial();
  const iconButton = 'rounded-xl p-2 text-muted transition hover:bg-raised hover:text-fg';

  return (
    <>
      <MarketStrip />
      <header className="site-header sticky top-0 z-40 w-full">
        <div className="mx-auto flex h-14 max-w-[100rem] items-center gap-3 px-3 sm:px-4 xl:px-5">
          <a href="/" onClick={(event) => { event.preventDefault(); onNavigate({ name: 'markets' }); }} className="group shrink-0" aria-label="BankrDex home">
            <BrandWordmark size={32} />
          </a>

          <nav aria-label="Main" className="ml-2 hidden items-center gap-0.5 md:flex">
            {NAV.map(({ key, label, icon: Icon }) => {
              const active = view.name === key || (key === 'feed' && view.name === 'profile');
              return (
                <button key={key} type="button" onClick={() => onNavigate({ name: key } as AppView)} aria-current={active ? 'page' : undefined} className="nav-link">
                  <Icon className="h-3.5 w-3.5" /> <span className={key === 'leaderboard' ? 'hidden lg:inline' : undefined}>{label}</span>
                </button>
              );
            })}
            <a href="/launches" className="nav-link">
              <Rocket className="h-3.5 w-3.5" /> <span className="hidden lg:inline">Launches</span>
            </a>
          </nav>

          <HeaderSearch className="ml-auto hidden w-full max-w-[22rem] sm:block xl:max-w-[26rem]" />

          <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:ml-0">
            <button type="button" onClick={() => setSoundEnabled(!soundEnabled)} className={`${iconButton} hidden lg:block`} title={soundEnabled ? t.soundOn : t.soundOff} aria-label={soundEnabled ? t.soundOn : t.soundOff}>
              {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>
            <button type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className={iconButton} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title={theme === 'dark' ? 'Light theme' : 'Dark theme'}>
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button type="button" onClick={() => setIsSettingsOpen(true)} className={iconButton} title="Settings" aria-label="Settings">
              <Settings2 className="h-4 w-4" />
            </button>
            <LanguageSelector className="hidden xl:inline-flex" />
            {wallet.isConnected ? <span className="ml-1"><UserMenu /></span> : (
              <button type="button" onClick={() => setIsWalletConnectModalOpen(true)} aria-label={t.connectWallet}
                className="btn-gradient ml-1.5 inline-flex h-9 items-center gap-2 rounded-xl px-4 text-[0.8125rem] font-extrabold text-white active:scale-95">
                <Wallet className="h-4 w-4" />
                <span className="hidden sm:inline">{t.connect}</span>
              </button>
            )}
          </div>
        </div>
      </header>
    </>
  );
};
