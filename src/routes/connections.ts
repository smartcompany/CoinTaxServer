import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authHook } from '../lib/auth.js';
import { EXCHANGES, type Exchange } from '../types/trade.js';
import {
  fetchBinanceTrades,
  fetchBithumbTrades,
  fetchBybitTrades,
  fetchCoinoneTrades,
  fetchUpbitTrades,
} from '../exchanges/clients.js';
import type { CanonicalTrade } from '../types/trade.js';
import {
  loadSyncStatus,
  touchSyncStatus,
  upsertTrades,
} from '../db/supabase.js';

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
 * Ephemeral sync: API keys are accepted in the request body only,
 * used in-memory to fetch trades, then discarded. Never written to DB.
 */
export async function connectionRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authHook);

  app.get('/sync/status', async (request) => {
    const status = await loadSyncStatus(request.user!.userId);
    return { status };
  });

  app.post('/exchanges/sync', async (request, reply) => {
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

    await upsertTrades(request.user!.userId, trades);
    const now = new Date().toISOString();
    await touchSyncStatus(request.user!.userId, body.exchange, now);

    return {
      imported: trades.length,
      exchange: body.exchange,
      last_synced_at: now,
      note: 'API keys were not stored on the server.',
    };
  });
}

export { upsertTrades };
