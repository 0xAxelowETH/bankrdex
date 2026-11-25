import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Route, ShieldCheck } from 'lucide-react';
import { formatUnits } from 'viem';
import { useApp } from '../../context/AppContext';
import { CHAINS, explorerTx, type ChainKey } from '../../config/chains';
import { PLATFORM_FEE_BPS } from '../../config/platformFee';
import {
  fetchBinanceAggregatorQuote,
  fetchBinanceSwapTransactions,
  fetchOkxAggregatorQuote,
  fetchOkxSwapTransactions,
  fetchRouterStatus,
  rankAggregatorQuotes,
  type AggregatorQuote,
  type RouterStatus,
} from '../../services/tradingApis';
import { executeFeeProtectedAggregatorSwap, fetchChainBalanceRaw, fetchChainTokenDecimals, type Eip1193Provider } from '../../utils/web3';
import { recordSwap } from '../../utils/swapHistory';
import { sound } from '../../utils/sound';
import { ChainEmblem } from '../ChainEmblem';
import { BrandLogo } from '../BrandLogo';
import { AmountField, type SwapIntent, DetailRows, FlipDivider, formatTokenAmount, PresetRow, SideTabs, SlippagePicker, StatusLine, SwapButton, type Side } from './SwapUi';
import { payAssetUsd, type PayAsset } from './payAssets';
import { PayAssetPicker, TokenPicker } from './Pickers';

// Swaps any token on any chain BankrDex lists through the OKX DEX and Binance Web3 aggregators.
// Route 'best' asks both and uses the better quote; 'okx' / 'binance' use only that aggregator.
// The other side of the trade can be any pay asset (ETH, the pool's pair token, stablecoins, main
// tokens). The 0.1% BankrDex fee is part of every route; the wallet is switched to the chain first.
export type Provider = AggregatorQuote['provider'];
export type RouterMode = 'best' | Provider;
const PROVIDERS: Provider[] = ['okx', 'binance'];
const PROVIDER_NAME: Record<Provider, string> = { okx: 'OKX DEX', binance: 'Binance Web3' };
const SLIPPAGES = [0.5, 1, 3, 5, 10];
const SLIPPAGE_KEY = 'bankrdex-router-slippage';
const QUOTE_REFRESH_MS = 20_000;
const HIGH_IMPACT = 5;
const SEVERE_IMPACT = 15;

function readSlippage(): number {
  try {
    const value = Number(window.localStorage.getItem(SLIPPAGE_KEY));
    return SLIPPAGES.includes(value) ? value : 3;
  } catch {
    return 3;
  }
}

type QuoteResult = { quote: AggregatorQuote } | { error: string };

export function useRouterStatus() {
  const [status, setStatus] = useState<{ okx: RouterStatus; binance: RouterStatus } | null>(null);
  useEffect(() => {
    let active = true;
    fetchRouterStatus().then((value) => { if (active) setStatus(value); }).catch(() => { if (active) setStatus(null); });
    return () => { active = false; };
  }, []);
  return status;
}

export function routersFor(status: ReturnType<typeof useRouterStatus>, chain: ChainKey): Provider[] {
  if (!status) return [];
  return PROVIDERS.filter((provider) => status[provider].configured && status[provider].chains.includes(chain));
}

const ETH_PRESETS = ['0.001', '0.005', '0.01', '0.05'];
const STABLE_PRESETS = ['5', '25', '100', '500'];
const USD_PRESETS = [5, 25, 100, 500];

export const RouterSwapPanel: React.FC<{
  intent?: SwapIntent;
  providers: Provider[];
  mode: RouterMode;
  payAssets: PayAsset[];
  payAsset: string;
  onPayAsset: (asset: PayAsset) => void;
  // Shown when every aggregator failed but the token has its own pool.
  onUseDirect?: () => void;
}> = ({ intent, providers: available, mode, payAssets, payAsset, onPayAsset, onUseDirect }) => {
  const {
    tokens,
    setActiveToken,
    activeToken,
    wallet,
    networkStats,
    walletRequest,
    setIsWalletConnectModalOpen,
    isBiometricLocked,
    requireBiometricThreshold,
    setIsBiometricModalOpen,
    addAlert,
  } = useApp();
  const chain: ChainKey = activeToken.chain ?? 'base';
  const chainConfig = CHAINS[chain];
  const token = activeToken.address.toLowerCase();
  const [side, setSide] = useState<Side>(intent?.direction ?? 'buy');
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState(readSlippage);
  const [quotes, setQuotes] = useState<{ key: string; results: Partial<Record<Provider, QuoteResult>> } | null>(null);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<Provider | null>(null);
  const [acceptImpact, setAcceptImpact] = useState(false);
  const [decimals, setDecimals] = useState<number | null>(null);
  const [balances, setBalances] = useState<{ native: bigint; token: bigint; counter: bigint } | null>(null);
  const [picker, setPicker] = useState<'asset' | 'token' | null>(null);
  const providers = useMemo(() => (mode === 'best' ? available : available.filter((provider) => provider === mode)), [available, mode]);
  const asset = payAssets.find((item) => item.address === payAsset) ?? payAssets[0];
  const [counterDecimals, setCounterDecimals] = useState(18);
  const [status, setStatus] = useState<{ kind: 'working' | 'done' | 'error'; message: string; txHash?: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  const requestId = useRef(0);

  useEffect(() => { if (intent) setSide(intent.direction); }, [intent]);
  useEffect(() => { setAmount(''); setQuotes(null); setPicked(null); setStatus(null); setAcceptImpact(false); }, [token, side, asset.address]);
  useEffect(() => { setPicked(null); }, [mode]);
  useEffect(() => {
    if (asset.address === 'native') { setCounterDecimals(18); return; }
    let active = true;
    fetchChainTokenDecimals(chain, asset.address).then((value) => { if (active) setCounterDecimals(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [asset.address, chain]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    setDecimals(null);
    fetchChainTokenDecimals(chain, token).then((value) => { if (active) setDecimals(value); }).catch(() => { if (active) setDecimals(18); });
    return () => { active = false; };
  }, [chain, token]);

  const loadBalances = useCallback(async () => {
    if (!wallet.isConnected || !wallet.address) { setBalances(null); return; }
    try {
      const [native, tokenRaw, counterRaw] = await Promise.all([
        fetchChainBalanceRaw(chain, wallet.address, 'native'),
        fetchChainBalanceRaw(chain, wallet.address, token),
        asset.address === 'native' ? Promise.resolve(-1n) : fetchChainBalanceRaw(chain, wallet.address, asset.address),
      ]);
      setBalances({ native, token: tokenRaw, counter: counterRaw < 0n ? native : counterRaw });
    } catch {
      setBalances(null);
    }
  }, [asset.address, chain, token, wallet.address, wallet.isConnected]);
  useEffect(() => { void loadBalances(); }, [loadBalances]);

  // The other side of the trade: the chosen pay asset.
  const counter = asset.address;
  const counterSymbol = asset.symbol;
  const counterLogo = asset.logo;
  const from = side === 'buy' ? counter : token;
  const to = side === 'buy' ? token : counter;
  const fromSymbol = side === 'buy' ? counterSymbol : activeToken.symbol;
  const toSymbol = side === 'buy' ? activeToken.symbol : counterSymbol;
  const quoteKey = `${chain}:${side}:${token}:${counter}:${amount}:${slippage}`;

  const counterPriceUsd = payAssetUsd(asset, networkStats.ethPriceUsd, tokens, chain);

  const fetchQuotes = useCallback(async () => {
    const value = Number(amount);
    if (!amount || !Number.isFinite(value) || value <= 0 || providers.length === 0) { setQuotes(null); return; }
    const id = ++requestId.current;
    setLoading(true);
    const settled = await Promise.allSettled(providers.map((provider) => (provider === 'okx'
      ? fetchOkxAggregatorQuote(from, to, value, slippage, wallet.address || undefined, fromSymbol, toSymbol, undefined, chain)
      : fetchBinanceAggregatorQuote(from, to, value, slippage, wallet.address || undefined, fromSymbol, toSymbol, undefined, chain))));
    if (id !== requestId.current) return;
    const results: Partial<Record<Provider, QuoteResult>> = {};
    settled.forEach((result, index) => {
      results[providers[index]] = result.status === 'fulfilled'
        ? { quote: result.value }
        : { error: result.reason instanceof Error ? result.reason.message.replace(/^.*?:\s/, '').slice(0, 140) : 'No route' };
    });
    setQuotes({ key: quoteKey, results });
    setLoading(false);
  }, [amount, chain, from, fromSymbol, providers, quoteKey, slippage, to, toSymbol, wallet.address]);

  // Debounced quote on input; refreshed while the amount stays the same.
  useEffect(() => {
    const debounce = window.setTimeout(() => void fetchQuotes(), 450);
    const refresh = window.setInterval(() => { if (status?.kind !== 'working') void fetchQuotes(); }, QUOTE_REFRESH_MS);
    return () => { window.clearTimeout(debounce); window.clearInterval(refresh); };
  }, [fetchQuotes, status?.kind]);

  const fresh = quotes && quotes.key === quoteKey ? quotes.results : null;
  const ranked = useMemo(() => {
    const ok = PROVIDERS.flatMap((provider) => {
      const result = fresh?.[provider];
      return result && 'quote' in result ? [result.quote] : [];
    });
    return rankAggregatorQuotes(ok, side === 'buy' ? activeToken.priceUsd : counterPriceUsd ?? 0);
  }, [activeToken.priceUsd, counterPriceUsd, fresh, side]);
  const best = ranked[0]?.provider ?? null;
  const chosen = ranked.find((quote) => quote.provider === (picked ?? best)) ?? ranked[0] ?? null;
  const impact = chosen?.priceImpactPercent ?? null;
  const severe = impact !== null && Math.abs(impact) >= SEVERE_IMPACT;
  const quoteAge = chosen ? Math.floor((now - chosen.quotedAt) / 1000) : null;

  const tokenDecimals = decimals ?? 18;
  const nativeBalance = balances ? Number(formatUnits(balances.native, 18)) : null;
  const tokenBalance = balances ? Number(formatUnits(balances.token, tokenDecimals)) : null;
  const counterBalance = balances ? (counter === 'native' ? nativeBalance : Number(formatUnits(balances.counter, counterDecimals))) : null;
  const payBalance = side === 'buy' ? counterBalance : tokenBalance;
  // Gas is paid in the native coin: keep some aside when paying with it.
  const gasReserve = side === 'buy' && counter === 'native' ? (chain === 'arc' ? 0.05 : 0.0003) : 0;
  const insufficient = wallet.isConnected && payBalance !== null && Number(amount) > Math.max(0, payBalance - gasReserve);
  const payPrice = side === 'buy' ? counterPriceUsd : activeToken.priceUsd;
  const receivePrice = side === 'buy' ? activeToken.priceUsd : counterPriceUsd;
  const payUsd = Number(amount) > 0 && payPrice ? Number(amount) * payPrice : null;
  const receiveUsd = chosen && receivePrice ? chosen.outputAmount * receivePrice : null;
  // Presets: ETH amounts for ETH / WETH, dollars for stablecoins, about $5-$500 for other tokens.
  const buyPresets = asset.usd === 'eth' ? ETH_PRESETS
    : asset.usd === 1 ? STABLE_PRESETS
      : counterPriceUsd ? USD_PRESETS.map((usd) => String(Number((usd / counterPriceUsd).toPrecision(2)))) : ETH_PRESETS;

  const setFraction = (fraction: number) => {
    if (payBalance === null) return;
    const max = Math.max(0, payBalance - gasReserve);
    const value = max * fraction;
    setAmount(value > 0 ? String(Number(value.toPrecision(8))) : '');
  };

  const pickSlippage = (value: number) => {
    setSlippage(value);
    try { window.localStorage.setItem(SLIPPAGE_KEY, String(value)); } catch { /* optional */ }
  };

  const submit = async () => {
    if (!wallet.isConnected || !wallet.address) { setIsWalletConnectModalOpen(true); return; }
    if (!chosen) return;
    // Trade size in ETH terms, for the biometric threshold.
    const nativeValue = ((side === 'buy' ? payUsd ?? receiveUsd : receiveUsd ?? payUsd) ?? 0) / (networkStats.ethPriceUsd || Number.POSITIVE_INFINITY);
    if (wallet.isBiometricProtected && isBiometricLocked && nativeValue >= requireBiometricThreshold) {
      setIsBiometricModalOpen(true);
      return;
    }
    if (Date.now() - chosen.quotedAt > 25_000) {
      setStatus({ kind: 'error', message: 'The quote expired. A fresh one is loading; press again.' });
      void fetchQuotes();
      return;
    }
    setStatus({ kind: 'working', message: `Building the ${PROVIDER_NAME[chosen.provider]} route…` });
    const provider: Eip1193Provider = { request: ({ method, params }) => walletRequest(method, params ?? []) };
    try {
      const transactions = chosen.provider === 'okx'
        ? await fetchOkxSwapTransactions(from, to, Number(amount), slippage, wallet.address, chain)
        : await fetchBinanceSwapTransactions(chosen, from, to, slippage, wallet.address, chain);
      const result = await executeFeeProtectedAggregatorSwap(
        transactions,
        wallet.address,
        to,
        provider,
        (message) => setStatus({ kind: 'working', message }),
        chain,
      );
      recordSwap(wallet.address, {
        txHash: result.txHash,
        timestamp: Date.now(),
        status: result.success ? 'success' : 'failed',
        provider: chosen.provider,
        paySymbol: fromSymbol,
        payAmount: amount,
        receiveSymbol: toSymbol,
        receiveAmount: result.outputAmount ?? chosen.outputAmount,
        tokenAddress: activeToken.address,
      });
      if (!result.success) throw Object.assign(new Error(result.message), { txHash: result.txHash });
      sound.playSuccess();
      setStatus({ kind: 'done', message: `${side === 'buy' ? 'Bought' : 'Sold'} ${activeToken.symbol} on ${chainConfig.name}.`, txHash: result.txHash });
      addAlert({ title: `${side === 'buy' ? 'Buy' : 'Sell'} confirmed`, message: `${amount} ${fromSymbol} → ${toSymbol} via ${PROVIDER_NAME[chosen.provider]}`, type: 'trade' });
      setAmount('');
      void loadBalances();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The swap failed.';
      const rejected = /reject|denied|cancel/i.test(message) && !/swap cancelled/i.test(message);
      setStatus({ kind: 'error', message: rejected ? 'Cancelled in the wallet.' : message.slice(0, 220), txHash: (error as { txHash?: string }).txHash });
    }
  };

  const busy = status?.kind === 'working';
  const value = Number(amount);
  const buttonLabel = !wallet.isConnected
    ? 'Connect wallet'
    : !(value > 0) ? 'Enter an amount'
      : insufficient ? `Not enough ${fromSymbol}`
        : loading && !chosen ? 'Finding the best route…'
          : !chosen ? 'No route for this amount'
            : severe && !acceptImpact ? 'Confirm the price impact first'
              : `${side === 'buy' ? 'Buy' : 'Sell'} ${activeToken.symbol}`;

  return (
    <section aria-label={`Swap ${activeToken.symbol}`} className="bd-card bd-glow-edge p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="w-40"><SideTabs side={side} onChange={setSide} /></div>
        <span className={`chain-chip chain-${chain} inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.6875rem] font-bold`} title={`Swaps run on ${chainConfig.name}; your wallet is switched there first.`}>
          <ChainEmblem chain={chain} /> {chainConfig.name}
        </span>
      </div>

      <AmountField
        label="You pay"
        value={amount}
        onChange={setAmount}
        token={side === 'buy' ? { symbol: counterSymbol, logo: counterLogo, name: asset.name } : { symbol: activeToken.symbol, logo: activeToken.logo, name: activeToken.name }}
        onTokenClick={() => setPicker(side === 'buy' ? 'asset' : 'token')}
        tokenPickerLabel={side === 'buy' ? 'Choose what to pay with' : 'Choose the token to sell'}
        balance={wallet.isConnected ? (payBalance === null ? null : `${formatTokenAmount(payBalance)} ${fromSymbol}`) : undefined}
        onMax={payBalance ? () => setFraction(1) : undefined}
        usd={payUsd}
        error={insufficient ? `Not enough ${fromSymbol}${gasReserve > 0 ? ' (gas kept aside)' : ''}` : undefined}
      />
      <PresetRow items={side === 'buy'
        ? buyPresets.map((preset) => ({ label: preset, onClick: () => setAmount(preset) }))
        : [0.25, 0.5, 0.75, 1].map((fraction) => ({ label: fraction === 1 ? 'MAX' : `${fraction * 100}%`, onClick: () => setFraction(fraction), disabled: !tokenBalance }))} />

      <FlipDivider onFlip={() => setSide(side === 'buy' ? 'sell' : 'buy')} />

      <AmountField
        label="You receive (estimated)"
        value={chosen ? formatTokenAmount(chosen.outputAmount) : ''}
        readOnly
        loading={loading && !chosen && value > 0}
        token={side === 'buy' ? { symbol: activeToken.symbol, logo: activeToken.logo, name: activeToken.name } : { symbol: counterSymbol, logo: counterLogo, name: asset.name }}
        onTokenClick={() => setPicker(side === 'buy' ? 'token' : 'asset')}
        tokenPickerLabel={side === 'buy' ? 'Choose the token to buy' : 'Choose what to receive'}
        balance={wallet.isConnected ? (side === 'buy' ? (tokenBalance === null ? null : `${formatTokenAmount(tokenBalance)} ${activeToken.symbol}`) : (counterBalance === null ? null : `${formatTokenAmount(counterBalance)} ${counterSymbol}`)) : undefined}
        usd={receiveUsd}
      />

      {providers.length === 0 && (
        <p className="mt-3 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          {mode === 'best' ? 'No aggregator serves' : `${PROVIDER_NAME[mode as Provider]} does not serve`} {chainConfig.name} on this server. Pick another route above.
        </p>
      )}
      {value > 0 && fresh && ranked.length === 0 && !loading && onUseDirect && (
        <button type="button" onClick={onUseDirect} className="mt-3 w-full rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-left text-xs font-semibold text-accent hover:bg-accent/15">
          No aggregator route for this trade. Use the token's own pool (Pool direct) instead →
        </button>
      )}
      {value > 0 && providers.length > 0 && (
        <div className="mt-3 space-y-1.5" role="radiogroup" aria-label="Router">
          {providers.map((provider) => {
            const result = fresh?.[provider];
            const quote = result && 'quote' in result ? result.quote : null;
            const selected = chosen?.provider === provider;
            return (
              <button
                key={provider}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={!quote || mode !== 'best'}
                onClick={() => setPicked(provider)}
                className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-xs transition ${selected ? 'border-accent/70 bg-accent/10' : 'border-line bg-sunken/40 hover:border-fg/20'} disabled:cursor-default`}
              >
                <BrandLogo brand={provider === 'okx' ? 'okx' : 'binance'} size={18} />
                <span className="min-w-0 flex-1">
                  <span className="block font-bold text-fg">{PROVIDER_NAME[provider]}</span>
                  <span className="block truncate text-[0.6875rem] text-subtle">{quote ? quote.router.replace(/^(OKX|Binance Web3) · /, '') : result && 'error' in result ? result.error : loading ? 'Asking for a route…' : '—'}</span>
                </span>
                {quote && (
                  <span className="text-right">
                    <span className="block font-mono font-bold text-fg">{formatTokenAmount(quote.outputAmount)}</span>
                    {quote.provider === best && ranked.length > 1 && <span className="inline-flex items-center gap-0.5 text-[0.625rem] font-extrabold uppercase text-up"><CheckCircle2 className="h-3 w-3" /> Best</span>}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <DetailRows rows={[
        ['Minimum received', chosen ? `${formatTokenAmount(chosen.minimumOutput)} ${toSymbol}` : '—'],
        ['Price impact', <span key="impact" className={impact === null ? '' : Math.abs(impact) >= SEVERE_IMPACT ? 'text-down' : Math.abs(impact) >= HIGH_IMPACT ? 'text-warn' : 'text-up'}>{impact === null ? '—' : `${impact.toFixed(2)}%`}</span>],
        [`BankrDex fee (${PLATFORM_FEE_BPS / 100}%)`, value > 0 ? `${formatTokenAmount((value * PLATFORM_FEE_BPS) / 10_000)} ${fromSymbol}` : '—'],
        ['Network fee', chosen?.providerFeeUsd ? `≈ $${chosen.providerFeeUsd.toFixed(2)}` : 'Paid in the wallet'],
        [<span key="slip">Slippage</span>, <SlippagePicker key="picker" value={slippage} options={SLIPPAGES} onChange={pickSlippage} />],
        [<span key="age" className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> Quote</span>, quoteAge === null ? '—' : `${quoteAge}s ago · refreshes every ${QUOTE_REFRESH_MS / 1000}s`],
      ]} />

      {severe && (
        <label className="mt-3 flex items-start gap-2 rounded-xl border border-down/50 bg-down/10 px-3 py-2 text-xs text-down">
          <input type="checkbox" checked={acceptImpact} onChange={(event) => setAcceptImpact(event.target.checked)} className="mt-0.5" />
          <span><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />Price impact is {impact?.toFixed(1)}%: you would lose a large part of this trade to the pool. Tick to continue anyway.</span>
        </label>
      )}

      <SwapButton side={side} busy={busy} disabled={wallet.isConnected && (!(value > 0) || insufficient || !chosen || (severe && !acceptImpact))} onClick={() => void submit()}>
        {buttonLabel}
      </SwapButton>
      <StatusLine status={status} explorerUrl={(hash) => explorerTx(chain, hash)} />

      <p className="mt-3 flex items-start gap-1.5 text-[0.6875rem] leading-relaxed text-subtle">
        <Route className="mt-0.5 h-3 w-3 shrink-0" />
        {mode === 'best' ? `Best of ${available.map((provider) => PROVIDER_NAME[provider]).join(' and ')}` : `Only ${PROVIDER_NAME[mode as Provider]}`} on {chainConfig.name}. Token approvals are for the exact amount.
        <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-up" />
      </p>

      {picker === 'asset' && (
        <PayAssetPicker
          title={side === 'buy' ? 'Pay with' : 'Receive in'}
          assets={payAssets}
          selected={asset.address}
          onSelect={onPayAsset}
          onClose={() => setPicker(null)}
        />
      )}
      {picker === 'token' && <TokenPicker current={activeToken} onSelect={setActiveToken} onClose={() => setPicker(null)} />}
    </section>
  );
};
