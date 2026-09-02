import { createAdminApiClient, type AdminApiClient } from '@shopify/admin-api-client';
import type { Session } from '@shopify/shopify-api';

/**
 * The Admin GraphQL capability (ADR 0003 §1 / IP-4 / IP-5).
 *
 * `admin.graphql(query, { variables, headers?, signal? })` resolves the **parsed**
 * `{ data, errors, extensions }` (`ClientResponse`) from `@shopify/admin-api-client`'s
 * `AdminApiClient` — it does **NOT** return a Fetch `Response` the way React
 * Router's `admin.graphql` does (cross-cutting rule #5). Code ported from an RR
 * template must drop the `.json()` unwrap and stop treating the result as a
 * `Response` (no `.status`, no `.headers` on it).
 *
 * The client's operation typing carries `AdminOperations`, which the app's
 * generated `app/types/admin.generated.d.ts` (WS7 / IP-5) module-augments — that
 * is how the typed operation strings resolve at the call site.
 */
export interface AdminApiContext {
  /**
   * Same call signature and parsed return as `AdminApiClient['request']`:
   * `Promise<ClientResponse<…>>` — i.e. `{ data?, errors?, extensions? }`.
   */
  graphql: AdminApiClient['request'];
}

export function createAdminApiContext(session: Session, apiVersion: string): AdminApiContext {
  if (!session.accessToken) {
    throw new Error(
      'shopify-app-tanstack-start: createAdminApiContext called with a session that has no accessToken',
    );
  }

  const client = createAdminApiClient({
    accessToken: session.accessToken,
    storeDomain: session.shop,
    apiVersion,
  });

  // `client.request` already resolves the parsed body ({ data, errors, extensions }).
  return { graphql: client.request };
}
