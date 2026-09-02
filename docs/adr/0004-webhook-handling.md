# Webhook handling

Webhooks are received as **TanStack Start server routes** under a configurable
`webhookPath` prefix (default `/webhooks`), validated inside a single factory, and
subscribed **only** through `shopify.app.toml` — not through the React Router
package's `webhooks` config field + `afterAuth` registration.

- **Factory.** `shopify.handlers.webhooks(...)` (pre-bound on the `createShopifyApp`
  return; also re-exported as `createWebhookHandler(shopify, ...)` from
  `shopify-app-tanstack-start/webhooks`). It is polymorphic:
  - a **single `WebhookHandler`** — topic is read from the validated request, one
    route file per topic, optional `expectedTopic` guard returns `400` on mismatch;
  - a **topic-keyed map** — one splat route dispatches internally; an unknown topic
    returns `200` + `logger.warning`.

  Either way it returns a plain `({ request }) => Promise<Response>` the route file
  wires into whatever the current TanStack Start server-route API is.
- **Validation.** The factory reads the raw body once (`request.text()`) and calls
  `api.webhooks.validate({ rawBody, rawRequest })`. No layout middleware.
- **Handler contract.** `WebhookHandler = (ctx: WebhookContext) => Promise<void>`,
  `WebhookContext = { shop, topic, webhookId, apiVersion, payload, session? }`.
  `session` is the offline session via `ensureValidOfflineSession(shop)` and may be
  `undefined` (app already uninstalled). No `admin` client is built by default.
  Return value is ignored; a throw yields `500` so Shopify retries.
- **Status contract** (matches `authenticate.webhook`): `200` empty on success /
  `500` on throw / `401` bad HMAC / `400` missing headers, unparseable body, or
  topic-guard mismatch / `405` non-POST.
- **Registration.** Subscriptions are declared in `shopify.app.toml`
  (`[[webhooks.subscriptions]]`, explicit `uri` per topic, `api_version` pinned to
  one literal shared with the app's `apiVersion` constant). `registerWebhooks({
  session })` (a thin wrap of `api.webhooks.register`) still ships from the
  `/webhooks` export as a documented escape hatch the starter never calls.
- **`requestMiddleware` interaction.** `createShopifyApp` config gains `webhookPath`;
  the global middleware from ADR 0002 auto-excludes anything under it from embedded
  auth. The exhaustive exclusion list is still assembled in ENG-2331 — this is its
  default.

Starter routes: `routes/webhooks/app/uninstalled.ts` (single-handler; deletes the
offline session for the shop, idempotent), `routes/webhooks/app/scopes_update.ts`
(single-handler; persists `payload.current` onto `Session.scope` — the persistence
side handed down from ENG-2326), `routes/webhooks/compliance/$.ts` (map mode over
`customers/data_request`, `customers/redact`, `shop/redact`; HMAC-validated `200`
stubs, declared in the toml so the app is App-Store-submission-ready).

## Why

- **Server routes, not `createServerFn`.** Webhooks are outside callers posting HMAC
  bodies; server functions are same-origin RPC and get auto-CSRF. The TanStack Start
  research is explicit that these must not be server functions.
- **`shopify.app.toml`-only registration.** This is the current Shopify-CLI-managed
  model. It makes the toml the single source of truth, removes an `afterAuth` side
  effect (and its 60 s-TTL idempotency concern from ADR 0002), and means the app
  never needs `api.webhooks.addHandlers` / `process` topic-routing — each route file
  is its own handler. `registerWebhooks` is kept only so an app that wants
  programmatic registration is not forced to fork the package.
- **Polymorphic factory.** The RR template ships per-topic route files; a single
  dispatch endpoint is also a common shape. Supporting both is a few lines in the
  factory and avoids dictating route-tree structure to the consuming app.
- **No `admin` client by default.** Neither example topic needs the Admin API.
  Building a client (and loading/refreshing a token) on every webhook is waste; an
  opt-in can be added if a future topic needs it.

## Considered and rejected

- **RR's runtime model** — `webhooks` config map → `api.webhooks.addHandlers` +
  `registerWebhooks` in `afterAuth`. Rejected as the default: it duplicates the toml,
  adds startup and post-auth work, and the CLI-managed toml path is where Shopify is
  heading. Still reachable via the shipped `registerWebhooks`.
- **A pathless layout `server.middleware` for HMAC.** Rejected: indirection without
  payoff for two or three routes; the factory already guarantees validation runs
  before the handler body.
- **`404` / `500` for an undeclared topic in map mode.** Rejected: a non-2xx drives
  Shopify retries and eventually auto-disables the subscription. Acknowledge (`200`)
  and log instead.

## Consequences

- Webhook handler bodies run inside the request — there is no queue (the
  cloud-events / queue rework is out of scope for this map). A slow handler holds the
  connection; Shopify's delivery timeout applies.
- `app/uninstalled` does not cascade-delete demo app data. The route file carries a
  `// TODO: delete demo rows for shop` that resolves against the ENG-2329 schema.
- The `webhookPath` default only covers routes actually placed under `/webhooks`.
  ENG-2331 owns making the full `requestMiddleware` exclusion list match the route
  tree; a webhook route placed elsewhere and not added there breaks (same
  load-bearing-list caveat as ADR 0002).
