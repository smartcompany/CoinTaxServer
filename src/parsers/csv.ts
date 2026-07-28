import Papa from 'papaparse';
import type { CanonicalTrade, Exchange, RawSource } from '../types/trade.js';

export type ParseResult = {
  trades: CanonicalTrade[];
  errors: string[];
};

function normalizeHeader(h: string): string {
  return h.replace(/^\uFEFF/, '').trim().toLowerCase();
}

function rowMap(headers: string[], row: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((h, i) => {
    out[normalizeHeader(h)] = (row[i] ?? '').trim();
  });
  return out;
}

function parseCsvRows(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const result = Papa.parse<string[]>(text, {
    skipEmptyLines: true,
  });
  const data = result.data.filter((r) => r.some((c) => c.trim() !== ''));
  if (data.length === 0) return { headers: [], rows: [] };
  const headers = data[0].map((h) => h.replace(/^\uFEFF/, '').trim());
  const rows = data.slice(1).map((r) => rowMap(headers, r));
  return { headers, rows };
}

function pick(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    const v = row[normalizeHeader(k)];
    if (v !== undefined && v !== '') return v;
  }
  return '';
}

function toIso(raw: string): string {
  const cleaned = raw.replace(/\//g, '-').replace(' ', 'T');
  const d = new Date(cleaned.includes('T') ? cleaned : cleaned.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) {
    // try YYYY-MM-DD HH:mm:ss KST without Z
    const m = raw.match(
      /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/,
    );
    if (m) {
      const iso = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}T${m[4].padStart(2, '0')}:${m[5]}:${(m[6] ?? '00').padStart(2, '0')}+09:00`;
      return new Date(iso).toISOString();
    }
    throw new Error(`Invalid date: ${raw}`);
  }
  return d.toISOString();
}

function parseSide(raw: string): 'buy' | 'sell' | null {
  const s = raw.trim().toLowerCase();
  if (['buy', 'bid', '매수', 'b'].includes(s)) return 'buy';
  if (['sell', 'ask', '매도', 's'].includes(s)) return 'sell';
  return null;
}

function assetFromMarket(market: string): string {
  // KRW-BTC, BTC/KRW, BTCUSDT, BTC-USDT
  const m = market.toUpperCase().replace('/', '-');
  if (m.includes('-')) {
    const [a, b] = m.split('-');
    if (a === 'KRW' || a === 'USDT' || a === 'BTC' || a === 'USD') return b;
    return a;
  }
  if (m.endsWith('USDT')) return m.slice(0, -4);
  if (m.endsWith('KRW')) return m.slice(0, -3);
  if (m.endsWith('BUSD')) return m.slice(0, -4);
  return m;
}

function makeId(exchange: Exchange, nativeId: string, fallback: string): string {
  return `${exchange}:${nativeId || fallback}`;
}

export function parseUpbitCsv(text: string, source: RawSource = 'csv'): ParseResult {
  const { rows } = parseCsvRows(text);
  const trades: CanonicalTrade[] = [];
  const errors: string[] = [];

  rows.forEach((row, i) => {
    try {
      const market = pick(row, ['마켓', 'market', '거래쌍', 'currency pair']);
      const sideRaw = pick(row, ['종류', 'side', '매수/매도', 'type']);
      const side = parseSide(sideRaw);
      if (!side) throw new Error(`Unknown side: ${sideRaw}`);
      const qty = pick(row, ['거래수량', 'volume', '수량', 'executed_volume']);
      const price = pick(row, ['거래단가', 'price', '체결가격', '평균체결가']);
      const fee = pick(row, ['수수료', 'paid_fee', 'fee']) || '0';
      const at = pick(row, ['체결시간', 'created_at', '주문시간', '시간', 'date']);
      const nativeId = pick(row, ['uuid', '주문번호', 'id', '거래번호']) || `row-${i}`;
      const asset = pick(row, ['화폐', 'asset', '코인']) || assetFromMarket(market);

      trades.push({
        id: makeId('upbit', nativeId, `${at}-${i}`),
        exchange: 'upbit',
        asset: asset.toUpperCase().replace(/KRW$/, '').replace(/^KRW-/, ''),
        side,
        quantity: qty.replace(/,/g, ''),
        priceKrw: price.replace(/,/g, ''),
        feeKrw: fee.replace(/,/g, ''),
        tradedAt: toIso(at),
        rawSource: source,
      });
    } catch (e) {
      errors.push(`upbit row ${i + 1}: ${(e as Error).message}`);
    }
  });

  return { trades, errors };
}

export function parseBithumbCsv(text: string, source: RawSource = 'csv'): ParseResult {
  const { rows } = parseCsvRows(text);
  const trades: CanonicalTrade[] = [];
  const errors: string[] = [];

  rows.forEach((row, i) => {
    try {
      const asset =
        pick(row, ['주문통화', 'order_currency', '코인', 'asset', 'currency']) ||
        assetFromMarket(pick(row, ['마켓', 'market']));
      const side = parseSide(pick(row, ['유형', 'type', '구분', 'side', '매수/매도']));
      if (!side) throw new Error('Unknown side');
      const qty = pick(row, ['체결수량', 'units', '수량', 'volume']).replace(/,/g, '');
      const price = pick(row, ['체결가격', 'price', '단가']).replace(/,/g, '');
      const fee = (pick(row, ['수수료', 'fee', 'paid_fee']) || '0').replace(/,/g, '');
      const at = pick(row, ['체결시간', 'order_date', '거래일시', '날짜', 'date']);
      const nativeId = pick(row, ['주문번호', 'order_id', 'id']) || `row-${i}`;

      trades.push({
        id: makeId('bithumb', nativeId, `${at}-${i}`),
        exchange: 'bithumb',
        asset: asset.toUpperCase(),
        side,
        quantity: qty,
        priceKrw: price,
        feeKrw: fee,
        tradedAt: toIso(at),
        rawSource: source,
      });
    } catch (e) {
      errors.push(`bithumb row ${i + 1}: ${(e as Error).message}`);
    }
  });

  return { trades, errors };
}

export function parseCoinoneCsv(text: string, source: RawSource = 'csv'): ParseResult {
  const { rows } = parseCsvRows(text);
  const trades: CanonicalTrade[] = [];
  const errors: string[] = [];

  rows.forEach((row, i) => {
    try {
      const asset = pick(row, ['currency', '코인', 'asset', '대상통화', 'target_currency']).toUpperCase();
      const side = parseSide(pick(row, ['type', '종류', 'side', '매수/매도']));
      if (!side) throw new Error('Unknown side');
      const qty = pick(row, ['qty', 'quantity', '수량', 'filled_qty']).replace(/,/g, '');
      const price = pick(row, ['price', '단가', '체결가']).replace(/,/g, '');
      const fee = (pick(row, ['fee', '수수료']) || '0').replace(/,/g, '');
      const at = pick(row, ['timestamp', '체결시간', '시간', 'date', 'created_at']);
      const nativeId = pick(row, ['order_id', 'id', 'trade_id']) || `row-${i}`;

      trades.push({
        id: makeId('coinone', nativeId, `${at}-${i}`),
        exchange: 'coinone',
        asset,
        side,
        quantity: qty,
        priceKrw: price,
        feeKrw: fee,
        tradedAt: toIso(at),
        rawSource: source,
      });
    } catch (e) {
      errors.push(`coinone row ${i + 1}: ${(e as Error).message}`);
    }
  });

  return { trades, errors };
}

export function parseBinanceCsv(
  text: string,
  usdtKrw: number,
  source: RawSource = 'csv',
): ParseResult {
  const { rows } = parseCsvRows(text);
  const trades: CanonicalTrade[] = [];
  const errors: string[] = [];

  rows.forEach((row, i) => {
    try {
      const pair = pick(row, ['pair', 'symbol', 'market', '마켓']);
      const asset = assetFromMarket(pair || pick(row, ['base', 'asset', 'coin']));
      const side = parseSide(pick(row, ['side', 'type', '매수/매도']));
      if (!side) throw new Error('Unknown side');
      const qty = pick(row, ['executed', 'amount', 'qty', 'quantity']).replace(/,/g, '');
      const priceUsdt = pick(row, ['price', 'avg price', 'average price']).replace(/,/g, '');
      const feeRaw = pick(row, ['fee', 'commission']) || '0';
      const feeCoin = pick(row, ['fee coin', 'commission asset']) || 'USDT';
      const at = pick(row, ['date(utc)', 'time', 'date', 'timestamp']);
      const nativeId = pick(row, ['order no', 'order id', 'trade id', 'id']) || `row-${i}`;

      const priceKrw = (Number(priceUsdt) * usdtKrw).toString();
      let feeKrw = '0';
      const feeNum = Number(feeRaw.replace(/,/g, '')) || 0;
      if (feeCoin.toUpperCase() === 'USDT' || feeCoin.toUpperCase() === 'BUSD') {
        feeKrw = (feeNum * usdtKrw).toString();
      } else if (feeCoin.toUpperCase() === asset.toUpperCase()) {
        feeKrw = (feeNum * Number(priceUsdt) * usdtKrw).toString();
      } else {
        feeKrw = (feeNum * usdtKrw).toString();
      }

      trades.push({
        id: makeId('binance', nativeId, `${at}-${i}`),
        exchange: 'binance',
        asset: asset.toUpperCase(),
        side,
        quantity: qty,
        priceKrw,
        feeKrw,
        tradedAt: toIso(at),
        rawSource: source,
      });
    } catch (e) {
      errors.push(`binance row ${i + 1}: ${(e as Error).message}`);
    }
  });

  return { trades, errors };
}

export function parseBybitCsv(
  text: string,
  usdtKrw: number,
  source: RawSource = 'csv',
): ParseResult {
  const { rows } = parseCsvRows(text);
  const trades: CanonicalTrade[] = [];
  const errors: string[] = [];

  rows.forEach((row, i) => {
    try {
      const pair = pick(row, ['symbol', 'pair', 'contracts', 'market']);
      const asset = assetFromMarket(pair || pick(row, ['base coin', 'coin', 'asset']));
      const side = parseSide(pick(row, ['side', 'direction', 'type']));
      if (!side) throw new Error('Unknown side');
      const qty = pick(row, ['filled', 'qty', 'quantity', 'size', 'exec qty']).replace(/,/g, '');
      const priceUsdt = pick(row, ['filled price', 'price', 'exec price', 'avg price']).replace(
        /,/g,
        '',
      );
      const feeNum = Number((pick(row, ['fee rate', 'fee', 'trading fee']) || '0').replace(/,/g, '')) || 0;
      const at = pick(row, ['time', 'timestamp', 'date', 'created time', 'trade time']);
      const nativeId = pick(row, ['order no.', 'order id', 'trade id', 'exec id', 'id']) || `row-${i}`;

      trades.push({
        id: makeId('bybit', nativeId, `${at}-${i}`),
        exchange: 'bybit',
        asset: asset.toUpperCase(),
        side,
        quantity: qty,
        priceKrw: (Number(priceUsdt) * usdtKrw).toString(),
        feeKrw: (feeNum * usdtKrw).toString(),
        tradedAt: toIso(at),
        rawSource: source,
      });
    } catch (e) {
      errors.push(`bybit row ${i + 1}: ${(e as Error).message}`);
    }
  });

  return { trades, errors };
}

export function parseExchangeCsv(
  exchange: Exchange,
  text: string,
  usdtKrw: number,
): ParseResult {
  switch (exchange) {
    case 'upbit':
      return parseUpbitCsv(text);
    case 'bithumb':
      return parseBithumbCsv(text);
    case 'coinone':
      return parseCoinoneCsv(text);
    case 'binance':
      return parseBinanceCsv(text, usdtKrw);
    case 'bybit':
      return parseBybitCsv(text, usdtKrw);
    default:
      return { trades: [], errors: [`Unsupported exchange: ${exchange}`] };
  }
}
