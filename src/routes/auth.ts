import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { hashPassword, verifyPassword } from '../lib/crypto.js';
import { authHook, signToken } from '../lib/auth.js';

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/register', async (request, reply) => {
    const body = z
      .object({
        email: z.string().email(),
        password: z.string().min(6),
      })
      .parse(request.body);

    const db = getDb();
    const existing = db
      .prepare('SELECT id FROM cointax_users WHERE email = ?')
      .get(body.email.toLowerCase());
    if (existing) {
      return reply.code(409).send({ error: 'Email already registered' });
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO cointax_users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)',
    ).run(id, body.email.toLowerCase(), hashPassword(body.password), now);

    const token = signToken({ userId: id, email: body.email.toLowerCase() });
    return { token, user: { id, email: body.email.toLowerCase() } };
  });

  app.post('/auth/login', async (request, reply) => {
    const body = z
      .object({
        email: z.string().email(),
        password: z.string().min(1),
      })
      .parse(request.body);

    const db = getDb();
    const user = db
      .prepare('SELECT id, email, password_hash FROM cointax_users WHERE email = ?')
      .get(body.email.toLowerCase()) as
      | { id: string; email: string; password_hash: string }
      | undefined;

    if (!user || !verifyPassword(body.password, user.password_hash)) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const token = signToken({ userId: user.id, email: user.email });
    return { token, user: { id: user.id, email: user.email } };
  });

  app.get('/auth/me', { preHandler: authHook }, async (request) => {
    return { user: request.user };
  });
}
