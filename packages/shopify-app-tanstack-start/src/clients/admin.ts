import {
  createAdminApiClient,
  type AllOperations,
  type AdminOperations,
  type ApiClientRequestOptions,
  type ClientResponse,
  type ResponseWithType,
  type ReturnData,
} from '@shopify/admin-api-client';
import type { ApiVersion, Session } from '@shopify/shopify-api';

/**
 * The Admin GraphQL capability (ADR 0003 1 / ADR 0010 2 / IP-4 / IP-5).
 *
 * `admin.graphql(query, { variables, apiVersion?, headers?, tries?, signal? })`
 * resolves a **Fetch `Response`** — RR-exact (`@shopify/shopify-app-react-router`
 * v2). ADR 0010 2 reverses ADR 0003's parsed-return decision: the `Response`
 * exposes `.status`, the real upstream headers (`Retry-After`, rate-limit,
 * `X-Shopify-API-Deprecated-Reason`), and `extensions.cost` — all of which the
 * parsed `{ data, errors, extensions }` shape hid. A server function unwraps
 * explicitly:
 *
 *   const res = await admin.graphql(QUERY, { variables });
 *   const { data } = await res.json();
 *
 * Built on `@shopify/admin-api-client`'s `createAdminApiClient(...).fetch` (the
 * same client `@shopify/shopify-app-react-router` v2's `admin.graphql` uses) — a
 * genuine `fetch` `Response` with genuine headers, `.json()` typed by the
 * library. `.fetch()` does **not** throw on an HTTP error status: an upstream
 * `401` / `429` / `5xx` comes back as a resolved `Response` carrying that status.
 *
 * The client's operation typing carries `AdminOperations`, which the app's
 * generated `app/types/admin.generated.d.ts` (WS7 / IP-5) module-augments — that
 * is how `(await res.json()).data` stays typed at the call site.
 */

/** Per-call options (RR `GraphQLQueryOptions`). */
export interface GraphQLQueryOptions<
  Operation extends keyof Operations,
  Operations extends AllOperations,
> {
  /** The variables to pass to the operation. */
  variables?: ApiClientRequestOptions<Operation, Operations>['variables'];
  /** Override the Admin API version for this request. */
  apiVersion?: ApiVersion;
  /** Additional request headers. */
  headers?: Record<string, string | number>;
  /** Total number of attempts if the request fails (RR semantics: `tries - 1` retries). */
  tries?: number;
  /** An `AbortSignal` to cancel the request. */
  signal?: AbortSignal;
}

/**
 * A Fetch `Response` whose `.json()` is typed against the operation's return
 * data (RR `GraphQLResponse`). Structurally a `Response`, so `res.status` /
 * `res.headers` are available.
 *
 * The `.json()` payload is `ClientResponse<…>` (`{ data?, errors?, extensions? }`)
 * — a superset of the library's `FetchResponseBody<…>` that also types a
 * transport-level `errors` array, so the starter's `generate-product.ts` demo can
 * unwrap `const { data, errors } = await res.json()` with no cast (ADR 0010 2,
 * deviation #2). `FetchResponseBody` structurally satisfies `ClientResponse`
 * (`errors` is optional), so widening `client.fetch`'s return to this is the one
 * internal cast `createAdminApiContext` makes.
 */
export type GraphQLResponse<
  Operation extends keyof Operations,
  Operations extends AllOperations,
> = ResponseWithType<ClientResponse<ReturnData<Operation, Operations>>>;

/** RR `GraphQLClient<Operations>` — a typed `admin.graphql`. */
export type GraphQLClient<Operations extends AllOperations> = <Operation extends keyof Operations>(
  query: Operation,
  options?: GraphQLQueryOptions<Operation, Operations>,
) => Promise<GraphQLResponse<Operation, Operations>>;

export interface AdminApiContext {
  /**
   * Same call signature as RR's `admin.graphql`. Resolves a Fetch `Response`
   * typed as `GraphQLClient<AdminOperations>` so `(await res.json()).data` stays
   * typed. An upstream Admin API error (401 / 429 / 5xx) resolves a `Response`
   * carrying that status — it is NOT thrown (the `adminMiddleware` adapter keys
   * on `res.status === 401`).
   */
  graphql: GraphQLClient<AdminOperations>;
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

  // `client.fetch` returns the genuine `fetch` `Response` (real headers, typed
  // `.json()`); it never throws on an HTTP error status. The one cast widens the
  // library's `FetchResponseBody`-typed `.json()` to `ClientResponse` (adds the
  // optional `errors`, ADR 0010 2 deviation #2).
  const graphql = ((operation: string, options: GraphQLQueryOptions<string, AllOperations> = {}) =>
    client.fetch(operation, {
      variables: options.variables as never,
      apiVersion: options.apiVersion ?? apiVersion,
      // `GraphQLQueryOptions` allows numeric header values (RR parity); the
      // client's `HeadersObject` is `string | string[]` and stringifies them.
      headers: options.headers as Record<string, string> | undefined,
      retries: options.tries ? options.tries - 1 : 0,
      signal: options.signal,
    })) as GraphQLClient<AdminOperations>;

  return { graphql };
}
