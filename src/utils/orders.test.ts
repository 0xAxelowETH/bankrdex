import { describe, expect, it } from 'vitest';
import { isTriggered, type Order } from './orders';

const order = (kind: Order['kind'], triggerPrice: number): Order => ({
  id: 'x', kind, token: '0x' + '1'.repeat(40), symbol: 'T', triggerPrice, amount: 1, slippage: 5,
  status: 'open', createdAt: 0, updatedAt: 0, expiresAt: null,
});

describe('isTriggered', () => {
  it('limit buys, stop losses and below-alerts fire at or under the level', () => {
    for (const kind of ['limit-buy', 'stop-loss', 'alert-below'] as const) {
      expect(isTriggered(order(kind, 1), 0.9)).toBe(true);
      expect(isTriggered(order(kind, 1), 1)).toBe(true);
      expect(isTriggered(order(kind, 1), 1.1)).toBe(false);
    }
  });

  it('take profits and above-alerts fire at or over the level', () => {
    for (const kind of ['take-profit', 'alert-above'] as const) {
      expect(isTriggered(order(kind, 1), 1.1)).toBe(true);
      expect(isTriggered(order(kind, 1), 0.9)).toBe(false);
    }
  });

  it('never fires without a price', () => {
    expect(isTriggered(order('stop-loss', 1), 0)).toBe(false);
  });
});
