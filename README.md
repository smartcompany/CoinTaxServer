# CoinTax Server

Fastify API for Vercel + Supabase.

## Local

```bash
cp .env.example .env
npm install
npm run dev
```

## Vercel

- Framework Preset: **Other**
- Node.js Version: **20.x**
- Root Directory: **비움** (이 repo가 git root)
- Build Command: **비움**
- Env: `JWT_SECRET`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

Entry: `api/index.ts` → `/health` 등 모든 경로
