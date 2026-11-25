import React, { useCallback, useState } from 'react';
import { Activity, Flame, Lightbulb, PenLine, Users } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useSocial } from '../../context/SocialContext';
import type { Thesis } from '../../services/social';
import { TradingActivity } from '../TradingActivity';
import { ThesisList } from './ThesisList';

type Tab = 'trades' | 'thesis';

// Bottom section of the token terminal: live trades and the community's theses on this token.
export const TerminalSocial: React.FC = () => {
  const { activeToken } = useApp();
  const { openComposer } = useSocial();
  const [tab, setTab] = useState<Tab>(() => (typeof window !== 'undefined' && window.location.hash.startsWith('#thesis-') ? 'thesis' : 'trades'));
  const [sort, setSort] = useState<'new' | 'top'>('new');
  const [sentiment, setSentiment] = useState<{ bullish: number; bearish: number; total: number } | null>(null);
  const token = activeToken.address.toLowerCase();

  const onLoaded = useCallback((theses: Thesis[]) => {
    const bullish = theses.filter((thesis) => thesis.stance === 'bullish').length;
    setSentiment({ bullish, bearish: theses.length - bullish, total: theses.length });
  }, []);

  const bullishShare = sentiment && sentiment.total > 0 ? Math.round((sentiment.bullish / sentiment.total) * 100) : null;
  const tabClass = (active: boolean) => `relative inline-flex items-center gap-2 px-1 pb-3 pt-1 text-sm font-extrabold transition ${active ? 'text-fg' : 'text-muted hover:text-fg'}`;

  return (
    <section aria-label="Trades and theses" className="min-w-0">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3 border-b border-line">
        <div className="flex items-center gap-5" role="tablist">
          <button role="tab" aria-selected={tab === 'trades'} onClick={() => setTab('trades')} className={tabClass(tab === 'trades')}>
            <Activity className="h-4 w-4" /> Trades
            {tab === 'trades' && <span className="tab-underline" />}
          </button>
          <button role="tab" aria-selected={tab === 'thesis'} onClick={() => setTab('thesis')} className={tabClass(tab === 'thesis')}>
            <Lightbulb className="h-4 w-4" /> Thesis
            {sentiment && sentiment.total > 0 && <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[0.6875rem] text-accent">{sentiment.total}</span>}
            {tab === 'thesis' && <span className="tab-underline" />}
          </button>
        </div>
        {tab === 'thesis' && (
          <div className="mb-2 flex items-center gap-2">
            <div className="flex rounded-full border border-line p-0.5 text-xs font-bold">
              {(['new', 'top'] as const).map((option) => (
                <button key={option} type="button" onClick={() => setSort(option)} aria-pressed={sort === option} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${sort === option ? 'bg-raised text-fg' : 'text-muted hover:text-fg'}`}>
                  {option === 'top' && <Flame className="h-3 w-3" />}{option === 'new' ? 'Latest' : 'Top'}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => openComposer()} className="btn-gradient inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-extrabold text-white">
              <PenLine className="h-3.5 w-3.5" /> New thesis
            </button>
          </div>
        )}
      </div>

      {tab === 'trades' ? <TradingActivity /> : (
        <div className="space-y-3">
          {bullishShare !== null && (
            <div className="rounded-2xl border border-line bg-panel p-3">
              <div className="mb-1.5 flex items-center justify-between text-xs font-bold">
                <span className="text-up">Bullish {bullishShare}%</span>
                <span className="flex items-center gap-1 text-muted"><Users className="h-3.5 w-3.5" /> Community sentiment on ${activeToken.symbol}</span>
                <span className="text-down">{100 - bullishShare}% Bearish</span>
              </div>
              <div className="flex h-2 overflow-hidden rounded-full bg-down/70">
                <div className="bg-up transition-all" style={{ width: `${bullishShare}%` }} />
              </div>
            </div>
          )}
          <ThesisList
            query={{ token, sort }}
            onLoaded={onLoaded}
            onCompose={() => openComposer()}
            emptyTitle={`No theses on $${activeToken.symbol} yet`}
            emptyHint="Share your entry, target and stop. Your call is tracked against the on-chain price from the moment you post."
          />
        </div>
      )}
    </section>
  );
};
