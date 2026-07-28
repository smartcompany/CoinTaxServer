import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createUser, findUserByEmail } from '../db/supabase.js';
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

    const email = body.email.toLowerCase();
    const existing = await findUserByEmail(email);
    if (existing) {
      return reply.code(409).send({ error: 'Email already registered' });
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    try {
      await createUser({
        id,
        email,
        password_hash: hashPassword(body.password),
        created_at: now,
      });
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('duplicate') || msg.includes('unique')) {
        return reply.code(409).send({ error: 'Email already registered' });
      }
      throw e;
    }

    const token = signToken({ userId: id, email });
    return { token, user: { id, email } };
  });

  app.post('/auth/login', async (request, reply) => {
    const body = z
      .object({
        email: z.string().email(),
        password: z.string().min(1),
      })
      .parse(request.body);

    const user = await findUserByEmail(body.email.toLowerCase());
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
