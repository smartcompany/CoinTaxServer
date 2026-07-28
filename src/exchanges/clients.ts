import { createHmac, createHash, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { CanonicalTrade } from '../types/trade.js';

export type ExchangeCredentials = {
  accessKey: string;
  secretKey: string;
};

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/** Upbit JWT for query-authenticated GET */
function upbitAuthHeader(
  accessKey: string,
  secretKey: string,
  query?: string,
): string {
  const payload: Record<string, string> = {
    access_key: accessKey,
    nonce: randomUUID(),
  };
  if (query) {
    const hash = createHash('sha512').update(query, 'utf8').digest('hex');
    payload.query_hash = hash;
    payload.query_hash_alg = 'SHA512';
  }
  const token = jwt.sign(payload, secretKey);
  return `Bearer ${token}`;
}

type UpbitOrder = {
  uuid: string;
  side: 'bid' | 'ask';
  market: string;
  created_at: string;
  executed_volume: string;
  paid_fee: string;
  avg_price?: string;
  price?: string;
  state: string;
};

export async function fetchUpbitTrades(
  creds: ExchangeCredentials,
  options?: { markets?: string[]; maxPages?: number },
): Promise<CanonicalTrade[]> {
  const markets =
    options?.markets ??
    (await fetchUpbitKrwMarkets());
  const maxPages = options?.maxPages ?? 50;
  const trades: CanonicalTrade[] = [];

  for (const market of markets) {
    for (let page = 1; page <= maxPages; page++) {
      const params = new URLSearchParams({
        market,
        state: 'done',
        page: String(page),
        limit: '100',
        order_by: 'desc',
      });
      const query = params.toString();
      const res = await fetch(`https://api.upbit.com/v1/orders?${query}`, {
        headers: {
          Authorization: upbitAuthHeader(creds.accessKey, creds.secretKey, query),
        },
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Upbit API ${res.status}: ${body}`);
      }
      const orders = (await res.json()) as UpbitOrder[];
      if (!Array.isArray(orders) || orders.length === 0) break;

      for (const o of orders) {
        const qty = o.executed_volume;
        if (!qty || Number(qty) === 0) continue;
        const price = o.avg_price || o.price || '0';
        const asset = market.includes('-') ? market.split('-')[1] : market;
        trades.push({
          id: `upbit:${o.uuid}`,
          exchange: 'upbit',
          asset,
          side: o.side === 'bid' ? 'buy' : 'sell',
          quantity: qty,
          priceKrw: price,
          feeKrw: o.paid_fee || '0',
          tradedAt: new Date(o.created_at).toISOString(),
          rawSource: 'api',
        });
      }
      await sleep(120);
      if (orders.length < 100) break;
    }
  }

  return trades;
}

async function fetchUpbitKrwMarkets(): Promise<string[]> {
  const res = await fetch('https://api.upbit.com/v1/market/all?isDetails=false');
  if (!res.ok) return ['KRW-BTC', 'KRW-ETH'];
  const markets = (await res.json()) as { market: string }[];
  return markets.map((m) => m.market).filter((m) => m.startsWith('KRW-'));
}

/** Bithumb — completed orders for a currency pair */
export async function fetchBithumbTrades(
  creds: ExchangeCredentials,
  orderCurrency = 'BTC',
  paymentCurrency = 'KRW',
): Promise<CanonicalTrade[]> {
  const endpoint = '/info/order_detail';
  // Bithumb v1.2 uses JWT similar to Upbit for some endpoints;
  // fallback path uses classic API sign for /info/user_transactions
  const path = '/info/user_transactions';
  const nonce = Date.now().toString();
  const params: Record<string, string> = {
    order_currency: orderCurrency,
    payment_currency: paymentCurrency,
    count: '50',
    searchGb: '0',
  };
  const query = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  const signPayload = `${path}${String.fromCharCode(0)}${query}${String.fromCharCode(0)}${nonce}`;
  const signature = createHmac('sha512', creds.secretKey)
    .update(signPayload)
    .digest('base64');

  const body = new URLSearchParams(params);
  const res = await fetch(`https://api.bithumb.com${path}`, {
    method: 'POST',
    headers: {
      'Api-Key': creds.accessKey,
      'Api-Sign': signature,
      'Api-Nonce': nonce,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bithumb API ${res.status}: ${text}`);
  }

  const json = (await res.json()) as {
    status: string;
    data?: Array<{
      search: string;
      transfer_date: string;
      units: string;
      price: string;
      fee: string;
      order_currency: string;
    }>;
    message?: string;
  };

  if (json.status !== '0000' || !json.data) {
    throw new Error(`Bithumb error: ${json.message ?? json.status}`);
  }

  void endpoint;
  return json.data
    .filter((t) => t.search === '1' || t.search === '2')
    .map((t, i) => ({
      id: `bithumb:${t.transfer_date}-${i}`,
      exchange: 'bithumb' as const,
      asset: (t.order_currency || orderCurrency).toUpperCase(),
      side: t.search === '2' ? ('buy' as const) : ('sell' as const),
      quantity: t.units.replace(/^\+|^-/, ''),
      priceKrw: t.price,
      feeKrw: t.fee || '0',
      tradedAt: new Date(Number(t.transfer_date)).toISOString(),
      rawSource: 'api' as const,
    }));
}

/** Coinone complete orders */
export async function fetchCoinoneTrades(
  creds: ExchangeCredentials,
  quoteCurrency = 'KRW',
  targetCurrency = 'BTC',
): Promise<CanonicalTrade[]> {
  const body = {
    access_token: creds.accessKey,
    nonce: Date.now(),
    quote_currency: quoteCurrency,
    target_currency: targetCurrency,
    size: 100,
  };
  const payload = Buffer.from(JSON.stringify(body)).toString('base64');
  const signature = createHmac('sha512', creds.secretKey)
    .update(payload)
    .digest('hex');

  const res = await fetch('https://api.coinone.co.kr/v2/order/complete_orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-COINONE-PAYLOAD': payload,
      'X-COINONE-SIGNATURE': signature,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Coinone API ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as {
    result?: string;
    errorCode?: string;
    completeOrders?: Array<{
      orderId: string;
      type: string;
      price: string;
      qty: string;
      fee: string;
      timestamp: number;
      remainQty?: string;
    }>;
  };

  if (json.result !== 'success' || !json.completeOrders) {
    throw new Error(`Coinone error: ${json.errorCode ?? 'unknown'}`);
  }

  return json.completeOrders.map((o) => ({
    id: `coinone:${o.orderId}`,
    exchange: 'coinone' as const,
    asset: targetCurrency.toUpperCase(),
    side: o.type.toLowerCase().includes('buy') ? ('buy' as const) : ('sell' as const),
    quantity: o.qty,
    priceKrw: o.price,
    feeKrw: o.fee || '0',
    tradedAt: new Date(o.timestamp).toISOString(),
    rawSource: 'api' as const,
  }));
}

function binanceSign(query: string, secret: string): string {
  return createHmac('sha256', secret).update(query).digest('hex');
}

export async function fetchBinanceTrades(
  creds: ExchangeCredentials,
  symbol = 'BTCUSDT',
  usdtKrw: number,
): Promise<CanonicalTrade[]> {
  const timestamp = Date.now();
  const query = `symbol=${symbol}&limit=1000&timestamp=${timestamp}`;
  const signature = binanceSign(query, creds.secretKey);
  const res = await fetch(
    `https://api.binance.com/api/v3/myTrades?${query}&signature=${signature}`,
    { headers: { 'X-MBX-APIKEY': creds.accessKey } },
  );
  if (!res.ok) {
    throw new Error(`Binance API ${res.status}: ${await res.text()}`);
  }
  const rows = (await res.json()) as Array<{
    id: number;
    orderId: number;
    price: string;
    qty: string;
    commission: string;
    commissionAsset: string;
    time: number;
    isBuyer: boolean;
  }>;

  const asset = symbol.replace(/USDT$|BUSD$|USDC$/, '');
  return rows.map((t) => {
    const feeNum = Number(t.commission) || 0;
    let feeKrw = feeNum * usdtKrw;
    if (t.commissionAsset === asset) {
      feeKrw = feeNum * Number(t.price) * usdtKrw;
    }
    return {
      id: `binance:${t.id}`,
      exchange: 'binance' as const,
      asset,
      side: t.isBuyer ? ('buy' as const) : ('sell' as const),
      quantity: t.qty,
      priceKrw: String(Number(t.price) * usdtKrw),
      feeKrw: String(feeKrw),
      tradedAt: new Date(t.time).toISOString(),
      rawSource: 'api' as const,
    };
  });
}

export async function fetchBybitTrades(
  creds: ExchangeCredentials,
  symbol = 'BTCUSDT',
  usdtKrw: number,
): Promise<CanonicalTrade[]> {
  const timestamp = Date.now().toString();
  const query = `category=spot&symbol=${symbol}&limit=100`;
  const preSign = `${timestamp}${creds.accessKey}5000${query}`;
  const sign = createHmac('sha256', creds.secretKey).update(preSign).digest('hex');

  const res = await fetch(`https://api.bybit.com/v5/execution/list?${query}`, {
    headers: {
      'X-BAPI-API-KEY': creds.accessKey,
      'X-BAPI-SIGN': sign,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': '5000',
    },
  });

  if (!res.ok) {
    throw new Error(`Bybit API ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as {
    retCode: number;
    retMsg: string;
    result?: {
      list?: Array<{
        execId: string;
        symbol: string;
        side: string;
        execPrice: string;
        execQty: string;
        execFee: string;
        execTime: string;
      }>;
    };
  };

  if (json.retCode !== 0) {
    throw new Error(`Bybit error: ${json.retMsg}`);
  }

  const asset = symbol.replace(/USDT$/, '');
  return (json.result?.list ?? []).map((t) => ({
    id: `bybit:${t.execId}`,
    exchange: 'bybit' as const,
    asset,
    side: t.side.toLowerCase() === 'buy' ? ('buy' as const) : ('sell' as const),
    quantity: t.execQty,
    priceKrw: String(Number(t.execPrice) * usdtKrw),
    feeKrw: String(Number(t.execFee || 0) * usdtKrw),
    tradedAt: new Date(Number(t.execTime)).toISOString(),
    rawSource: 'api' as const,
  }));
}
