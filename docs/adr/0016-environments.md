# Environments (production + staging) and per-env Shopify config

Decision: ENG-2372. Depends on ADR 0011 / 0015.

## Decision

| | Staging | Production |
|---|---|---|
| Hostname | `https://<name_prefix>-staging.<account>.workers.dev` | Custom domain, Terraform `production_hostname` (per-app subdomain on the caller's zone) |
| Wrangler config | `apps/web/wrangler.jsonc` (CLI `wrangler deploy`) | `apps/web/wrangler.production.jsonc` (`WRANGLER_CONFIG=… wrangler deploy`, never `-c`) |
| Shopify config | `shopify.app.staging.toml` | `shopify.app.production.toml` |
| D1 / KV / secrets | Own set, names `<prefix>-staging-*` | Own set, names `<prefix>-production-*` |
| `shopify app dev` | Unchanged: root `shopify.app.toml` + CLI tunnel | n/a |

A second app forking the starter picks its own `name_prefix` and
`production_hostname`. Nothing in the module is hard-coded to this repo's
Shopify client ID.

`wrangler.jsonc` is the staging Worker (CLI). Production is a second file,
`wrangler.production.jsonc`. Terraform apply **patches** the matching file
with worker name, D1 name/id, KV id, and HOST. Binding names, `main`, and
`SHOPIFY_API_KEY` stay Wrangler-owned. Never `wrangler deploy -c` — that
skips Vite.

**Shopify:** two Partner Dashboard apps (or two TOML configs against two client
IDs). `application_url` / `auth.redirect_urls` / webhook URIs are the env
hostname. `shopify app deploy --config shopify.app.staging.toml` (and
`.production.`). Root `shopify.app.toml` remains the `shopify app dev` file
(ADR 0008). One dated `API_VERSION` still feeds runtime + codegen; the toml
`[webhooks] api_version` stays in sync by comment.

**Secrets per env:** `wrangler secret put SHOPIFY_API_SECRET --env <env>`.
`SHOPIFY_API_KEY`, `SCOPES`, `HOST` are Wrangler `vars` (the API key is already
public in HTML). `.dev.vars` is only for `wrangler`/`CLOUDFLARE=1` local preview,
not for `shopify app dev` (that keeps root `.env`).

**Promotion:** none. Each env is deployed independently from `main`. No staging
→ production artifact promotion in this phase.

## Why

- Map destination: production on a custom domain, staging on `*.workers.dev`.
- Independent deploys are the minimal promotion story for a manual CLI try-out.

## Considered and rejected

- **One Shopify app, two URLs.** Managed install / client ID / webhooks are
  per-app; mixing staging and production on one client ID is how UAT gets
  polluted.
- **Generate the whole `wrangler.jsonc` from Terraform.** Double-manages binding
  names and fights hand-edits. Patching IDs/HOST on apply is the seam instead.
