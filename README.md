# CoinTax Server

Fastify API for Vercel + Supabase.

## Local

```bash
cp .env.example .env
npm install
npm run dev
```

## Vercel

이 폴더가 git root입니다. Vercel에서 이 repo를 연결하면 Root Directory는 **비워두거나 `.`**.

- Framework Preset: **Other**
- Env: `JWT_SECRET`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

Entry: `api/index.ts` (serverless). Local entry: `src/index.ts`.
