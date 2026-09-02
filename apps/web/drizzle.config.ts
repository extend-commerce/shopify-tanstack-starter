import { defineConfig } from 'drizzle-kit';
import dotenv from 'dotenv';

dotenv.config();

// drizzle-kit is the sole migration authority (ADR 0005): `pnpm db:generate`
// writes committed SQL under ./app/db/migrations, `pnpm db:migrate` applies it.
// No `drizzle-kit push`, no migrate-on-boot.

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    'DATABASE_URL is not set. Copy apps/web/.env.example to .env (or run via `pnpm db:up`).',
  );
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './app/db/schema.ts',
  out: './app/db/migrations',
  dbCredentials: { url },
});
