import React, { useEffect, useState } from 'react';
import { Crown, Info, Medal, Trophy } from 'lucide-react';
import { fetchLeaderboard, timeAgo, type LeaderboardRow } from '../../services/social';
import { useOpenToken } from './ThesisCard';
import { FollowButton } from './FollowButton';
import { formatUsd, ProfileAvatar, TraderLabel } from './SocialBits';
import { useSocial } from '../../context/SocialContext';

const RANK_STYLE = ['from-yellow-300 to-amber-500 text-black', 'from-slate-200 to-slate-400 text-black', 'from-orange-300 to-orange-600 text-black'];

export const LeaderboardTable: React.FC<{ window: '24h' | '7d'; sort: 'pnl' | 'volume'; limit?: number; compact?: boolean }> = ({ window, sort, limit = 50, compact = false }) => {
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const openToken = useOpenToken();
  const { navigate } = useSocial();

  useEffect(() => {
    let active = true;
    setRows(null);
    fetchLeaderboard(window, sort)
      .then((result) => { if (active) setRows(result.rows.slice(0, limit)); })
      .catch((problem: unknown) => { if (active) { setRows([]); setError(problem instanceof Error ? problem.message : 'Could not load the leaderboard.'); } });
    return () => { active = false; };
  }, [limit, sort, window]);

  if (rows === null) return <div className="space-y-2">{Array.from({ length: compact ? 5 : 8 }, (_, index) => <div key={index} className="h-12 animate-pulse rounded-xl bg-panel" />)}</div>;
  if (rows.length === 0) return <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">{error ?? 'No trades indexed in this window yet.'}</p>;

  if (compact) {
    return (
      <ol className="space-y-1">
        {rows.map((row, index) => (
          <li key={row.wallet} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-xs hover:bg-raised/50">
            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.625rem] font-black ${index < 3 ? `bg-gradient-to-br ${RANK_STYLE[index]}` : 'bg-raised text-muted'}`}>{index + 1}</span>
            <TraderLabel wallet={row.wallet} card={row.profile} size={22} className="min-w-0 flex-1" />
            <span className={`font-mono font-bold ${sort === 'volume' ? 'text-fg' : row.pnlUsd >= 0 ? 'text-up' : 'text-down'}`}>{sort === 'volume' ? formatUsd(row.volumeUsd) : formatUsd(row.pnlUsd, true)}</span>
          </li>
        ))}
      </ol>
    );
  }

  const podium = rows.slice(0, 3);
  return (
    <div className="space-y-4">
      <div className="scrollbar-none -mx-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-3 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0">
        {podium.map((row, index) => (
          <button key={row.wallet} type="button" onClick={() => navigate({ name: 'profile', id: row.profile?.username ?? row.wallet })}
            className={`podium-card relative w-[78%] shrink-0 snap-center overflow-hidden rounded-2xl border border-line bg-panel p-4 text-left transition sm:w-auto hover:-translate-y-0.5 hover:border-fg/20 ${index === 0 ? 'sm:order-2 sm:-mt-2' : index === 1 ? 'sm:order-1 sm:mt-3' : 'sm:order-3 sm:mt-3'}`}>
            <span aria-hidden="true" className={`absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br opacity-20 blur-2xl ${RANK_STYLE[index]}`} />
            <div className="flex items-center gap-3">
              <div className="relative">
                <ProfileAvatar wallet={row.wallet} card={row.profile} size={48} />
                <span className={`absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br text-xs font-black ring-2 ring-panel ${RANK_STYLE[index]}`}>
                  {index === 0 ? <Crown className="h-3.5 w-3.5" /> : index + 1}
                </span>
              </div>
              <div className="min-w-0">
                <div className="truncate font-extrabold text-fg">{row.profile ? (row.profile.displayName || `@${row.profile.username}`) : `${row.wallet.slice(0, 6)}…${row.wallet.slice(-4)}`}</div>
                <div className="text-xs text-muted">{row.trades} trade{row.trades === 1 ? '' : 's'} · {row.tokens} token{row.tokens === 1 ? '' : 's'}</div>
              </div>
            </div>
            <div className="mt-3 flex items-end justify-between">
              <div>
                <div className="text-[0.625rem] font-bold uppercase tracking-wider text-subtle">{sort === 'volume' ? 'Volume' : 'Est. PnL'}</div>
                <div className={`font-mono text-xl font-black ${sort === 'volume' ? 'text-fg' : row.pnlUsd >= 0 ? 'text-up' : 'text-down'}`}>{sort === 'volume' ? formatUsd(row.volumeUsd) : formatUsd(row.pnlUsd, true)}</div>
              </div>
              {row.bestTokenSymbol && <span className="rounded-full bg-raised px-2 py-0.5 text-[0.6875rem] font-bold text-fg-soft">best ${row.bestTokenSymbol}</span>}
            </div>
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-panel">
        <table className="w-full text-left text-xs md:min-w-[46rem]">
          <thead className="border-b border-line text-[0.6875rem] uppercase tracking-wider text-subtle">
            <tr>
              <th className="px-3 py-3 sm:px-4">#</th>
              <th className="py-3">Trader</th>
              <th className="py-3 pl-3 text-right">Est. PnL</th>
              <th className="hidden py-3 text-right md:table-cell">Volume</th>
              <th className="py-3 pl-4 text-right">Trades</th>
              <th className="hidden py-3 text-right md:table-cell">Win rate</th>
              <th className="hidden py-3 text-right md:table-cell">Best token</th>
              <th className="hidden py-3 text-right md:table-cell">Last trade</th>
              <th className="px-4 py-3 text-right"><span className="sr-only">Follow</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {rows.map((row, index) => (
              <tr key={row.wallet} className="transition hover:bg-raised/40">
                <td className="px-3 py-2.5 sm:px-4">
                  {index < 3
                    ? <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br text-[0.6875rem] font-black ${RANK_STYLE[index]}`}>{index === 0 ? <Trophy className="h-3.5 w-3.5" /> : <Medal className="h-3.5 w-3.5" />}</span>
                    : <span className="pl-1.5 font-mono font-bold text-muted">{index + 1}</span>}
                </td>
                <td className="max-w-[16rem] py-2.5"><TraderLabel wallet={row.wallet} card={row.profile} size={28} /></td>
                <td className={`py-2.5 pl-3 text-right font-mono font-bold ${row.pnlUsd >= 0 ? 'text-up' : 'text-down'}`}>{formatUsd(row.pnlUsd, true)}</td>
                <td className="hidden py-2.5 text-right font-mono text-fg md:table-cell">{formatUsd(row.volumeUsd)}</td>
                <td className="whitespace-nowrap py-2.5 pl-4 text-right font-mono"><span className="text-up">{row.buys}</span><span className="text-subtle"> / </span><span className="text-down">{row.sells}</span></td>
                <td className="hidden py-2.5 text-right font-mono text-fg-soft md:table-cell">{row.tokens ? Math.round((row.wins / row.tokens) * 100) : 0}%</td>
                <td className="hidden py-2.5 text-right md:table-cell">
                  {row.bestToken ? <button type="button" onClick={() => openToken(row.bestToken!)} className="font-bold text-fg hover:text-accent">${row.bestTokenSymbol ?? row.bestToken.slice(0, 6)}</button> : '—'}
                </td>
                <td className="hidden py-2.5 text-right text-muted md:table-cell">{row.lastTradeAt ? timeAgo(row.lastTradeAt) : '—'}</td>
                <td className="px-3 py-2.5 text-right sm:px-4"><FollowButton wallet={row.wallet} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export const LeaderboardView: React.FC = () => {
  const [window, setWindow] = useState<'24h' | '7d'>('24h');
  const [sort, setSort] = useState<'pnl' | 'volume'>('pnl');
  const pill = (active: boolean) => `rounded-full px-3 py-1.5 text-xs font-extrabold transition ${active ? 'bg-fg text-surface' : 'text-muted hover:text-fg'}`;
  return (
    <div className="mx-auto max-w-6xl px-3 py-5 sm:px-4">
      <div className="page-hero mb-5 rounded-3xl border border-line p-5 sm:p-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-warn/40 bg-warn/10 px-2.5 py-1 text-[0.6875rem] font-extrabold uppercase tracking-wider text-warn"><Trophy className="h-3.5 w-3.5" /> Leaderboard</span>
            <h1 className="mt-2 text-2xl font-black tracking-tight text-fg sm:text-3xl">Top Bankr traders</h1>
            <p className="mt-1 max-w-xl text-sm text-muted">Ranked from every on-chain swap in Bankr pools on Base. Follow a trader to see their trades in your feed.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="flex rounded-full border border-line bg-panel p-1">
              {(['24h', '7d'] as const).map((option) => <button key={option} type="button" onClick={() => setWindow(option)} aria-pressed={window === option} className={pill(window === option)}>{option}</button>)}
            </div>
            <div className="flex rounded-full border border-line bg-panel p-1">
              {(['pnl', 'volume'] as const).map((option) => <button key={option} type="button" onClick={() => setSort(option)} aria-pressed={sort === option} className={pill(sort === option)}>{option === 'pnl' ? 'PnL' : 'Volume'}</button>)}
            </div>
          </div>
        </div>
      </div>
      <LeaderboardTable window={window} sort={sort} />
      <p className="mt-3 flex items-start gap-1.5 text-[0.6875rem] leading-relaxed text-subtle">
        <Info className="mt-0.5 h-3 w-3 shrink-0" />
        Est. PnL counts positions opened inside the window: sells of earlier buys are ignored and tokens still held are valued at the latest pool price. Bots and snipers are included; wallets with under $10 volume are left out.
      </p>
    </div>
  );
};
