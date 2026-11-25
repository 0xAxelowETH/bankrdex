import React from 'react';
import { useApp } from '../context/AppContext';
import { SwapHistoryList } from './SwapHistoryList';
import { OkxTokenLogo } from './OkxTokenLogo';
import { BrandLogo, getStablecoinLogoBrand } from './BrandLogo';
import { BASE_STABLECOINS, shortenAddress } from '../utils/web3';
import {
  ArrowDownRight,
  ArrowUpRight,
  X,
  PieChart,
  RefreshCw,
  Wallet,
  ExternalLink,
} from 'lucide-react';
import type { Token } from '../types';

export const PortfolioModal: React.FC<{ onOpenSwap: () => void }> = ({ onOpenSwap }) => {
  const {
    isPortfolioOpen,
    setIsPortfolioOpen,
    portfolio,
    totalPortfolioValueUsd,
    wallet,
    setActiveToken,
    setPendingSwapTokenToSell,
    tokens,
    networkStats,
    isPortfolioRefreshing,
    portfolioError,
    portfolioLastSyncedAt,
    refreshPortfolio,
    setIsWalletConnectModalOpen,
    t,
  } = useApp();

  const openTokenSale = (token: Token) => {
    setActiveToken(token);
    setPendingSwapTokenToSell(token);
    setIsPortfolioOpen(false);
    onOpenSwap();
  };

  const portfolioPerformance = portfolio.map((item) => {
    const tokenInfo = tokens.find((token) => token.id === item.tokenId);
    const currentPriceUsd = tokenInfo?.priceUsd || item.currentPriceUsd;
    const change24h = tokenInfo?.change24h;
    const currentValueUsd = item.balance * currentPriceUsd;
    const hasPerformanceData = currentPriceUsd > 0
      && typeof change24h === 'number'
      && Number.isFinite(change24h)
      && change24h > -100;
    const previousValueUsd = hasPerformanceData
      ? currentValueUsd / (1 + change24h / 100)
      : null;

    return {
      item,
      currentPriceUsd,
      currentValueUsd,
      change24h: hasPerformanceData ? change24h : null,
      pnl24hUsd: previousValueUsd === null ? null : currentValueUsd - previousValueUsd,
      previousValueUsd,
    };
  });
  const assetsWithPerformance = portfolioPerformance.filter((asset) => asset.pnl24hUsd !== null);
  const totalPnl24hUsd = assetsWithPerformance.reduce((sum, asset) => sum + (asset.pnl24hUsd ?? 0), 0);
  const totalPreviousValueUsd = assetsWithPerformance.reduce((sum, asset) => sum + (asset.previousValueUsd ?? 0), 0);
  const totalPnl24hPercentage = totalPreviousValueUsd > 0
    ? (totalPnl24hUsd / totalPreviousValueUsd) * 100
    : null;
  const formatPnlUsd = (value: number) =>
    `${value > 0 ? '+' : value < 0 ? '−' : ''}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (!isPortfolioOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm animate-in fade-in sm:p-6">
      <div className="relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-accent/30 bg-accent/10 text-accent">
              <PieChart className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-fg">{t.portfolio}</h3>
              <p className="truncate text-xs text-muted font-mono">
                {wallet.isConnected ? `${shortenAddress(wallet.address)} · Base` : t.walletNotConnected}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => void refreshPortfolio()}
              disabled={!wallet.isConnected || isPortfolioRefreshing}
              title={t.refreshWalletBalance}
              aria-label={t.refreshWalletBalance}
              className="rounded-md border border-line p-2 text-fg-soft transition-colors hover:border-accent/60 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RefreshCw className={`h-4 w-4 ${isPortfolioRefreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setIsPortfolioOpen(false)}
              aria-label={t.closePortfolio}
              className="rounded-md border border-line p-2 text-muted transition-colors hover:bg-raised hover:text-fg"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
            <div className="min-w-0 rounded-lg border border-line bg-sunken/60 p-3 sm:p-4">
              <span className="text-xs text-muted">{t.totalPortfolioValue}</span>
              <div className="mt-1 break-words font-mono text-base font-bold tabular-nums sm:text-xl text-fg">
                ${totalPortfolioValueUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <span className="text-[0.75rem] text-subtle">{t.assetsWithPricesAndEth}</span>
            </div>
            <div className="min-w-0 rounded-lg border border-line bg-sunken/60 p-3 sm:p-4">
              <span className="text-xs text-muted">{t.erc20TokensFound}</span>
              <div className="mt-1 break-words font-mono text-base font-bold tabular-nums sm:text-xl text-fg">{portfolio.length}</div>
              <span className="text-[0.75rem] text-subtle">{t.contractsInRegistry}: {tokens.length.toLocaleString('en-US')}</span>
            </div>
            <div className="min-w-0 rounded-lg border border-line bg-sunken/60 p-3 sm:p-4">
              <span className="text-xs text-muted">{t.nativeBalance}</span>
              <div className="mt-1 break-words font-mono text-base font-bold tabular-nums sm:text-xl text-accent">
                {wallet.ethBalance.toLocaleString('en-US', { maximumFractionDigits: 4 })} ETH
              </div>
              <span className="text-[0.75rem] text-subtle">
                {networkStats.ethPriceUsd > 0 ? `≈ $${(wallet.ethBalance * networkStats.ethPriceUsd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'ETH price unavailable'}
              </span>
            </div>
            <div className="min-w-0 rounded-lg border border-line bg-sunken/60 p-3 sm:p-4">
              <span className="text-xs text-muted">{t.tokenPnl24h}</span>
              <div className={`mt-1 flex items-center gap-1 font-mono text-xl font-bold tabular-nums ${
                totalPnl24hPercentage === null
                  ? 'text-subtle'
                  : totalPnl24hUsd < 0
                    ? 'text-red-400'
                    : 'text-green-400'
              }`}>
                {totalPnl24hPercentage === null ? '—' : (
                  <>
                    {totalPnl24hUsd < 0
                      ? <ArrowDownRight className="h-5 w-5 shrink-0" />
                      : <ArrowUpRight className="h-5 w-5 shrink-0" />}
                    {formatPnlUsd(totalPnl24hUsd)}
                  </>
                )}
              </div>
              <span className={`text-[0.75rem] ${
                totalPnl24hPercentage === null
                  ? 'text-subtle'
                  : totalPnl24hPercentage < 0
                    ? 'text-red-400'
                    : 'text-green-400'
              }`}>
                {totalPnl24hPercentage === null
                  ? t.changeDataUnavailable
                  : `${totalPnl24hPercentage > 0 ? '+' : ''}${totalPnl24hPercentage.toFixed(2)}%`}
                {totalPnl24hPercentage !== null && t.estimatedPriceChange}
              </span>
            </div>
          </div>

          {portfolioError && (
            <div role="alert" className="mt-4 flex items-center justify-between gap-3 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-200">
              <span>{portfolioError}</span>
              <button onClick={() => void refreshPortfolio()} className="shrink-0 font-semibold text-rose-100 underline underline-offset-2">
                {t.retry}
              </button>
            </div>
          )}

          <section className="mt-5 overflow-hidden rounded-lg border border-line bg-sunken/60">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-panel/70 px-4 py-3">
              <div>
                <h4 className="text-sm font-semibold text-fg">{t.assetsInWallet}</h4>
                <p className="mt-0.5 text-[0.75rem] text-subtle">
                  {portfolioLastSyncedAt
                    ? `${t.syncedAt} ${new Date(portfolioLastSyncedAt).toLocaleTimeString()}`
                    : t.waitingForSync}
                </p>
              </div>
              {isPortfolioRefreshing && <span className="text-[0.75rem] text-accent">{t.readingOnChain}</span>}
            </div>

              {wallet.isConnected && (
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-line/70 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(120px,0.7fr)_minmax(100px,0.6fr)]">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent/10">
                      <BrandLogo brand="eth" size={26} className="rounded-full" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-fg">ETH</div>
                      <div className="text-[0.75rem] text-muted">Native asset · Base</div>
                      <a
                        href={`https://basescan.org/address/${wallet.address}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-[0.75rem] font-semibold text-accent hover:text-accent"
                      >
                        BaseScan <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                  <div className="text-right sm:text-left">
                    <div className="font-mono text-sm tabular-nums text-fg">
                      {wallet.ethBalance.toLocaleString('en-US', { maximumFractionDigits: 8 })}
                    </div>
                    <div className="text-[0.75rem] text-subtle">ETH</div>
                  </div>
                  <div className="col-span-2 text-right sm:col-span-1">
                    <div className="font-mono text-sm font-semibold tabular-nums text-fg">
                      {networkStats.ethPriceUsd > 0
                        ? `$${(wallet.ethBalance * networkStats.ethPriceUsd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : '—'}
                    </div>
                    <div className="text-[0.75rem] text-subtle">
                      {networkStats.ethPriceUsd > 0 ? `$${networkStats.ethPriceUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })} / ETH` : t.priceUnavailable}
                    </div>
                  </div>
                </div>
              )}

              {wallet.isConnected && BASE_STABLECOINS.map((stablecoin) => {
                const balance = wallet.stablecoinBalances[stablecoin.address.toLowerCase()] ?? 0;
                if (balance <= 0) return null;
                return (
                  <div key={stablecoin.address} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-line/70 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(120px,0.7fr)_minmax(100px,0.6fr)]">
                    <div className="flex min-w-0 items-center gap-3">
                      <BrandLogo brand={getStablecoinLogoBrand(stablecoin.symbol)} size={40} className="shrink-0 rounded-full" />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-fg">{stablecoin.symbol}</div>
                        <div className="text-[0.75rem] text-muted">{stablecoin.name} · Stablecoin</div>
                      </div>
                    </div>
                    <div className="text-right sm:text-left">
                      <div className="font-mono text-sm tabular-nums text-fg">{balance.toLocaleString('en-US', { maximumFractionDigits: 2 })}</div>
                      <div className="text-[0.75rem] text-subtle">{stablecoin.symbol}</div>
                    </div>
                    <div className="col-span-2 text-right sm:col-span-1">
                      <div className="font-mono text-sm font-semibold tabular-nums text-fg">${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                      <div className="text-[0.75rem] text-subtle">≈ $1.00 / {stablecoin.symbol}</div>
                    </div>
                  </div>
                );
              })}

            {!wallet.isConnected ? (
              <div className="flex flex-col items-center px-5 py-10 text-center">
                <Wallet className="h-7 w-7 text-subtle" />
                <p className="mt-3 text-sm font-semibold text-fg">{t.connectToViewAssets}</p>
                <button
                  onClick={() => {
                    setIsPortfolioOpen(false);
                    setIsWalletConnectModalOpen(true);
                  }}
                  className="mt-4 rounded-md btn-gradient px-4 py-2 text-xs font-bold text-white"
                >
                  {t.connectWallet}
                </button>
              </div>
            ) : portfolio.length === 0 && isPortfolioRefreshing ? (
              <div className="px-4 py-10 text-center text-sm text-muted">{t.scanTokenBalances}</div>
            ) : portfolio.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="text-sm font-semibold text-fg">{t.noTokenBalances}</p>
                <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-subtle">
                  {t.registryScanDescription}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-line/70">
                {portfolioPerformance.map(({ item, currentPriceUsd, currentValueUsd, change24h, pnl24hUsd }) => {
                  const tokenInfo = tokens.find((token) => token.id === item.tokenId);
                  const pnlColor = pnl24hUsd === null
                    ? 'text-subtle'
                    : pnl24hUsd < 0
                      ? 'text-red-400'
                      : 'text-green-400';
                  return (
                    <div
                      key={item.tokenId}
                      role={tokenInfo ? 'button' : undefined}
                      tabIndex={tokenInfo ? 0 : undefined}
                      aria-label={tokenInfo ? `Sell ${item.symbol} in swap` : undefined}
                      onClick={() => {
                        if (tokenInfo) openTokenSale(tokenInfo);
                      }}
                      onKeyDown={(event) => {
                        if (tokenInfo && event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                          event.preventDefault();
                          openTokenSale(tokenInfo);
                        }
                      }}
                      className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition-colors hover:bg-panel sm:grid-cols-[minmax(0,1fr)_minmax(120px,0.7fr)_minmax(100px,0.6fr)] ${tokenInfo ? 'cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent' : ''}`}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <OkxTokenLogo logo={tokenInfo?.logo || item.logo} symbol={item.symbol} name={item.name} size="lg" />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-fg">{item.name}</div>
                          <div className="text-[0.75rem] font-mono text-muted">${item.symbol}</div>
                          {tokenInfo && (
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                openTokenSale(tokenInfo);
                              }}
                              className="mt-1 text-[0.75rem] font-semibold text-accent hover:text-accent"
                            >
                              {t.tradeToken} {item.symbol} ↗
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="text-right sm:text-left">
                        <div className="font-mono text-sm tabular-nums text-fg">
                          {item.balance.toLocaleString('en-US', { maximumFractionDigits: 6 })}
                        </div>
                        <div className="text-[0.75rem] text-subtle">{item.symbol}</div>
                      </div>
                      <div className="col-span-2 text-right sm:col-span-1">
                        <div className="font-mono text-sm font-semibold tabular-nums text-fg">
                          {currentValueUsd > 0 ? `$${currentValueUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                        </div>
                        <div className="text-[0.75rem] text-subtle">
                          {currentPriceUsd > 0 ? `$${currentPriceUsd.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${t.pricePerToken}` : t.priceUnavailable}
                        </div>
                        <div className={`mt-1 flex items-center justify-end gap-1 font-mono text-[0.75rem] font-semibold sm:justify-start ${pnlColor}`}>
                          {pnl24hUsd === null ? (
                            'PnL 24h: —'
                          ) : (
                            <>
                              {pnl24hUsd < 0
                                ? <ArrowDownRight className="h-3.5 w-3.5" />
                                : <ArrowUpRight className="h-3.5 w-3.5" />}
                              <span>{formatPnlUsd(pnl24hUsd)}</span>
                              <span>({change24h !== null && change24h > 0 ? '+' : ''}{change24h?.toFixed(2)}%)</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <SwapHistoryList />

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[0.75rem] text-subtle">
            <span>{t.tokenBalanceRefresh}</span>
            <button onClick={() => setIsPortfolioOpen(false)} className="rounded-md border border-line px-3 py-1.5 text-fg-soft transition-colors hover:bg-raised hover:text-fg">
              {t.close}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
