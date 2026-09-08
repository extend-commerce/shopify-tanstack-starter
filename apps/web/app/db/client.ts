// DEPLOYMENT PORTABILITY SWAP POINT (ADR 0009 / ADR 0012).
//
// Local Node (`shopify app dev`) uses better-sqlite3 against a file SQLite DB.
// The Workers build aliases `~/platform` to `platform.cf.ts`, which loads
// `./client.d1.ts` (`drizzle-orm/d1` + `env.DB`) instead of this file.
//
// This is one of the two sanctioned exceptions to the "no `node:*` in app server
// code" rule (BUILD-PLAN 6.2); `apps/web/vite.config.ts` is the other.
//
// Env note: a module-scope handle is acceptable for the Node target — the
// process is long-lived. The D1 sibling reads `env.DB` per call.
//
// This module does NOT load `.env` — `DATABASE_URL` is already on `process.env`
// by the time it runs: `vite.config.ts` forwards the root `.env` for the app
// (dev + build), `db:seed` / `start` pass `node --env-file-if-exists=../../.env`,
// and `drizzle.config.ts` loads it via dotenv.

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { DrizzleSessionStorageSQLite } from '@shopify/shopify-app-session-storage-drizzle';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import * as schema from './schema';

const DEFAULT_SQLITE_PATH = resolve(import.meta.dirname, '../../../../.data/dev.sqlite');

function sqliteFilePath(): string {
  const url = process.env.DATABASE_URL;
  const fallback = DEFAULT_SQLITE_PATH;
  if (!url) return fallback;
  if (url.includes('://') && !url.startsWith('file:')) return fallback;
  return resolve(url.replace(/^file:/, ''));
}

const filePath = sqliteFilePath();
mkdirSync(dirname(filePath), { recursive: true });
const sqlite = new Database(filePath);
sqlite.pragma('journal_mode = WAL');

export const db = drizzle(sqlite, { schema });

// The constructor's 2nd parameter is typed `typeof` the adapter's OWN internal
// `sessionTable` (a branded Drizzle sqlite table type). The adapter re-exports
// neither that value nor its `SQLiteSessionTable` type from the package root, so
// our verbatim copy in `./schema` is a structurally-identical but
// nominally-distinct declaration. `as never` documents "the required type is
// not importable" while satisfying the call — the guarantee that the shape
// matches is the verbatim copy + the committed migration, not this cast
// (ADR 0012: re-diff `schema.ts` on adapter bumps).
export const sessionStorage = new DrizzleSessionStorageSQLite(db, schema.sessionTable as never);
