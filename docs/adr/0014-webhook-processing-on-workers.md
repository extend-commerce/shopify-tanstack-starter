# Webhook processing on Workers

Decision: ENG-2370. Research: ENG-2365 (`docs/research/deploy-queues-cost.md`).
Brings ENG-2320's deferred "queue-based webhook processing rework" **partially**
into scope and then **parks the queue** for the topics this starter actually
ships.

## Decision

**Keep HMAC + work synchronous** for the three starter handlers
(`app/uninstalled`, `app/scopes_update`, GDPR compliance stubs). The
`shopify.handlers.webhooks` factory (ADR 0004) is unchanged. Package stays
runtime-agnostic; no Queue producer in `apps/web`.

Shopify's 5s HTTPS timeout is plenty for a D1 delete / a scope column write / a
200 stub. Shopify already retries on non-2xx (8 times / 4 hours). Queues would
add Miniflare-only local DX and a `queue()` custom entry for work that does not
need it.

**Bulk topics** (`orders/*`, `products/*`, anything that can burst or exceed 5s)
HMAC-validate synchronously, enqueue `{ shop, topic, webhookId, apiVersion, payload }`,
process in the same Worker's `queue()` with a DLQ. That path is specified, not
shipped — graduate it when a real bulk handler exists. Do **not** use
`ctx.waitUntil()` for control/GDPR topics (a 200 drops Shopify's retry).

ENG-2320's "queue rework out of scope" line is superseded by this ticket, and
then this ticket chooses not to ship a queue for the current surface.

## Why

- Cost is not the issue ($0.80 at 1M webhooks/month on Workers Paid). Complexity
  and local DX are. Standing preference: most minimal implementation.
- Custom `app/server.ts` + Queue bindings with no producer is the half-wired
  config ADR 0009 warned against.

## Considered and rejected

- **Queue everything, including control topics.** Status-quo is simpler and
  keeps `shopify app dev` identical.
- **`waitUntil()` after 200.** Silent failure after ack. Unsafe for uninstall /
  GDPR.
- **Durable Objects as a bus.** More expensive, more code.

## Consequences

- Terraform does **not** create a Queue / DLQ in this phase.
- `wrangler.jsonc` `main` is `./app/server.ts` (a filesystem entry Wrangler can
  resolve; it re-exports TanStack Start's fetch handler). Do **not** add
  `queue()` there until a bulk topic needs it.
- When a bulk topic lands: add `queue()` on that same entry, a Queue + DLQ in
  the Terraform module, and an app-level dispatcher wrapping the existing
  factory (HMAC in the route, work in `queue()`).
