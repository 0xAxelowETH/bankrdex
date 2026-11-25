import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Fingerprint, ShieldCheck, AlertCircle } from 'lucide-react';
import { hasPin } from '../utils/biometric';

export const BiometricLockModal: React.FC = () => {
  const {
    isBiometricModalOpen,
    setIsBiometricModalOpen,
    unlockWalletWithBiometrics,
    unlockWithPin,
    enableBiometrics,
    isBiometricEnrolledState,
    t,
  } = useApp();

  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isCheckingPin, setIsCheckingPin] = useState(false);

  if (!isBiometricModalOpen) return null;

  const handleBiometricAuth = async () => {
    setIsScanning(true);
    setPinError(null);
    try {
      const success = isBiometricEnrolledState
        ? await unlockWalletWithBiometrics()
        : await enableBiometrics();
      if (!success) setPinError(t.passkeyUnavailable);
      else if (!isBiometricEnrolledState) setIsBiometricModalOpen(false);
    } finally {
      setIsScanning(false);
    }
  };

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCheckingPin) return;
    setIsCheckingPin(true);
    try {
      const result = await unlockWithPin(pinInput);
      if (result.ok) {
        setPinInput('');
        setPinError(null);
        return;
      }
      if (result.reason === 'no-pin') setPinError(t.noPinSet);
      else if (result.reason === 'locked') {
        setPinError(`${t.pinLockedOut} ${Math.ceil((result.retryAfterMs ?? 0) / 1000)}${t.seconds}`);
      } else {
        setPinError(`${t.incorrectPin} ${result.attemptsLeft ?? 0} ${t.pinAttemptsLeft}`);
      }
    } finally {
      setIsCheckingPin(false);
    }
  };
  const pinAvailable = hasPin();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in">
      <div className="relative w-full max-w-md rounded-3xl border border-line bg-panel p-6 text-center shadow-2xl">
        {/* Animated Biometric Radar / Fingerprint Icon */}
        <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-2xl border border-accent/30 bg-accent/10 text-accent relative">
          <Fingerprint
            className={`h-10 w-10 transition-transform ${
              isScanning ? 'scale-110 text-emerald-400 animate-pulse' : ''
            }`}
          />
          {isScanning && (
            <div className="absolute inset-0 rounded-2xl border-2 border-emerald-400 animate-ping opacity-30 pointer-events-none" />
          )}
        </div>

        <h3 className="text-lg font-bold text-fg tracking-wide">
          {isBiometricEnrolledState ? t.biometricVerifyTitle : t.biometricEnableTitle}
        </h3>
        <p className="mt-1 text-xs text-muted leading-relaxed">
          {isBiometricEnrolledState
            ? t.biometricVerifyDescription
            : t.biometricEnableDescription}
        </p>

        {/* Biometric trigger button */}
        <button
          onClick={handleBiometricAuth}
          disabled={isScanning}
          className="w-full mt-6 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-neutral-950 font-bold text-sm shadow-lg flex items-center justify-center gap-2 transition-all cursor-pointer"
        >
          <Fingerprint className="h-5 w-5" />
          <span>
            {isScanning
              ? t.scanningBiometrics
              : isBiometricEnrolledState
              ? t.scanFingerprint
              : t.registerBiometrics}
          </span>
        </button>

        {/* PIN Fallback Form */}
        <div className="my-5 flex items-center gap-2">
          <div className="h-px flex-1 bg-raised" />
          <span className="text-[0.75rem] font-mono text-subtle">{t.orSecurityPin}</span>
          <div className="h-px flex-1 bg-raised" />
        </div>

        <form onSubmit={handlePinSubmit} className="space-y-3">
          <div className="relative">
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              disabled={!pinAvailable}
              maxLength={6}
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              placeholder={pinAvailable ? t.enterDefaultPin : t.noPinSet}
              className="w-full rounded-xl border border-line bg-sunken/60 py-2.5 px-4 text-center font-mono text-base tracking-widest text-fg outline-none focus:border-amber-500 placeholder:text-subtle placeholder:tracking-normal placeholder:text-xs"
            />
          </div>

          {pinError && (
            <div role="alert" className="flex items-center justify-center gap-1.5 text-xs text-rose-400">
              <AlertCircle className="h-3.5 w-3.5" />
              <span>{pinError}</span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsBiometricModalOpen(false)}
              className="w-1/2 py-2.5 rounded-xl border border-line text-xs font-semibold text-muted hover:bg-raised transition-colors"
            >
              {t.cancel}
            </button>
            <button
              type="submit"
              disabled={!pinAvailable || isCheckingPin}
              className="w-1/2 disabled:cursor-not-allowed disabled:opacity-50 py-2.5 rounded-xl bg-raised hover:bg-neutral-700 text-xs font-semibold text-fg transition-colors"
            >
              {t.unlockWithPin}
            </button>
          </div>
        </form>

        <div className="mt-4 pt-4 border-t border-line text-[0.75rem] text-subtle flex items-center justify-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
          <span>{t.webauthnHardwareEncryption}</span>
        </div>
        <p className="mt-2 text-[0.75rem] text-subtle">{t.localLockNotice}</p>
      </div>
    </div>
  );
};
