import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Zap } from 'lucide-react';
import { AmountField, DetailRows, FlipDivider, PresetRow, SideTabs, SlippagePicker, StatusLine, SwapButton } from './swap/SwapUi';
import { formatUnits, parseUnits } from 'viem';
import { useApp } from '../context/AppContext';
import { PLATFORM_FEE_BPS } from '../config/platformFee';
import { CHAINS, explorerTx } from '../config/chains';
import { recordSwap } from '../utils/swapHistory';
import {
  deploymentOf,
  directBuy,
  directBuyWithQuote,
  directSell,
  formatAmount,
  isNativePaired,
  minimumOut,
  nativeBalance,
  quoteDirect,
  tokenBalance,
  type DirectPool,
} from '../services/directSwap';
import type { SwapIntent } from './swap/SwapUi';
import type { PayAsset } from './swap/payAssets';
import { PayAssetPicker, TokenPicker } from './swap/Pickers';

// Swap panel for Bankr tokens that trade in their own Uniswap V4 pool (Base, Robinhood): quotes
// come from Uniswap's V4Quoter and the swap goes straight to the pool through the Universal
// Router, so it works for tokens no aggregator has indexed yet (fresh launches). Pools paired
// with WETH trade against ETH; pools paired with another token (e.g. a stock token on Robinhood)
// trade against that token.
const ETH_PRESETS = ['0.001', '0.005', '0.01', '0.05'];
const TOKEN_PRESETS = ['0.01', '0.1', '1', '10'];
const SELL_PRESETS = [25, 50, 75, 100];
const SLIPPAGES = [1, 3, 5, 10, 20];
const SLIPPAGE_KEY = 'bankrdex-direct-slippage';
const ETH_GAS_RESERVE = 0.0003;
const NATIVE_ETH_LOGO = 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png';

function readSlippage(): number {
  try {
    const value = Number(window.localStorage.getItem(SLIPPAGE_KEY));
    return SLIPPAGES.includes(value) ? value : 5;
  } catch {
    return 5;
  }
}

export const DirectSwapPanel: React.FC<{
  pool: DirectPool;
  intent?: SwapIntent;
  payAssets?: PayAsset[];
  // Another pay asset was picked: the caller moves to a route that can use it.
  onPayAsset?: (asset: PayAsset) => void;
}> = ({ pool, intent, payAssets = [], onPayAsset }) => {
  const { activeToken, setActiveToken, wallet, networkStats, sendWalletTransaction, walletRequest, setIsWalletConnectModalOpen, addAlert } = useApp();
  const chain = CHAINS[pool.chain];
  const deployment = deploymentOf(pool);
  const native = isNativePaired(pool);
  const [direction, setDirection] = useState<'buy' | 'sell'>(intent?.direction ?? 'buy');
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState(readSlippage);
  const [quote, setQuote] = useState<{ amount: string; direction: 'buy' | 'sell'; out: bigint } | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [balances, setBalances] = useState<{ token: bigint; pay: bigint } | null>(null);
  const [status, setStatus] = useState<{ kind: 'working' | 'done' | 'error'; message: string; txHash?: string } | null>(null);
  const quoteTimer = useRef<number | undefined>(undefined);
  const [picker, setPicker] = useState<'asset' | 'token' | null>(null);
  // What buys are paid with and sells are paid out in: ETH, or the pool's quote token.
  const counterSymbol = native ? chain.nativeSymbol : activeToken.quoteSymbol || 'quote';
  const counterIn = native ? deployment.weth : pool.quote;

  useEffect(() => { if (intent) setDirection(intent.direction); }, [intent]);
  useEffect(() => { setAmount(''); setQuote(null); setStatus(null); }, [activeToken.address, direction]);

  // Balances on the pool's chain: the token, and ETH or the quote token.
  useEffect(() => {
    if (!wallet.isConnected || !wallet.address) { setBalances(null); return; }
    let active = true;
    Promise.all([
      tokenBalance(pool.token, wallet.address, pool.chain),
      native ? nativeBalance(wallet.address, pool.chain) : tokenBalance(pool.quote, wallet.address, pool.chain),
    ]).then(([token, pay]) => { if (active) setBalances({ token, pay }); }).catch(() => undefined);
    return () => { active = false; };
  }, [native, pool.chain, pool.quote, pool.token, wallet.address, wallet.isConnected, status?.kind]);

  // Debounced quote whenever the amount changes.
  useEffect(() => {
    window.clearTimeout(quoteTimer.current);
    setQuoteError('');
    const value = Number(amount);
    if (!amount || !Number.isFinite(value) || value <= 0) { setQuote(null); return; }
    quoteTimer.current = window.setTimeout(async () => {
      try {
        const raw = parseUnits(amount, 18);
        const out = await quoteDirect(pool, direction === 'buy' ? counterIn : pool.token, raw);
        setQuote({ amount, direction, out });
      } catch (error) {
        setQuote(null);
        setQuoteError(error instanceof Error && /revert|execution/i.test(error.message)
          ? 'The pool cannot fill this amount right now.'
          : 'Quote unavailable; retry in a moment.');
      }
    }, 350);
    return () => window.clearTimeout(quoteTimer.current);
  }, [amount, counterIn, direction, pool]);

  const paySymbol = direction === 'buy' ? counterSymbol : activeToken.symbol;
  const outSymbol = direction === 'buy' ? activeToken.symbol : counterSymbol;
  const freshQuote = quote && quote.amount === amount && quote.direction === direction ? quote : null;
  const minOut = freshQuote ? minimumOut(freshQuote.out, slippage) : null;
  const feeAmount = Number(amount) > 0 ? (Number(amount) * PLATFORM_FEE_BPS) / 10_000 : 0;
  const tokenAmount = balances ? Number(formatUnits(balances.token, 18)) : null;
  const payAmount = balances ? Number(formatUnits(balances.pay, 18)) : null;
  // Gas is paid in ETH: keep some aside when paying with it.
  const reserve = direction === 'buy' && native ? ETH_GAS_RESERVE : 0;
  const available = direction === 'buy' ? (payAmount === null ? null : Math.max(0, payAmount - reserve)) : tokenAmount;
  const insufficient = wallet.isConnected && available !== null && Number(amount) > available;
  const usdValue = useMemo(() => {
    const value = Number(amount);
    if (!(value > 0)) return null;
    if (direction === 'sell') return value * activeToken.priceUsd;
    return native ? value * networkStats.ethPriceUsd : null;
  }, [activeToken.priceUsd, amount, direction, native, networkStats.ethPriceUsd]);

  const submit = async () => {
    if (!wallet.isConnected) { setIsWalletConnectModalOpen(true); return; }
    setStatus({ kind: 'working', message: 'Preparing…' });
    const access = {
      address: wallet.address,
      sendTransaction: (transaction: Parameters<typeof sendWalletTransaction>[0]) => sendWalletTransaction(transaction, pool.chain),
      request: walletRequest,
      onProgress: (message: string) => setStatus({ kind: 'working', message }),
    };
    try {
      const result = direction === 'sell'
        ? await directSell(pool, amount, slippage, access)
        : native
          ? await directBuy(pool, amount, slippage, access)
          : await directBuyWithQuote(pool, amount, slippage, access);
      recordSwap(wallet.address, {
        txHash: result.txHash,
        timestamp: Date.now(),
        status: result.succeeded ? 'success' : 'failed',
        provider: 'uniswap',
        paySymbol,
        payAmount: amount,
        receiveSymbol: outSymbol,
        receiveAmount: Number(formatUnits(result.quoted, 18)),
        tokenAddress: activeToken.address,
      });
      if (!result.succeeded) throw Object.assign(new Error(`The swap failed on ${chain.name} (price moved or slippage too low).`), { txHash: result.txHash });
      setStatus({ kind: 'done', message: `${direction === 'buy' ? 'Bought' : 'Sold'} ${activeToken.symbol} on ${chain.name}.`, txHash: result.txHash });
      addAlert({ title: `${direction === 'buy' ? 'Buy' : 'Sell'} confirmed`, message: `${amount} ${paySymbol} → ${outSymbol}`, type: 'trade' });
      setAmount('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The swap failed.';
      const rejected = /reject|denied|cancel/i.test(message);
      setStatus({ kind: 'error', message: rejected ? 'Cancelled in the wallet.' : message.slice(0, 180), txHash: (error as { txHash?: string }).txHash });
    }
  };

  const busy = status?.kind === 'working';
  const value = Number(amount);
  const tokenChip = { symbol: activeToken.symbol, logo: activeToken.logo, name: activeToken.name };
  const counterChip = native ? { symbol: chain.nativeSymbol, logo: chain.nativeSymbol === 'ETH' ? NATIVE_ETH_LOGO : chain.logo } : { symbol: counterSymbol, logo: activeToken.quoteLogo };
  const buttonLabel = !wallet.isConnected
    ? 'Connect wallet'
    : !(value > 0) ? 'Enter an amount'
      : insufficient ? `Not enough ${paySymbol}`
        : !freshQuote ? (quoteError ? 'No quote' : 'Getting a quote…')
          : `${direction === 'buy' ? 'Buy' : 'Sell'} ${activeToken.symbol}`;
  return (
    <section aria-label={`Swap ${activeToken.symbol}`} className="bd-card bd-glow-edge p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="w-40"><SideTabs side={direction} onChange={setDirection} /></div>
        <span className={`chain-chip chain-${chain.key} inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[0.6875rem] font-bold`} title={`Swaps go straight to this token's Uniswap V4 pool on ${chain.name} through the Uniswap Universal Router.`}>
          <Zap className="h-3 w-3" /> Uniswap V4 · {chain.name}
        </span>
      </div>

      <AmountField
        label="You pay"
        value={amount}
        onChange={setAmount}
        token={direction === 'buy' ? counterChip : tokenChip}
        onTokenClick={() => setPicker(direction === 'buy' ? 'asset' : 'token')}
        tokenPickerLabel={direction === 'buy' ? 'Choose what to pay with' : 'Choose the token to sell'}
        balance={wallet.isConnected ? (direction === 'buy' ? (payAmount === null ? null : `${formatAmount(balances?.pay ?? 0n)} ${counterSymbol}`) : tokenAmount === null ? null : `${formatAmount(balances?.token ?? 0n)} ${activeToken.symbol}`) : undefined}
        onMax={available ? () => setAmount(String(Number(available.toPrecision(8)))) : undefined}
        usd={usdValue}
        error={insufficient ? `Not enough ${paySymbol}${reserve ? ' (gas kept aside)' : ''}` : undefined}
      />
      <PresetRow items={direction === 'buy'
        ? (native ? ETH_PRESETS : TOKEN_PRESETS).map((preset) => ({ label: preset, onClick: () => setAmount(preset) }))
        : SELL_PRESETS.map((percent) => ({
          label: percent === 100 ? 'MAX' : `${percent}%`,
          disabled: !balances?.token,
          onClick: () => { if (balances?.token) setAmount(formatUnits((balances.token * BigInt(percent)) / 100n, 18)); },
        }))} />

      <FlipDivider onFlip={() => setDirection(direction === 'buy' ? 'sell' : 'buy')} />

      <AmountField
        label="You receive (estimated)"
        value={freshQuote ? formatAmount(freshQuote.out) : ''}
        readOnly
        loading={Boolean(amount) && !freshQuote && !quoteError}
        token={direction === 'buy' ? tokenChip : counterChip}
        onTokenClick={() => setPicker(direction === 'buy' ? 'token' : 'asset')}
        tokenPickerLabel={direction === 'buy' ? 'Choose the token to buy' : 'Choose what to receive'}
        error={quoteError || undefined}
      />

      <DetailRows rows={[
        ['Minimum received', minOut !== null ? `${formatAmount(minOut)} ${outSymbol}` : '—'],
        [`BankrDex fee (${PLATFORM_FEE_BPS / 100}%)`, feeAmount > 0 ? `${feeAmount.toPrecision(3)} ${paySymbol}` : '—'],
        ['Pool fee', 'Set by the Bankr pool (~1.75%)'],
        ['Slippage', <SlippagePicker key="slippage" value={slippage} options={SLIPPAGES} onChange={(next) => { setSlippage(next); try { window.localStorage.setItem(SLIPPAGE_KEY, String(next)); } catch { /* optional */ } }} />],
      ]} />

      <SwapButton side={direction} busy={busy} disabled={wallet.isConnected && (!freshQuote || insufficient)} onClick={() => void submit()}>
        {buttonLabel}
      </SwapButton>
      <StatusLine status={status} explorerUrl={(hash) => explorerTx(pool.chain, hash)} />
      <p className="mt-3 text-[0.6875rem] leading-relaxed text-subtle">
        {native ? '' : `This pool trades against ${counterSymbol}: buys pay with ${counterSymbol} and sells pay out ${counterSymbol}. `}
        New Bankr launches charge a high anti-snipe fee for their first seconds. Token payments ask for an
        exact-amount approval and a Permit2 signature; nothing is approved without a limit.
      </p>
      {picker === 'asset' && (
        <PayAssetPicker
          title={direction === 'buy' ? 'Pay with' : 'Receive in'}
          assets={payAssets.length > 0 ? payAssets : [{ address: native ? 'native' : pool.quote.toLowerCase(), symbol: counterSymbol, name: counterSymbol, logo: counterChip.logo, group: native ? 'native' : 'pair' }]}
          selected={native ? 'native' : pool.quote.toLowerCase()}
          unsupported={new Set(payAssets.map((asset) => asset.address).filter((address) => address !== (native ? 'native' : pool.quote.toLowerCase())))}
          unsupportedHint="Not in this pool: switches to the Recommended route"
          onSelect={(asset) => { if (asset.address !== (native ? 'native' : pool.quote.toLowerCase())) onPayAsset?.(asset); }}
          onClose={() => setPicker(null)}
        />
      )}
      {picker === 'token' && <TokenPicker current={activeToken} onSelect={setActiveToken} onClose={() => setPicker(null)} />}
    </section>
  );
};
