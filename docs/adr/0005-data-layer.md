# Data layer: Drizzle + Postgres, session storage only

The starter's only persisted data is the Shopify session. It is stored through
`@shopify/shopify-app-session-storage-drizzle`'s `DrizzleSessionStoragePostgres`
(reused as-is — see ENG-2323), against an **app-owned** Drizzle schema and
`drizzle-kit` migrations, with local Postgres via a root `docker-compose.yml`.

- **Location.** `apps/web/app/db/` (`schema.ts`, `client.ts`, `migrations/`,
  `seed.ts`) + `apps/web/drizzle.config.ts`. Not a `packages/db` workspace — one
  app, one consumer, and the glue package only ever sees the `SessionStorage`
  interface, never the schema.
- **Driver.** `pg` + `drizzle-orm/node-postgres`. `drizzle-orm` pinned to
  `^0.45.0` — the adapter's peer is `^0.44.7 || ^0.45.0` and `ERESOLVE`s on the
  `1.0.0-rc` line.
- **Session schema.** `schema.ts` is a **verbatim copy** of the adapter's canonical
  `postgres.schema.ts`: all 17 columns (including `refreshToken` /
  `refreshTokenExpires` and the six associated-user columns), canonical camelCase
  SQL identifiers, SQL table name `session`. No columns added or removed.
- **No example app table.** Session storage is the only data-layer concern the
  starter ships. `seed.ts` is a bare documented stub; `db:seed` stays in the
  bootstrap chain so adding a table later needs no wiring.
- **Migrations.** `drizzle-kit` is the sole migration authority: `pnpm db:generate`
  produces committed SQL files, `pnpm db:migrate` (`drizzle-kit migrate`) applies
  them. No `drizzle-kit push`; no migrate-on-boot from server code. Applied via
  `apps/web` `predev` and from cold by `db:up`.
- **Local Postgres.** Root `docker-compose.yml`: one `postgres:17-alpine`, named
  volume, `pg_isready` healthcheck. `pnpm db:up` = `docker compose up -d --wait` →
  `db:migrate` → `db:seed`.

## Why

- **Verbatim copy, not an import.** `@shopify/shopify-app-session-storage-drizzle`
  exports only the three adapter classes — not its schema and not the
  `PostgresSessionTable` type. We own the migration for the table regardless (the
  adapter never issues DDL), so the schema module has to live in the repo. Copying
  the canonical file keeps a single upstream artifact to diff against on adapter
  bumps. `new DrizzleSessionStoragePostgres(db, sessionTable)` then takes a single
  `as` cast at the call site, because the constructor's parameter type
  (`typeof` their `sessionTable`, a branded Drizzle table type) is not importable.
  A reader will ask why we don't just import it; this is the answer.
- **Keep the online-token columns.** Offline-only auth (ADR 0002) leaves `userId`,
  `firstName`…`emailVerified`, and the refresh-token columns perpetually null. They
  stay in the schema so a later `future.expiringOfflineAccessTokens` flip — which
  the adapter writes `refreshToken` / `refreshTokenExpires` for — is not a schema
  emergency.
- **No app table.** The one-example-table idea was dropped deliberately: it added a
  demo entity, a CRUD server function, and a seed with nothing real to seed. The
  starter shows Drizzle purely as the `SessionStorage` backing; app authors add
  their own tables against the same `schema.ts` + `drizzle-kit` setup. A reader
  seeing a whole data-layer decision resolve to one externally-shaped table should
  know this was a scoping call, not an omission.
- **drizzle-kit as sole authority.** The alternative — Shopify's raw-SQL
  `@shopify/shopify-app-session-storage-postgresql` with its own pool and
  `CREATE TABLE` migrator — would fight `drizzle-kit` for schema ownership in one
  database (ENG-2323). One tool, one migration history.

## Considered and rejected

- **Inline ~50-line `SessionStorage` impl.** Feasible, but the official Postgres
  adapter is ~184 lines because `Session` ↔ row mapping (associated user + refresh
  tokens) is the real work, and Shopify tests it against the shared
  `batteryOfTests`. Rejected unless a future decision needs column names the
  adapter cannot accept.
- **`packages/db` workspace.** Rejected: no second consumer.
- **`postgres` (postgres.js) driver.** Lighter, but the adapter is only tested
  against `node-postgres`; not worth the `PgDatabase` assignability risk in a
  starter.
- **`drizzle-kit push` / migrate-on-boot.** Rejected: non-reproducible schema state
  and a second migration authority racing the app process.

## Consequences

- `apps/web` gains a hard dependency on a reachable Postgres before `shopify app
  dev` is useful; `db:up` is the one-command path and `predev` runs `db:migrate`.
- Adapter bumps require re-diffing `schema.ts` against the upstream canonical file;
  the `as` cast can mask a genuine shape change, so the copy must be checked, not
  assumed.
- `app/uninstalled` (ADR 0004) deletes only the session row in the starter. Its
  "delete demo rows for shop" TODO has no concrete table to act on until an app
  author adds one.
- `.env` loading and `shopify app dev` env injection for `DATABASE_URL`, plus the
  Turbo `dev` / `db:*` task graph, are ENG-2332's to wire.
