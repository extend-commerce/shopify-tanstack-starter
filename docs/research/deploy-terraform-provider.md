# Cloudflare Terraform provider (v5) — resource coverage & wrangler boundary

**Ticket:** [ENG-2366](https://linear.app/extend-commerce/issue/ENG-2366/research-cloudflare-terraform-provider-v5-resource-coverage-and)
**Question:** What can the Cloudflare Terraform provider actually manage for this stack, where's the seam against `wrangler.jsonc`, and how should state be stored?
**Date:** 2026-09-03
**Sources:** [Terraform Registry — cloudflare/cloudflare v5.23.0](https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs); [CF Workers IaC guide](https://developers.cloudflare.com/workers/platform/infrastructure-as-code/) (updated 2026-08-10); [v4→v5 upgrade guide](https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs/guides/version-5-upgrade); [CF changelog — new Workers API](https://developers.cloudflare.com/changelog/post/2025-09-03-new-workers-api/); community R2-backend posts.

---

## Recommendation

**Terraform provisions infrastructure (D1, KV, Queues, R2, DNS, the Worker shell). Wrangler deploys code.** Use the new beta `cloudflare_worker` / `cloudflare_worker_version` / `cloudflare_workers_deployment` resources for the Worker, not the legacy `cloudflare_workers_script`. Terraform creates the Worker name + observability config; Wrangler (or a second TF `cloudflare_worker_version`) uploads the script + bindings. Secrets stay out of Terraform — use `wrangler secret put` or `.dev.vars`.

Pin provider **≥ 5.23.0** (latest as of 2026-09-03). State backend on R2 with `use_lockfile = true`.

---

## 1. Resource coverage

| Stack resource | Terraform resource | Status in v5 |
|---|---|---|
| **Worker (shell)** | `cloudflare_worker` | ✅ Beta. Creates the Worker by name + observability config. No script content. |
| **Worker version (script + bindings)** | `cloudflare_worker_version` | ✅ Beta. Uploads modules, sets `compatibility_date`, `compatibility_flags`, and bindings. |
| **Worker deployment** | `cloudflare_workers_deployment` | ✅ Beta. Deploys a version at a percentage (100% for single-version). |
| **Worker script (legacy)** | `cloudflare_workers_script` | ✅ Legacy. Single resource that combines script + bindings + deployment. Still supported but the registry recommends the beta trio. |
| **Workers custom domain** | `cloudflare_workers_custom_domain` | ✅ `hostname`, `service`, `zone_id`. Production custom domain. |
| **Workers route** | `cloudflare_workers_route` | ✅ Pattern + script name. Alternative to custom domain. |
| **Workers subdomain** | `cloudflare_workers_subdomain` | ✅ Enables `*.workers.dev` subdomain for the account. |
| **D1 database** | `cloudflare_d1_database` | ✅ `name`, `jurisdiction`, `primary_location_hint`, `read_replication`. |
| **KV namespace** | `cloudflare_workers_kv_namespace` | ✅ `title`, `jurisdiction`. |
| **KV key-value** | `cloudflare_workers_kv` | ✅ Individual keys. Not needed for app runtime; useful for seeding. |
| **Queue** | `cloudflare_queue` | ✅ `queue_name`. Consumer config (script, batch_size, max_retries, DLQ) is in the `consumers` attribute. |
| **R2 bucket** | `cloudflare_r2_bucket` | ✅ `name`, `location`, `jurisdiction`, `storage_class`. |
| **DNS record** | `cloudflare_dns_record` | ✅ A/AAAA/CNAME. Usually not needed if using `cloudflare_workers_custom_domain`. |
| **Zone (data source)** | `data.cloudflare_zone` / `data.cloudflare_zones` | ✅ Look up zone ID by name. |
| **Worker secret** | ~~`cloudflare_workers_secret`~~ | ❌ **Removed in v5.** See section 4. |
| **Secrets Store** | `cloudflare_secrets_store`, `cloudflare_secrets_store_secret` | ✅ New in v5. Alternative to `wrangler secret put`. Values in TF state (plaintext). |
| **Logpush job** | `cloudflare_logpush_job` | ✅ Out of scope for this map (observability is deferred). |

### Bindings in `cloudflare_worker_version`

All bindings go in a flat `bindings` array with a `type` discriminator:

```hcl
bindings = [
  { type = "d1",           name = "DB",            id = cloudflare_d1_database.main.id },
  { type = "kv_namespace", name = "SESSION_KV",    namespace_id = cloudflare_workers_kv_namespace.session.id },
  { type = "queue",        name = "WEBHOOK_QUEUE",  queue_name = cloudflare_queue.webhooks.queue_name },
  { type = "r2_bucket",    name = "ASSETS",         bucket_name = cloudflare_r2_bucket.assets.name },
]
```

---

## 2. v5 specifics

### What changed from v4

- **`cloudflare_workers_secret` / `cloudflare_worker_secret` removed.** Secrets are now `secret_text` bindings on `cloudflare_workers_script`, Secrets Store resources, or `wrangler secret put`.
- **`cloudflare_workers_script`**: `name` → `script_name`; binding blocks (`kv_namespace_binding { }`) → flat `bindings = [{ type = "kv_namespace", ... }]` array.
- **New beta resources**: `cloudflare_worker`, `cloudflare_worker_version`, `cloudflare_workers_deployment` (since v5.9.0). These use the new `/workers/` beta API.
- **`tf-migrate` CLI**: Automates v4→v5 HCL migration. Not relevant for a greenfield module.

### Provider pin

```hcl
terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.23"
    }
  }
}
```

Latest: **5.23.0** (2026-07-10). v5.x releases are weekly. Pin to `~> 5.23` (any 5.x ≥ 5.23).

---

## 3. The wrangler ⇄ Terraform overlap

### Recommended division

| Concern | Owner | Why |
|---|---|---|
| **Infrastructure** (D1 db, KV ns, Queue, R2 bucket, DNS, custom domain) | **Terraform** | Declarative, auditable, diff-able. These are account-level resources that rarely change. |
| **Worker shell** (name, observability) | **Terraform** (`cloudflare_worker`) | Created once, referenced by name. |
| **Code deploy** (script content, compatibility_date, compatibility_flags, bindings wiring) | **Wrangler** (`wrangler deploy`) | Tight feedback loop with `vite build`. `wrangler.jsonc` references resources by name/ID. |
| **Secrets** | **`wrangler secret put`** | Stays out of TF state. `.dev.vars` for local dev. |

### Does `cloudflare_workers_script` fight `wrangler deploy`?

**Yes, if you manage script content in both.** Both `cloudflare_workers_script` and `wrangler deploy` upload the script via the same API. If Terraform manages the script, a subsequent `wrangler deploy` overwrites it, and the next `terraform plan` shows drift.

**The beta pattern avoids this:** `cloudflare_worker` creates the Worker name only. `wrangler deploy` (or `cloudflare_worker_version` + `cloudflare_workers_deployment` in TF) uploads the script. The IaC guide explicitly says: "you could use just the `cloudflare_worker` resource and seamlessly use Wrangler or your own deployment tools for Versions or Deployments."

**Recommended for this starter:**
1. Terraform creates `cloudflare_worker` (name + observability).
2. Terraform creates all infrastructure resources (D1, KV, Queue, R2, custom domain).
3. `wrangler.jsonc` references resource names/IDs (either hardcoded from TF output or templated).
4. `wrangler deploy` uploads the built script with bindings.
5. `wrangler secret put` sets secrets.

This avoids the script-content drift problem entirely.

### Binding names

Binding names (e.g. `DB`, `SESSION_KV`, `WEBHOOK_QUEUE`) must match between `wrangler.jsonc` and any TF `cloudflare_worker_version` config. If Wrangler owns the deploy, bindings are in `wrangler.jsonc` only. If TF owns the version, bindings are in the `cloudflare_worker_version` resource.

---

## 4. Secrets

**`cloudflare_workers_secret` was removed in v5.** Three alternatives:

| Method | Secrets in TF state? | Recommendation |
|---|---|---|
| `wrangler secret put` | No | ✅ **Use this.** Manual or CI-scripted. `.dev.vars` for local. |
| `secret_text` binding on `cloudflare_workers_script` | **Yes** (plaintext) | ❌ Avoid — secrets in state. |
| Secrets Store (`cloudflare_secrets_store_secret`) | **Yes** (plaintext in state) | ❌ Avoid unless state is encrypted. |

For the starter: **secrets = `wrangler secret put`**. The deploy plan's runbook documents the required secrets (Shopify API key/secret, etc.) and the commands to set them.

---

## 5. State backend on R2

**R2 works as a Terraform S3 backend.** R2 is S3-compatible and correctly honors `If-None-Match: *` conditional writes (verified by multiple community stress tests).

```hcl
terraform {
  backend "s3" {
    bucket = "terraform-state"
    key    = "shopify-starter/terraform.tfstate"
    region = "auto"

    # R2-specific overrides
    use_lockfile                = true   # native S3 locking (TF ≥ 1.10)
    use_path_style              = true
    skip_s3_checksum            = true
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_requesting_account_id  = true
    skip_region_validation      = true

    endpoints = {
      s3 = "https://<ACCOUNT_ID>.r2.cloudflarestorage.com"
    }
  }
}
```

### State locking

`use_lockfile = true` (Terraform ≥ 1.10) creates a `.tflock` file in the bucket using S3 conditional writes. No DynamoDB equivalent needed. R2 supports this correctly. **Best-effort** — not as strong as DynamoDB's transactional lock, but sufficient for manual `terraform apply` (one operator at a time). For CI, add a mutex (e.g. GitHub Actions concurrency group).

### Bootstrapping

The state bucket cannot be in the state it manages. **Create the R2 bucket manually** (dashboard or `wrangler r2 bucket create terraform-state`) before the first `terraform init`. Document this as a one-time bootstrap step in the runbook.

Enable **versioning** on the state bucket for rollback capability.

### State encryption

R2 encrypts at rest by default. For defense-in-depth (secrets that leak into state), consider OpenTofu's client-side state encryption or the Secrets Store approach. For a plan-only effort, document the risk and move on.

---

## 6. Two environments

### Recommended: separate root modules (not workspaces)

| Approach | Pros | Cons |
|---|---|---|
| **Terraform workspaces** | Single module, `terraform.workspace` variable | Shared state file backend config; easy to apply to wrong env; limited variable overrides |
| **Separate root modules** (e.g. `infra/envs/production/`, `infra/envs/staging/`) | Explicit, isolated state, clear blast radius | Some duplication (mitigated by a shared module) |
| **`for_each` over env map** | Single apply for all envs | Blast radius: one bad plan affects both envs |

**Recommended: separate root modules calling a shared module.**

```
infra/
  modules/
    shopify-worker/       # shared module
      main.tf             # cloudflare_worker, d1, kv, queue, r2, custom_domain
      variables.tf        # account_id, zone_id, app_name, env_name, subdomain
      outputs.tf          # resource IDs for wrangler.jsonc
  envs/
    production/
      main.tf             # module "app" { source = "../../modules/shopify-worker" ... }
      backend.tf          # S3 backend with production state key
      terraform.tfvars    # production values
    staging/
      main.tf             # module "app" { source = "../../modules/shopify-worker" ... }
      backend.tf          # S3 backend with staging state key
      terraform.tfvars    # staging values
```

### Per-env resource naming

Convention: `{app_name}-{env_name}` for all resources.

```hcl
variable "app_name"  { default = "shopify-starter" }
variable "env_name"  { type = string }  # "production" or "staging"

locals {
  prefix = "${var.app_name}-${var.env_name}"
}

resource "cloudflare_worker" "app" {
  name = local.prefix
  # ...
}

resource "cloudflare_d1_database" "main" {
  name = "${local.prefix}-db"
  # ...
}
```

Production: custom domain (`app.example.com` via `cloudflare_workers_custom_domain`).
Staging: `*.workers.dev` subdomain (automatic when `cloudflare_workers_subdomain` is enabled).

---

## 7. Auth

### Provider authentication

```hcl
provider "cloudflare" {
  api_token = var.cloudflare_api_token  # supplied via env var or tfvars (never committed)
}
```

The `CLOUDFLARE_API_TOKEN` environment variable is the standard mechanism. Never use the Global API key.

### Required API token scopes

For the resources in this stack, the token needs:

| Permission | Scope | For |
|---|---|---|
| Workers Scripts Read/Write | Account | `cloudflare_worker`, `cloudflare_worker_version`, `cloudflare_workers_deployment`, `cloudflare_workers_script` |
| Workers KV Storage Read/Write | Account | `cloudflare_workers_kv_namespace` |
| D1 Read/Write | Account | `cloudflare_d1_database` |
| Queues Read/Write | Account | `cloudflare_queue` |
| Workers R2 Storage Read/Write | Account | `cloudflare_r2_bucket` |
| Workers Custom Domains Read/Write | Account | `cloudflare_workers_custom_domain` |
| DNS Read/Write | Zone | `cloudflare_dns_record` (if used) |
| Workers Tail Read | Account | For `cloudflare_workers_script` (optional) |
| Account Settings Read | Account | For zone lookups |

**Token does not land in state** — it's provided at apply time via environment variable.

Create the token in the Cloudflare dashboard (API Tokens → Create Token → Custom Token) with the scopes above. The token can be scoped to a single account.

---

## Implications for decision tickets

| Ticket | Implication |
|---|---|
| **D-iac (ENG-2371)** | Use beta `cloudflare_worker` + Wrangler for code. Shared module, separate envs. R2 state backend with `use_lockfile`. |
| **D-envs (ENG-2372)** | Separate root modules for production/staging. `{app}-{env}` naming. Production = custom domain, staging = `*.workers.dev`. |
| **D-webhooks (ENG-2370)** | `cloudflare_queue` resource manages queue + consumer config (script, batch_size, DLQ). |
| **D-data (ENG-2368)** | `cloudflare_d1_database` creates the DB; migrations via `wrangler d1 migrations apply`. |
| **D-session-kv (ENG-2369)** | `cloudflare_workers_kv_namespace` creates the namespace; app code uses `env.SESSION_KV`. |

---

## Primary sources

| Claim | Source |
|---|---|
| `cloudflare_worker` / `cloudflare_worker_version` / `cloudflare_workers_deployment` beta resources | [CF changelog 2025-09-03](https://developers.cloudflare.com/changelog/post/2025-09-03-new-workers-api/), [IaC guide](https://developers.cloudflare.com/workers/platform/infrastructure-as-code/) |
| "use just `cloudflare_worker` and seamlessly use Wrangler" | [IaC guide](https://developers.cloudflare.com/workers/platform/infrastructure-as-code/) |
| `cloudflare_workers_secret` removed in v5 | [v5 upgrade guide](https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs/guides/version-5-upgrade) |
| `secret_text` binding, Secrets Store alternatives | [v5 upgrade guide](https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs/guides/version-5-upgrade), [CF community](https://community.cloudflare.com/t/best-practice-for-managing-worker-secrets-from-terraform/894507) |
| R2 S3 backend with `use_lockfile` | [Terraform 1.10 S3 locking](https://www.linkedin.com/posts/fizz-orange_til-terraform-s3-backend-has-native-state-activity-7429839851824439296-r69j), [jroddev R2 backend](https://blog.jroddev.com/opentofu-state-in-cloudflare-r2-without-giving-cloudflare-plaintext/), [BigMike R2 backend](https://bigmike.help/en/devops/how-i-tamed-terraform-moving-state-from-git-to-cloudflare-r2/) |
| R2 honors `If-None-Match: *` | [gordonmurray.ie S3 conditional writes test](https://gordonmurray.ie/data/2026/05/02/s3-is-the-perfect-place-to-store-data-until-you-try-to-search-it.html) |
| Bindings array format in v5 | [IaC guide § Bindings in Terraform](https://developers.cloudflare.com/workers/platform/infrastructure-as-code/) |
| `cloudflare_d1_database` resource | [Terraform Registry](https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs/resources/d1_database) |
| `cloudflare_queue` with consumers | [Terraform Registry](https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs/resources/queue) |
| `cloudflare_workers_custom_domain` | [Terraform Registry](https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs/resources/workers_custom_domain) |
| `cloudflare_r2_bucket` | [CF Terraform docs](https://developers.cloudflare.com/api/terraform/resources/r2/) |
| Provider v5.23.0 (latest) | [OpenTofu Registry](https://search.opentofu.org/provider/cloudflare/cloudflare/v5.22.0/docs/resources/queue) — v5.23.0 listed |
