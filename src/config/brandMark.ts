// The BankrDex mark: a bold lime "B" whose two counters are up-right breakout arrows, on a dark
// tile with a violet glow. Single source for the React mark (BrandMark.tsx), server-rendered
// images (share cards) and the icon files (scripts/brand-icons.mjs).
export const MARK_B_PATH = 'M136 96 H300 C356 96 394 134 394 184 C394 214 380 238 356 251 C390 264 410 294 410 332 C410 382 370 416 316 416 H136 Z';
export const MARK_ARROW_TOP = 'M212 222 L288 146 M233 146 H288 V201';
export const MARK_ARROW_BOTTOM = 'M212 364 L300 276 M237 276 H300 V339';
export const MARK_ARROW_WIDTH = 30;
export const MARK_COLORS = { limeA: '#f0ff5a', limeB: '#c3ff2e', mint: '#4dffb0', ink: '#06070a', violet: '#7c3aed' };

// The mark as a standalone SVG document. 'rounded' = app tile with a hairline border; 'square' =
// full-bleed (iOS / maskable icons round it themselves), with the glyph scaled by `scale`.
export function brandMarkSvg(shape: 'rounded' | 'square' = 'rounded', scale = 1): string {
  const { limeA, limeB, mint, ink, violet } = MARK_COLORS;
  const radius = shape === 'rounded' ? 118 : 0;
  const offset = 256 - 256 * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs>`
    + `<linearGradient id="l" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${limeA}"/><stop offset="0.55" stop-color="${limeB}"/><stop offset="1" stop-color="${mint}"/></linearGradient>`
    + `<radialGradient id="b" cx="0.25" cy="0.15" r="1"><stop offset="0" stop-color="#1a2208"/><stop offset="0.5" stop-color="#0a0c0e"/><stop offset="1" stop-color="#050608"/></radialGradient>`
    + `<radialGradient id="v" cx="0.95" cy="0.95" r="0.7"><stop offset="0" stop-color="${violet}" stop-opacity="0.5"/><stop offset="1" stop-color="${violet}" stop-opacity="0"/></radialGradient>`
    + `</defs><rect width="512" height="512" rx="${radius}" fill="url(#b)"/><rect width="512" height="512" rx="${radius}" fill="url(#v)"/>`
    + (shape === 'rounded' ? `<rect x="6" y="6" width="500" height="500" rx="113" fill="none" stroke="${limeB}" stroke-opacity="0.25" stroke-width="5"/>` : '')
    + `<g transform="translate(${offset} ${offset}) scale(${scale})"><path d="${MARK_B_PATH}" fill="url(#l)"/>`
    + `<g fill="none" stroke="${ink}" stroke-width="${MARK_ARROW_WIDTH}" stroke-linecap="round" stroke-linejoin="round"><path d="${MARK_ARROW_TOP}"/><path d="${MARK_ARROW_BOTTOM}"/></g></g></svg>`;
}
