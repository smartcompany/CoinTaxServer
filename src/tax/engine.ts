import { Decimal } from 'decimal.js';
import {
  BASIC_DEDUCTION_KRW,
  TAX_RATE,
  type CanonicalTrade,
} from '../types/trade.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type AssetPosition = {
  quantity: Decimal;
  avgCostKrw: Decimal;
};

export type RealizedTrade = {
  trade: CanonicalTrade;
  proceedsKrw: Decimal;
  costBasisKrw: Decimal;
  feeKrw: Decimal;
  gainKrw: Decimal;
  year: number;
};

export type AssetYearSummary = {
  asset: string;
  gainsKrw: string;
  lossesKrw: string;
  netKrw: string;
  sellCount: number;
};

export type ExchangeYearSummary = {
  exchange: string;
  netKrw: string;
  sellCount: number;
};

export type YearTaxReport = {
  year: number;
  totalGainsKrw: string;
  totalLossesKrw: string;
  netIncomeKrw: string;
  basicDeductionKrw: string;
  taxableIncomeKrw: string;
  estimatedTaxKrw: string;
  byAsset: AssetYearSummary[];
  byExchange: ExchangeYearSummary[];
  realized: RealizedTrade[];
};

export type DeemedCostSnapshot = {
  asset: string;
  /** KRW unit price as of 2026-12-31 */
  priceKrw: string;
};

function yearOf(iso: string): number {
  return new Date(iso).getUTCFullYear();
}

/**
 * Apply deemed acquisition cost step-up at 2026-12-31.
 * For holdings carried into 2027, cost basis becomes max(actual avg, FMV).
 */
export function applyDeemedAcquisitionCost(
  positions: Map<string, AssetPosition>,
  snapshots: DeemedCostSnapshot[],
): Map<string, AssetPosition> {
  const next = new Map<string, AssetPosition>();
  for (const [asset, pos] of positions) {
    next.set(asset, { ...pos });
  }

  for (const snap of snapshots) {
    const pos = next.get(snap.asset);
    if (!pos || pos.quantity.lte(0)) continue;
    const fmv = new Decimal(snap.priceKrw);
    if (fmv.gt(pos.avgCostKrw)) {
      next.set(snap.asset, {
        quantity: pos.quantity,
        avgCostKrw: fmv,
      });
    }
  }
  return next;
}

/**
 * Process trades chronologically with moving-average (총평균법) cost basis.
 * Sells before 2027 are tracked for basis but excluded from taxable years
 * when filtering reports — callers pass all trades for correct basis.
 */
export function realizeTrades(
  trades: CanonicalTrade[],
  options?: {
    deemedCosts?: DeemedCostSnapshot[];
    applyDeemedAt?: string;
  },
): { realized: RealizedTrade[]; positions: Map<string, AssetPosition> } {
  const sorted = [...trades].sort(
    (a, b) =>
      new Date(a.tradedAt).getTime() - new Date(b.tradedAt).getTime() ||
      a.id.localeCompare(b.id),
  );

  const positions = new Map<string, AssetPosition>();
  const realized: RealizedTrade[] = [];
  const deemedAt = options?.applyDeemedAt ?? '2026-12-31T23:59:59.999Z';
  let deemedApplied = false;

  for (const trade of sorted) {
    if (
      !deemedApplied &&
      options?.deemedCosts?.length &&
      new Date(trade.tradedAt).getTime() > new Date(deemedAt).getTime()
    ) {
      const updated = applyDeemedAcquisitionCost(
        positions,
        options.deemedCosts,
      );
      positions.clear();
      for (const [k, v] of updated) positions.set(k, v);
      deemedApplied = true;
    }

    const qty = new Decimal(trade.quantity);
    const price = new Decimal(trade.priceKrw);
    const fee = new Decimal(trade.feeKrw || '0');
    const pos = positions.get(trade.asset) ?? {
      quantity: new Decimal(0),
      avgCostKrw: new Decimal(0),
    };

    if (trade.side === 'buy') {
      const cost = qty.mul(price).plus(fee);
      const newQty = pos.quantity.plus(qty);
      const newAvg =
        newQty.eq(0)
          ? new Decimal(0)
          : pos.quantity
              .mul(pos.avgCostKrw)
              .plus(cost)
              .div(newQty);
      positions.set(trade.asset, { quantity: newQty, avgCostKrw: newAvg });
      continue;
    }

    // sell
    const sellQty = Decimal.min(qty, pos.quantity);
    if (sellQty.lte(0)) {
      // short / missing basis — treat cost as 0 with remaining qty as sell
      const proceeds = qty.mul(price);
      const gain = proceeds.minus(fee);
      realized.push({
        trade,
        proceedsKrw: proceeds,
        costBasisKrw: new Decimal(0),
        feeKrw: fee,
        gainKrw: gain,
        year: yearOf(trade.tradedAt),
      });
      continue;
    }

    const costBasis = sellQty.mul(pos.avgCostKrw);
    const proceeds = sellQty.mul(price);
    // Fee allocated to this disposal
    const gain = proceeds.minus(costBasis).minus(fee);
    const remaining = pos.quantity.minus(sellQty);

    positions.set(trade.asset, {
      quantity: remaining,
      avgCostKrw: remaining.lte(0) ? new Decimal(0) : pos.avgCostKrw,
    });

    realized.push({
      trade,
      proceedsKrw: proceeds,
      costBasisKrw: costBasis,
      feeKrw: fee,
      gainKrw: gain,
      year: yearOf(trade.tradedAt),
    });
  }

  if (!deemedApplied && options?.deemedCosts?.length) {
    const updated = applyDeemedAcquisitionCost(positions, options.deemedCosts);
    positions.clear();
    for (const [k, v] of updated) positions.set(k, v);
  }

  return { realized, positions };
}

export function buildYearTaxReport(
  realized: RealizedTrade[],
  year: number,
): YearTaxReport {
  const yearTrades = realized.filter((r) => r.year === year);

  let totalGains = new Decimal(0);
  let totalLosses = new Decimal(0);

  const assetMap = new Map<
    string,
    { gains: Decimal; losses: Decimal; sellCount: number }
  >();
  const exchangeMap = new Map<
    string,
    { net: Decimal; sellCount: number }
  >();

  for (const r of yearTrades) {
    if (r.gainKrw.gte(0)) totalGains = totalGains.plus(r.gainKrw);
    else totalLosses = totalLosses.plus(r.gainKrw.abs());

    const a = assetMap.get(r.trade.asset) ?? {
      gains: new Decimal(0),
      losses: new Decimal(0),
      sellCount: 0,
    };
    if (r.gainKrw.gte(0)) a.gains = a.gains.plus(r.gainKrw);
    else a.losses = a.losses.plus(r.gainKrw.abs());
    a.sellCount += 1;
    assetMap.set(r.trade.asset, a);

    const e = exchangeMap.get(r.trade.exchange) ?? {
      net: new Decimal(0),
      sellCount: 0,
    };
    e.net = e.net.plus(r.gainKrw);
    e.sellCount += 1;
    exchangeMap.set(r.trade.exchange, e);
  }

  const netIncome = totalGains.minus(totalLosses);
  const deduction = new Decimal(BASIC_DEDUCTION_KRW);
  const taxable = Decimal.max(0, netIncome.minus(deduction));
  const tax = taxable.mul(TAX_RATE).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);

  return {
    year,
    totalGainsKrw: totalGains.toFixed(0),
    totalLossesKrw: totalLosses.toFixed(0),
    netIncomeKrw: netIncome.toFixed(0),
    basicDeductionKrw: deduction.toFixed(0),
    taxableIncomeKrw: taxable.toFixed(0),
    estimatedTaxKrw: tax.toFixed(0),
    byAsset: [...assetMap.entries()].map(([asset, v]) => ({
      asset,
      gainsKrw: v.gains.toFixed(0),
      lossesKrw: v.losses.toFixed(0),
      netKrw: v.gains.minus(v.losses).toFixed(0),
      sellCount: v.sellCount,
    })),
    byExchange: [...exchangeMap.entries()].map(([exchange, v]) => ({
      exchange,
      netKrw: v.net.toFixed(0),
      sellCount: v.sellCount,
    })),
    realized: yearTrades,
  };
}

export function calculateTaxForYear(
  trades: CanonicalTrade[],
  year: number,
  options?: {
    deemedCosts?: DeemedCostSnapshot[];
  },
): YearTaxReport {
  const { realized } = realizeTrades(trades, options);
  return buildYearTaxReport(realized, year);
}
