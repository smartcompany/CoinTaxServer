import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { getSupabaseConfig } from './db/supabase.js';
import { authRoutes } from './routes/auth.js';
import { connectionRoutes } from './routes/connections.js';
import { tradeRoutes } from './routes/trades.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'production',
  });

  await app.register(cors, { origin: true });
  await app.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024 },
  });

  app.get('/', async () => ({
    ok: true,
    service: 'cointax-server',
    health: '/health',
    version: '1.0.0',
  }));

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

  return app;
}
