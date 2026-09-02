# Three-way context model, and `admin.graphql` returns parsed data

There is **no single "populated context" object**. What React Router hands back from
one `authenticate.admin(request)` call is split across three places:

1. **`adminMiddleware` server-fn context** `{ admin, session, scopes, billing }` —
   the authenticated critical path, server-only, attached by function middleware to
   every `createServerFn` that touches the Admin API.
2. **`unauthenticated.admin(shop)` / `unauthenticated.storefront(shop)`** — free
   functions for offline access with no session token (webhooks, cron, app proxy).
3. **Client-safe router context** `{ shop, isAuthenticated, queryClient }` — the only
   context that reaches the browser, populated during SSR from the global
   `requestMiddleware` result and dehydrated.

`admin.graphql(query, { variables })` resolves the **parsed** `{ data, errors,
extensions }` from `@shopify/admin-api-client`'s `GraphQLClient<AdminOperations>` — it
does **not** return a Fetch `Response` the way React Router's `admin.graphql` does.

## Why

- The split is forced by the TanStack execution model (ENG-2321 research): loaders and
  `beforeLoad` are isomorphic and their return values are dehydrated to the client, so
  an access token or a live client cannot live there. The token stays in
  server-function / middleware context; anything the browser needs is the
  `{ shop, isAuthenticated }` subset.
- Parsed over `Response`: a server function returns a serialisable value, so the
  caller wants `{ data }`, not `await (await admin.graphql(...)).json()`. RR's
  `Response` wrapper exists for Remix loader ergonomics this project does not have.
  `@shopify/api-codegen-preset` types the operation either way.

## Consequences

- Every Admin API call in `apps/web` goes through a `createServerFn` carrying
  `adminMiddleware`; loaders call those server functions. There is no `admin` in a
  loader or component.
- Code ported from an RR template must drop the `.json()` unwrap on `admin.graphql`
  results and stop treating the result as a `Response` (no `.status`, no `.headers`).
- `billing` is in the context type from the start, but its helpers are the deferred
  slot from ADR 0001 / ENG-2325 — the shape is reserved, the implementation lands later.
- A full Customer Account GraphQL client is out of scope: RR ships none, and it needs
  its own storefront-hosted customer-token flow. Only
  `authenticate.public.customerAccount` (session-token validation + CORS) is provided.
