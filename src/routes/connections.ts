import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../db/index.js';
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

function usdtKrw(): number {
  return Number(process.env.DEFAULT_USDT_KRW ?? '1350');
}

function upsertTrades(userId: string, trades: CanonicalTrade[]) {
  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO cointax_trades (
      id, user_id, exchange, asset, side, quantity, price_krw, fee_krw, traded_at, raw_source, created_at
    ) VALUES (
      @id, @user_id, @exchange, @asset, @side, @quantity, @price_krw, @fee_krw, @traded_at, @raw_source, @created_at
    )
    ON CONFLICT(id) DO UPDATE SET
      quantity = excluded.quantity,
      price_krw = excluded.price_krw,
      fee_krw = excluded.fee_krw,
      traded_at = excluded.traded_at
  `);

  const now = new Date().toISOString();
  const tx = db.transaction((rows: CanonicalTrade[]) => {
    for (const t of rows) {
      insert.run({
        id: t.id,
        user_id: userId,
        exchange: t.exchange,
        asset: t.asset,
        side: t.side,
        quantity: t.quantity,
        price_krw: t.priceKrw,
        fee_krw: t.feeKrw,
        traded_at: t.tradedAt,
        raw_source: t.rawSource,
        created_at: now,
      });
    }
  });
  tx(trades);
}

function touchSyncStatus(userId: string, exchange: Exchange, at: string) {
  const db = getDb();
  db.prepare(`
    INSERT INTO cointax_sync_status (user_id, exchange, last_synced_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, exchange) DO UPDATE SET last_synced_at = excluded.last_synced_at
  `).run(userId, exchange, at);
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
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT exchange, last_synced_at
         FROM cointax_sync_status WHERE user_id = ? ORDER BY last_synced_at DESC`,
      )
      .all(request.user!.userId);
    return { status: rows };
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
      // Ensure we don't retain references longer than needed
      creds.accessKey = '';
      creds.secretKey = '';
      return reply.code(502).send({
        error: 'Exchange sync failed',
        detail: (e as Error).message,
      });
    }

    creds.accessKey = '';
    creds.secretKey = '';

    upsertTrades(request.user!.userId, trades);
    const now = new Date().toISOString();
    touchSyncStatus(request.user!.userId, body.exchange, now);

    return {
      imported: trades.length,
      exchange: body.exchange,
      last_synced_at: now,
      note: 'API keys were not stored on the server.',
    };
  });
}

export { upsertTrades };
