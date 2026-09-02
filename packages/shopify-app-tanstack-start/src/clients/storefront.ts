import type { ApiVersion, Session, Shopify } from '@shopify/shopify-api';

/**
 * The offline Storefront GraphQL capability (ADR 0003 §2, §capability parity).
 *
 * Reached ONLY via `unauthenticated.storefront(shop)` — there is no authenticated
 * `storefront` in this package (RR parity). Like `admin.graphql`, it resolves the
 * **parsed** `{ data, errors, extensions }`, not a Fetch `Response`.
 *
 * Built on `@shopify/shopify-api`'s `api.clients.Storefront` so the package takes
 * no direct dependency on `@shopify/storefront-api-client`. Nothing in the starter
 * uses Storefront GraphQL (ADR 0007: `ApiType.Admin` only); a consumer that wants
 * typed `StorefrontOperations` swaps in the typed client.
 */
export type StorefrontGraphqlResponse<TData = unknown> = {
  data?: TData;
  errors?: unknown;
  extensions?: Record<string, unknown>;
};

export interface StorefrontApiContext {
  graphql: <TData = unknown>(
    query: string,
    options?: {
      variables?: Record<string, unknown>;
      headers?: Record<string, string | number>;
      signal?: AbortSignal;
    },
  ) => Promise<StorefrontGraphqlResponse<TData>>;
}

export function createStorefrontApiContext(
  api: Shopify,
  session: Session,
  apiVersion: string,
): StorefrontApiContext {
  const client = new api.clients.Storefront({
    session,
    apiVersion: apiVersion as ApiVersion,
  });

  const graphql = (async (query: string, options: Record<string, unknown> = {}) => {
    // `client.request` resolves the parsed `ClientResponse` ({ data, errors, extensions }).
    return client.request(query, {
      variables: options.variables as never,
      headers: options.headers as never,
      signal: options.signal as never,
    });
  }) as StorefrontApiContext['graphql'];

  return { graphql };
}
