import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseExchangeCsv } from '../parsers/csv.js';
import { EXCHANGES, type Exchange } from '../types/trade.js';
import {
  fetchBinanceTrades,
  fetchBithumbTrades,
  fetchBybitTrades,
  fetchCoinoneTrades,
  fetchUpbitTrades,
} from '../exchanges/clients.js';
import type { CanonicalTrade } from '../types/trade.js';

function usdtKrw(): number {
  return Number(process.env.DEFAULT_USDT_KRW ?? '1350');
}

async function fetchTradesForExchange(
  exchange: Exchange,
  creds: { accessKey: string; secretKey: string },
  options: {
    symbol?: string;
    markets?: string[];
    maxPages?: number;
  },
): Promise<CanonicalTrade[]> {
  switch (exchange) {
    case 'upbit':
      return fetchUpbitTrades(creds, {
        markets: options.markets,
        maxPages: options.maxPages ?? 20,
      });
    case 'bithumb':
      return fetchBithumbTrades(
        creds,
        options.symbol?.replace(/KRW$/, '') ?? 'BTC',
      );
    case 'coinone':
      return fetchCoinoneTrades(creds, 'KRW', options.symbol ?? 'BTC');
    case 'binance':
      return fetchBinanceTrades(
        creds,
        options.symbol ?? 'BTCUSDT',
        usdtKrw(),
      );
    case 'bybit':
      return fetchBybitTrades(
        creds,
        options.symbol ?? 'BTCUSDT',
        usdtKrw(),
      );
  }
}

/**
 * Parse/sync without login. Trades are returned to the client only — not stored.
 */
export async function guestRoutes(app: FastifyInstance) {
  app.post('/guest/uploads/csv', async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.code(400).send({ error: 'Missing file' });

    const exchangeField = (data.fields as Record<string, { value?: string }>)
      ?.exchange?.value;
    const exchange = z
      .enum(EXCHANGES as [Exchange, ...Exchange[]])
      .parse(exchangeField);

    const buf = await data.toBuffer();
    const text = buf.toString('utf8');
    const parsed = parseExchangeCsv(exchange, text, usdtKrw());

    return {
      imported: parsed.trades.length,
      errors: parsed.errors,
      exchange,
      trades: parsed.trades,
      note: 'Parsed only — not stored on server.',
    };
  });

  app.post('/guest/exchanges/sync', async (request, reply) => {
    const body = z
      .object({
        exchange: z.enum(EXCHANGES as [Exchange, ...Exchange[]]),
        accessKey: z.string().min(1),
        secretKey: z.string().min(1),
        symbol: z.string().optional(),
        markets: z.array(z.string()).optional(),
        maxPages: z.number().int().positive().max(200).optional(),
      })
      .parse(request.body);

    const creds = {
      accessKey: body.accessKey,
      secretKey: body.secretKey,
    };

    let trades: CanonicalTrade[] = [];
    try {
      trades = await fetchTradesForExchange(body.exchange, creds, {
        symbol: body.symbol,
        markets: body.markets,
        maxPages: body.maxPages,
      });
    } catch (e) {
      creds.accessKey = '';
      creds.secretKey = '';
      return reply.code(502).send({
        error: 'Exchange sync failed',
        detail: (e as Error).message,
      });
    }

    creds.accessKey = '';
    creds.secretKey = '';

    const now = new Date().toISOString();
    return {
      imported: trades.length,
      exchange: body.exchange,
      last_synced_at: now,
      trades,
      note: 'API keys were not stored on the server.',
    };
  });
}
