import type { ChainKey } from '../../config/chains';
import type { Token } from '../../types';

const DAY_MS = 86_400_000;
const finite = (value: number) => (Number.isFinite(value) ? value : 0);

export const launchedAtOf = (token: Token) => token.launchedAt || Date.parse(token.createdAt) || 0;

export interface ChainShare {
  chain: ChainKey;
  count: number;
  volume: number;
}

// Market-wide figures for the header strip and the dashboard, from the catalog snapshot.
export interface MarketTotals {
  count: number;
  volume: number;
  txns: number;
  buys: number;
  sells: number;
  fresh: number;
  gainers: number;
  losers: number;
  chains: ChainShare[];
  trending: Token[];
  topGainers: Token[];
  newest: Token[];
  movers: Token[];
}

const SPOTLIGHT_SIZE = 5;

export function marketTotals(tokens: Token[], now = Date.now()): MarketTotals {
  const live = tokens.filter((token) => !token.externalSource);
  let volume = 0;
  let txns = 0;
  let buys = 0;
  let sells = 0;
  let fresh = 0;
  let gainers = 0;
  let losers = 0;
  const chains = new Map<ChainKey, ChainShare>();
  for (const token of live) {
    const tokenVolume = finite(token.volume24hUsd);
    volume += tokenVolume;
    txns += finite(token.totalTx24h);
    buys += finite(token.totalBuys24h);
    sells += finite(token.totalSells24h);
    if (now - launchedAtOf(token) < DAY_MS) fresh += 1;
    if (tokenVolume > 0 && token.change24h > 0) gainers += 1;
    if (tokenVolume > 0 && token.change24h < 0) losers += 1;
    const chain = token.chain ?? 'base';
    const share = chains.get(chain) ?? { chain, count: 0, volume: 0 };
    share.count += 1;
    share.volume += tokenVolume;
    chains.set(chain, share);
  }
  const traded = live.filter((token) => finite(token.volume24hUsd) > 0);
  return {
    count: live.length,
    volume,
    txns,
    buys,
    sells,
    fresh,
    gainers,
    losers,
    chains: [...chains.values()].sort((left, right) => right.volume - left.volume),
    trending: [...traded].sort((left, right) => finite(right.totalTx24h) - finite(left.totalTx24h)).slice(0, SPOTLIGHT_SIZE),
    topGainers: traded
      .filter((token) => token.volume24hUsd > 1_000 && token.change24h > 0)
      .sort((left, right) => right.change24h - left.change24h)
      .slice(0, SPOTLIGHT_SIZE),
    newest: [...live].sort((left, right) => launchedAtOf(right) - launchedAtOf(left)).slice(0, SPOTLIGHT_SIZE),
    movers: traded
      .filter((token) => token.volume24hUsd > 2_000 && Number.isFinite(token.change24h) && token.change24h !== 0)
      .sort((left, right) => Math.abs(right.change24h) - Math.abs(left.change24h))
      .slice(0, 14),
  };
}

export const compactNumber = (value: number) =>
  value.toLocaleString('en-US', { notation: value >= 100_000 ? 'compact' : 'standard', maximumFractionDigits: value >= 100_000 ? 1 : 0 });
