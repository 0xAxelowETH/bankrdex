import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, ShieldCheck, ShieldQuestion, XCircle } from 'lucide-react';
import { parseUnits } from 'viem';
import { useApp } from '../context/AppContext';
import { fetchDirectPool, quoteDirect } from '../services/directSwap';

// Pre-trade safety signals for a Bankr token on Base, from the on-chain index and the chain:
// snipers and bundled buys at launch, dev / sniper / burn holdings, a sell simulation against
// the pool (honeypot check), and how many tokens the creator has launched.
interface Risk {
  firstTradeBlock: number | null;
  snipers: number;
  sniperHoldingPct: number | null;
  bundledBuys: number;
  buyers: number;
  sellers: number;
  devHoldingPct: number | null;
  burnedPct: number | null;
  partialHistory: boolean;
}

type Level = 'ok' | 'warn' | 'bad' | 'unknown';

const levelStyle: Record<Level, string> = {
  ok: 'text-up',
  warn: 'text-warn',
  bad: 'text-down',
  unknown: 'text-fg-soft',
};
const levelBar: Record<Level, string> = {
  ok: 'bg-up',
  warn: 'bg-warn',
  bad: 'bg-down',
  unknown: 'bg-raised',
};
const LevelIcon = ({ level }: { level: Level }) => {
  if (level === 'ok') return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-up" aria-label="OK" />;
  if (level === 'warn') return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warn" aria-label="Caution" />;
  if (level === 'bad') return <XCircle className="h-3.5 w-3.5 shrink-0 text-down" aria-label="Red flag" />;
  return <CircleDashed className="h-3.5 w-3.5 shrink-0 text-subtle" aria-label="Info" />;
};

function Row({ label, value, level, hint }: { label: string; value: React.ReactNode; level: Level; hint?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-raised/50" title={hint}>
      <LevelIcon level={level} />
      <dt className="min-w-0 flex-1 truncate text-muted">{label}</dt>
      <dd className={`text-right font-mono font-semibold ${levelStyle[level]}`}>{value}</dd>
    </div>
  );
}

const pct = (value: number | null | undefined) => value === null || value === undefined ? '—' : `${value < 0.01 && value > 0 ? '<0.01' : value.toFixed(2)}%`;

export const TokenRiskCard: React.FC = () => {
  const { activeToken: token } = useApp();
  const address = token.address.toLowerCase();
  const isBaseBankr = (token.chain ?? 'base') === 'base' && token.externalSource !== 'market';
  const [risk, setRisk] = useState<Risk | null>(null);
  const [sellable, setSellable] = useState<boolean | null>(null);
  const [creatorLaunches, setCreatorLaunches] = useState<number | null>(null);
  const [holders, setHolders] = useState<{ count: number | null; top10: number | null } | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (!isBaseBankr) return;
    let active = true;
    setState('loading');
    setRisk(null);
    setSellable(null);
    setCreatorLaunches(null);
    setHolders(null);
    fetch(`/api/market/risk?token=${address}`)
      .then((response) => response.ok ? response.json() as Promise<{ risk: Risk }> : Promise.reject(new Error(String(response.status))))
      .then((payload) => { if (active) { setRisk(payload.risk); setState('ready'); } })
      .catch(() => { if (active) setState('error'); });
    fetch(`/api/token-stats/${address}?chain=base`)
      .then((response) => response.ok ? response.json() as Promise<{ holderCount: number | null; top10Share: number | null }> : null)
      .then((payload) => { if (active && payload) setHolders({ count: payload.holderCount, top10: payload.top10Share }); })
      .catch(() => undefined);
    // Honeypot check: can a small amount actually be sold back into the pool?
    fetchDirectPool(address)
      .then((pool) => pool ? quoteDirect(pool, address, parseUnits('1000', 18)).then((out) => out > 0n) : null)
      .then((value) => { if (active) setSellable(value); })
      .catch(() => { if (active) setSellable(false); });
    if (token.creator) {
      fetch(`/api/bankr-proxy/public/doppler/creator-fees/${token.creator.toLowerCase()}?days=1`)
        .then((response) => response.ok ? response.json() as Promise<{ tokens?: unknown[] }> : null)
        .then((payload) => { if (active && payload) setCreatorLaunches(payload.tokens?.length ?? 0); })
        .catch(() => undefined);
    }
    return () => { active = false; };
  }, [address, isBaseBankr, token.creator]);

  if (!isBaseBankr) return null;

  const devLevel: Level = risk?.devHoldingPct === null || risk?.devHoldingPct === undefined ? 'unknown' : risk.devHoldingPct > 10 ? 'bad' : risk.devHoldingPct > 5 ? 'warn' : 'ok';
  const sniperLevel: Level = !risk || risk.partialHistory || risk.sniperHoldingPct === null ? 'unknown' : risk.sniperHoldingPct > 20 ? 'bad' : risk.sniperHoldingPct > 5 ? 'warn' : 'ok';
  const creatorLevel: Level = creatorLaunches === null ? 'unknown' : creatorLaunches >= 20 ? 'bad' : creatorLaunches >= 5 ? 'warn' : 'ok';
  const sellLevel: Level = sellable === null ? 'unknown' : sellable ? 'ok' : 'bad';
  const bundleLevel: Level = !risk || risk.partialHistory ? 'unknown' : risk.bundledBuys > 3 ? 'warn' : 'ok';
  const top10Level: Level = holders?.top10 == null ? 'unknown' : holders.top10 > 70 ? 'warn' : 'ok';
  const checks: Level[] = [sellLevel, devLevel, sniperLevel, bundleLevel, top10Level, creatorLevel];
  const flags = checks.filter((level) => level === 'bad').length;
  const cautions = checks.filter((level) => level === 'warn').length;
  const passed = checks.filter((level) => level === 'ok').length;
  const verdict = state === 'loading'
    ? { text: 'Checking…', className: 'border-line text-muted' }
    : flags > 0
      ? { text: `${flags} red flag${flags > 1 ? 's' : ''}`, className: 'border-down/40 bg-down/10 text-down' }
      : cautions > 0
        ? { text: `${cautions} caution${cautions > 1 ? 's' : ''}`, className: 'border-warn/40 bg-warn/10 text-warn' }
        : state === 'error'
          ? { text: 'Partial data', className: 'border-line text-muted' }
          : { text: 'No red flags', className: 'border-up/40 bg-up/10 text-up' };

  return (
    <section aria-label={`${token.symbol} safety`} className="bd-card p-4 text-xs">
      <div className="mb-3 flex items-center gap-2">
        {state === 'loading'
          ? <Loader2 className="h-4 w-4 animate-spin text-muted" />
          : flags > 0 ? <AlertTriangle className="h-4 w-4 text-down" /> : state === 'error' ? <ShieldQuestion className="h-4 w-4 text-subtle" /> : <ShieldCheck className="h-4 w-4 text-up" />}
        <h3 className="text-sm font-bold text-fg">Safety checks</h3>
        <span className={`ml-auto rounded-full border px-2 py-0.5 text-[0.6875rem] font-extrabold ${verdict.className}`}>{verdict.text}</span>
      </div>
      <div className="mb-3">
        <div className="flex gap-1" aria-hidden="true">
          {checks.map((level, index) => <span key={index} className={`h-1.5 flex-1 rounded-full ${levelBar[level]}`} />)}
        </div>
        <p className="mt-1.5 text-[0.6875rem] text-subtle">{passed} of {checks.length} checks passed{state === 'loading' ? ' so far' : ''}</p>
      </div>
      <dl className="space-y-0.5">
        <Row
          label="Sellable (pool simulation)"
          value={sellable === null ? '…' : sellable ? 'Yes' : 'No / unknown'}
          level={sellLevel}
          hint="Asks Uniswap's V4 quoter to sell 1,000 tokens into the pool. A failure can mean the pool blocks sells."
        />
        <Row label="Dev holds" value={pct(risk?.devHoldingPct)} level={devLevel} hint="Share of supply in the launcher's wallet (excluding the 1-year creator vesting contract)." />
        <Row
          label="Snipers (first 2 blocks)"
          value={!risk ? '—' : risk.partialHistory ? 'Before index' : `${risk.snipers} · hold ${pct(risk.sniperHoldingPct)}`}
          level={sniperLevel}
          hint={risk?.partialHistory ? 'This token launched before the on-chain index started, so its first trades are not covered.' : 'Wallets that bought in the first two blocks of trading, and how much of the supply they still hold.'}
        />
        <Row label="Bundled buys" value={risk ? (risk.partialHistory ? '—' : String(risk.bundledBuys)) : '—'} level={bundleLevel} hint="Transactions that bought this token more than once (bot-bundled buys)." />
        <Row label="Top 10 holders" value={pct(holders?.top10)} level={top10Level} hint="Includes the pool and the creator vesting contract, so it is higher than real wallet concentration." />
        <Row
          label="Creator's recent launches"
          value={creatorLaunches === null ? (token.creator ? '…' : 'Unknown creator') : creatorLaunches >= 50 ? '50+' : String(creatorLaunches)}
          level={creatorLevel}
          hint="Bankr launches by the same creator (up to the 50 most recent). Serial launchers are a common rug pattern."
        />
        <Row label="Buyers / sellers (indexed)" value={risk ? `${risk.buyers} / ${risk.sellers}` : '—'} level="unknown" />
        <Row label="Holders" value={holders?.count != null ? holders.count.toLocaleString('en-US') : '—'} level="unknown" />
        <Row label="Burned" value={pct(risk?.burnedPct)} level="unknown" />
      </dl>
      <p className="mt-3 text-[0.6875rem] leading-relaxed text-subtle">
        Signals, not verdicts: each can have an innocent explanation. Always check the contract and liquidity yourself.
      </p>
    </section>
  );
};
