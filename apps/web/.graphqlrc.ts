import { shopifyApiProject, ApiType } from '@shopify/api-codegen-preset';
import type { IGraphQLConfig } from 'graphql-config';

import { API_VERSION } from './app/shopify.config';

/**
 * GraphQL codegen config (ADR 0007 §GraphQL codegen).
 *
 * - Admin API only — nothing in the starter uses Storefront / Customer GraphQL.
 * - `apiVersion` comes from the ONE shared dated constant (`app/shopify.config.ts`),
 *   the same value `createShopifyApp` runs with (cross-cutting rule #7). Never
 *   `LATEST_API_VERSION`.
 * - `documents` scans the app's `#graphql`-tagged operation strings (the two
 *   product mutations in `app/server/generate-product.ts`) and excludes the
 *   generated output itself.
 * - Emits two files into `app/types/`:
 *     - `admin.types.d.ts`     — schema types for `API_VERSION` (app-independent;
 *                                a one-line move into a shared package if a second
 *                                app ever lands — ADR 0007).
 *     - `admin.generated.d.ts` — operation types built from THIS app's query
 *                                strings; module-augments `@shopify/admin-api-client`'s
 *                                `AdminQueries` / `AdminMutations`, which is how the
 *                                package's `GraphQLClient<AdminOperations>` typing
 *                                (IP-5) resolves at each call site.
 *
 * Both files are committed so a fresh `pnpm i && pnpm typecheck` needs no schema
 * fetch (RR parity). Regenerate with `pnpm --filter web graphql-codegen` whenever
 * the operation strings or `API_VERSION` change — that requires network access to
 * `shopify.dev` for the Admin schema.
 */
const config: IGraphQLConfig = {
  projects: {
    default: shopifyApiProject({
      apiType: ApiType.Admin,
      apiVersion: API_VERSION,
      documents: ['app/**/*.{ts,tsx}', '!app/types/**'],
      outputDir: './app/types',
    }),
  },
};

export default config;
