import { useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { fetchIndexedStats } from '../services/tradingApis';
import { directBuy, directSell, fetchDirectPool, tokenBalance } from '../services/directSwap';
import { formatUnits } from 'viem';
import { isAlert, isTriggered, ORDER_LABEL, readOrders, updateOrder, type Order } from '../utils/orders';
import { recordSwap } from '../utils/swapHistory';

// Watches open orders and alerts while the app is open: every 5 seconds it reads indexed prices
// for the tokens involved; a met condition notifies the user and, for orders, asks the wallet
// to sign the swap straight into the token's V4 pool. Mounted once in the app shell.
const POLL_MS = 5_000;

function notify(title: string, body: string) {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(title, { body, icon: '/icons/icon-192.png' });
  } catch {
    // In-app alert below is enough.
  }
}

export function OrderWatcher() {
  const { wallet, sendWalletTransaction, walletRequest, addAlert } = useApp();
  const walletRef = useRef({ wallet, sendWalletTransaction, walletRequest, addAlert });
  walletRef.current = { wallet, sendWalletTransaction, walletRequest, addAlert };
  const busy = useRef(false);

  useEffect(() => {
    const execute = async (order: Order, priceUsd: number) => {
      const { wallet: currentWallet, sendWalletTransaction: send, walletRequest: request, addAlert: alert } = walletRef.current;
      const message = `${order.symbol} at $${priceUsd.toPrecision(4)} (${ORDER_LABEL[order.kind]} $${order.triggerPrice.toPrecision(4)})`;
      if (isAlert(order.kind)) {
        updateOrder(order.id, { status: 'notified', note: `Triggered at $${priceUsd.toPrecision(4)}` });
        alert({ title: 'Price alert', message, type: order.kind === 'alert-above' ? 'pump' : 'dump' });
        notify('BankrDex price alert', message);
        return;
      }
      if (!currentWallet.isConnected) {
        updateOrder(order.id, { status: 'failed', note: 'Triggered while no wallet was connected.' });
        alert({ title: `${ORDER_LABEL[order.kind]} triggered`, message: `${message}. Connect your wallet to trade.`, type: 'security' });
        notify(`${ORDER_LABEL[order.kind]} triggered`, message);
        return;
      }
      updateOrder(order.id, { status: 'executing' });
      notify(`${ORDER_LABEL[order.kind]} triggered`, `${message}. Confirm the swap in your wallet.`);
      try {
        const pool = await fetchDirectPool(order.token);
        if (!pool) throw new Error('No V4 pool found for this token.');
        const access = { address: currentWallet.address, sendTransaction: (transaction: Parameters<typeof send>[0]) => send(transaction, 'base'), request };
        let result;
        let payAmount: string;
        if (order.kind === 'limit-buy') {
          payAmount = String(order.amount);
          result = await directBuy(pool, payAmount, order.slippage, access);
        } else {
          const balance = await tokenBalance(order.token, currentWallet.address);
          const amount = (balance * BigInt(Math.round(Math.min(order.amount, 100) * 100))) / 10_000n;
          if (amount <= 0n) throw new Error(`No ${order.symbol} to sell.`);
          payAmount = formatUnits(amount, 18);
          result = await directSell(pool, payAmount, order.slippage, access);
        }
        recordSwap(currentWallet.address, {
          txHash: result.txHash,
          timestamp: Date.now(),
          status: result.succeeded ? 'success' : 'failed',
          provider: 'uniswap',
          paySymbol: order.kind === 'limit-buy' ? 'ETH' : order.symbol,
          payAmount,
          receiveSymbol: order.kind === 'limit-buy' ? order.symbol : 'ETH',
          receiveAmount: Number(formatUnits(result.quoted, 18)),
          tokenAddress: order.token,
        });
        updateOrder(order.id, { status: result.succeeded ? 'filled' : 'failed', txHash: result.txHash, note: result.succeeded ? `Filled at ~$${priceUsd.toPrecision(4)}` : 'Swap reverted' });
        alert({ title: `${ORDER_LABEL[order.kind]} ${result.succeeded ? 'filled' : 'failed'}`, message, type: 'trade' });
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Swap failed';
        updateOrder(order.id, { status: /reject|denied|cancel/i.test(reason) ? 'cancelled' : 'failed', note: reason.slice(0, 160) });
      }
    };

    const tick = async () => {
      if (busy.current) return;
      const now = Date.now();
      const open = readOrders().filter((order) => order.status === 'open');
      open.filter((order) => order.expiresAt && order.expiresAt < now).forEach((order) => updateOrder(order.id, { status: 'cancelled', note: 'Expired' }));
      const live = open.filter((order) => !order.expiresAt || order.expiresAt >= now);
      if (live.length === 0) return;
      busy.current = true;
      try {
        const stats = await fetchIndexedStats([...new Set(live.map((order) => order.token))]);
        // One order at a time, so the wallet never gets two signature requests at once.
        for (const order of live) {
          const price = stats.get(order.token)?.price_usd ?? 0;
          if (isTriggered(order, price)) {
            await execute(order, price);
            break;
          }
        }
      } catch {
        // retry on the next tick
      } finally {
        busy.current = false;
      }
    };
    const timer = window.setInterval(() => void tick(), POLL_MS);
    void tick();
    return () => window.clearInterval(timer);
  }, []);

  return null;
}
