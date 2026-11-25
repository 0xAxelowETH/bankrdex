import React, { useEffect, useMemo, useState } from 'react';
import { Bell, ExternalLink, Trash2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { explorerTx } from '../config/chains';
import { addOrder, isAlert, ORDER_LABEL, ORDERS_EVENT, readOrders, removeFinishedOrders, triggersBelow, updateOrder, type Order, type OrderKind } from '../utils/orders';

// Limit buy, take-profit, stop-loss and price alerts for the active token. Orders live in this
// browser and are executed by <OrderWatcher /> (the wallet confirms each swap).
const KINDS: OrderKind[] = ['limit-buy', 'take-profit', 'stop-loss', 'alert-above', 'alert-below'];
const EXPIRY_HOURS = [1, 6, 24, 72, 0];

function useOrders(): Order[] {
  const [orders, setOrders] = useState(readOrders);
  useEffect(() => {
    const sync = () => setOrders(readOrders());
    window.addEventListener(ORDERS_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(ORDERS_EVENT, sync); window.removeEventListener('storage', sync); };
  }, []);
  return orders;
}

export const OrdersPanel: React.FC = () => {
  const { activeToken } = useApp();
  const orders = useOrders();
  const [kind, setKind] = useState<OrderKind>('take-profit');
  const [trigger, setTrigger] = useState('');
  const [amount, setAmount] = useState('50');
  const [expiry, setExpiry] = useState(24);
  const [slippage, setSlippage] = useState(10);
  const price = activeToken.priceUsd;
  const address = activeToken.address.toLowerCase();
  const tokenOrders = useMemo(() => orders.filter((order) => order.token === address).slice().reverse(), [address, orders]);

  useEffect(() => {
    // Suggest a trigger relative to the current price for the chosen order type.
    if (!(price > 0)) return;
    const factor = kind === 'take-profit' || kind === 'alert-above' ? 2 : kind === 'stop-loss' ? 0.7 : 0.8;
    setTrigger((price * factor).toPrecision(4));
    setAmount(kind === 'limit-buy' ? '0.005' : '50');
  }, [kind, price, address]);

  const place = async () => {
    const triggerPrice = Number(trigger);
    const value = Number(amount);
    if (!(triggerPrice > 0) || (!isAlert(kind) && !(value > 0))) return;
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch { /* optional */ }
    }
    addOrder({
      kind,
      token: address,
      symbol: activeToken.symbol,
      triggerPrice,
      amount: isAlert(kind) ? 0 : value,
      slippage,
      expiresAt: expiry ? Date.now() + expiry * 3_600_000 : null,
    });
  };

  const distance = price > 0 && Number(trigger) > 0 ? ((Number(trigger) / price - 1) * 100) : null;
  return (
    <section aria-label="Orders and alerts" className="bd-card p-4 text-xs">
      <div className="mb-3 flex items-center gap-2">
        <Bell className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-bold text-fg">Orders &amp; alerts</h3>
      </div>
      <div className="mb-2 flex flex-wrap gap-1">
        {KINDS.map((option) => (
          <button key={option} type="button" onClick={() => setKind(option)} className={`rounded px-2 py-1 ${kind === option ? 'bg-accent font-bold text-black' : 'border border-line text-muted hover:text-fg'}`}>
            {ORDER_LABEL[option]}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-muted">
          <span className="mb-0.5 block">{triggersBelow(kind) ? 'When price ≤' : 'When price ≥'} (USD)</span>
          <input value={trigger} onChange={(event) => setTrigger(event.target.value.replace(/[^0-9.e-]/g, ''))} inputMode="decimal" className="w-full rounded border border-line bg-raised px-2 py-1 font-mono text-fg outline-none focus:border-accent" />
          {distance !== null && <span className={`mt-0.5 block ${distance >= 0 ? 'text-up' : 'text-down'}`}>{distance >= 0 ? '+' : ''}{distance.toFixed(1)}% from now</span>}
        </label>
        {!isAlert(kind) && (
          <label className="text-muted">
            <span className="mb-0.5 block">{kind === 'limit-buy' ? 'Spend (ETH)' : 'Sell (% of balance)'}</span>
            <input value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" className="w-full rounded border border-line bg-raised px-2 py-1 font-mono text-fg outline-none focus:border-accent" />
          </label>
        )}
        <label className="text-muted">
          <span className="mb-0.5 block">Expires</span>
          <select value={expiry} onChange={(event) => setExpiry(Number(event.target.value))} className="w-full rounded border border-line bg-raised px-2 py-1 text-fg">
            {EXPIRY_HOURS.map((hours) => <option key={hours} value={hours}>{hours ? `${hours}h` : 'Never'}</option>)}
          </select>
        </label>
        {!isAlert(kind) && (
          <label className="text-muted">
            <span className="mb-0.5 block">Slippage</span>
            <select value={slippage} onChange={(event) => setSlippage(Number(event.target.value))} className="w-full rounded border border-line bg-raised px-2 py-1 text-fg">
              {[3, 5, 10, 20].map((value) => <option key={value} value={value}>{value}%</option>)}
            </select>
          </label>
        )}
      </div>
      <button type="button" onClick={() => void place()} className="mt-3 w-full rounded-lg bg-accent py-2 text-xs font-bold text-black">
        Place {ORDER_LABEL[kind].toLowerCase()}
      </button>
      <p className="mt-2 text-[0.6875rem] leading-relaxed text-subtle">
        Orders run in this browser while a BankrDex tab is open; your wallet confirms each swap when the price is reached.
      </p>

      {tokenOrders.length > 0 && (
        <div className="mt-3 border-t border-line pt-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-semibold uppercase tracking-wide text-subtle">This token</span>
            <button type="button" onClick={removeFinishedOrders} className="text-subtle hover:text-fg">Clear finished</button>
          </div>
          <ul className="space-y-1">
            {tokenOrders.map((order) => (
              <li key={order.id} className="flex items-center justify-between gap-2 rounded border border-line px-2 py-1">
                <span className="min-w-0">
                  <span className="font-semibold text-fg">{ORDER_LABEL[order.kind]}</span>{' '}
                  <span className="font-mono text-muted">{triggersBelow(order.kind) ? '≤' : '≥'} ${order.triggerPrice.toPrecision(4)}</span>
                  {!isAlert(order.kind) && <span className="text-muted"> · {order.kind === 'limit-buy' ? `${order.amount} ETH` : `${order.amount}%`}</span>}
                  <span className={`ml-1 ${order.status === 'filled' ? 'text-up' : order.status === 'failed' ? 'text-down' : 'text-subtle'}`}>· {order.status}</span>
                  {order.note && <span className="block truncate text-subtle" title={order.note}>{order.note}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {order.txHash && <a href={explorerTx('base', order.txHash)} target="_blank" rel="noopener noreferrer" className="text-subtle hover:text-fg" aria-label="View transaction"><ExternalLink className="h-3.5 w-3.5" /></a>}
                  {order.status === 'open' && (
                    <button type="button" onClick={() => updateOrder(order.id, { status: 'cancelled' })} className="text-subtle hover:text-down" aria-label="Cancel order"><Trash2 className="h-3.5 w-3.5" /></button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};
