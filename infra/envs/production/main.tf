terraform {
  required_version = ">= 1.10.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5"
    }
  }

  # First CLI try-out: local state (this directory). Before a second operator
  # exists, switch to the R2 backend in backend.hcl.example:
  #   terraform init -backend-config=backend.hcl
}

provider "cloudflare" {
  # CLOUDFLARE_API_TOKEN in the environment. Do not commit tokens.
}

module "app" {
  source = "../../modules/shopify-worker"

  account_id          = var.account_id
  name_prefix         = var.name_prefix
  environment         = "production"
  zone_id             = var.zone_id
  production_hostname = var.production_hostname
}

variable "account_id" {
  type        = string
  description = "Cloudflare account ID."
}

variable "name_prefix" {
  type    = string
  default = "shopify-tanstack-starter"
}

variable "zone_id" {
  type        = string
  description = "Cloudflare zone ID that owns production_hostname."
}

variable "production_hostname" {
  type        = string
  description = "Full production hostname, e.g. app.example.com."
}

output "worker_name" { value = module.app.worker_name }
output "d1_database_id" { value = module.app.d1_database_id }
output "d1_database_name" { value = module.app.d1_database_name }
output "auth_kv_id" { value = module.app.auth_kv_id }
output "app_host" { value = module.app.app_host }
output "wrangler_snippet" { value = module.app.wrangler_snippet }
