import React, { useMemo } from 'react';
import { Activity, Fuel, Layers, Rocket, TrendingUp } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { BrandLogo } from './BrandLogo';
import { compactUsd } from './MarketTableParts';
import { compactNumber, marketTotals } from './market/marketStats';
import { formatLag, useIndexFreshness } from './useIndexFreshness';

const Divider = () => <span className="h-3 w-px shrink-0 bg-line" aria-hidden="true" />;

// Thin data strip above the header: chain status, ETH, gas and live market totals.
export const MarketStrip: React.FC = () => {
  const { tokens, networkStats } = useApp();
  const totals = useMemo(() => marketTotals(tokens), [tokens]);
  const index = useIndexFreshness();
  const buyShare = totals.buys + totals.sells > 0 ? Math.round((totals.buys / (totals.buys + totals.sells)) * 100) : null;
  const breadth = totals.gainers + totals.losers > 0 ? (totals.gainers / (totals.gainers + totals.losers)) * 100 : 50;

  return (
    <div className="site-topbar hidden md:block">
      <div className="scrollbar-none mx-auto flex h-7 max-w-[100rem] items-center gap-3 overflow-x-auto px-3 font-mono text-[0.6875rem] text-muted sm:px-4 xl:px-5">
        <span className={`flex shrink-0 items-center gap-1.5 ${networkStats.isOnline ? 'text-up' : 'text-warn'}`} title="Base RPC status and latency">
          <span className={`h-1.5 w-1.5 rounded-full ${networkStats.isOnline ? 'live-dot bg-up' : 'bg-warn'}`} />
          <span className="chain-base chain-text font-semibold">Base</span> {networkStats.isOnline ? `${networkStats.rpcLatencyMs}ms` : 'offline'}
        </span>
        {index.state !== 'unknown' && (
          <span
            className={`flex shrink-0 items-center gap-1 ${index.state === 'live' ? 'text-muted' : index.state === 'delayed' ? 'text-warn' : 'text-down'}`}
            title="On-chain index behind charts, trades and 24h stats (Base)"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${index.state === 'live' ? 'bg-up' : index.state === 'delayed' ? 'bg-warn' : 'bg-down'}`} />
            {index.state === 'live' ? 'Index live' : `Index ${formatLag(index.lagSeconds)} behind`}
          </span>
        )}
        <Divider />
        <span className="flex shrink-0 items-center gap-1.5" title="ETH price">
          <BrandLogo brand="eth" size={12} />
          <span className="text-fg-soft">{networkStats.ethPriceUsd > 0 ? `$${networkStats.ethPriceUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—'}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1" title="Base gas price">
          <Fuel className="h-3 w-3" />
          <span className="text-fg-soft">{networkStats.gasPriceGwei > 0 ? `${networkStats.gasPriceGwei} gwei` : '—'}</span>
        </span>
        {networkStats.blockNumber > 0 && <span className="hidden shrink-0 lg:inline" title="Latest Base block">#{networkStats.blockNumber.toLocaleString('en-US')}</span>}
        <Divider />
        <span className="flex shrink-0 items-center gap-1" title="Verified Bankr tokens listed">
          <Layers className="h-3 w-3" /> Tokens <span className="text-fg-soft">{totals.count.toLocaleString('en-US')}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1" title="Combined 24h volume of listed tokens">
          <TrendingUp className="h-3 w-3" /> 24h vol <span className="text-fg-soft">{compactUsd(totals.volume)}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1" title={buyShare === null ? 'Transactions in 24h' : `${buyShare}% of 24h transactions were buys`}>
          <Activity className="h-3 w-3" /> 24h txns <span className="text-fg-soft">{compactNumber(totals.txns)}</span>
          {buyShare !== null && <span className={buyShare >= 50 ? 'text-up' : 'text-down'}>({buyShare}% buys)</span>}
        </span>
        <span className="flex shrink-0 items-center gap-1" title="Launched in the last 24 hours">
          <Rocket className="h-3 w-3" /> New 24h <span className="text-accent">{totals.fresh.toLocaleString('en-US')}</span>
        </span>
        <span className="ml-auto hidden shrink-0 items-center gap-2 xl:flex" title="Tokens up vs down over 24h (traded tokens only)">
          <span className="text-up">▲ {totals.gainers}</span>
          <span className="ratio-bar w-20"><span style={{ width: `${breadth}%` }} /></span>
          <span className="text-down">▼ {totals.losers}</span>
        </span>
      </div>
    </div>
  );
};
