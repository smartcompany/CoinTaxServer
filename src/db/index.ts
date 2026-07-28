import Database, { type Database as SqliteDatabase } from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DbUser = {
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
};

export type DbTrade = {
  id: string;
  user_id: string;
  exchange: string;
  asset: string;
  side: string;
  quantity: string;
  price_krw: string;
  fee_krw: string;
  traded_at: string;
  raw_source: string;
  created_at: string;
};

export type DbDeemedCost = {
  user_id: string;
  asset: string;
  price_krw: string;
};

export type DbFxRate = {
  date: string;
  pair: string;
  rate: string;
};

let db: SqliteDatabase | null = null;

export function getDb(path = process.env.DATABASE_PATH ?? './data/cointax.db'): SqliteDatabase {
  if (db) return db;
  mkdirSync(dirname(path), { recursive: true });
  db = new Database(path);
  db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}

export function migrate(database: SqliteDatabase) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS cointax_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cointax_sync_status (
      user_id TEXT NOT NULL REFERENCES cointax_users(id) ON DELETE CASCADE,
      exchange TEXT NOT NULL,
      last_synced_at TEXT NOT NULL,
      PRIMARY KEY (user_id, exchange)
    );

    CREATE TABLE IF NOT EXISTS cointax_trades (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES cointax_users(id) ON DELETE CASCADE,
      exchange TEXT NOT NULL,
      asset TEXT NOT NULL,
      side TEXT NOT NULL,
      quantity TEXT NOT NULL,
      price_krw TEXT NOT NULL,
      fee_krw TEXT NOT NULL,
      traded_at TEXT NOT NULL,
      raw_source TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cointax_trades_user_year
      ON cointax_trades(user_id, traded_at);
    CREATE INDEX IF NOT EXISTS idx_cointax_trades_user_asset
      ON cointax_trades(user_id, asset);

    CREATE TABLE IF NOT EXISTS cointax_deemed_costs (
      user_id TEXT NOT NULL REFERENCES cointax_users(id) ON DELETE CASCADE,
      asset TEXT NOT NULL,
      price_krw TEXT NOT NULL,
      PRIMARY KEY (user_id, asset)
    );

    CREATE TABLE IF NOT EXISTS cointax_fx_rates (
      date TEXT NOT NULL,
      pair TEXT NOT NULL,
      rate TEXT NOT NULL,
      PRIMARY KEY (date, pair)
    );
  `);
}

export function resetDbForTests(path: string): SqliteDatabase {
  if (db) {
    db.close();
    db = null;
  }
  return getDb(path);
}
