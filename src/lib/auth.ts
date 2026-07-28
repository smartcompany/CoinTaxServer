import type { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';

export type AuthUser = { userId: string; email: string };

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export function signToken(user: AuthUser): string {
  const secret = process.env.JWT_SECRET ?? 'change-me-in-production';
  return jwt.sign(user, secret, { expiresIn: '30d' });
}

export function authHook(
  request: FastifyRequest,
  reply: FastifyReply,
  done: (err?: Error) => void,
) {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }
  try {
    const secret = process.env.JWT_SECRET ?? 'change-me-in-production';
    const payload = jwt.verify(header.slice(7), secret) as AuthUser;
    request.user = payload;
    done();
  } catch {
    reply.code(401).send({ error: 'Invalid token' });
  }
}
