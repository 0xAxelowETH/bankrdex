import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { getWalletConnectProjectId, getWalletConnectProvider, toEip1193Provider } from '../utils/walletConnect';
import {
  X,
  Wallet,
  ExternalLink,
  Zap,
  Search,
  QrCode,
} from 'lucide-react';
import { BrandLogo } from './BrandLogo';

export const WalletConnectModal: React.FC = () => {
  const {
    isWalletConnectModalOpen,
    setIsWalletConnectModalOpen,
    connectWallet,
    connectByCustomAddress,
    networkStats,
    t,
  } = useApp();

  const [customAddress, setCustomAddress] = useState('');
  const [isQuerying, setIsQuerying] = useState(false);
  const [customError, setCustomError] = useState('');
  const [walletConnectError, setWalletConnectError] = useState('');
  const walletConnectProjectId = getWalletConnectProjectId();

  if (!isWalletConnectModalOpen) return null;

  const handleInjectedConnect = async () => {
    setIsQuerying(true);
    setWalletConnectError('');
    try {
      const connected = await connectWallet('injected');
      if (connected) {
        setIsWalletConnectModalOpen(false);
      } else {
        setWalletConnectError(t.walletExtensionError);
      }
    } catch {
      setWalletConnectError(t.walletConnectionError);
    } finally {
      setIsQuerying(false);
    }
  };

  const handleQrConnect = async () => {
    setWalletConnectError('');
    if (!walletConnectProjectId) {
      setWalletConnectError(t.walletConnectConfigError);
      return;
    }

    setIsQuerying(true);
    let provider: Awaited<ReturnType<typeof getWalletConnectProvider>> | null = null;
    let connected = false;

    try {
      provider = await getWalletConnectProvider();
      if (!provider.session) await provider.connect();
      const providerAdapter = toEip1193Provider(provider);
      connected = await connectWallet('injected', providerAdapter);
      if (connected) {
        setIsWalletConnectModalOpen(false);
      } else {
        setWalletConnectError(t.walletAccountError);
      }
    } catch (error) {
      const details = error instanceof Error ? error.message : t.unknownError;
      setWalletConnectError(`WalletConnect: ${details}`);
    } finally {
      if (provider && !connected) void provider.disconnect().catch(() => undefined);
      setIsQuerying(false);
    }
  };

  const handleCustomSync = async (e: React.FormEvent) => {
    e.preventDefault();
    setCustomError('');
    if (!customAddress.startsWith('0x') || customAddress.length !== 42) {
      setCustomError(t.invalidWalletAddress);
      return;
    }

    setIsQuerying(true);
    try {
      const ok = await connectByCustomAddress(customAddress.trim());
      if (ok) {
        setIsWalletConnectModalOpen(false);
      } else {
        setCustomError(t.rpcBalanceError);
      }
    } finally {
      setIsQuerying(false);
    }
  };

  const option = 'group flex w-full items-center gap-3 rounded-2xl border border-line bg-sunken/50 p-3 text-left transition hover:border-accent/50 hover:bg-raised/60 disabled:cursor-wait disabled:opacity-60';
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={t.walletConnectTitle}>
      <button type="button" aria-label="Close" className="absolute inset-0 cursor-default" onClick={() => setIsWalletConnectModalOpen(false)} />
      <div className="relative max-h-[94dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-line bg-panel p-5 shadow-2xl shadow-black/60 sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="btn-gradient flex h-10 w-10 items-center justify-center rounded-2xl text-white"><Wallet className="h-5 w-5" /></span>
            <div>
              <h3 className="text-base font-extrabold text-fg">{t.walletConnectTitle}</h3>
              <p className="text-xs text-muted">Trade on Base, Robinhood, Arbitrum and Arc. Every swap is signed in your wallet.</p>
            </div>
          </div>
          <button type="button" onClick={() => setIsWalletConnectModalOpen(false)} aria-label="Close" className="rounded-full p-1.5 text-muted hover:bg-raised hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 flex items-center justify-between rounded-xl border border-line/80 bg-sunken/50 px-3 py-2 text-[0.6875rem]">
          <span className="inline-flex items-center gap-1.5 font-bold text-up"><span className="live-dot h-1.5 w-1.5 rounded-full bg-up" /> {t.mainnet}</span>
          <span className="font-mono text-subtle">#{networkStats.blockNumber.toLocaleString('en-US')} · {networkStats.rpcLatencyMs}ms</span>
        </div>

        <div className="mt-3 space-y-2">
          <button type="button" onClick={handleInjectedConnect} disabled={isQuerying} className={option}>
            <BrandLogo brand="okx" size={36} className="rounded-xl bg-white p-1.5" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-sm font-extrabold text-fg">OKX Wallet <span className="rounded-full bg-up/15 px-1.5 py-0.5 text-[0.625rem] font-extrabold uppercase text-up">{t.recommended}</span></span>
              <span className="block text-xs text-muted">{t.walletNonCustodial}</span>
            </span>
            <Zap className="h-4 w-4 text-accent opacity-0 transition group-hover:opacity-100" />
          </button>
          <button type="button" onClick={handleInjectedConnect} disabled={isQuerying} className={option}>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-raised"><BrandLogo brand="metamask" size={24} /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-extrabold text-fg">Browser wallet</span>
              <span className="block text-xs text-muted">{t.otherWalletDescription}</span>
            </span>
            <BrandLogo brand="binance" size={18} className="rounded-full bg-white p-0.5" />
          </button>
          <button type="button" onClick={handleQrConnect} disabled={isQuerying} className={option}>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 text-accent"><QrCode className="h-5 w-5" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-extrabold text-fg">{t.qrConnect}</span>
              <span className="block text-xs text-muted">{isQuerying ? t.scanningQR : t.scanWithMobileWallet}</span>
            </span>
            <ExternalLink className="h-4 w-4 text-subtle" />
          </button>
        </div>
        {!walletConnectProjectId && (
          <p className="mt-2 text-[0.6875rem] text-subtle">WalletConnect QR needs a Project ID in <span className="font-mono">.env.local</span>.</p>
        )}
        {walletConnectError && <p role="alert" className="mt-3 rounded-xl bg-down/10 px-3 py-2 text-xs text-down">{walletConnectError}</p>}

        <details className="group mt-4 rounded-2xl border border-line/80 bg-sunken/40 px-3 py-2.5">
          <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-bold text-fg-soft">
            <span className="inline-flex items-center gap-1.5"><Search className="h-3.5 w-3.5" /> Watch an address (read-only)</span>
            <span className="text-subtle transition group-open:rotate-180">⌄</span>
          </summary>
          <form onSubmit={handleCustomSync} className="mt-2.5 space-y-2">
            <input
              type="text"
              value={customAddress}
              onChange={(e) => setCustomAddress(e.target.value)}
              placeholder={t.exampleAddress}
              aria-label={t.walletAddressLabel}
              className="w-full rounded-xl border border-line bg-panel px-3 py-2.5 font-mono text-xs text-fg outline-none placeholder:text-subtle focus:border-accent"
            />
            {customError && <p className="text-xs text-down">{customError}</p>}
            <button type="submit" disabled={isQuerying || !customAddress} className="w-full rounded-xl bg-fg py-2.5 text-xs font-extrabold text-surface transition hover:opacity-90 disabled:opacity-50">
              {isQuerying ? t.readingOnChainBalance : t.syncWalletBalance}
            </button>
          </form>
        </details>
        <p className="mt-3 text-center text-[0.6875rem] text-subtle">BankrDex never sees your keys or seed phrase.</p>
      </div>
    </div>
  );
};
