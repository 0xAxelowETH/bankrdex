import { useEffect, useRef, useState } from 'react';

// BankrDex mascots: chibi Bankr bots that follow the cursor on desktop. They nap when the
// cursor rests, startle awake, and cheer on app events (see `mascotCheer`). Purely decorative:
// they never take clicks, hide on touch screens and for reduced-motion users.

const SETTING_KEY = 'bankrdex-mascot';
const SETTING_EVENT = 'bankrdex:mascot-setting';
const CHEER_EVENT = 'bankrdex:mascot-cheer';
const SIZE = 64;
// How close the mascot walks to the cursor, and how long the cursor must rest before a nap.
const STOP_DISTANCE = 34;
const SLEEP_AFTER_MS = 12_000;
const SURPRISE_MS = 650;
const CHEER_MS = 1_800;

type Mood = 'idle' | 'run' | 'sleep' | 'surprised' | 'cheer';

export type MascotId = 'botty' | 'bnkr' | 'vault' | 'agent';
export type MascotSetting = MascotId | 'off';

const INK = '#14213d';
const SCREEN = '#e0f2fe';

// --- Shared face -------------------------------------------------------------------------------

interface FaceLayout {
  leftX: number;
  rightX: number;
  eyeY: number;
  mouthY: number;
  blushY: number;
  blushInset?: number;
  // Anime eyes: taller, with a coloured iris (used by Kohi-chan).
  iris?: string;
}

function Eyes({ mood, face }: { mood: Mood; face: FaceLayout }) {
  const { leftX: l, rightX: r, eyeY: y } = face;
  if (mood === 'sleep') {
    return (
      <g fill="none" stroke="#2b1a10" strokeWidth="1.8" strokeLinecap="round">
        <path d={`M${l - 3} ${y + 1} q3 2.4 6 0`} />
        <path d={`M${r - 3} ${y + 1} q3 2.4 6 0`} />
      </g>
    );
  }
  if (mood === 'cheer') {
    return (
      <g fill="none" stroke="#2b1a10" strokeWidth="2" strokeLinecap="round">
        <path d={`M${l - 3} ${y + 2} q3 -4 6 0`} />
        <path d={`M${r - 3} ${y + 2} q3 -4 6 0`} />
      </g>
    );
  }
  if (mood === 'surprised') {
    return (
      <g>
        {[l, r].map((x) => (
          <g key={x}>
            <circle cx={x} cy={y} r="3.8" fill="#fff" stroke="#2b1a10" strokeWidth="1.4" />
            <circle cx={x} cy={y} r="1.5" fill="#2b1a10" />
          </g>
        ))}
      </g>
    );
  }
  if (face.iris) {
    return (
      <g className="bm-eyes">
        {[l, r].map((x) => (
          <g key={x}>
            <ellipse cx={x} cy={y} rx="3.5" ry="4.6" fill="#2b1a10" />
            <ellipse cx={x} cy={y + 1.2} rx="2.5" ry="3" fill={face.iris} />
            <circle cx={x + 1.2} cy={y - 1.8} r="1.45" fill="#fff" />
            <circle cx={x - 1.1} cy={y + 2.2} r="0.7" fill="#fff" />
            <path d={`M${x - 3.8} ${y - 4.2} q3.8 -2 7.6 0`} fill="none" stroke="#2b1a10" strokeWidth="1.3" strokeLinecap="round" />
          </g>
        ))}
      </g>
    );
  }
  return (
    <g className="bm-eyes">
      {[l, r].map((x) => (
        <g key={x}>
          <ellipse cx={x} cy={y} rx="3" ry="3.9" fill="#2b1a10" />
          <circle cx={x + 1.1} cy={y - 1.5} r="1.25" fill="#fff" />
          <circle cx={x - 0.8} cy={y + 1.6} r="0.6" fill="#fff" />
        </g>
      ))}
    </g>
  );
}

function Mouth({ mood, face }: { mood: Mood; face: FaceLayout }) {
  const x = (face.leftX + face.rightX) / 2;
  const y = face.mouthY;
  if (mood === 'sleep') return <ellipse cx={x} cy={y + 1} rx="1.1" ry="1.3" fill="#7a3b2a" />;
  if (mood === 'surprised') return <ellipse cx={x} cy={y + 1.4} rx="1.6" ry="2.1" fill="#7a3b2a" />;
  if (mood === 'cheer') {
    return <path d={`M${x - 3.4} ${y - 0.4} q3.4 4.6 6.8 0 z`} fill="#c2553f" stroke="#2b1a10" strokeWidth="1.1" strokeLinejoin="round" />;
  }
  return <path d={`M${x - 2.6} ${y - 0.2} q1.3 1.7 2.6 0 q1.3 1.7 2.6 0`} fill="none" stroke="#2b1a10" strokeWidth="1.4" strokeLinecap="round" />;
}

function Face({ mood, face }: { mood: Mood; face: FaceLayout }) {
  const inset = face.blushInset ?? 5.5;
  return (
    <>
      <ellipse cx={face.leftX - inset} cy={face.blushY} rx="3.2" ry="1.7" fill="#ff9fb0" opacity="0.75" />
      <ellipse cx={face.rightX + inset} cy={face.blushY} rx="3.2" ry="1.7" fill="#ff9fb0" opacity="0.75" />
      <Eyes mood={mood} face={face} />
      <Mouth mood={mood} face={face} />
    </>
  );
}

function Shadow() {
  return <ellipse className="bm-shadow" cx="40" cy="75.5" rx="16" ry="3.2" fill="#000" opacity="0.22" />;
}

function Legs({ fill = '#5a341d', y = 63 }: { fill?: string; y?: number }) {
  return (
    <g className="bm-legs" fill={fill}>
      <rect className="bm-leg-l" x="30" y={y} width="7.5" height={73 - y} rx="3.6" />
      <rect className="bm-leg-r" x="42.5" y={y} width="7.5" height={73 - y} rx="3.6" />
    </g>
  );
}

// --- Characters ----------------------------------------------------------------------------------

// Botty: a Base-blue robot with a screen face and a blinking antenna.
function Botty({ mood }: { mood: Mood }) {
  return (
    <>
      <Shadow />
      <g className="bm-figure">
        <Legs fill="#1e3a8a" y={62} />
        <g className="bm-paws" fill="#93c5fd" stroke={INK} strokeWidth="1.6">
          <rect x="17" y="47" width="6.5" height="9" rx="3.2" />
          <rect x="56.5" y="47" width="6.5" height="9" rx="3.2" />
        </g>
        {/* Body with a chest light */}
        <rect x="24" y="44" width="32" height="20" rx="6" fill="#2563eb" stroke={INK} strokeWidth="2.4" />
        <circle cx="40" cy="54" r="3.4" fill="#fde047" stroke={INK} strokeWidth="1.4" />
        {/* Head */}
        <rect x="18" y="18" width="44" height="30" rx="10" fill="#3b82f6" stroke={INK} strokeWidth="2.6" />
        <rect x="23" y="23" width="34" height="20" rx="6" fill={SCREEN} />
        <rect x="14.5" y="28" width="4" height="10" rx="2" fill="#1e40af" stroke={INK} strokeWidth="1.4" />
        <rect x="61.5" y="28" width="4" height="10" rx="2" fill="#1e40af" stroke={INK} strokeWidth="1.4" />
        <g className="bm-steam">
          <path d="M40 18 V9" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="40" cy="7" r="3.6" fill="#fde047" stroke={INK} strokeWidth="1.6" />
        </g>
        <Face mood={mood} face={{ leftX: 33, rightX: 47, eyeY: 31, mouthY: 37, blushY: 37, blushInset: 4.4, iris: '#38bdf8' }} />
      </g>
    </>
  );
}

// Bnkr: a gold coin with a little antenna.
function Bnkr({ mood }: { mood: Mood }) {
  return (
    <>
      <Shadow />
      <g className="bm-figure">
        <Legs fill="#92400e" y={60} />
        <g className="bm-paws" fill="#fcd34d" stroke={INK} strokeWidth="1.6">
          <ellipse cx="19.5" cy="46" rx="3.6" ry="3.2" />
          <ellipse cx="60.5" cy="46" rx="3.6" ry="3.2" />
        </g>
        <circle cx="40" cy="40" r="22" fill="#f59e0b" stroke={INK} strokeWidth="2.6" />
        <circle cx="40" cy="40" r="17" fill="#fbbf24" stroke="#b45309" strokeWidth="1.6" />
        <ellipse cx="32" cy="29" rx="5" ry="3" fill="#fde68a" opacity="0.7" transform="rotate(-30 32 29)" />
        <g className="bm-steam">
          <path d="M40 18 q1 -6 5 -9" fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="46" cy="8" r="3.2" fill="#60a5fa" stroke={INK} strokeWidth="1.5" />
        </g>
        <Face mood={mood} face={{ leftX: 33, rightX: 47, eyeY: 38, mouthY: 45, blushY: 44.5, blushInset: 4.6 }} />
      </g>
    </>
  );
}

// Vault: a tiny bank safe with a combination dial.
function Vault({ mood }: { mood: Mood }) {
  return (
    <>
      <Shadow />
      <g className="bm-figure">
        <Legs fill="#334155" y={63} />
        <rect x="19" y="20" width="42" height="44" rx="7" fill="#94a3b8" stroke={INK} strokeWidth="2.6" />
        <rect x="23.5" y="24.5" width="33" height="35" rx="4" fill="#cbd5e1" stroke="#475569" strokeWidth="1.4" />
        <rect x="16" y="28" width="4" height="7" rx="1.5" fill="#475569" stroke={INK} strokeWidth="1.2" />
        <rect x="16" y="48" width="4" height="7" rx="1.5" fill="#475569" stroke={INK} strokeWidth="1.2" />
        <g className="bm-steam">
          <circle cx="40" cy="51" r="5.2" fill="#e2e8f0" stroke={INK} strokeWidth="1.6" />
          <path d="M40 46.8 V49 M44.2 51 H42 M40 55.2 V53 M35.8 51 H38" stroke={INK} strokeWidth="1.2" strokeLinecap="round" />
        </g>
        <Face mood={mood} face={{ leftX: 33, rightX: 47, eyeY: 33, mouthY: 39, blushY: 39, blushInset: 4.6 }} />
        <g className="bm-paws" fill="#cbd5e1" stroke={INK} strokeWidth="1.6">
          <ellipse cx="62.5" cy="44" rx="3.4" ry="3" />
        </g>
      </g>
    </>
  );
}

// Agent-chan: a chibi trader with blue twin tails, a headset and a tiny coin.
function Agent({ mood }: { mood: Mood }) {
  const hair = '#1d4ed8';
  const skin = '#ffe6d5';
  return (
    <>
      <Shadow />
      <g className="bm-figure">
        <g className="bm-tail-l">
          <path d="M23 26 q-12 6 -9 22 q1.5 8 7 11 q-2 -10 3 -18 z" fill={hair} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
        </g>
        <g className="bm-tail-r">
          <path d="M57 26 q12 6 9 22 q-1.5 8 -7 11 q2 -10 -3 -18 z" fill={hair} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
        </g>
        <g className="bm-legs" fill="#1e293b">
          <rect className="bm-leg-l" x="33" y="64" width="6" height="9" rx="3" />
          <rect className="bm-leg-r" x="41" y="64" width="6" height="9" rx="3" />
        </g>
        {/* Hoodie */}
        <path d="M31 50 H49 L55 67 Q40 70 25 67 Z" fill="#0f172a" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
        <path d="M36 55 H44" stroke="#38bdf8" strokeWidth="1.8" strokeLinecap="round" />
        {/* Head */}
        <circle cx="40" cy="33" r="17.5" fill={skin} stroke={INK} strokeWidth="2.4" />
        <path d="M22.4 35 q-2.4 -19.5 17.6 -20.5 q20 1 17.6 20.5 q-3.6 -6.5 -8 -8 q-1.6 4.5 -6.2 4.5 q-0.6 -4.4 -3.4 -6 q-2.8 4.6 -7.4 4.6 q-0.6 -3.8 -2.6 -5 q-4.6 3 -7.6 9.9 z" fill={hair} stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
        {/* Headset */}
        <path d="M21 32 q1 -20 19 -20 q18 0 19 20" fill="none" stroke="#e2e8f0" strokeWidth="2.2" />
        <rect x="18.5" y="30" width="5" height="9" rx="2.4" fill="#e2e8f0" stroke={INK} strokeWidth="1.3" />
        <rect x="56.5" y="30" width="5" height="9" rx="2.4" fill="#e2e8f0" stroke={INK} strokeWidth="1.3" />
        <g className="bm-steam">
          <path d="M40 12 V6" stroke={INK} strokeWidth="2" strokeLinecap="round" />
          <circle cx="40" cy="4.5" r="2.6" fill="#38bdf8" stroke={INK} strokeWidth="1.3" />
        </g>
        <Face mood={mood} face={{ leftX: 33, rightX: 47, eyeY: 37.5, mouthY: 44, blushY: 42.5, blushInset: 4.6, iris: '#2563eb' }} />
        {/* Hands holding a tiny coin */}
        <g className="bm-paws">
          <circle cx="40" cy="61" r="3.6" fill="#fbbf24" stroke={INK} strokeWidth="1.3" />
          <ellipse cx="35" cy="61.5" rx="2.6" ry="2.3" fill={skin} stroke={INK} strokeWidth="1.3" />
          <ellipse cx="45" cy="61.5" rx="2.6" ry="2.3" fill={skin} stroke={INK} strokeWidth="1.3" />
        </g>
      </g>
    </>
  );
}

export const MASCOTS: { id: MascotId; name: string; render: (props: { mood: Mood }) => React.JSX.Element }[] = [
  { id: 'botty', name: 'Botty', render: Botty },
  { id: 'bnkr', name: 'Bnkr', render: Bnkr },
  { id: 'vault', name: 'Vault', render: Vault },
  { id: 'agent', name: 'Agent-chan', render: Agent },
];

// --- Settings ---------------------------------------------------------------------------------

export function readMascotSetting(): MascotSetting {
  try {
    const saved = window.localStorage.getItem(SETTING_KEY);
    if (saved === 'off') return 'off';
    return MASCOTS.some((mascot) => mascot.id === saved) ? saved as MascotId : 'botty';
  } catch {
    return 'botty';
  }
}

export function setMascotSetting(setting: MascotSetting): void {
  try {
    window.localStorage.setItem(SETTING_KEY, setting);
  } catch {
    // Storage unavailable: the choice applies to this page only.
  }
  window.dispatchEvent(new CustomEvent(SETTING_EVENT, { detail: setting }));
}

// Lets the rest of the app celebrate with the mascot (a confirmed swap, a whale buy…).
export function mascotCheer(): void {
  window.dispatchEvent(new Event(CHEER_EVENT));
}

function canShowMascot(): boolean {
  return window.matchMedia('(pointer: fine)').matches
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Static portrait for the Settings picker.
export function MascotPortrait({ id, size = 40 }: { id: MascotId; size?: number }) {
  const Character = MASCOTS.find((mascot) => mascot.id === id)?.render ?? Botty;
  return (
    <svg viewBox="0 0 80 80" width={size} height={size} aria-hidden="true" className="bm-portrait">
      <Character mood="idle" />
    </svg>
  );
}

// --- Follower ------------------------------------------------------------------------------------

export function BankrMascot() {
  const [character, setCharacter] = useState<MascotId | null>(null);
  const [mood, setMood] = useState<Mood>('idle');
  const [facingLeft, setFacingLeft] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const moodRef = useRef<Mood>('idle');

  useEffect(() => {
    const update = () => {
      const setting = readMascotSetting();
      setCharacter(setting !== 'off' && canShowMascot() ? setting : null);
    };
    update();
    window.addEventListener(SETTING_EVENT, update);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    motion.addEventListener('change', update);
    return () => {
      window.removeEventListener(SETTING_EVENT, update);
      motion.removeEventListener('change', update);
    };
  }, []);

  const enabled = character !== null;
  useEffect(() => {
    if (!enabled) return;
    const element = rootRef.current;
    if (!element) return;

    const position = { x: window.innerWidth - 90, y: window.innerHeight - 24 };
    const target = { ...position };
    let lastPointerMoveAt = Date.now();
    let moodUntil = 0;
    let facing = false;
    let frame = 0;

    const changeMood = (next: Mood, holdMs = 0) => {
      if (holdMs > 0) moodUntil = Date.now() + holdMs;
      if (moodRef.current === next) return;
      moodRef.current = next;
      setMood(next);
    };

    const place = () => {
      element.style.transform = `translate3d(${Math.round(position.x - SIZE / 2)}px, ${Math.round(position.y - SIZE)}px, 0)`;
    };

    const tick = () => {
      frame = window.requestAnimationFrame(tick);
      const now = Date.now();
      const dx = target.x - position.x;
      const dy = target.y - position.y;
      const distance = Math.hypot(dx, dy);
      const busy = now < moodUntil;

      if (distance > STOP_DISTANCE && !(busy && moodRef.current === 'surprised')) {
        // Faster when far away, gentle when close.
        const step = Math.min(distance - STOP_DISTANCE, Math.max(1.6, Math.min(9, distance * 0.07)));
        position.x += (dx / distance) * step;
        position.y += (dy / distance) * step;
        place();
        if (Math.abs(dx) > 3 && (dx < 0) !== facing) {
          facing = dx < 0;
          setFacingLeft(facing);
        }
        if (!busy) changeMood('run');
      } else if (!busy) {
        changeMood(now - lastPointerMoveAt > SLEEP_AFTER_MS ? 'sleep' : 'idle');
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      // Stand just below the cursor, slightly behind it.
      target.x = Math.min(window.innerWidth - SIZE / 2, Math.max(SIZE / 2, event.clientX));
      target.y = Math.min(window.innerHeight - 4, Math.max(SIZE, event.clientY + 52));
      lastPointerMoveAt = Date.now();
      if (moodRef.current === 'sleep') changeMood('surprised', SURPRISE_MS);
    };
    const handleCheer = () => changeMood('cheer', CHEER_MS);
    const handleResize = () => {
      position.x = Math.min(position.x, window.innerWidth - SIZE / 2);
      position.y = Math.min(position.y, window.innerHeight - 4);
      place();
    };

    place();
    frame = window.requestAnimationFrame(tick);
    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener(CHEER_EVENT, handleCheer);
    window.addEventListener('resize', handleResize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener(CHEER_EVENT, handleCheer);
      window.removeEventListener('resize', handleResize);
    };
  }, [enabled]);

  if (!character) return null;
  const Character = MASCOTS.find((mascot) => mascot.id === character)?.render ?? Botty;

  return (
    <div ref={rootRef} className={`bm-root bm-${mood} ${facingLeft ? 'bm-left' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 80 80" width={SIZE} height={SIZE} aria-hidden="true" className="bm-svg">
        <Character mood={mood} />
      </svg>
      {mood === 'sleep' && (
        <span className="bm-zzz"><i>z</i><i>z</i><i>Z</i></span>
      )}
      {mood === 'surprised' && <span className="bm-bang">!</span>}
      {mood === 'cheer' && (
        <span className="bm-hearts"><i>♥</i><i>✦</i><i>♥</i></span>
      )}
    </div>
  );
}
