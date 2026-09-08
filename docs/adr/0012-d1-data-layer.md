# D1 data layer — schema, session storage, migrations

**Revises [ADR 0005](0005-data-layer.md)** (Postgres → SQLite). Executes ADR 0009's
`app/db/client.ts` swap point.

Decision: ENG-2368. Research: ENG-2363 (`docs/research/deploy-d1-session-storage.md`).

## Decision

1. **Adapter.** Keep `@shopify/shopify-app-session-storage-drizzle@5.0.1`. Production
   on Workers is `new DrizzleSessionStorageSQLite(drizzle(env.DB), sessionTable)`
   (`drizzle-orm/d1`). Local Node is the **same class** over
   `drizzle-orm/better-sqlite3`. Do not inline `SessionStorage`. Do not move
   sessions to `@shopify/shopify-app-session-storage-kv`.
2. **Schema.** `apps/web/app/db/schema.ts` is a verbatim copy of the adapter's
   `sqlite.schema.ts` (17 columns, `text` dates, `blob({ mode: 'bigint' })` `userId`,
   integer booleans). Re-diff on adapter bumps. Same `as never` constructor cast
   as ADR 0005 (the branded table type is still not exported).
3. **Client.** Two files behind a Vite alias (ADR 0011 / 0017):
   - `app/db/client.ts` — better-sqlite3 against `DATABASE_URL` (`file:…` SQLite).
   - `app/db/client.d1.ts` — per-call `drizzle(env.DB)` from `cloudflare:workers`.
     Do not construct the D1 client at module scope.
4. **Migrations.** `drizzle-kit` remains the sole generator (`dialect: 'sqlite'`).
   Committed SQL under `apps/web/app/db/migrations`. Local apply: `drizzle-kit
   migrate`. Remote apply: `wrangler d1 migrations apply --remote --env <env>`
   (runbook). No migrate-on-boot. No `drizzle-kit push`. No `d1-http` from
   `pnpm db:up` (that needs a Cloudflare account).
5. **Seed.** Still a no-op stub. Session rows are written by the adapter at runtime.
6. **Fallback.** Hyperdrive + external Postgres is documented, not shipped. Escalate
   only if a D1 try-out shows `userId` blob/bigint (or similar) is unworkable.
   Offline-only auth leaves `userId` null in the starter.

## Why

- Same package, same `SessionStorage` seam, dialect swap only. ENG-2323 already
  rejected an inline adapter.
- D1 is in the adapter's typed contract (`BaseSQLiteDatabase<'async'>`) even though
  Shopify's tests run against better-sqlite3.
- Local file SQLite means `pnpm db:up` no longer needs Docker (ADR 0017).

## Considered and rejected

- **Keep Postgres locally, D1 only on Workers.** Two schemas, two migrations, two
  `SessionStorage` classes. The map's destination is D1 as the data layer.
- **KV session storage.** Wrong seam — KV in this map is the auth de-dupe guard
  (ADR 0013), not session rows.
- **drizzle-orm 1.0-rc.** Adapter peer is still `^0.44.7 \|\| ^0.45.0`.

## Consequences

- `pg`, `@types/pg`, and root `docker-compose.yml` leave the starter.
- `DATABASE_URL` becomes a `file:` SQLite path. `.env.example` and README follow.
- The existing Postgres `0000_*` migration is replaced with a SQLite one.
