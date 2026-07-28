export type Exchange =
  | 'upbit'
  | 'bithumb'
  | 'coinone'
  | 'binance'
  | 'bybit';

export type TradeSide = 'buy' | 'sell';
export type RawSource = 'api' | 'csv';

export type CanonicalTrade = {
  id: string;
  exchange: Exchange;
  asset: string;
  side: TradeSide;
  quantity: string;
  priceKrw: string;
  feeKrw: string;
  tradedAt: string;
  rawSource: RawSource;
};

export const EXCHANGES: Exchange[] = [
  'upbit',
  'bithumb',
  'coinone',
  'binance',
  'bybit',
];

export const BASIC_DEDUCTION_KRW = 2_500_000;
export const TAX_RATE = 0.22;
