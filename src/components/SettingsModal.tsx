import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  X,
  Fingerprint,
  SlidersHorizontal,
  Volume2,
  VolumeX,
  Bell,
  Globe,
  Sun,
  Moon,
  Bot,
} from 'lucide-react';
import { hasPin, isValidPin, setPin as savePin } from '../utils/biometric';
import { LanguageSelector } from './LanguageSelector';
import { MASCOTS, MascotPortrait, readMascotSetting, setMascotSetting, type MascotSetting } from './BankrMascot';

export const SettingsModal: React.FC = () => {
  const {
    isSettingsOpen,
    setIsSettingsOpen,
    soundEnabled,
    setSoundEnabled,
    wallet,
    isBiometricEnrolledState,
    enableBiometrics,
    disableBiometrics,
    theme,
    setTheme,
    t,
  } = useApp();

  const [pin, setPin] = useState('');
  const [pinSaved, setPinSaved] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [mascot, setMascot] = useState<MascotSetting>(() => readMascotSetting());

  if (!isSettingsOpen) return null;

  const handleSavePin = async () => {
    if (!isValidPin(pin)) {
      setPinError(t.pinFormatHint);
      return;
    }
    try {
      await savePin(pin);
      setPin('');
      setPinError(null);
      setPinSaved(true);
      setTimeout(() => setPinSaved(false), 2000);
    } catch (error) {
      setPinError(error instanceof Error ? error.message : t.pinFormatHint);
    }
  };

  const requestBrowserNotification = async () => {
    if ('Notification' in window) {
      const res = await Notification.requestPermission();
      if (res === 'granted') {
        new Notification('BankrDex Notifications Enabled', {
          body: t.soundNotificationBody,
          icon: '/favicon.ico',
        });
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
      <div className="relative w-full max-w-lg rounded-3xl border border-line bg-panel p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-line">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-accent/10 text-accent border border-accent/30">
              <SlidersHorizontal className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-fg tracking-wide">
                {t.settings}
              </h3>
              <p className="text-xs text-muted">{t.settingsDescription}</p>
            </div>
          </div>
          <button
            onClick={() => setIsSettingsOpen(false)}
            className="p-1.5 rounded-lg border border-line text-muted hover:text-fg hover:bg-raised transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Settings Body */}
        <div className="space-y-4 my-4 max-h-[70vh] overflow-y-auto pr-1">
          <div className="p-3 rounded-xl border border-line bg-sunken/60 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs">
              <Globe className="h-4 w-4 text-muted" />
              <span className="font-semibold text-fg">{t.language}</span>
            </div>
            <LanguageSelector />
          </div>

          <div className="p-3 rounded-xl border border-line bg-sunken/60 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs">
              {theme === 'dark' ? (
                <Moon className="h-4 w-4 text-muted" />
              ) : (
                <Sun className="h-4 w-4 text-accent" />
              )}
              <span className="font-semibold text-fg">{t.appearance}</span>
            </div>
            <div className="inline-flex rounded-lg border border-line bg-panel p-0.5" role="group" aria-label={t.appearance}>
              <button
                type="button"
                onClick={() => setTheme('dark')}
                aria-pressed={theme === 'dark'}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${theme === 'dark' ? 'bg-accent text-black' : 'text-muted hover:text-fg'}`}
              >
                {t.darkTheme}
              </button>
              <button
                type="button"
                onClick={() => setTheme('light')}
                aria-pressed={theme === 'light'}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${theme === 'light' ? 'bg-accent text-black' : 'text-muted hover:text-fg'}`}
              >
                {t.lightTheme}
              </button>
            </div>
          </div>

          {/* Sound & Notifications */}
          <div className="p-3 rounded-xl border border-line bg-sunken/60 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs">
                {soundEnabled ? (
                  <Volume2 className="h-4 w-4 text-accent" />
                ) : (
                  <VolumeX className="h-4 w-4 text-muted" />
                )}
                <div>
                  <span className="font-semibold text-fg block">{t.soundEffects}</span>
                  <span className="text-[0.75rem] text-subtle">
                    {t.soundEffectsDescription}
                  </span>
                </div>
              </div>
              <input
                type="checkbox"
                checked={soundEnabled}
                onChange={(e) => setSoundEnabled(e.target.checked)}
                className="h-4 w-4 rounded accent-[#c3ff2e] cursor-pointer"
              />
            </div>

            <div className="pt-2 border-t border-line flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs">
                <Bell className="h-4 w-4 text-accent" />
                <div>
                  <span className="font-semibold text-fg block">{t.browserNotifications}</span>
                  <span className="text-[0.75rem] text-subtle">
                    {t.priceAlertDescription}
                  </span>
                </div>
              </div>
              <button
                onClick={requestBrowserNotification}
                className="px-2.5 py-1 rounded bg-panel border border-line text-xs font-semibold text-accent hover:text-fg"
              >
                {t.enable}
              </button>
            </div>
          </div>

          {/* Mascot */}
          <div className="p-3 rounded-xl border border-line bg-sunken/60 space-y-3">
            <div className="flex items-center gap-2 text-xs">
              <Bot className={`h-4 w-4 ${mascot !== 'off' ? 'text-accent' : 'text-muted'}`} />
              <div>
                <span className="font-semibold text-fg block" id="mascot-label">{t.mascot}</span>
                <span className="text-[0.75rem] text-subtle">{t.mascotDescription}</span>
              </div>
            </div>
            <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-labelledby="mascot-label">
              {[...MASCOTS.map((item) => ({ id: item.id as MascotSetting, name: item.name })), { id: 'off' as MascotSetting, name: t.mascotOff }].map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={mascot === option.id}
                  onClick={() => {
                    setMascot(option.id);
                    setMascotSetting(option.id);
                  }}
                  className={`flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-[0.6875rem] font-semibold transition-colors ${mascot === option.id ? 'border-accent bg-accent/10 text-accent' : 'border-line text-muted hover:border-fg/20 hover:text-fg'}`}
                >
                  {option.id === 'off'
                    ? <span className="flex h-10 w-10 items-center justify-center text-lg text-subtle" aria-hidden="true">⦸</span>
                    : <MascotPortrait id={option.id as Exclude<MascotSetting, 'off'>} />}
                  <span className="truncate max-w-full">{option.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Biometric Security */}
          <div className="p-3 rounded-xl border border-line bg-sunken/60 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs">
                <Fingerprint className="h-4 w-4 text-emerald-400" />
                <div>
                  <span className="font-semibold text-fg block">{t.biometricAuthentication}</span>
                  <span className="text-[0.75rem] text-subtle">
                    {t.biometricDescription}
                  </span>
                </div>
              </div>
              <input
                type="checkbox"
                checked={isBiometricEnrolledState}
                onChange={async (e) => {
                  if (e.target.checked) {
                    await enableBiometrics();
                  } else {
                    disableBiometrics();
                  }
                }}
                className="h-4 w-4 rounded accent-emerald-500 cursor-pointer"
              />
            </div>

            {/* PIN Code Setting */}
            <div className="pt-2 border-t border-line flex items-center justify-between text-xs">
              <span className="text-muted">{t.securityPin}</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  maxLength={6}
                  value={pin}
                  placeholder={hasPin() ? '••••' : '----'}
                  aria-label={t.securityPin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  className="w-20 px-2 py-1 bg-panel border border-line rounded font-mono text-center text-fg"
                />
                <button
                  onClick={handleSavePin}
                  className="px-2.5 py-1 bg-raised hover:bg-neutral-700 text-fg rounded font-medium"
                >
                  {pinSaved ? t.saved : t.save}
                </button>
              </div>
            </div>
            {pinError && <p role="alert" className="text-[0.75rem] text-rose-400">{pinError}</p>}
            <p className="text-[0.75rem] text-subtle">{t.localLockNotice}</p>
          </div>

          {/* External wallet key management */}
          {wallet.isConnected && (
            <div className="p-3 rounded-xl border border-line bg-sunken/60 text-xs">
              <span className="font-semibold text-fg">{t.externalWalletKeys}</span>
              <p className="text-[0.75rem] text-subtle mt-1">
                {t.externalWalletKeysDescription}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-line flex items-center justify-end">
          <button
            onClick={() => setIsSettingsOpen(false)}
            className="px-5 py-2 rounded-xl btn-gradient text-white font-bold text-xs shadow-md transition-colors"
          >
            {t.saveSettings}
          </button>
        </div>
      </div>
    </div>
  );
};
