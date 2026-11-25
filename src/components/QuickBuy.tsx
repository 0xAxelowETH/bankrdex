import React, { useEffect, useState } from 'react';
import { Loader2, Zap } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { directBuy, fetchDirectPool, isNativePaired, supportsDirectSwap } from '../services/directSwap';
import { recordSwap } from '../utils/swapHistory';
import { formatUnits } from 'viem';
import type { Token } from '../types';
import { FEATURES } from '../config/features';
import { SoonBadge } from './SoonBadge';

// One-click buys from the market table: a fixed ETH amount straight into the token's V4 pool.
// The wallet still confirms every transaction.
const AMOUNT_KEY = 'bankrdex-quick-buy-eth';
const SLIPPAGE_KEY = 'bankrdex-direct-slippage';
const AMOUNT_EVENT = 'bankrdex:quick-buy-amount';
const DEFAULT_AMOUNT = '0.005';

function readAmount(): string {
  try {
    const value = window.localStorage.getItem(AMOUNT_KEY);
    return value && Number(value) > 0 ? value : DEFAULT_AMOUNT;
  } catch {
    return DEFAULT_AMOUNT;
  }
}

function useQuickBuyAmount(): [string, (value: string) => void] {
  const [amount, setAmount] = useState(readAmount);
  useEffect(() => {
    const sync = () => setAmount(readAmount());
    window.addEventListener(AMOUNT_EVENT, sync);
    return () => window.removeEventListener(AMOUNT_EVENT, sync);
  }, []);
  const update = (value: string) => {
    setAmount(value);
    if (Number(value) > 0) {
      try { window.localStorage.setItem(AMOUNT_KEY, value); } catch { /* optional */ }
      window.dispatchEvent(new Event(AMOUNT_EVENT));
    }
  };
  return [amount, update];
}

// Toolbar control: the ETH amount every ⚡ button buys.
export function QuickBuyAmount() {
  const [amount, setAmount] = useQuickBuyAmount();
  return (
    <label className="flex h-9 items-center gap-1.5 rounded-xl border border-line bg-panel px-2.5 text-xs font-semibold text-muted transition focus-within:border-accent/60" title="ETH spent by each ⚡ quick-buy button (Base tokens, direct to the Uniswap V4 pool)">
      <Zap className="h-3.5 w-3.5 text-accent" />
      <span className="hidden sm:inline">Quick buy</span>
      <input
        inputMode="decimal"
        value={amount}
        onChange={(event) => setAmount(event.target.value.replace(',', '.').replace(/[^0-9.]/g, ''))}
        aria-label="Quick buy amount in ETH"
        className="w-14 bg-transparent text-right font-mono text-fg outline-none"
      />
      <span>ETH</span>
    </label>
  );
}

export function QuickBuyButton({ token, compact = false }: { token: Token; compact?: boolean }) {
  const { wallet, sendWalletTransaction, walletRequest, setIsWalletConnectModalOpen, addAlert } = useApp();
  const [amount] = useQuickBuyAmount();
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const chain = token.chain ?? 'base';
  if (!supportsDirectSwap(chain) || token.externalSource === 'market') return null;
  // Base pools come from the on-chain index: until it runs, quick buys there are "Soon".
  if (chain === 'base' && !FEATURES.baseDirectSwap) {
    return (
      <span title="Coming soon: one-click buys on Base" aria-label="Quick buy coming soon"
        className="inline-flex cursor-not-allowed items-center gap-0.5 whitespace-nowrap rounded-lg border border-line px-1.5 py-1 text-muted opacity-70">
        <Zap className="h-3 w-3" />
        <SoonBadge />
      </span>
    );
  }

  const buy = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!wallet.isConnected) { setIsWalletConnectModalOpen(true); return; }
    setState('working');
    try {
      const pool = await fetchDirectPool(token.address, chain, { poolId: token.poolAddress, quote: token.quoteAddress });
      if (!pool || !isNativePaired(pool)) throw new Error(`${token.symbol} has no WETH pool for a direct buy; open the token to trade it.`);
      let slippage = 5;
      try { slippage = Number(window.localStorage.getItem(SLIPPAGE_KEY)) || 5; } catch { /* default */ }
      const result = await directBuy(pool, amount, slippage, {
        address: wallet.address,
        sendTransaction: (transaction) => sendWalletTransaction(transaction, chain),
        request: walletRequest,
      });
      recordSwap(wallet.address, {
        txHash: result.txHash,
        timestamp: Date.now(),
        status: result.succeeded ? 'success' : 'failed',
        provider: 'uniswap',
        paySymbol: 'ETH',
        payAmount: amount,
        receiveSymbol: token.symbol,
        receiveAmount: Number(formatUnits(result.quoted, 18)),
        tokenAddress: token.address,
      });
      if (!result.succeeded) throw new Error('The swap failed on-chain.');
      setState('done');
      addAlert({ title: 'Quick buy confirmed', message: `${amount} ETH → ${token.symbol}`, type: 'trade' });
    } catch (error) {
      setState('error');
      const message = error instanceof Error ? error.message : 'Quick buy failed.';
      if (!/reject|denied|cancel/i.test(message)) addAlert({ title: 'Quick buy failed', message: message.slice(0, 160), type: 'security' });
    } finally {
      window.setTimeout(() => setState('idle'), 2_500);
    }
  };

  return (
    <button
      type="button"
      onClick={(event) => void buy(event)}
      disabled={state === 'working'}
      title={`Buy ${amount} ETH of ${token.symbol} (direct, Uniswap V4)`}
      aria-label={`Quick buy ${amount} ETH of ${token.symbol}`}
      className={`inline-flex items-center gap-0.5 whitespace-nowrap rounded-lg border px-2 py-1 font-mono text-[0.6875rem] font-bold transition ${state === 'done' ? 'border-up bg-up/10 text-up' : state === 'error' ? 'border-down bg-down/10 text-down' : 'border-accent/40 bg-accent/[0.06] text-accent hover:bg-accent hover:text-black'} disabled:opacity-60`}
    >
      {state === 'working' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
      {!compact && amount}
    </button>
  );
}
