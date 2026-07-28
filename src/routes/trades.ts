import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { authHook } from '../lib/auth.js';
import { parseExchangeCsv } from '../parsers/csv.js';
import { EXCHANGES, type CanonicalTrade, type Exchange } from '../types/trade.js';
import { upsertTrades } from './connections.js';
import {
  calculateTaxForYear,
  type DeemedCostSnapshot,
} from '../tax/engine.js';

function usdtKrw(): number {
  return Number(process.env.DEFAULT_USDT_KRW ?? '1350');
}

function loadUserTrades(userId: string): CanonicalTrade[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, exchange, asset, side, quantity, price_krw, fee_krw, traded_at, raw_source
       FROM cointax_trades WHERE user_id = ? ORDER BY traded_at ASC`,
    )
    .all(userId) as Array<{
    id: string;
    exchange: Exchange;
    asset: string;
    side: 'buy' | 'sell';
    quantity: string;
    price_krw: string;
    fee_krw: string;
    traded_at: string;
    raw_source: 'api' | 'csv';
  }>;

  return rows.map((r) => ({
    id: r.id,
    exchange: r.exchange,
    asset: r.asset,
    side: r.side,
    quantity: r.quantity,
    priceKrw: r.price_krw,
    feeKrw: r.fee_krw,
    tradedAt: r.traded_at,
    rawSource: r.raw_source,
  }));
}

function loadDeemedCosts(userId: string): DeemedCostSnapshot[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT asset, price_krw FROM cointax_deemed_costs WHERE user_id = ?')
    .all(userId) as Array<{ asset: string; price_krw: string }>;
  return rows.map((r) => ({ asset: r.asset, priceKrw: r.price_krw }));
}

export async function tradeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authHook);

  app.get('/trades', async (request) => {
    const query = z
      .object({
        year: z.coerce.number().optional(),
        exchange: z.enum(EXCHANGES as [Exchange, ...Exchange[]]).optional(),
        asset: z.string().optional(),
      })
      .parse(request.query);

    let trades = loadUserTrades(request.user!.userId);
    if (query.year) {
      trades = trades.filter(
        (t) => new Date(t.tradedAt).getUTCFullYear() === query.year,
      );
    }
    if (query.exchange) {
      trades = trades.filter((t) => t.exchange === query.exchange);
    }
    if (query.asset) {
      trades = trades.filter(
        (t) => t.asset.toUpperCase() === query.asset!.toUpperCase(),
      );
    }
    return { trades, count: trades.length };
  });

  app.post('/uploads/csv', async (request, reply) => {
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
    upsertTrades(request.user!.userId, parsed.trades);

    return {
      imported: parsed.trades.length,
      errors: parsed.errors,
      exchange,
    };
  });

  app.get('/tax/:year', async (request) => {
    const year = z.coerce.number().parse((request.params as { year: string }).year);
    const trades = loadUserTrades(request.user!.userId);
    const deemedCosts = loadDeemedCosts(request.user!.userId);
    const report = calculateTaxForYear(trades, year, { deemedCosts });

    // Don't send full Decimal objects in realized — serialize
    return {
      disclaimer:
        '참고용 계산입니다. 세무 신고 전 국세청 안내 및 세무사 상담을 확인하세요.',
      report: {
        ...report,
        realized: report.realized.map((r) => ({
          id: r.trade.id,
          exchange: r.trade.exchange,
          asset: r.trade.asset,
          side: r.trade.side,
          quantity: r.trade.quantity,
          tradedAt: r.trade.tradedAt,
          proceedsKrw: r.proceedsKrw.toFixed(0),
          costBasisKrw: r.costBasisKrw.toFixed(0),
          feeKrw: r.feeKrw.toFixed(0),
          gainKrw: r.gainKrw.toFixed(0),
        })),
      },
    };
  });

  app.put('/deemed-costs', async (request) => {
    const body = z
      .object({
        items: z.array(
          z.object({
            asset: z.string().min(1),
            priceKrw: z.string().min(1),
          }),
        ),
      })
      .parse(request.body);

    const db = getDb();
    const upsert = db.prepare(`
      INSERT INTO cointax_deemed_costs (user_id, asset, price_krw)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, asset) DO UPDATE SET price_krw = excluded.price_krw
    `);
    const tx = db.transaction((items: { asset: string; priceKrw: string }[]) => {
      for (const item of items) {
        upsert.run(
          request.user!.userId,
          item.asset.toUpperCase(),
          item.priceKrw,
        );
      }
    });
    tx(body.items);
    return { saved: body.items.length };
  });

  app.get('/deemed-costs', async (request) => {
    return { items: loadDeemedCosts(request.user!.userId) };
  });

  app.get('/summary', async (request) => {
    const trades = loadUserTrades(request.user!.userId);
    const years = new Set(
      trades.map((t) => new Date(t.tradedAt).getUTCFullYear()),
    );
    const deemedCosts = loadDeemedCosts(request.user!.userId);
    const byYear = [...years]
      .sort()
      .map((year) => {
        const r = calculateTaxForYear(trades, year, { deemedCosts });
        return {
          year,
          netIncomeKrw: r.netIncomeKrw,
          estimatedTaxKrw: r.estimatedTaxKrw,
          taxableIncomeKrw: r.taxableIncomeKrw,
        };
      });

    return {
      tradeCount: trades.length,
      years: byYear,
      disclaimer:
        '참고용 계산입니다. 세무 신고 전 국세청 안내 및 세무사 상담을 확인하세요.',
    };
  });
}
