// Limit orders, take-profit / stop-loss and price alerts, kept in this browser. BankrDex never
// holds funds: when an order's price condition is met, the order watcher asks the connected
// wallet to sign the swap, so orders only run while a BankrDex tab is open.
export type OrderKind = 'limit-buy' | 'take-profit' | 'stop-loss' | 'alert-above' | 'alert-below';
export type OrderStatus = 'open' | 'executing' | 'filled' | 'failed' | 'cancelled' | 'notified';

export interface Order {
  id: string;
  kind: OrderKind;
  token: string;
  symbol: string;
  // USD price that triggers the order.
  triggerPrice: number;
  // limit-buy: ETH to spend. take-profit / stop-loss: percent of the token balance to sell.
  amount: number;
  slippage: number;
  status: OrderStatus;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
  txHash?: string;
  note?: string;
}

const KEY = 'bankrdex-orders';
export const ORDERS_EVENT = 'bankrdex:orders';
const MAX_ORDERS = 200;

export const isAlert = (kind: OrderKind) => kind === 'alert-above' || kind === 'alert-below';
// Buy below / alert below / stop-loss trigger when the price falls to the level.
export const triggersBelow = (kind: OrderKind) => kind === 'limit-buy' || kind === 'stop-loss' || kind === 'alert-below';

export function isTriggered(order: Order, priceUsd: number): boolean {
  if (!(priceUsd > 0)) return false;
  return triggersBelow(order.kind) ? priceUsd <= order.triggerPrice : priceUsd >= order.triggerPrice;
}

export function readOrders(): Order[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(value) ? value.filter((order): order is Order => Boolean(order) && typeof (order as Order).id === 'string' && /^0x[a-f0-9]{40}$/.test((order as Order).token)) : [];
  } catch {
    return [];
  }
}

function write(orders: Order[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(orders.slice(-MAX_ORDERS)));
  } catch {
    // Orders stay for this session only.
  }
  window.dispatchEvent(new Event(ORDERS_EVENT));
}

export function addOrder(order: Omit<Order, 'id' | 'status' | 'createdAt' | 'updatedAt'>): Order {
  const created: Order = { ...order, token: order.token.toLowerCase(), id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, status: 'open', createdAt: Date.now(), updatedAt: Date.now() };
  write([...readOrders(), created]);
  return created;
}

export function updateOrder(id: string, patch: Partial<Order>): void {
  write(readOrders().map((order) => order.id === id ? { ...order, ...patch, updatedAt: Date.now() } : order));
}

export function removeFinishedOrders(): void {
  write(readOrders().filter((order) => order.status === 'open' || order.status === 'executing'));
}

export const ORDER_LABEL: Record<OrderKind, string> = {
  'limit-buy': 'Limit buy',
  'take-profit': 'Take profit',
  'stop-loss': 'Stop loss',
  'alert-above': 'Alert above',
  'alert-below': 'Alert below',
};
