/// <reference types="@cloudflare/workers-types" />

/**
 * Bindings for the Workers build (ADR 0011 / 0016). Augments the `Env` that
 * `cloudflare:workers` already declares (workers-types v5). `wrangler types`
 * (cf-typegen) can replace this once someone has run it against a real account.
 */
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    AUTH_KV: KVNamespace;
    SHOPIFY_API_KEY: string;
    SHOPIFY_API_SECRET: string;
    SCOPES: string;
    HOST: string;
  }
}
