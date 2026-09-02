// DEPLOYMENT PORTABILITY SWAP POINT (ADR 0009).
//
// `pg` (node-postgres) uses `node:net` / `node:tls` and is NOT Workers-compatible.
// A serverless target (Cloudflare Workers, Neon HTTP, etc.) swaps a different
// driver + drizzle adapter behind the SAME `@shopify/shopify-app-session-storage`
// `SessionStorage` interface — nothing outside this module changes.
//
// This is one of the two sanctioned exceptions to the "no `node:*` in app server
// code" rule (BUILD-PLAN 6.2); `apps/web/vite.config.ts` / the nitro preset is
// the other.
//
// Env note: the cross-cutting rule is "read env per request, never at module
// scope" (ADR 0009). A module-scope pool is acceptable here for the `node-server`
// target — the process is long-lived and owns one pool for its lifetime. A
// serverless swap that recreates the client per request would read
// `process.env.DATABASE_URL` inside the request scope instead.
//
// This module does NOT load `.env` — `DATABASE_URL` is already on `process.env`
// by the time it runs: `vite.config.ts` forwards the root `.env` for the app
// (dev + build), `db:seed` / `start` pass `node --env-file-if-exists=../../.env`,
// and a real deployment injects env from the host.

import { DrizzleSessionStoragePostgres } from '@shopify/shopify-app-session-storage-drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env (repo root) and run `pnpm db:up`.',
  );
}

const pool = new Pool({ connectionString });

export const db = drizzle(pool, { schema });

// The constructor's 2nd parameter is typed `typeof` the adapter's OWN internal
// `sessionTable` (a branded Drizzle `PgTableWithColumns` type). The adapter
// re-exports neither that value nor its `PostgresSessionTable` type from the
// package root, so our verbatim copy in `./schema` is a structurally-identical
// but nominally-distinct declaration. `as never` documents "the required type is
// not importable" while satisfying the call — the guarantee that the shape
// matches is the verbatim copy + the committed migration, not this cast
// (ADR 0005 Consequences: re-diff `schema.ts` on adapter bumps).
export const sessionStorage = new DrizzleSessionStoragePostgres(db, schema.sessionTable);
