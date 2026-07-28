import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { CanonicalTrade, Exchange } from '../types/trade.js';
import type { DeemedCostSnapshot } from '../tax/engine.js';

let client: SupabaseClient | null = null;

/** Server-side Supabase client (service role). Never expose this key to the Flutter app. */
export function getSupabase(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required',
    );
  }

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export function getSupabaseConfig() {
  return {
    url: process.env.SUPABASE_URL ?? '',
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY ?? '',
  };
}

export type DbUser = {
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
};

export async function findUserByEmail(email: string): Promise<DbUser | null> {
  const { data, error } = await getSupabase()
    .from('cointax_users')
    .select('id, email, password_hash, created_at')
    .eq('email', email)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function createUser(user: {
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
}): Promise<void> {
  const { error } = await getSupabase().from('cointax_users').insert(user);
  if (error) throw new Error(error.message);
}

export async function loadUserTrades(userId: string): Promise<CanonicalTrade[]> {
  const { data, error } = await getSupabase()
    .from('cointax_trades')
    .select(
      'id, exchange, asset, side, quantity, price_krw, fee_krw, traded_at, raw_source',
    )
    .eq('user_id', userId)
    .order('traded_at', { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    id: r.id as string,
    exchange: r.exchange as Exchange,
    asset: r.asset as string,
    side: r.side as 'buy' | 'sell',
    quantity: r.quantity as string,
    priceKrw: r.price_krw as string,
    feeKrw: r.fee_krw as string,
    tradedAt: r.traded_at as string,
    rawSource: r.raw_source as 'api' | 'csv',
  }));
}

export async function upsertTrades(
  userId: string,
  trades: CanonicalTrade[],
): Promise<void> {
  if (trades.length === 0) return;

  const now = new Date().toISOString();
  const rows = trades.map((t) => ({
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
  }));

  // Upsert in chunks to avoid payload limits
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await getSupabase().from('cointax_trades').upsert(chunk, {
      onConflict: 'id',
    });
    if (error) throw new Error(error.message);
  }
}

export async function loadDeemedCosts(
  userId: string,
): Promise<DeemedCostSnapshot[]> {
  const { data, error } = await getSupabase()
    .from('cointax_deemed_costs')
    .select('asset, price_krw')
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    asset: r.asset as string,
    priceKrw: r.price_krw as string,
  }));
}

export async function saveDeemedCosts(
  userId: string,
  items: Array<{ asset: string; priceKrw: string }>,
): Promise<void> {
  const rows = items.map((item) => ({
    user_id: userId,
    asset: item.asset.toUpperCase(),
    price_krw: item.priceKrw,
  }));
  const { error } = await getSupabase()
    .from('cointax_deemed_costs')
    .upsert(rows, { onConflict: 'user_id,asset' });
  if (error) throw new Error(error.message);
}

export async function loadSyncStatus(
  userId: string,
): Promise<Array<{ exchange: string; last_synced_at: string }>> {
  const { data, error } = await getSupabase()
    .from('cointax_sync_status')
    .select('exchange, last_synced_at')
    .eq('user_id', userId)
    .order('last_synced_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ exchange: string; last_synced_at: string }>;
}

export async function touchSyncStatus(
  userId: string,
  exchange: Exchange,
  at: string,
): Promise<void> {
  const { error } = await getSupabase().from('cointax_sync_status').upsert(
    {
      user_id: userId,
      exchange,
      last_synced_at: at,
    },
    { onConflict: 'user_id,exchange' },
  );
  if (error) throw new Error(error.message);
}
