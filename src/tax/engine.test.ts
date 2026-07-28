import { describe, expect, it } from 'vitest';
import { calculateTaxForYear, realizeTrades } from './engine.js';
import type { CanonicalTrade } from '../types/trade.js';

function trade(
  partial: Partial<CanonicalTrade> &
    Pick<CanonicalTrade, 'id' | 'side' | 'quantity' | 'priceKrw' | 'tradedAt'>,
): CanonicalTrade {
  return {
    exchange: 'upbit',
    asset: 'BTC',
    feeKrw: '0',
    rawSource: 'csv',
    ...partial,
  };
}

describe('realizeTrades moving average', () => {
  it('computes average cost across buys then gain on sell', () => {
    const trades: CanonicalTrade[] = [
      trade({
        id: '1',
        side: 'buy',
        quantity: '1',
        priceKrw: '10000000',
        tradedAt: '2027-01-10T00:00:00.000Z',
      }),
      trade({
        id: '2',
        side: 'buy',
        quantity: '1',
        priceKrw: '20000000',
        tradedAt: '2027-02-10T00:00:00.000Z',
      }),
      trade({
        id: '3',
        side: 'sell',
        quantity: '1',
        priceKrw: '18000000',
        feeKrw: '10000',
        tradedAt: '2027-03-10T00:00:00.000Z',
      }),
    ];

    const { realized, positions } = realizeTrades(trades);
    expect(realized).toHaveLength(1);
    // avg cost = 15_000_000, gain = 18_000_000 - 15_000_000 - 10_000
    expect(realized[0].gainKrw.toFixed(0)).toBe('2990000');
    expect(positions.get('BTC')?.quantity.toFixed(0)).toBe('1');
    expect(positions.get('BTC')?.avgCostKrw.toFixed(0)).toBe('15000000');
  });
});

describe('calculateTaxForYear', () => {
  it('applies 2.5M deduction and 22% rate', () => {
    const trades: CanonicalTrade[] = [
      trade({
        id: 'b1',
        side: 'buy',
        quantity: '1',
        priceKrw: '50000000',
        tradedAt: '2027-01-01T00:00:00.000Z',
      }),
      trade({
        id: 's1',
        side: 'sell',
        quantity: '1',
        priceKrw: '80000000',
        feeKrw: '100000',
        tradedAt: '2027-06-01T00:00:00.000Z',
      }),
    ];

    const report = calculateTaxForYear(trades, 2027);
    // gain = 30_000_000 - 100_000 = 29_900_000
    expect(report.netIncomeKrw).toBe('29900000');
    // taxable = 29_900_000 - 2_500_000 = 27_400_000
    expect(report.taxableIncomeKrw).toBe('27400000');
    // tax = 27_400_000 * 0.22 = 6_028_000
    expect(report.estimatedTaxKrw).toBe('6028000');
  });

  it('returns zero tax when under basic deduction', () => {
    const trades: CanonicalTrade[] = [
      trade({
        id: 'b1',
        side: 'buy',
        quantity: '1',
        priceKrw: '1000000',
        tradedAt: '2027-01-01T00:00:00.000Z',
      }),
      trade({
        id: 's1',
        side: 'sell',
        quantity: '1',
        priceKrw: '2000000',
        tradedAt: '2027-06-01T00:00:00.000Z',
      }),
    ];
    const report = calculateTaxForYear(trades, 2027);
    expect(report.netIncomeKrw).toBe('1000000');
    expect(report.taxableIncomeKrw).toBe('0');
    expect(report.estimatedTaxKrw).toBe('0');
  });

  it('applies deemed acquisition cost from 2026-12-31 FMV', () => {
    const trades: CanonicalTrade[] = [
      trade({
        id: 'b1',
        side: 'buy',
        quantity: '1',
        priceKrw: '10000000',
        tradedAt: '2025-06-01T00:00:00.000Z',
      }),
      trade({
        id: 's1',
        side: 'sell',
        quantity: '1',
        priceKrw: '50000000',
        tradedAt: '2027-03-01T00:00:00.000Z',
      }),
    ];

    const report = calculateTaxForYear(trades, 2027, {
      deemedCosts: [{ asset: 'BTC', priceKrw: '40000000' }],
    });
    // cost stepped up to 40M, gain = 10M
    expect(report.netIncomeKrw).toBe('10000000');
    expect(report.taxableIncomeKrw).toBe('7500000');
    expect(report.estimatedTaxKrw).toBe('1650000');
  });
});
