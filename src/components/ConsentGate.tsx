import React, { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { CONSENT_STORAGE_KEY, LEGAL_VERSION } from '../config/legal';

export const CONSENT_ACCEPTED_EVENT = 'bankrdex:consent-accepted';
let acceptedThisSession = false;

export function hasAccepted(): boolean {
  if (acceptedThisSession) return true;
  try {
    const stored = JSON.parse(window.localStorage.getItem(CONSENT_STORAGE_KEY) || 'null') as { version?: string } | null;
    return stored?.version === LEGAL_VERSION;
  } catch {
    return false;
  }
}

// Shown on the first visit (and again when LEGAL_VERSION changes) until the visitor accepts.
export const ConsentGate: React.FC = () => {
  const [isOpen, setIsOpen] = useState(() => !hasAccepted());
  const [checks, setChecks] = useState({ terms: false, privacy: false, risk: false });
  const dialogRef = useRef<HTMLDivElement>(null);
  const allChecked = checks.terms && checks.privacy && checks.risk;

  useEffect(() => {
    if (!isOpen) return;
    dialogRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [isOpen]);

  if (!isOpen) return null;

  const accept = () => {
    try {
      window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ version: LEGAL_VERSION, acceptedAt: new Date().toISOString() }));
    } catch {
      // Storage unavailable: accept for this session only.
    }
    acceptedThisSession = true;
    window.dispatchEvent(new Event(CONSENT_ACCEPTED_EVENT));
    setIsOpen(false);
  };

  const items: { key: keyof typeof checks; label: React.ReactNode }[] = [
    {
      key: 'terms',
      label: <>I have read and agree to the <a href="/terms" target="_blank" rel="noopener" className="text-accent underline">Terms of Service</a>.</>,
    },
    {
      key: 'privacy',
      label: <>I have read the <a href="/privacy" target="_blank" rel="noopener" className="text-accent underline">Privacy Policy</a>.</>,
    },
    {
      key: 'risk',
      label: <>I understand that trading tokens is risky, that BankrDex is non-custodial, and that I am responsible for every transaction I sign.</>,
    },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/80 p-3 backdrop-blur-sm sm:items-center">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-title"
        className="w-full max-w-md rounded-2xl border border-line bg-panel p-5 text-sm text-fg shadow-2xl"
      >
        <div className="flex items-center gap-3">
          <img src="/sources/bankrdex-mark.svg" alt="" width={40} height={40} className="brand-mark-shell rounded-[28%]" />
          <div>
            <h2 id="consent-title" className="text-base font-bold">Welcome to BankrDex</h2>
            <p className="text-xs text-muted">Please confirm before you continue.</p>
          </div>
        </div>

        <ul className="mt-4 space-y-2">
          {items.map((item) => (
            <li key={item.key}>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-surface p-3 hover:border-accent/50">
                <input
                  type="checkbox"
                  checked={checks[item.key]}
                  onChange={(event) => setChecks((current) => ({ ...current, [item.key]: event.target.checked }))}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--bd-accent)]"
                />
                <span className="leading-relaxed text-fg-soft">{item.label}</span>
              </label>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={accept}
          disabled={!allChecked}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3 font-bold text-black transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ShieldCheck className="h-4 w-4" />
          Agree and enter BankrDex
        </button>
        <p className="mt-3 text-center text-xs text-subtle">
          New here? Read the <a href="/docs" target="_blank" rel="noopener" className="underline hover:text-fg">BankrDex Docs</a>.
        </p>
      </div>
    </div>
  );
};
