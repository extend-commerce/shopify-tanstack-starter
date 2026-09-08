# Drizzle Shopify session-storage adapter — SQLite / D1

**Ticket:** [ENG-2363](https://linear.app/extend-commerce/issue/ENG-2363/research-drizzle-shopify-session-storage-adapter-sqlite-d1-support)
**Question:** Can the starter keep using `@shopify/shopify-app-session-storage-drizzle` on Cloudflare D1 (SQLite), or does moving off Postgres force a hand-rolled session-storage adapter?
**Date:** 2026-09-03
**Sources:** `@shopify/shopify-app-session-storage-drizzle@5.0.1` on npm (updated 2026-08-28) and `Shopify/shopify-app-js` `main` (`packages/apps/session-storage/shopify-app-session-storage-drizzle/`); Drizzle D1 driver + kit docs; Cloudflare D1 migrations. Prior Postgres research: `docs/research/session-storage-adapter.md` (ENG-2323). Not vendored.

---

## Recommendation

**Keep `@shopify/shopify-app-session-storage-drizzle`. Switch the class, not the package.** Production on Workers is `new DrizzleSessionStorageSQLite(drizzle(env.DB), sessionTable)` with `drizzle-orm/d1`. Local (no Cloudflare account) is the **same class** over `drizzle-orm/better-sqlite3` (what Shopify tests) or `drizzle-orm/libsql`. Do **not** write an inline `SessionStorage`. Do **not** move sessions to `@shopify/shopify-app-session-storage-kv` — that abandons the Drizzle data layer the map is moving to D1.

The adapter is typed for **both** `'sync' | 'async'` `BaseSQLiteDatabase`. `DrizzleD1Database` **extends** `BaseSQLiteDatabase<'async', D1Result, …>`. Every adapter method `await`s Drizzle’s query builder; it never calls sync-only `better-sqlite3` APIs and never uses `db.batch()`. D1 is therefore in the typed contract even though Shopify’s `batteryOfTests` only run against **better-sqlite3**.

Do **not** take Drizzle’s D1 getting-started pin of `drizzle-orm@rc` (1.0 line). The adapter peer is still `^0.44.7 || ^0.45.0` (catalog `^0.45.0`). Stay there.

The remaining risk is **shape, not existence**: `userId` is `blob({ mode: 'bigint' })`, `expires` / `refreshTokenExpires` are ISO **text** (not `timestamp`). Copy `sqlite.schema.ts`, not the truncated README. If D1’s blob/bigint mapping fails in a later try-out, *then* inline the five methods or store `userId` as `text`/`integer` behind a thin mapper — not as the default.

---

## Versions (2026-09-03)

| Package | Pin / latest | Notes |
|---|---|---|
| `@shopify/shopify-app-session-storage-drizzle` | **5.0.1** (catalog; npm latest, 2026-08-28) | Exports three classes. Peers: api `^14`, session-storage `^6`, drizzle-orm `^0.44.7 \|\| ^0.45.0` |
| `@shopify/shopify-app-session-storage` | **6.0.1** (catalog) | Five-method `SessionStorage` unchanged from ENG-2323 |
| `@shopify/shopify-api` | **14.0.1** | |
| `drizzle-orm` | catalog `^0.45.0`; adapter tests on **0.45.2** | Do not take 1.0 rc |
| `drizzle-kit` | catalog **0.30.6** (adapter *dev* is `^0.31.10`) | SQLite dialect is what we need; kit minor is a D-data pin, not a blocker |

DevDependencies of the adapter (not runtime): `better-sqlite3`, `@libsql/client`, `pg`, `mysql2`. No `wrangler` / D1 types. Tests: `drizzle-orm/better-sqlite3` only.

---

## 1. Dialect coverage

**Yes — SQLite ships.** Package README and `src/drizzle.ts` export exactly three classes:

- `DrizzleSessionStoragePostgres`
- **`DrizzleSessionStorageSQLite`**
- `DrizzleSessionStorageMySQL`

Constructor (`src/adapters/drizzle-sqlite.adapter.ts`):

```ts
constructor(
  private readonly db: BaseSQLiteDatabase<'sync' | 'async', any, any>,
  private readonly sessionTable: SQLiteSessionTable,
)
```

`BaseSQLiteDatabase` is the sqlite-core root. Drivers that extend it:

| Driver import | Result type | ResultKind | Shopify tests? |
|---|---|---|---|
| `drizzle-orm/better-sqlite3` | BetterSQLite3Database | `'sync'` | **Yes** (`drizzle-sqlite.test.ts`) |
| `drizzle-orm/libsql` | LibSQLDatabase | `'async'` | README example only; historical typing complaint [#2259](https://github.com/Shopify/shopify-app-js/issues/2259) was against **2.0.16** with a narrower constructor |
| **`drizzle-orm/d1`** | `DrizzleD1Database extends BaseSQLiteDatabase<'async', D1Result, TSchema>` | `'async'` | **No** |

The `'sync' | 'async'` union is the whole point of the current constructor. D1 is on the async side of that union.

---

## 2. D1 specifically

**Typed yes; tested no.** [Drizzle D1 driver](https://orm.drizzle.team/docs/connect-cloudflare-d1): `import { drizzle } from 'drizzle-orm/d1'` then `drizzle(env.BINDING)`. Source (`drizzle-orm/src/d1/driver.ts`): `DrizzleD1Database extends BaseSQLiteDatabase<'async', D1Result, TSchema>`. That is assignable to `BaseSQLiteDatabase<'sync' | 'async', any, any>`.

The adapter’s SQL surface is portable query-builder:

- `insert` + `onConflictDoUpdate({ target: id })`
- `select` / `delete` + `eq` / `inArray` / `orderBy(desc(expires))`

All of those are `await`ed. No `db.run` sync, no `better-sqlite3` `Database` type, no `db.batch()`. D1’s extra `batch()` on `DrizzleD1Database` is unused. **No async/batch API mismatch in this class.**

Caveats for D-data (not blockers to *trying* the official class):

- Shopify never runs `batteryOfTests` against D1. A Worker/Miniflare smoke of the five methods is the first execution-effort check, not a planning gap.
- `userId: blob('userId', { mode: 'bigint' })` + ISO-text dates is the likely D1 quirk surface (D1 affinity vs drizzle blob/bigint). Offline-only auth (ADR 0002) leaves `userId` null in the starter, so this only bites if online sessions or `future.expiringOfflineAccessTokens` land.
- Issue #2259 (libsql type error) is **stale vs 5.0.1**’s `BaseSQLiteDatabase<'sync' \| 'async'>`. Do not treat it as a D1 veto.

---

## 3. Imposed schema vs current `pg-core`

Canonical file: `src/schemas/sqlite.schema.ts` (17 columns, table name `session`, camelCase SQL identifiers). **Copy this, not the README SQLite snippet** — README still omits associated-user + refresh-token columns and shows `accessToken` nullable; canonical has `accessToken` **notNull**, matching Postgres 4.0.0+.

| JS key | Current Postgres (`apps/web/app/db/schema.ts`) | Canonical SQLite | Change |
|---|---|---|---|
| `id` | `text` PK | `text` PK | none |
| `shop`, `state` | `text` not null | `text` not null | none |
| `isOnline` | `boolean` default false, not null | `integer({ mode: 'boolean' })` default false, not null | dialect mapping |
| `scope` | `text` | `text` | none |
| `expires` | `timestamp({ mode: 'date' })` | **`text`** (adapter writes `Date.toISOString()`, reads `new Date(row).getTime()`) | type + serialization |
| `accessToken` | `text` not null | `text` not null | none |
| `userId` | `bigint({ mode: 'number' })` | **`blob({ mode: 'bigint' })`** | type |
| `firstName`, `lastName`, `email`, `locale` | `text` | `text` | none |
| `accountOwner`, `collaborator`, `emailVerified` | `boolean` | `integer({ mode: 'boolean' })` | dialect mapping |
| `refreshToken` | `text` | `text` | none |
| `refreshTokenExpires` | `timestamp({ mode: 'date' })` | **`text`** (ISO, same as `expires`) | type + serialization |

`onlineAccessInfo` is still flattened into those associated-user columns — same as Postgres. SQLite does not grow extra columns.

DDL from the test’s `CREATE TABLE` (what drizzle-kit sqlite will emit, in spirit): `isOnline`/`accountOwner`/… are integers; `expires` text; `userId` blob.

---

## 4. The `as` cast

**Same situation as Postgres.** `src/drizzle.ts` exports only the three classes. `SQLiteSessionTable` (`typeof sessionTable` in `sqlite.schema.ts`) is **not** on the package root. The constructor’s second argument is that branded table type.

ADR 0005’s “verbatim copy + one cast because the type isn’t importable” applies 1:1. `apps/web/app/db/client.ts` already documents this for Postgres (`as never` in the comment; the call currently has no assertion — D-data should keep the documented cast when swapping classes).

---

## 5. Fallback cost

**Do not inline by default.** The official SQLite class is the same ~mapping work as `DrizzleSessionStoragePostgres` (~session `toObject` / `fromPropertyArray` including associated user + refresh tokens) and already runs `batteryOfTests`. ENG-2323 rejected a ~50-line rewrite for Postgres; SQLite does not change that math.

If D1 blob/bigint actually fails at try-out:

| Option | Size | When |
|---|---|---|
| **Keep official class, change only `userId` column** to `text`/`integer` + a one-field mapper | small | first fallback |
| Thin `implements SessionStorage` over `drizzle-orm/d1` | ~the sqlite adapter (~180 lines of mapping) | last resort |
| `@shopify/shopify-app-session-storage-kv` | official, no SQL | **wrong seam** — sessions leave Drizzle; map is D1-as-data-layer |
| Community D1 `SessionStorage` | none found (2026-09-03). Remix/CF posts use **KV** for sessions and D1 for app tables | not a candidate |

`SessionStorage` remains five methods: `storeSession`, `loadSession`, `deleteSession`, `deleteSessions`, `findSessionsByShop`.

---

## 6. Migrations

The adapter **owns no DDL**. Tests `CREATE TABLE IF NOT EXISTS` in `beforeAll`. README: create the table and apply changes *before* using the package. Same as Postgres / ADR 0005: **`drizzle-kit` is the generator**.

Applying to D1 (two official paths — pick in D-data / D-localdev):

1. **`drizzle-kit generate`** (dialect `sqlite`) → committed SQL, then **`wrangler d1 migrations apply`**. Cloudflare now supports Drizzle’s nested layout via `migrations_pattern` (e.g. `migrations/*/migration.sql`) on the D1 binding ([D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/), changelog 2026-05-29). `wrangler d1 migrations create` must **not** be the generator if the pattern is nested — generate with drizzle-kit.
2. **`drizzle-kit` `driver: 'd1-http'`** — `migrate` / `push` / studio against a real account ([D1 HTTP + kit](https://orm.drizzle.team/docs/guides/d1-http-with-drizzle-kit)). Needs account id, database id, API token. **Violates “no Cloudflare account locally.”** Maintainer-only for remote apply, not `pnpm db:up`.

Local without a CF account: drizzle-kit generate + apply to a **file SQLite** (better-sqlite3 / libsql `file:`) the way `db:up` applies Postgres today. Miniflare’s local D1 is a `wrangler dev` concern (D-localdev / ENG-2373). Do not make app developers run `d1-http`.

Do not enable `@shopify/shopify-app-session-storage-sqlite` (raw `sqlite3`, own file, own DDL) alongside drizzle-kit.

---

## Implications for D-data (ENG-2368)

1. **Adapter:** `DrizzleSessionStorageSQLite` from the same 5.0.1 package. Swap the class + driver in `apps/web/app/db/client.ts` (already marked ADR 0009 swap point). Package `src/**` stays ignorant.
2. **Schema:** replace `pg-core` copy with a verbatim copy of `sqlite.schema.ts`. Re-diff on adapter bumps. Keep all 17 columns.
3. **Local:** same `SessionStorage` class; `drizzle-orm/better-sqlite3` (tested) or libsql file. `pnpm db:up` restyles from docker-postgres to a local sqlite file (or compose-less). No `wrangler login`.
4. **Worker:** `drizzle-orm/d1` + `env.DB` per request (ADR 0009). Do not construct the D1 client at module scope.
5. **Hyperdrive / external Postgres as shipped default** stays in fog unless a try-out shows D1 + this adapter unworkable. R1 does **not** show that.
6. **KV session storage** is a different product (`@shopify/shopify-app-session-storage-kv`). Irrelevant to this ticket; KV in the map is the *auth de-dupe* guard (ENG-2369), not session rows.

---

## Fog for later tickets

- **D1 `blob`/`bigint` `userId` at runtime** — only graduates if a try-out fails; D-data can note it as the first rollback lever.
- **drizzle-kit 0.30.6 vs adapter-dev 0.31.x** — whether `migrations_pattern` / nested output matches 0.30.6’s layout. D-data / D-localdev.
- **Local sqlite file vs Miniflare D1** for `shopify app dev` — ENG-2373.

---

## Primary sources

| Claim | Source |
|---|---|
| Three exported classes including `DrizzleSessionStorageSQLite` | npm 5.0.1 README; `src/drizzle.ts` |
| Constructor `BaseSQLiteDatabase<'sync' \| 'async', any, any>` | `src/adapters/drizzle-sqlite.adapter.ts` |
| Canonical SQLite columns + `SQLiteSessionTable` | `src/schemas/sqlite.schema.ts` |
| Tests = better-sqlite3 + `batteryOfTests`; DDL in `beforeAll` | `src/__tests__/drizzle-sqlite.test.ts` |
| Peers / 5.0.1 | package.json on npm + GitHub `main` |
| `DrizzleD1Database extends BaseSQLiteDatabase<'async', …>` | `drizzle-orm/src/d1/driver.ts`; https://orm.drizzle.team/docs/connect-cloudflare-d1 |
| Kit `d1-http` needs CF token | https://orm.drizzle.team/docs/guides/d1-http-with-drizzle-kit |
| `wrangler d1` + `migrations_pattern` for nested Drizzle SQL | https://developers.cloudflare.com/d1/reference/migrations/ |
| No package-root export of schema types | `src/drizzle.ts` (three class re-exports only) |
| Libsql typing issue is 2.0.16-era | https://github.com/Shopify/shopify-app-js/issues/2259 |
