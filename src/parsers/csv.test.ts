import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  parseBinanceCsv,
  parseBithumbCsv,
  parseBybitCsv,
  parseCoinoneCsv,
  parseUpbitCsv,
} from './csv.js';

const dir = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  readFileSync(join(dir, 'fixtures', name), 'utf8');

describe('csv parsers', () => {
  it('parses upbit fixture', () => {
    const { trades, errors } = parseUpbitCsv(fixture('upbit.csv'));
    expect(errors).toEqual([]);
    expect(trades).toHaveLength(4);
    expect(trades[0].asset).toBe('BTC');
    expect(trades[0].side).toBe('buy');
    expect(trades[0].exchange).toBe('upbit');
  });

  it('parses bithumb fixture', () => {
    const { trades, errors } = parseBithumbCsv(fixture('bithumb.csv'));
    expect(errors).toEqual([]);
    expect(trades).toHaveLength(2);
    expect(trades[0].asset).toBe('BTC');
  });

  it('parses coinone fixture', () => {
    const { trades, errors } = parseCoinoneCsv(fixture('coinone.csv'));
    expect(errors).toEqual([]);
    expect(trades[0].asset).toBe('XRP');
  });

  it('parses binance with USDT→KRW', () => {
    const { trades, errors } = parseBinanceCsv(fixture('binance.csv'), 1350);
    expect(errors).toEqual([]);
    expect(trades).toHaveLength(2);
    expect(Number(trades[0].priceKrw)).toBe(60000 * 1350);
  });

  it('parses bybit with USDT→KRW', () => {
    const { trades, errors } = parseBybitCsv(fixture('bybit.csv'), 1350);
    expect(errors).toEqual([]);
    expect(trades[0].asset).toBe('ETH');
    expect(Number(trades[0].priceKrw)).toBe(2500 * 1350);
  });
});
