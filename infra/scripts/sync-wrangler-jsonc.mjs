#!/usr/bin/env node
/**
 * Patch Terraform-owned resource IDs into one Wrangler config file.
 *
 * Staging apply writes apps/web/wrangler.jsonc. Production apply writes
 * apps/web/wrangler.production.jsonc. Each file is a single Worker (no nested
 * `env` blocks) so a CLI staging deploy does not need production IDs.
 *
 * Binding names (`DB`, `AUTH_KV`), `main`, compatibility flags, and secrets
 * stay hand-authored. This script writes worker name, D1 name/id, KV id, and
 * HOST (when known).
 */
import { readFileSync, writeFileSync } from 'node:fs';

function parseJsonc(text) {
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(stripped);
}

function normalizeHost(host) {
  if (!host) return undefined;
  const trimmed = host.trim().replace(/\/$/, '');
  if (!trimmed) return undefined;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function syncWranglerConfig(config, input) {
  const vars = {
    ...(config.vars && typeof config.vars === 'object' ? config.vars : {}),
  };
  // One-time flatten if this file still has the old nested env layout.
  const nested = input.environment && config.env?.[input.environment]?.vars;
  if (nested && typeof nested === 'object') Object.assign(vars, nested);
  delete config.env;

  config.name = input.workerName;
  config.d1_databases = [
    {
      binding: 'DB',
      database_name: input.d1Name,
      database_id: input.d1Id,
      migrations_dir: 'app/db/migrations',
    },
  ];
  config.kv_namespaces = [
    {
      binding: 'AUTH_KV',
      id: input.kvId,
    },
  ];
  if (!vars.SCOPES) vars.SCOPES = 'write_products';
  const host = normalizeHost(input.host);
  if (host) vars.HOST = host;
  config.vars = vars;
  return config;
}

function readInputFromEnv() {
  const wranglerPath = process.env.WRANGLER_JSONC;
  const workerName = process.env.WORKER_NAME;
  const d1Name = process.env.D1_DATABASE_NAME;
  const d1Id = process.env.D1_DATABASE_ID;
  const kvId = process.env.AUTH_KV_ID;
  if (!wranglerPath || !workerName || !d1Name || !d1Id || !kvId) {
    console.error(
      'sync-wrangler-jsonc: missing WRANGLER_JSONC, WORKER_NAME, D1_DATABASE_NAME, D1_DATABASE_ID, or AUTH_KV_ID',
    );
    process.exit(1);
  }
  return {
    environment: process.env.WRANGLER_SYNC_ENV ?? '',
    wranglerPath,
    workerName,
    d1Name,
    d1Id,
    kvId,
    host: process.env.APP_HOST ?? '',
  };
}

function headerComment(environment) {
  const which =
    environment === 'production'
      ? 'Production Worker (`wrangler.production.jsonc`). Filled by production terraform apply / CI.'
      : 'Staging Worker (`wrangler.jsonc`). Filled by staging terraform apply; CLI deploys use this file.';
  return `/**
 * ${which}
 * Binding names (DB, AUTH_KV) are the contract with app/platform.cf.ts.
 * Worker name, D1 IDs, KV IDs, and HOST are written by terraform apply
 * via infra/scripts/sync-wrangler-jsonc.mjs.
 * SHOPIFY_API_KEY stays a hand-edited var. SHOPIFY_API_SECRET is a wrangler secret.
 */
`;
}

function main() {
  const input = readInputFromEnv();
  const previous = parseJsonc(readFileSync(input.wranglerPath, 'utf8'));
  const next = syncWranglerConfig(previous, input);
  writeFileSync(
    input.wranglerPath,
    `${headerComment(input.environment)}${JSON.stringify(next, null, 2)}\n`,
  );
  const host = normalizeHost(input.host);
  console.log(
    `Updated ${input.wranglerPath} (d1=${input.d1Id}, kv=${input.kvId}${host ? `, host=${host}` : ''})`,
  );
}

if (process.argv.includes('--self-test')) {
  const got = syncWranglerConfig(
    {
      name: 'old',
      vars: { SCOPES: 'write_products', SHOPIFY_API_KEY: 'keep-me' },
      env: {
        staging: { vars: { HOST: 'https://from-nested.example' } },
        production: { name: 'must-not-remain' },
      },
    },
    {
      environment: 'staging',
      workerName: 'app-staging',
      d1Name: 'app-staging-db',
      d1Id: 'd1-id',
      kvId: 'kv-id',
      host: 'app-staging.example.workers.dev',
    },
  );
  if (got.env) throw new Error('nested env should be removed');
  if (got.name !== 'app-staging') throw new Error('worker name not written');
  if (got.vars.SHOPIFY_API_KEY !== 'keep-me') throw new Error('api key dropped');
  if (got.d1_databases[0].database_id !== 'd1-id') throw new Error('d1 not written');
  if (got.vars.HOST !== 'https://app-staging.example.workers.dev') {
    throw new Error(`host not normalized: ${got.vars.HOST}`);
  }
  console.log('self-test ok');
} else {
  main();
}
