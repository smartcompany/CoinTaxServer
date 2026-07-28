import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authHook } from '../lib/auth.js';
import { parseExchangeCsv } from '../parsers/csv.js';
import { EXCHANGES, type Exchange } from '../types/trade.js';
import {
  loadDeemedCosts,
  loadUserTrades,
  saveDeemedCosts,
  upsertTrades,
} from '../db/supabase.js';
import { calculateTaxForYear } from '../tax/engine.js';

function usdtKrw(): number {
  return Number(process.env.DEFAULT_USDT_KRW ?? '1350');
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

    let trades = await loadUserTrades(request.user!.userId);
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
    await upsertTrades(request.user!.userId, parsed.trades);

    return {
      imported: parsed.trades.length,
      errors: parsed.errors,
      exchange,
    };
  });

  app.get('/tax/:year', async (request) => {
    const year = z.coerce
      .number()
      .parse((request.params as { year: string }).year);
    const trades = await loadUserTrades(request.user!.userId);
    const deemedCosts = await loadDeemedCosts(request.user!.userId);
    const report = calculateTaxForYear(trades, year, { deemedCosts });

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

    await saveDeemedCosts(request.user!.userId, body.items);
    return { saved: body.items.length };
  });

  app.get('/deemed-costs', async (request) => {
    return { items: await loadDeemedCosts(request.user!.userId) };
  });

  app.get('/summary', async (request) => {
    const trades = await loadUserTrades(request.user!.userId);
    const years = new Set(
      trades.map((t) => new Date(t.tradedAt).getUTCFullYear()),
    );
    const deemedCosts = await loadDeemedCosts(request.user!.userId);
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
