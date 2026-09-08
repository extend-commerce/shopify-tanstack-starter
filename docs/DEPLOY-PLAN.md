# `shopify-tanstack-starter` — Cloudflare Deploy Plan

This is the execution plan for
[ENG-2362](https://linear.app/extend-commerce/issue/ENG-2362/deploy-shopify-tanstack-starter-to-cloudflare-workers-terraform-deploy).
Decisions live in `docs/adr/0011`–`0017`. This document turns them into a
manual CLI try-out. **CI is out of scope** until that try-out succeeds.

Research (copied onto this branch): `docs/research/deploy-*.md`.

---

## 1. What is being deployed

An embedded Shopify admin app on **Cloudflare Workers**:

| Piece | Local (`shopify app dev`) | Hosted |
|---|---|---|
| Runtime | Node 22, Vite SSR | Workers + `nodejs_compat` |
| Shopify API adapter | `@shopify/shopify-api/adapters/node` (`platform.ts`) | `@shopify/shopify-api/adapters/cf-worker` (`platform.cf.ts`) |
| Data | File SQLite (`.data/dev.sqlite`) | D1 |
| Auth de-dupe | In-memory | KV (`AUTH_KV`) |
| Webhooks | Sync HMAC + work (ADR 0014) | Same |
| Build | `vite build` + `nitro({ preset: 'node-server' })` | `CLOUDFLARE=1 wrangler deploy` |

Terraform owns account resources (Worker shell, D1, KV, production custom
domain). Wrangler owns code upload, binding wiring, secrets, and D1 migrations.

---

## 2. Workstreams (what landed)

| WS | ADR | Owns |
|---|---|---|
| A | 0011 | `platform.cf.ts` → `@shopify/shopify-api/adapters/cf-worker`, `apps/web/vite.config.ts` `CLOUDFLARE=1` path, `wrangler.jsonc` |
| B | 0012 | SQLite schema, `client.ts` / `client.d1.ts`, drizzle-kit sqlite migrations, no Docker |
| C | 0013 | `AuthCoordinationStore` on `createShopifyApp`, KV impl in `apps/web` |
| D | 0014 | No Queue in this phase (control topics stay sync) |
| E | 0015 | `infra/modules/shopify-worker`, `infra/envs/{staging,production}` |
| F | 0016 | `shopify.app.{staging,production}.toml`, wrangler `[env.*]` |
| G | 0017 | `app/platform.ts` / `platform.cf.ts` seam, `pnpm db:up` = mkdir + migrate + seed |

---

## 3. Integration points

| # | Contract |
|---|---|
| **IP-CF-1** | Vite alias `~/platform` → `platform.ts` (Node) or `platform.cf.ts` (`CLOUDFLARE=1`) |
| **IP-CF-2** | Bindings: `DB` (D1), `AUTH_KV` (KV). Names must match `wrangler.jsonc` and `platform.cf.ts` |
| **IP-CF-3** | Wrangler env names `staging` / `production` match Terraform `environment` and Shopify toml `--config` |
| **IP-CF-4** | `AuthCoordinationStore` — package default memory; Workers pass KV |
| **IP-CF-5** | Session schema = verbatim adapter `sqlite.schema.ts`; `DrizzleSessionStorageSQLite` |

---

## 4. Manual deploy runbook

### 0. Prerequisites

- Cloudflare account, Workers Paid (custom domain + D1 + KV)
- `CLOUDFLARE_API_TOKEN` with Workers Scripts, D1, KV, Workers custom domains
- `wrangler login` (or the token) on this machine
- Two Shopify Partner apps (staging + production client IDs), or start with staging only
- Node 22, pnpm 10, Terraform ≥ 1.10

### 1. First-time bootstrap (once)

```bash
pnpm i
pnpm db:up          # local SQLite; still required for shopify app dev
```

Optional later: `wrangler r2 bucket create shopify-tanstack-starter-tfstate` and
copy `infra/envs/<env>/backend.hcl.example` → `backend.hcl`. Skip for the first
solo try-out (local Terraform state in `infra/envs/<env>/`).

### 2. Terraform apply (staging)

```bash
cd infra/envs/staging
cp terraform.tfvars.example terraform.tfvars   # fill account_id
terraform init
terraform plan
terraform apply
```

Apply patches `apps/web/wrangler.jsonc` `env.staging` with the Worker name, D1
name/id, KV id, and `HOST` (`*.workers.dev` when the account subdomain exists).
It does **not** write production, `SHOPIFY_API_KEY`, or secrets. Confirm with
`terraform output wrangler_snippet` if you want the values in the terminal too.

### 3. Secrets + vars

```bash
cd apps/web
# HOST is already in wrangler.jsonc from terraform apply.
# Add the public Shopify client id:
#   env.staging.vars.SHOPIFY_API_KEY
npx wrangler secret put SHOPIFY_API_SECRET
```

### 4. D1 migrations (remote)

```bash
cd apps/web
npx wrangler d1 migrations apply DB --remote
```

`drizzle-kit` generated the SQL; Wrangler applies it to the remote database.
Local apply remains `pnpm db:migrate` against the file SQLite.

### 5. Worker deploy

```bash
pnpm deploy:staging
# = CLOUDFLARE=1 vite build && wrangler deploy  (from apps/web)

# Vite must run first. `wrangler deploy` alone either esbuild-fails on
# TanStack virtual imports, or (if dist/ exists) uploads a stale
# dist/server/wrangler.json — that is where a deleted KV id can come from.
# Never pass `-c`.
```

Confirm the `*.workers.dev` URL serves the app.

### 6. Shopify app deploy (staging)

Edit `shopify.app.staging.toml` (`client_id`, `application_url`, `redirect_urls`)
then:

```bash
shopify app deploy --config shopify.app.staging.toml
```

Install the staging app on a dev store and open it embedded. Token exchange
should persist a `session` row in D1 (`wrangler d1 execute DB --command 'select id, shop from session'`).

### 7. Production (after staging works)

Same sequence in `infra/envs/production` + `pnpm deploy:production` +
`shopify.app.production.toml`. Terraform attaches `production_hostname` as a
Workers custom domain. D1/secrets for production use
`--config wrangler.production.jsonc` (safe for those commands; do not use `-c`
on `wrangler deploy`).

---

## 5. Cross-cutting rules

1. Package `src/**` stays runtime-agnostic (existing oxlint rule). Cloudflare
   types live in `apps/web` only.
2. No secrets in Terraform state — `wrangler secret put` only.
3. Do not manage Worker script content in Terraform (ADR 0015).
4. App-developer DX: `pnpm i && pnpm db:up && shopify app dev`. No Wrangler
   login required for that loop.
5. ADRs 0011–0017 are the source of truth if this plan and the code drift.

---

## 6. Post-deploy verification

- [ ] Staging `*.workers.dev` loads the non-embedded `/` banner
- [ ] Embedded load in a real dev store: `window.shopify` is an object, `idToken()`
      resolves, `<s-app-nav>` highlights, `generateProduct` mutates the store
- [ ] Uninstall webhook deletes the D1 session row
- [ ] A second Worker isolate (two concurrent loads) does not break auth
      (best-effort KV; residual double-`afterAuth` is accepted — starter handler
      is a no-op)
- [ ] Production custom domain (when applied) serves the same app with a
      different D1 / KV / Shopify client ID
- [ ] `shopify app dev` still works on Node + file SQLite after this change

---

## 7. Out of scope (still)

- GitHub Actions `terraform apply` / `wrangler deploy`
- Logging / observability beyond the Worker `observability.enabled` flag
- Per-PR preview Workers
- Cloudflare Queues (ADR 0014 — graduate with a bulk webhook topic)
- WAF / rate-limiting
