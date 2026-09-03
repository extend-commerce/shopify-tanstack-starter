import type {
  AllOperations,
  AdminOperations,
  ApiClientRequestOptions,
  FetchResponseBody,
  ResponseWithType,
  ReturnData,
} from '@shopify/admin-api-client';
import type { ApiVersion, Session, Shopify } from '@shopify/shopify-api';
import { HttpResponseError } from '@shopify/shopify-api';

/**
 * The Admin GraphQL capability (ADR 0003 1 / ADR 0010 2 / IP-4 / IP-5).
 *
 * `admin.graphql(query, { variables, apiVersion?, headers?, tries?, signal? })`
 * resolves a **Fetch `Response`** — RR-exact (`@shopify/shopify-app-react-router`
 * v2). ADR 0010 2 reverses ADR 0003's parsed-return decision: the `Response`
 * exposes `.status`, rate-limit / cost headers (`extensions.cost`, `Retry-After`),
 * and deprecation warnings that the parsed `{ data, errors, extensions }` shape
 * hid. A server function unwraps explicitly:
 *
 *   const res = await admin.graphql(QUERY, { variables });
 *   const { data } = await res.json();
 *
 * Built on `new api.clients.Graphql({ session, apiVersion })` (RR's client), NOT
 * `@shopify/admin-api-client`'s `createAdminApiClient` — that package stays a
 * dependency for `AdminOperations` typing only (ADR 0010 Consequences).
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
 */
export type GraphQLResponse<
  Operation extends keyof Operations,
  Operations extends AllOperations,
> = ResponseWithType<FetchResponseBody<ReturnData<Operation, Operations>>>;

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

export function createAdminApiContext(
  api: Shopify,
  session: Session,
  apiVersion: string,
): AdminApiContext {
  if (!session.accessToken) {
    throw new Error(
      'shopify-app-tanstack-start: createAdminApiContext called with a session that has no accessToken',
    );
  }

  const graphql = (async (
    operation: string,
    options: GraphQLQueryOptions<string, AllOperations> = {},
  ) => {
    const client = new api.clients.Graphql({
      session,
      apiVersion: (options.apiVersion ?? apiVersion) as ApiVersion,
    });

    try {
      // `client.request` resolves the parsed `{ data, errors, extensions }`; we
      // wrap it back into a `Response` to match RR's `admin.graphql` shape.
      const apiResponse = await client.request(operation, {
        variables: options.variables as never,
        retries: options.tries ? options.tries - 1 : 0,
        headers: options.headers,
        signal: options.signal,
      });

      return new Response(JSON.stringify(apiResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    } catch (error) {
      // An HTTP-level failure (401 invalid token, 429 throttle, 5xx) is a thrown
      // `HttpResponseError` in `@shopify/shopify-api`. Surface it as a `Response`
      // with the upstream status so the 401-retry wrapper (ADR 0010 1) can act on
      // `res.status === 401` instead of sniffing an error shape.
      if (error instanceof HttpResponseError) {
        return new Response(JSON.stringify(error.response.body ?? {}), {
          status: error.response.code,
          statusText: error.response.statusText,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw error;
    }
  }) as GraphQLClient<AdminOperations>;

  return { graphql };
}
