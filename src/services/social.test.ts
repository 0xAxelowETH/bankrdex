import { describe, expect, it } from 'vitest';
import { riskReward, thesisPerformance, thesisStatus } from './social';

describe('thesis maths', () => {
  it('scores bearish calls when price falls', () => {
    expect(thesisPerformance({ stance: 'bullish', priceAtPost: 1, priceNow: 1.5 })).toBeCloseTo(50);
    expect(thesisPerformance({ stance: 'bearish', priceAtPost: 1, priceNow: 0.8 })).toBeCloseTo(20);
    expect(thesisPerformance({ stance: 'bullish', priceAtPost: null, priceNow: 1 })).toBeNull();
  });

  it('marks targets and stops', () => {
    expect(thesisStatus({ stance: 'bullish', targetPrice: 2, stopPrice: 0.5, priceNow: 2.1 })).toBe('target');
    expect(thesisStatus({ stance: 'bullish', targetPrice: 2, stopPrice: 0.5, priceNow: 0.4 })).toBe('stopped');
    expect(thesisStatus({ stance: 'bearish', targetPrice: 0.5, stopPrice: 2, priceNow: 0.4 })).toBe('target');
    expect(thesisStatus({ stance: 'bearish', targetPrice: 0.5, stopPrice: 2, priceNow: 1 })).toBe('open');
  });

  it('computes reward to risk', () => {
    expect(riskReward('bullish', 1, 2, 0.7)).toBeCloseTo(1 / 0.3);
    expect(riskReward('bearish', 1, 0.5, 1.25)).toBeCloseTo(2);
    expect(riskReward('bullish', 1, 0.9, 0.7)).toBeNull();
  });
});
