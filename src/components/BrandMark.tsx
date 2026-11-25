import React, { useId } from 'react';
import { MARK_ARROW_BOTTOM, MARK_ARROW_TOP, MARK_ARROW_WIDTH, MARK_B_PATH, MARK_COLORS } from '../config/brandMark';

// The BankrDex mark (src/config/brandMark.ts) inline, so it stays sharp at any size. `animated`
// draws the breakout arrows in on hover of the closest `.group`.
export const BrandMark: React.FC<{ size?: number; className?: string; animated?: boolean; title?: string }> = ({ size = 32, className = '', animated = false, title }) => {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const ref = (name: string) => `url(#${name}${id})`;
  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={`shrink-0 ${animated ? 'brand-mark-animated' : ''} ${className}`}
    >
      <defs>
        <linearGradient id={`lime${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={MARK_COLORS.limeA} />
          <stop offset="0.55" stopColor={MARK_COLORS.limeB} />
          <stop offset="1" stopColor={MARK_COLORS.mint} />
        </linearGradient>
        <radialGradient id={`bg${id}`} cx="0.25" cy="0.15" r="1">
          <stop offset="0" stopColor="#1a2208" />
          <stop offset="0.5" stopColor="#0a0c0e" />
          <stop offset="1" stopColor="#050608" />
        </radialGradient>
        <radialGradient id={`violet${id}`} cx="0.95" cy="0.95" r="0.7">
          <stop offset="0" stopColor={MARK_COLORS.violet} stopOpacity="0.5" />
          <stop offset="1" stopColor={MARK_COLORS.violet} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="512" height="512" rx="118" fill={ref('bg')} />
      <rect width="512" height="512" rx="118" fill={ref('violet')} />
      <rect x="6" y="6" width="500" height="500" rx="113" fill="none" stroke={MARK_COLORS.limeB} strokeOpacity="0.25" strokeWidth="5" />
      <path fill={ref('lime')} d={MARK_B_PATH} />
      <g fill="none" stroke={MARK_COLORS.ink} strokeWidth={MARK_ARROW_WIDTH} strokeLinecap="round" strokeLinejoin="round">
        <path className="brand-mark-line" d={MARK_ARROW_TOP} pathLength={1} />
        <path className="brand-mark-line brand-mark-line-2" d={MARK_ARROW_BOTTOM} pathLength={1} />
      </g>
    </svg>
  );
};

// Mark + "BankrDex" wordmark, as used in the header and footer.
export const BrandWordmark: React.FC<{ size?: number; className?: string; textClassName?: string }> = ({ size = 32, className = '', textClassName = 'text-[1.15rem]' }) => (
  <span className={`inline-flex items-center gap-2.5 ${className}`}>
    <span className="brand-mark-shell rounded-[28%]"><BrandMark size={size} animated /></span>
    <span className={`font-display font-bold leading-none tracking-[-0.04em] text-fg ${textClassName}`}>
      Bankr<span className="text-gradient">Dex</span>
    </span>
  </span>
);
