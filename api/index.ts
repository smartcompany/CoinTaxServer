import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

let appPromise: Promise<FastifyInstance> | null = null;

function getApp() {
  if (!appPromise) appPromise = buildApp();
  return appPromise;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const app = await getApp();
  await app.ready();
  app.server.emit('request', req, res);
}
