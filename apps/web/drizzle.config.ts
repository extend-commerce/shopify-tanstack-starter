import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// `drizzle-kit` is a standalone CLI (not run through Vite), so it loads the
// monorepo-root `.env` itself. dotenv never overrides an already-set var.
loadEnv({ path: resolve(__dirname, '../../.env') });

// drizzle-kit is the sole migration authority (ADR 0005): `pnpm db:generate`
// writes committed SQL under ./app/db/migrations, `pnpm db:migrate` applies it.
// No `drizzle-kit push`, no migrate-on-boot.

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env (repo root) or run `pnpm db:up`.',
  );
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './app/db/schema.ts',
  out: './app/db/migrations',
  dbCredentials: { url },
});
