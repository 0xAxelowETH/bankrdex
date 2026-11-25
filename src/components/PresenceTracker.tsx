import { useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { CONSENT_ACCEPTED_EVENT, hasAccepted } from './ConsentGate';

const VISITOR_ID_KEY = 'bankrdex-visitor-id';
const HEARTBEAT_MS = 60_000;

// Random, anonymous ID for this browser. Shared by all its tabs, so one browser counts once.
function visitorId(): string | null {
  try {
    const saved = window.localStorage.getItem(VISITOR_ID_KEY);
    if (saved && /^[0-9a-f-]{36}$/.test(saved)) return saved;
    const created = crypto.randomUUID();
    window.localStorage.setItem(VISITOR_ID_KEY, created);
    return created;
  } catch {
    return null;
  }
}

// Sends a small heartbeat while a tab is visible, after the visitor accepted the policies.
// Powers the admin visitor statistics (online now, unique visitors); renders nothing.
export function PresenceTracker() {
  const { wallet } = useApp();
  const walletRef = useRef<string | null>(null);
  walletRef.current = wallet.isConnected && wallet.address ? wallet.address : null;
  const lastSentWalletRef = useRef<string | null>(null);

  useEffect(() => {
    let intervalId: number | undefined;
    let lastBeatAt = 0;

    const beat = () => {
      if (document.visibilityState !== 'visible' || !hasAccepted()) return;
      const id = visitorId();
      if (!id) return;
      lastBeatAt = Date.now();
      lastSentWalletRef.current = walletRef.current;
      void fetch('/api/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId: id, wallet: walletRef.current }),
        keepalive: true,
      }).catch(() => undefined);
    };
    const handleVisibility = () => {
      // Coming back to the tab: count it right away unless a beat was just sent.
      if (document.visibilityState === 'visible' && Date.now() - lastBeatAt > 15_000) beat();
    };

    beat();
    intervalId = window.setInterval(beat, HEARTBEAT_MS);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener(CONSENT_ACCEPTED_EVENT, beat);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener(CONSENT_ACCEPTED_EVENT, beat);
    };
  }, []);

  // Link the wallet as soon as it connects instead of waiting for the next beat.
  const connectedWallet = wallet.isConnected ? wallet.address : null;
  useEffect(() => {
    if (!connectedWallet || connectedWallet === lastSentWalletRef.current || !hasAccepted()) return;
    const id = visitorId();
    if (!id) return;
    lastSentWalletRef.current = connectedWallet;
    void fetch('/api/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorId: id, wallet: connectedWallet }),
      keepalive: true,
    }).catch(() => undefined);
  }, [connectedWallet]);

  return null;
}
