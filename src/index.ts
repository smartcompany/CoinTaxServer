import 'dotenv/config';
import { buildApp } from './app.js';

const port = Number(process.env.PORT ?? 4000);

async function main() {
  const app = await buildApp();
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`CoinTax server listening on http://localhost:${port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
