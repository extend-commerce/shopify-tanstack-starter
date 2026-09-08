# Terraform module layout and the IaC / wrangler boundary

Decision: ENG-2371. Research: ENG-2366 (`docs/research/deploy-terraform-provider.md`).

## Decision

### Boundary

| Resource | Owner |
|---|---|
| Worker **shell** (name, observability, `*.workers.dev` subdomain flag) | Terraform `cloudflare_worker` |
| D1 database | Terraform `cloudflare_d1_database` |
| KV namespace (`AUTH_KV`) | Terraform `cloudflare_workers_kv_namespace` |
| Production custom domain | Terraform `cloudflare_workers_custom_domain` |
| R2 **state** bucket | Created out of band (bootstrap), not in the app module |
| Worker **code**, compatibility flags, binding **wiring** | **Wrangler** (`wrangler deploy`) |
| D1 migrations (apply) | Wrangler (`wrangler d1 migrations apply`) |
| Runtime secrets (`SHOPIFY_API_SECRET`, …) | `wrangler secret put` — **never Terraform** |

Do **not** manage script content with `cloudflare_workers_script` /
`cloudflare_worker_version`. Wrangler would fight Terraform on every deploy.

### Layout

```
infra/
  modules/shopify-worker/   # shared
  envs/staging/             # root module + own state key
  envs/production/          # root module + own state key
```

Separate root modules, not workspaces, not `for_each` over envs. Variables:
`account_id`, `zone_id` (production), `name_prefix`, `environment`,
`production_hostname` (e.g. `app.example.com`). Outputs: worker name, D1 id,
KV id, `app_host`. Apply also patches `apps/web/wrangler.jsonc` `env.<environment>`
(IDs + worker name + HOST) via `infra/scripts/sync-wrangler-jsonc.mjs`. Binding
names, `main`, and secrets stay Wrangler-owned.

### State

S3-compatible backend on R2, `use_lockfile = true` (Terraform ≥ 1.10). Bootstrap
the bucket with `wrangler r2 bucket create` (or the dashboard) **once**, out of
band. Enable versioning. Provider pin `cloudflare/cloudflare ~> 5.23`.

### Credentials

`CLOUDFLARE_API_TOKEN` in the environment for `terraform apply`. Token scopes:
Workers Scripts, D1, KV, Workers Routes/Custom Domains (production). Distinct
from Worker runtime secrets.

### Runbook skeleton

Bootstrap R2 state bucket → `terraform init/plan/apply` per env (apply writes
IDs into `wrangler.jsonc`) → `wrangler secret put` → `wrangler d1 migrations apply --remote`
→ `wrangler deploy --env …` → `shopify app deploy --config shopify.app.<env>.toml`.

## Why

- Research recommendation, matches the map (Terraform = account resources,
  Wrangler = code).
- Isolated state per env so a bad staging apply cannot touch production.

## Considered and rejected

- **Terraform workspaces.** Easy to apply to the wrong env; shared backend config.
- **Secrets Store / `secret_text` bindings.** Values land in TF state.
- **Queue resources in this module.** No consumer yet (ADR 0014).
