# Drizzle / Postgres `SessionStorage` adapter

**Ticket:** [ENG-2323](https://linear.app/extend-commerce/issue/ENG-2323/find-a-drizzlepostgres-session-storage-adapter)
**Question:** Does a usable `@shopify/shopify-app-session-storage`-compatible session-storage adapter for Drizzle (or plain `pg` / Postgres) already exist?
**Date:** 2026-08-28
**Clone:** `https://github.com/Shopify/shopify-app-js` @ `c92c01fdf0b52ac4c57bee2517050997ec934b8a` (shallow `main`, `/tmp/shopify-app-js-research/shopify-app-js`; not vendored)
**npm:** registry snapshots the same day; weekly downloads are 2026-08-20 → 2026-08-26

---

## Recommendation

**Reuse `@shopify/shopify-app-session-storage-drizzle` as-is** — specifically `DrizzleSessionStoragePostgres(db, sessionTable)`.

Do **not** publish a `shopify-app-session-storage-drizzle` of our own (Shopify already ships it). Do **not** write a ~50-line inline adapter: the official Postgres class is ~184 lines because the non-trivial work is `Session` ↔ row mapping (associated user fields + refresh tokens), and Shopify already tests that mapping against the shared `batteryOfTests`. Do **not** pair the official raw-SQL `@shopify/shopify-app-session-storage-postgresql` with a Drizzle data layer — it opens its own `pg.Pool`, auto-creates/migrates a separate table, and would fight Drizzle-kit for schema ownership.

Keep `SessionStorage` as the seam. The app owns the Drizzle schema *file* and migrations; the adapter imposes the required column set.

---

## Versions (current line, 2026-08-10)

Recorded from package source **and** the published npm registry (both agree). All three Shopify session packages were released together on 2026-08-10 with `@shopify/shopify-api@14.0.0`.

| Package | Latest | Peers | Weekly downloads |
|---|---|---|---|
| `@shopify/shopify-app-session-storage` | **6.0.0** | `@shopify/shopify-api` `^14.0.0` | 302,459 |
| `@shopify/shopify-app-session-storage-drizzle` | **5.0.0** | api `^14.0.0`, session-storage `^6.0.0`, `drizzle-orm` `^0.44.7 \|\| ^0.45.0` | 4,819 |
| `@shopify/shopify-app-session-storage-postgresql` | **7.0.0** | api `^14.0.0`, session-storage `^6.0.0` | 17,089 |
| `@shopify/shopify-api` | **14.0.0** | — | — |
| `drizzle-orm` | **0.45.2** (`latest`); `1.0.0-rc.4` on `rc` | — | — |

Peer matrix is internally consistent: drizzle 5.0.0 and postgresql 7.0.0 both require the current interface package (6.0.0) and api 14. Pin `drizzle-orm` to `^0.44.7 \|\| ^0.45.0` (do not take the 1.0 RCs) or npm will `ERESOLVE`.

---

## Current `SessionStorage` interface

Source: `packages/apps/session-storage/shopify-app-session-storage/src/types.ts`. Guide: `implementing-session-storage.md`. Unchanged in 6.0.0 (that release is a peer bump onto api 14).

```ts
interface SessionStorage {
  storeSession(session: Session): Promise<boolean>;
  loadSession(id: string): Promise<Session | undefined>;
  deleteSession(id: string): Promise<boolean>;
  deleteSessions(ids: string[]): Promise<boolean>;
  findSessionsByShop(shop: string): Promise<Session[]>;
}
```

`Session` comes from `@shopify/shopify-api`. Adapters round-trip via `session.toObject()` / `Session.fromPropertyArray(..., true)`. Ids stay `offline_{shop}` / `{shop}_{userId}` (see ENG-2322 findings).

The interface package also exports RDBMS migrator helpers (`RdbmsSessionStorageOptions`, `SessionStorageMigrator`, …). Those are used by the **postgresql** adapter, not by drizzle.

---

## Comparison

| Candidate | Current `SessionStorage`? | Postgres | ORM | Schema ownership | Last release | Peers vs current line | Verdict |
|---|---|---|---|---|---|---|---|
| **`@shopify/shopify-app-session-storage-drizzle`** `DrizzleSessionStoragePostgres` | **Yes** — `implements SessionStorage`; five methods; runs `batteryOfTests` | Yes (`pg-core`) | Drizzle | **App owns the file + drizzle-kit migrations.** Adapter **imposes column JS keys + types** (see below). No auto-migrate. Table *name* is yours (`pgTable('…')`). | 5.0.0, 2026-08-10 | api `^14`, session-storage `^6`, drizzle-orm `^0.44.7 \|\| ^0.45.0` | **Reuse as-is** |
| `@shopify/shopify-app-session-storage-postgresql` | **Yes** | Yes (raw `pg`) | None | **Adapter owns the table.** Default name `shopify_sessions`. `CREATE TABLE IF NOT EXISTS` + built-in migrator (scope width, case sensitivity, refresh tokens, user-info columns). Own `pg.Pool`. | 7.0.0, 2026-08-10 | api `^14`, session-storage `^6` | Official and current, but wrong for a Drizzle app (second pool + competing DDL) |
| Inline `class … implements SessionStorage` (~50 lines) | Would, if we copy the five methods | Yes | Drizzle | Full ownership, including column names | n/a | n/a | Unnecessary. Official Postgres adapter is already ~184 lines of mapping we would re-derive |
| Publish our own `shopify-app-session-storage-drizzle` | n/a | — | — | — | — | — | **Out of scope.** Shopify already published this name |
| `@hashem-ramadan/shopify-app-session-storage-postgresql-cloudsql` | Unknown vs interface 6; peers are **stale** | Yes (unix-socket fork of official postgresql) | None | Same as official postgresql | 2.0.0, 2026-06-09 | api `^13`, session-storage `^5` | Cloud SQL sockets only; not Drizzle; behind current peers |
| `@bazaarforge/shopify-app-session-storage-adaptable-postgresql` | Unverified | Yes (`pg-promise`) | None | Own table | 1.0.0-alpha.2, 2025-02-08 | `pg`, `pg-promise` (no Shopify peers listed) | Alpha, unmaintained relative to current line |
| Other npm `shopify-app-session-storage-*` | CosmosDB / Firestore / DynamoDB / SurrealDB / Vercel KV / MySQL forks | No | — | — | 2023–2025 | Stale | Not Postgres/Drizzle |

npm `shopify-app-session-storage` search (2026-08-28) returned **no community Drizzle adapter**. The only Drizzle implementation is Shopify’s official package, listed in `packages/apps/session-storage/README.md` beside postgresql/prisma/sqlite/….

---

## Candidate: `@shopify/shopify-app-session-storage-drizzle`

Sources:

- npm: https://www.npmjs.com/package/@shopify/shopify-app-session-storage-drizzle
- GitHub: `packages/apps/session-storage/shopify-app-session-storage-drizzle/`
- Adapter: `src/adapters/drizzle-postgres.adapter.ts`
- Canonical schema: `src/schemas/postgres.schema.ts`
- Tests: `src/__tests__/drizzle-postgres.test.ts` (node-postgres + `batteryOfTests`)
- Docs: README, `MIGRATION_TO_EXPIRING_TOKENS.md`, CHANGELOG 5.0.0 / 4.0.0

### Interface compliance

`DrizzleSessionStoragePostgres implements SessionStorage`. Methods: `storeSession` (`insert` + `onConflictDoUpdate` on `id`), `loadSession`, `deleteSession`, `deleteSessions` (`inArray`), `findSessionsByShop` (`eq(shop)` + `orderBy(desc(expires))`). Mapping uses `session.toObject()` on write and `Session.fromPropertyArray(Object.entries(sessionParams), true)` on read, including `onlineAccessInfo.associated_user.*` flattened into columns and `refreshToken` / `refreshTokenExpires`.

Constructor:

```ts
constructor(
  private readonly db: PgDatabase<PgQueryResultHKT, any>,
  private readonly sessionTable: PostgresSessionTable,
)
```

`PgDatabase` is drizzle’s pg-core database type — compatible with `drizzle-orm/node-postgres` (what the tests use), and typically `postgres-js` / neon-serverless as well. The second argument is the app’s `pgTable(…)`.

### Schema: we own the file, they own the shape

README: “requires a `schema.ts` with a `session` table with at-least the columns as in the example. Make sure to create `session` table and apply changes to the database before using this package.” The adapter does **not** create tables.

Canonical Postgres columns (`src/schemas/postgres.schema.ts`):

| JS key / SQL name | Type | Notes |
|---|---|---|
| `id` | `text` PK | |
| `shop` | `text` not null | |
| `state` | `text` not null | |
| `isOnline` | `boolean` default false, not null | camelCase SQL identifier |
| `scope` | `text` | |
| `expires` | `timestamp({mode: 'date'})` | `Date`, not unix int |
| `accessToken` | `text` not null | |
| `userId` | `bigint({mode: 'number'})` | |
| `firstName`, `lastName`, `email`, `locale` | `text` | associated user |
| `accountOwner`, `collaborator`, `emailVerified` | `boolean` | associated user |
| `refreshToken` | `text` | expiring offline tokens (since 4.0.0) |
| `refreshTokenExpires` | `timestamp({mode: 'date'})` | |

What we control:

- The Drizzle schema module and drizzle-kit migrations.
- The **table name** (`pgTable('session' | 'shopify_sessions' | …, {…})`) — the adapter never hard-codes `'session'`; it uses the table object you pass.
- Extra columns, in principle (README “at-least”). Inserts only write the known fields; extra **required** columns without defaults would break `storeSession` at runtime. Constructor is typed as `typeof` their `sessionTable`, so extra columns may need a type assertion.

What we do **not** control without forking:

- The JS property names the adapter reads (`sessionTable.id`, `.shop`, `.refreshTokenExpires`, …). Renaming columns means a wrapper or our own impl.
- `accessToken` not-null (4.0.0 migration guide).
- Timestamp mode for `expires` / `refreshTokenExpires` (`mode: 'date'`).

**README trap:** the Postgres example in README still omits `firstName`…`emailVerified` and the refresh-token columns. Copy `postgres.schema.ts` or `MIGRATION_TO_EXPIRING_TOKENS.md`, not the truncated README snippet.

### Maintenance

First-party Shopify package, released with the rest of `shopify-app-js`. 5.0.0 is a peer bump onto api 14 / session-storage 6 (CHANGELOG lists it under Patch Changes despite the major version — same pattern as the interface package’s 6.0.0). 4.0.0 (2026-03-11) added refresh-token columns (breaking schema). 4.0.1 widened drizzle-orm to `^0.45.0`. GitHub issues exist around driver typing (`LibSQLDatabase`, older drizzle-orm pins); the current peers target 0.44.7 / 0.45.x.

---

## Candidate: `@shopify/shopify-app-session-storage-postgresql`

Sources: `src/postgresql.ts`, `src/migrations.ts`, `src/postgres-connection.ts`, README.

Implements the same five `SessionStorage` methods. Uses raw SQL through its own `pg.Pool`. Default table **`shopify_sessions`** (not `session`). `CREATE TABLE IF NOT EXISTS` plus a migrator table `shopify_sessions_migrations`. Column types differ from the Drizzle schema:

- `expires` is `integer` (unix **seconds**; multiplied by 1000 on read)
- `refreshTokenExpires` is `bigint` (ms), not `timestamp`
- `varchar(255)` / `varchar(1024)` for strings vs drizzle `text`

That table shape is **not** a drop-in for `DrizzleSessionStoragePostgres`. Using both adapters against one Postgres database would mean two pools, two table names (unless reconfigured), and two migration authorities.

Use this package only if the app had **no** Drizzle (or other ORM) and wanted Shopify to own DDL. That is not this port.

---

## Community packages (searched, rejected)

npm search `shopify-app-session-storage` (2026-08-28): official adapters plus CosmosDB, two Firestore ports, a DynamoDB fork, a MySQL fork, SurrealDB, Vercel KV, and two Postgres-related extras:

1. **`@hashem-ramadan/shopify-app-session-storage-postgresql-cloudsql@2.0.0`** (2026-06-09) — fork of the official postgresql adapter for Cloud SQL unix sockets. Peers: api `^13`, session-storage `^5`. Not Drizzle; one major behind current peers.
2. **`@bazaarforge/shopify-app-session-storage-adaptable-postgresql@1.0.0-alpha.2`** (2025-02-08) — `pg-promise`. Alpha. No Shopify session-storage peer.

No package named `*session-storage-drizzle*` other than Shopify’s.

---

## Alternatives considered (and why not)

**Reuse postgresql behind a thin wrapper.** A wrapper cannot make Shopify’s auto-DDL coexist with drizzle-kit, and it would still be raw SQL on a second pool. Rejected.

**Inline ~50-line Drizzle adapter.** Feasible against the five-method interface (`implementing-session-storage.md`). The official Postgres adapter is already that class, plus associated-user and refresh-token mapping Shopify tests. Re-implementing it would be a maintenance fork of a published, version-aligned package. Rejected unless a future grilling ticket needs column names the official adapter cannot accept.

**Publish `shopify-app-session-storage-drizzle`.** Name is taken. Standing preference forbids it anyway.

---

## Implications for the port

For the later data-layer grilling ticket (and for wiring auth glue from ENG-2322):

1. **Concrete adapter:** `@shopify/shopify-app-session-storage-drizzle@5.0.0` + `DrizzleSessionStoragePostgres`. Depend also on `@shopify/shopify-app-session-storage@6` and `@shopify/shopify-api@14` (already implied by ENG-2322). Driver: `pg` (what Shopify tests) unless grilling chooses `postgres.js` / neon and confirms `PgDatabase` assignability.

2. **Pin `drizzle-orm` to 0.44.7–0.45.x.** Latest `latest` is 0.45.2; `rc` is 1.0.0-rc.4. The adapter’s peer will `ERESOLVE` on 1.0. Historical pattern: Shopify lags drizzle minors (issue #730, 4.0.1 peer widen). Grilling should treat drizzle 1.0 as a *later* bump, not a day-one choice.

3. **Session table lives in the app schema, migrated by drizzle-kit.** Copy the full column set from `postgres.schema.ts` (including refresh-token + associated-user fields). Do not trust the truncated README example. Table name is free; column JS keys are not.

4. **Do not enable Shopify’s postgresql adapter migrator** in the same database. One migration authority: drizzle-kit. `accessToken` is `NOT NULL`; `expires` is `timestamp`, not unix int.

5. **Seam stays `SessionStorage`.** Auth glue (token exchange, `storeSession` after exchange, `findSessionsByShop` on uninstall) talks only to the interface. Swapping Drizzle for Prisma/sqlite/memory later is a constructor change, not an auth rewrite. ENG-2322 already classified this as “Reuse (seam)”.

6. **Expiring offline tokens:** drizzle 4.0.0+ stores `refreshToken` / `refreshTokenExpires`. Port should add those columns on day one even if the future flag is off, so a later flag flip is not a schema emergency.

7. **Tests:** Shopify’s `batteryOfTests` is the contract. App-level tests can construct `DrizzleSessionStoragePostgres` against a test DB; no need to re-test the adapter’s SQL.

8. **Memory adapter for unit tests / `shopify-app-session-storage-memory@7.0.0`** remains valid behind the same seam (does not persist). Production path is drizzle/postgres.

---

## Claim → source index

| Claim | Source |
|---|---|
| `SessionStorage` five methods | `shopify-app-session-storage/src/types.ts`; `implementing-session-storage.md` |
| Interface 6.0.0 peers api `^14`; released 2026-08-10 | `shopify-app-session-storage/package.json`; npm `time["6.0.0"]`; CHANGELOG 6.0.0 |
| Official drizzle package exists, listed first-party | `session-storage/README.md`; npm `@shopify/shopify-app-session-storage-drizzle` |
| `DrizzleSessionStoragePostgres implements SessionStorage` | `drizzle-postgres.adapter.ts` |
| Canonical Postgres columns + `PostgresSessionTable` | `schemas/postgres.schema.ts` |
| App supplies `pgTable`; no auto-create | drizzle README; test file `CREATE TABLE IF NOT EXISTS` in `beforeAll` |
| Refresh-token columns required since 4.0.0 | drizzle CHANGELOG 4.0.0; `MIGRATION_TO_EXPIRING_TOKENS.md` |
| drizzle 5.0.0 peers | drizzle `package.json`; npm `peerDependencies`; CHANGELOG 5.0.0 |
| drizzle-orm latest 0.45.2 / rc 1.0 | `npm view drizzle-orm dist-tags` |
| Weekly downloads | npm downloads API, week 2026-08-20–26 |
| postgresql 7.0.0 owns table `shopify_sessions`, own `pg.Pool`, auto-DDL | `postgresql.ts` `createTable` / options; `postgres-connection.ts` |
| postgresql column types (unix `expires`, bigint `refreshTokenExpires`) | `postgresql.ts` `createTable` + `databaseRowToSession` |
| postgresql migrations list | `postgresql/src/migrations.ts` |
| drizzle tests use `batteryOfTests` + node-postgres | `drizzle-postgres.test.ts` |
| No community Drizzle adapter on npm | `npm search shopify-app-session-storage` 2026-08-28 |
| Cloud SQL fork peers stale | `npm view @hashem-ramadan/shopify-app-session-storage-postgresql-cloudsql` |
| bazaarforge alpha | `npm view @bazaarforge/shopify-app-session-storage-adaptable-postgresql` |
| Prisma analogy (app schema, imposed columns) | `shopify-app-session-storage-prisma/README.md` |
| Clone SHA | `git rev-parse HEAD` in `/tmp/shopify-app-js-research/shopify-app-js` |
