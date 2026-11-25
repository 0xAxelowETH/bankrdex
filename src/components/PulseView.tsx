import { useEffect, useMemo, useState } from 'react';
import { Flame, Rocket, Sparkles } from 'lucide-react';
import type { Token } from '../types';
import { OkxTokenLogo } from './OkxTokenLogo';
import { ChainEmblem } from './ChainEmblem';
import { TokenAge } from './MarketTableParts';
import { QuickBuyButton } from './QuickBuy';

// Pulse: three live columns side by side, like the discovery boards of GMGN / Axiom.
//   New        launched in the last hour, newest first
//   Heating up younger than a day, most trades in the last 15 minutes
//   Trending   most trades in the last hour, any age
// Trade counts come from the on-chain index (/api/market/pulse); refreshed every 5 seconds.
interface PulseRow {
  token_address: string;
  trades: number;
  buys: number;
  volume_usd: number;
}

const REFRESH_MS = 5_000;
const COLUMN_SIZE = 25;
const DAY = 86_400_000;

const usd = (value: number) => value >= 1e6 ? `$${(value / 1e6).toFixed(2)}M` : value >= 1e3 ? `$${(value / 1e3).toFixed(1)}K` : `$${value.toFixed(0)}`;

function usePulse(minutes: number) {
  const [rows, setRows] = useState<PulseRow[]>([]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const response = await fetch(`/api/market/pulse?minutes=${minutes}&limit=150`, { cache: 'no-store' });
        if (!response.ok) return;
        const payload = await response.json() as { tokens?: PulseRow[] };
        if (active) setRows(payload.tokens ?? []);
      } catch {
        // keep the previous rows
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => { active = false; window.clearInterval(timer); };
  }, [minutes]);
  return rows;
}

function PulseCard({ token, launchedAt, stat, onSelect }: { token: Token; launchedAt: number; stat?: PulseRow; onSelect: (token: Token) => void }) {
  const buyShare = stat && stat.trades > 0 ? Math.round((stat.buys / stat.trades) * 100) : null;
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelect(token)}
        onKeyDown={(event) => { if (event.key === 'Enter') onSelect(token); }}
        className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-transparent px-2 py-2 hover:border-line hover:bg-raised"
      >
        <span className="relative shrink-0">
          <OkxTokenLogo logo={token.logo} symbol={token.symbol} name={token.name} size="md" />
          <ChainEmblem chain={token.chain ?? 'base'} className="absolute -bottom-1 -left-1 h-3.5 w-3.5 border border-surface" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm font-bold text-fg">${token.symbol}</span>
            <span className="shrink-0 font-mono text-[0.75rem] text-muted"><TokenAge at={launchedAt} /></span>
          </div>
          <div className="truncate text-[0.6875rem] leading-4 text-muted">{token.name || '—'}</div>
          <div className="mt-0.5 flex items-center gap-2 font-mono text-[0.6875rem] text-muted">
            <span>MC {token.marketCapUsd > 0 ? usd(token.marketCapUsd) : '—'}</span>
            {stat ? <span>{stat.trades} tx · {usd(stat.volume_usd)}</span> : <span>Vol {token.volume24hUsd > 0 ? usd(token.volume24hUsd) : '—'}</span>}
            {buyShare !== null && <span className={buyShare >= 50 ? 'text-up' : 'text-down'}>{buyShare}% buys</span>}
          </div>
        </div>
        <QuickBuyButton token={token} compact />
      </div>
    </li>
  );
}

export function PulseView({ tokens, onSelect, launchedAtOf }: { tokens: Token[]; onSelect: (token: Token) => void; launchedAtOf: (token: Token) => number }) {
  const heating = usePulse(15);
  const trending = usePulse(60);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);
  const byAddress = useMemo(() => new Map(tokens.filter((token) => (token.chain ?? 'base') === 'base').map((token) => [token.address.toLowerCase(), token])), [tokens]);

  const fresh = useMemo(() => tokens
    .map((token) => ({ token, at: launchedAtOf(token) }))
    .filter(({ at }) => at > 0 && now - at < 3_600_000)
    .sort((left, right) => right.at - left.at)
    .slice(0, COLUMN_SIZE), [launchedAtOf, now, tokens]);
  const pick = (rows: PulseRow[], filter: (token: Token) => boolean) => rows
    .flatMap((row) => {
      const token = byAddress.get(row.token_address);
      return token && filter(token) ? [{ token, stat: row, at: launchedAtOf(token) }] : [];
    })
    .slice(0, COLUMN_SIZE);
  const heatingCards = pick(heating, (token) => { const at = launchedAtOf(token); return at > 0 && now - at < DAY; });
  const trendingCards = pick(trending, () => true);

  const columns = [
    { title: 'New', hint: 'Launched in the last hour', icon: <Sparkles className="h-4 w-4 text-accent" />, cards: fresh.map(({ token, at }) => ({ token, at, stat: undefined as PulseRow | undefined })) },
    { title: 'Heating up', hint: 'Under a day old, most trades in the last 15 minutes', icon: <Rocket className="h-4 w-4 text-up" />, cards: heatingCards },
    { title: 'Trending', hint: 'Most trades in the last hour', icon: <Flame className="h-4 w-4 text-orange-400" />, cards: trendingCards },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-3">
      {columns.map((column) => (
        <section key={column.title} aria-label={column.title} className="flex min-h-[20rem] flex-col rounded-xl border border-line bg-panel">
          <header className="flex items-center gap-2 border-b border-line px-3 py-2.5" title={column.hint}>
            {column.icon}
            <h3 className="text-sm font-bold text-fg">{column.title}</h3>
            <span className="ml-auto text-[0.6875rem] text-subtle">{column.hint}</span>
          </header>
          {column.cards.length === 0
            ? <p className="p-4 text-xs text-subtle">Nothing here right now.</p>
            : (
              <ul className="max-h-[70vh] space-y-0.5 overflow-y-auto p-1.5">
                {column.cards.map(({ token, at, stat }) => <PulseCard key={`${token.chain ?? 'base'}:${token.address}`} token={token} launchedAt={at} stat={stat} onSelect={onSelect} />)}
              </ul>
            )}
        </section>
      ))}
    </div>
  );
}
