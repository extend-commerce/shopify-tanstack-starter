import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// `drizzle-kit` is a standalone CLI (not run through Vite), so it loads the
// monorepo-root `.env` itself. dotenv never overrides an already-set var.
loadEnv({ path: resolve(__dirname, '../../.env') });

// drizzle-kit is the sole migration authority (ADR 0012): `pnpm db:generate`
// writes committed SQL under ./app/db/migrations, `pnpm db:migrate` applies it
// to the local file SQLite. Remote D1 apply is `wrangler d1 migrations apply`
// (runbook). No `drizzle-kit push`, no migrate-on-boot.

const DEFAULT_SQLITE_URL = 'file:../../.data/dev.sqlite';

function sqliteUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) return DEFAULT_SQLITE_URL;
  if (raw.startsWith('file:') || raw.startsWith('/') || !raw.includes('://')) return raw;
  // Stale Postgres URL in `.env` after the ADR 0012 swap — ignore it.
  return DEFAULT_SQLITE_URL;
}

const url = sqliteUrl();

export default defineConfig({
  dialect: 'sqlite',
  schema: './app/db/schema.ts',
  out: './app/db/migrations',
  dbCredentials: { url },
});
