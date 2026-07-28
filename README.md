# CoinTax Server

Fastify API for Vercel + Supabase.

## Local

```bash
cp .env.example .env
npm install
npm run dev
```

## Vercel

이 폴더가 git root입니다. Root Directory는 **비움**.

- Framework Preset: **Other**
- Node.js Version: **20.x** (Project Settings에서도 확인)
- Build Command: `npm run vercel-build` (기본값 — package.json의 vercel-build 스크립트)
- Env: `JWT_SECRET`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

배포 시 `vercel-build`가 `api/index.cjs`를 생성합니다. `/health`로 확인하세요.
