import React from 'react';
import type { Language } from '../types';
import { useApp } from '../context/AppContext';

const languageOptions: { code: Language; flag: string; labelKey: 'english' | 'chinese' | 'japanese' | 'korean' }[] = [
  { code: 'en', flag: '🇺🇸', labelKey: 'english' },
  { code: 'zh', flag: '🇨🇳', labelKey: 'chinese' },
  { code: 'ja', flag: '🇯🇵', labelKey: 'japanese' },
  { code: 'ko', flag: '🇰🇷', labelKey: 'korean' },
];

interface LanguageSelectorProps {
  className?: string;
}

export const LanguageSelector: React.FC<LanguageSelectorProps> = ({ className = '' }) => {
  const { lang, setLang, t } = useApp();

  return (
    <label className={`items-center ${className || 'inline-flex'}`}>
      <span className="sr-only">{t.selectLanguage}</span>
      <select
        aria-label={t.selectLanguage}
        value={lang}
        onChange={(event) => setLang(event.target.value as Language)}
        className="rounded border border-line bg-panel px-2 py-1 text-[0.75rem] font-semibold text-[#d7efe9] outline-none focus:border-accent"
      >
        {languageOptions.map(({ code, flag, labelKey }) => (
          <option key={code} value={code}>
            {flag} {t[labelKey]}
          </option>
        ))}
      </select>
    </label>
  );
};
