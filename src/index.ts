import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { getDb } from './db/index.js';
import { getSupabaseConfig } from './db/supabase.js';
import { authRoutes } from './routes/auth.js';
import { connectionRoutes } from './routes/connections.js';
import { tradeRoutes } from './routes/trades.js';

const port = Number(process.env.PORT ?? 4000);

async function main() {
  getDb();
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await app.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024 },
  });

  app.get('/health', async () => {
    const supabase = getSupabaseConfig();
    return {
      ok: true,
      service: 'cointax-server',
      supabase: {
        configured: Boolean(supabase.url && supabase.publishableKey),
        url: supabase.url || null,
      },
    };
  });

  await app.register(authRoutes);
  await app.register(connectionRoutes);
  await app.register(tradeRoutes);

  await app.listen({ port, host: '0.0.0.0' });
  console.log(`CoinTax server listening on http://localhost:${port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
