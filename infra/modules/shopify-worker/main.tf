terraform {
  required_version = ">= 1.10.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5"
    }
  }
}

variable "account_id" {
  type        = string
  description = "Cloudflare account ID."
}

variable "name_prefix" {
  type        = string
  description = "Resource name prefix. Forks pick their own (e.g. my-shopify-app)."
  default     = "shopify-tanstack-starter"
}

variable "environment" {
  type        = string
  description = "staging or production. Used in resource names."
}

variable "zone_id" {
  type        = string
  description = "Cloudflare zone ID for the production custom domain. Unused on staging."
  default     = ""
}

variable "production_hostname" {
  type        = string
  description = "Full production hostname (e.g. app.example.com). Empty on staging."
  default     = ""
}

locals {
  worker_name     = "${var.name_prefix}-${var.environment}"
  is_production   = var.environment == "production"
  workers_dev_url = try(cloudflare_worker.app.subdomain.url, "")
  app_host = (
    local.is_production && var.production_hostname != ""
    ? "https://${trimsuffix(var.production_hostname, "/")}"
    : local.workers_dev_url
  )
  wrangler_jsonc = local.is_production ? abspath("${path.module}/../../../apps/web/wrangler.production.jsonc") : abspath("${path.module}/../../../apps/web/wrangler.jsonc")
}

resource "cloudflare_worker" "app" {
  account_id = var.account_id
  name       = local.worker_name

  observability = {
    enabled = true
  }

  subdomain = {
    enabled          = true
    previews_enabled = true
  }
}

resource "cloudflare_d1_database" "main" {
  account_id = var.account_id
  name       = "${local.worker_name}-db"
}

resource "cloudflare_workers_kv_namespace" "auth" {
  account_id = var.account_id
  title      = "${local.worker_name}-auth"
}

resource "cloudflare_workers_custom_domain" "production" {
  count      = local.is_production && var.production_hostname != "" && var.zone_id != "" ? 1 : 0
  account_id = var.account_id
  zone_id    = var.zone_id
  hostname   = var.production_hostname
  service    = cloudflare_worker.app.name
}

output "worker_name" {
  value = cloudflare_worker.app.name
}

output "worker_id" {
  value = cloudflare_worker.app.id
}

output "d1_database_name" {
  value = cloudflare_d1_database.main.name
}

output "d1_database_id" {
  value = cloudflare_d1_database.main.id
}

output "auth_kv_id" {
  value = cloudflare_workers_kv_namespace.auth.id
}

output "auth_kv_title" {
  value = cloudflare_workers_kv_namespace.auth.title
}

output "app_host" {
  description = "Public origin written to wrangler.jsonc vars.HOST when known."
  value       = local.app_host
}

# Staging apply writes wrangler.jsonc; production writes wrangler.production.jsonc.
resource "terraform_data" "sync_wrangler_jsonc" {
  triggers_replace = {
    environment      = var.environment
    worker_name      = local.worker_name
    d1_database_name = cloudflare_d1_database.main.name
    d1_database_id   = cloudflare_d1_database.main.id
    auth_kv_id       = cloudflare_workers_kv_namespace.auth.id
    app_host         = local.app_host
    wrangler_jsonc   = local.wrangler_jsonc
  }

  provisioner "local-exec" {
    interpreter = ["node"]
    command     = abspath("${path.module}/../../scripts/sync-wrangler-jsonc.mjs")
    environment = {
      WRANGLER_JSONC    = local.wrangler_jsonc
      WRANGLER_SYNC_ENV = var.environment
      WORKER_NAME       = local.worker_name
      D1_DATABASE_NAME  = cloudflare_d1_database.main.name
      D1_DATABASE_ID    = cloudflare_d1_database.main.id
      AUTH_KV_ID        = cloudflare_workers_kv_namespace.auth.id
      APP_HOST          = local.app_host
    }
  }
}

output "wrangler_snippet" {
  description = "IDs also written into the env's Wrangler file on apply."
  value       = <<-EOT
    file: ${local.wrangler_jsonc}
      name: ${local.worker_name}
      d1_databases[0].database_name: ${cloudflare_d1_database.main.name}
      d1_databases[0].database_id: ${cloudflare_d1_database.main.id}
      kv_namespaces[0].id: ${cloudflare_workers_kv_namespace.auth.id}
      vars.HOST: ${local.app_host}
  EOT
}
