# Cloudflare Queues pricing vs Shopify webhook volume

**Ticket:** [ENG-2365](https://linear.app/extend-commerce/issue/ENG-2365/research-cloudflare-queues-pricing-vs-webhook-volume-cost-optimized)
**Question:** Is Cloudflare Queues cost-safe for a Shopify app that may receive high webhook volume, and if not, what's the cheaper async mechanism?
**Date:** 2026-09-03 (pricing pages retrieved this day; Queues pricing page `dateModified` 2026-04-21, Workers pricing page 2026-08-28)
**Sources:** Cloudflare Queues pricing / limits / configure / DLQ / JS APIs / local-development; Workers pricing / limits; Shopify `verify-deliveries` + privacy-law-compliance. Not vendored.

---

## Recommendation

**Queues is cost-safe on Workers Paid. Cost is not the reason to skip it.** One million typical Shopify webhooks/month is **$0.80** of Queues operations above the included 1M ops; ten million is **$11.60**. That sits on top of the **$5/month Workers Paid** floor the deploy already implies (custom domain, D1, KV). The billed unit is **operations per 64 KB chunk of write/read/delete**, not “per message,” and a normal `<64 KB` enqueue→consume→ack is **3 ops**. Batching does **not** discount ops.

The reason to hesitate is **complexity and local DX**, not money:

- The starter’s shipped topics (`app/uninstalled`, `app/scopes_update`, GDPR stubs) are a D1 write / no-op that already finishes inside Shopify’s **5-second HTTPS timeout**. Status-quo **synchronous** processing plus Shopify’s **8 retries / 4 hours** is the minimal implementation and works under `shopify app dev` with **no Wrangler / no Cloudflare account**.
- `ctx.waitUntil()` after a 200 is cheaper than a queue (no extra ops) but **drops Shopify’s retry** once you have acknowledged. A failed `afterAuth`-style side effect is then gone. Do not use it for `app/uninstalled` or GDPR redaction.
- **Durable Objects** as a queue are strictly more expensive (duration-billed wall-clock + $12.50/million GB-s) and more code. Rejected as the webhook bus.

**Recommendation input for D-webhooks (ENG-2370), split by topic class:**

| Class | Fit | Why |
|---|---|---|
| **Control** — `app/uninstalled`, `app/scopes_update`, `customers/*`, `shop/redact` | Keep **synchronous** HMAC + work (status quo) | Tiny, must succeed, Shopify already retries on non-2xx; GDPR action SLA is **30 days** after a 200, not 5 seconds |
| **Bulk** — `orders/*`, `products/*`, anything that can burst or exceed 5s | HMAC-validate + **enqueue**, `queue()` consumer + DLQ | Queues cost is negligible; Shopify’s own docs tell you to queue to stay inside 5s; 128 KB message cap means enqueue a **pointer** (or truncated body), not a guaranteed raw payload |

Local: Queues only exist under `wrangler dev` (Miniflare). They do **not** run if `shopify app dev` drives Vite directly (ADR 0008). That is a D-localdev concern, not a cost one.

---

## 1. Queues pricing model

**Queues is on the Workers Free plan** as of the 2026-02-04 changelog ([Queues now available on Workers Free plan](https://developers.cloudflare.com/changelog/post/2026-02-04-queues-free-plan/)). It is not Paid-only.

Source: [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/) (retrieved 2026-09-03; page `dateModified` 2026-04-21). Same table is mirrored on [Workers pricing → Queues](https://developers.cloudflare.com/workers/platform/pricing/).

| | Workers Free | Workers Paid |
|---|---|---|
| Standard operations | **10,000 operations/day** included | **1,000,000 operations/month** included + **$0.40 / million** operations |
| Message retention | 24 hours, non-configurable | 4 days default, configurable up to 14 days |

Billed unit, quoted:

- An **operation** is counted for each **64 KB** of data that is **written, read, or deleted**.
- Messages **larger than 64 KB** are charged as multiple messages: a 65 KB message and a 127 KB message both incur **two** operation charges when written, read, or deleted.
- A KB is **1,000 bytes**; each message includes ~**100 bytes** of internal metadata.
- Operations are **per message, not per batch**. A batch of 10 processed messages = 10 writes + 10 reads + 10 deletes.
- No egress / throughput charges.

“In most cases, it takes **3 operations** to deliver a message: 1 write, 1 read, and 1 delete.” Cloudflare’s own Paid estimate:

```text
((Number of Messages * 3) - 1,000,000) / 1,000,000 * $0.40
```

Retries and DLQ extras (same page):

- Each **retry incurs a read** (a 10-message batch retried = 10 extra ops per retry).
- A message retried 3 times (default), failing on the fourth, then written to a DLQ: **five read operations** plus the DLQ **write**.
- Messages that **expire** before a read: write + delete only (no read).

Workers Paid itself is **$5/month** minimum and includes Workers / KV / Hyperdrive / Durable Objects allotments ([Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)). The deploy map’s custom domain + D1 + KV already puts the app on Paid; Queues ops are incremental on that floor.

The Free daily 10k-ops cap is a **hard ceiling for that plan**, not a “then $0.40” overage. The pricing table lists no paid overage for Free.

---

## 2. Volume math (Shopify webhooks)

Assumptions (stated so D-webhooks can swap them):

- Typical Shopify HTTPS webhook JSON is **well under 64 KB** (plus ~100 B metadata) → **1 chunk** per op. Huge `orders/*` payloads can exceed 64 KB (and even Queues’ **128 KB** message cap — see §3). Table below is the 1-chunk case.
- Path: enqueue (`write`) → consumer (`read`) → ack (`delete`) = **3 ops / webhook**, no retries, no DLQ.
- Worker **HTTP** ingest of the webhook is billed as a normal Worker request regardless of whether we also enqueue. That cost exists today. Queue **consumer** invocations burn **CPU time** (Paid: 30M CPU-ms included/month, then $0.02/M CPU-ms; queue consumers may use up to 15 min CPU). They are not a second Shopify delivery.

| Webhooks / month | Queue ops (×3) | vs Paid included (1M) | Queues $ (Paid) | vs Free 10k ops/day |
|---|---|---|---|---|
| **100k** | 300k | under | **$0.00** | ~10k ops/day **at the Free daily cap** — any retry or burst 429s |
| **1M** | 3.0M | 2.0M billed | **$0.80** | ~100k ops/day — **10× Free cap**, not feasible |
| **10M** | 30.0M | 29.0M billed | **$11.60** | 1M ops/day — not feasible on Free |

Cloudflare’s own worked example (1M messages/day × 30 days × 3 ops − 1M included = 89M billed → **$35.60**) is two orders of magnitude above a busy Shopify app.

Retry sensitivity: a 10% retry rate adds ~0.1 read/message. At 10M webhooks that is +1M ops ≈ **+$0.40**. Negligible.

**Shopify volume character.** Mandatory topics (`customers/data_request`, `customers/redact`, `shop/redact`) and `app/uninstalled` / `app/scopes_update` are rare. Bulk `orders/*` / `products/*` are the only way to reach 1M–10M/month, and only on high-volume stores or many shops. The starter today ships **two control handlers + GDPR stubs** (ADR 0004) — volume is near-zero.

**Shopify retry (primary):** [Verify webhook deliveries](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries)

- 1s connect timeout, **5s timeout for the entire HTTPS request**.
- Success = **200-range only** (3xx counts as failure; redirects are not followed).
- On error / timeout: **8 retries over 4 hours**. After 8 consecutive failures the subscription is **auto-deleted if it was configured using the Admin API**. TOML-managed subscriptions (this starter, ADR 0004) are the CLI-managed path; the auto-delete sentence is scoped to Admin API registration — do not assume TOML subs are deleted the same way, and do not rely on that either.
- Shopify tells you to **queue** to handle bursts and stay inside 5s.

**GDPR:** [Privacy law compliance](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance) — confirm with **200**, complete the action **within 30 days**. `shop/redact` arrives **48 hours after uninstall**. Invalid HMAC → **401**.

---

## 3. Limits

Source: [Queues limits](https://developers.cloudflare.com/queues/platform/limits/) (retrieved 2026-09-03; page `dateModified` 2026-04-21). Apply to **both** Free and Paid except retention.

| Feature | Limit |
|---|---|
| Queues per account | 10,000 |
| Message size | **128 KB** (KB = 1000 bytes; ~100 B internal metadata counts) |
| Message retries | **100** (consumer `max_retries` default **3**) |
| Max consumer batch size | 100 messages |
| Max messages per `sendBatch` | 100 **or** 256 KB total |
| Max batch wait time | 60 s (`max_batch_timeout` default **5 s**, batch size default **10**) |
| Per-queue throughput | **5,000 messages/s** (`send` / `sendBatch` throw `Too Many Requests` above) |
| Retention | Paid: configurable 60 s–14 days (default 4 days / 345600 s). Free: **24 h** non-configurable |
| Per-queue backlog | 25 GB (`Storage Limit Exceeded` on send) |
| Concurrent consumer invocations | **250** (push-based only). Unset `max_concurrency` = scale to this max |
| Consumer wall clock | **15 minutes** |
| Consumer CPU time | Configurable to **5 minutes** (`limits.cpu_ms`; default 30 s, same as HTTP Paid) |
| `visibilityTimeout` | **12 hours** — **pull-based** queues |
| `delaySeconds` (send or retry) | 24 hours |

Config (defaults): [Configure Queues](https://developers.cloudflare.com/queues/configuration/configure-queues/), [Batching, retries and delays](https://developers.cloudflare.com/queues/configuration/batching-retries/). Consumer fields: `max_batch_size`, `max_batch_timeout`, `max_retries` (default 3), `dead_letter_queue`, `max_concurrency`, `retry_delay`. Per-message `retry({ delaySeconds })` / `retryAll`.

**DLQ:** [Dead Letter Queues](https://developers.cloudflare.com/queues/configuration/dead-letter-queues/). Named on the consumer. After `max_retries`, the message is **written to the DLQ** (a real queue you must also consume). No DLQ → failed messages are **deleted**. DLQ with no consumer: persist **4 days** then delete. A missing DLQ name is **created automatically**.

**Same-Worker producer+consumer** is first-class (`queue()` on the default export alongside `fetch`) — [JavaScript APIs](https://developers.cloudflare.com/queues/configuration/javascript-apis/). Whether a **TanStack Start** Worker can export `queue()` is ENG-2364, not this ticket.

**128 KB vs Shopify bodies.** Queues cannot hold an oversize Shopify payload. If bulk topics enqueue the raw body, D-webhooks must decide: reject / spill to R2 or D1 and enqueue a pointer. Control-topic payloads (`app/uninstalled`, GDPR) are tiny.

---

## 4. Alternatives, compared

Workers HTTP / `waitUntil` limits: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) (`dateModified` 2026-09-03). Pricing: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).

### `ctx.waitUntil()` fire-and-forget (same invocation)

- **Cost:** $0 extra beyond the HTTP Worker request. No queue ops.
- **Limits:** `waitUntil()` extends execution **up to 30 seconds after the response or disconnect**. HTTP wall time is otherwise “unlimited while the client stays connected”; Shopify disconnects at **5s**, so the useful window is that 30s after you 200. CPU: Free **10 ms/invocation** (HMAC + D1 is already tight); Paid default **30 s**, max **5 min**.
- **Guarantees:** None. Failure after 200 is **silent to Shopify** — they will not retry. No DLQ, no backlog, no backpressure.
- **Local:** works in any `fetch` runtime (Node via `shopify app dev`, Miniflare). No CF account.
- **Complexity:** a few lines.
- **Verdict:** fine for telemetry. **Unsafe** for `app/uninstalled` / GDPR / anything that must happen.

### Batching into fewer queue ops

- **Does not reduce ops.** Docs are explicit: ops are per message, not per batch. `sendBatch` is a latency/throughput API (up to 100 messages / 256 KB). Consumer batches (default 10) amortize **Worker invocations / CPU**, not Queues dollars.
- **Local:** same as Queues (`wrangler dev`).
- **Verdict:** use batches for consumer efficiency if you adopt Queues; do not adopt Queues *because* of batching discounts.

### Durable Object as queue/coordinator

- **Cost:** Paid DO = 1M requests/month included then **$0.15/M**, plus duration **400,000 GB-s/month** then **$12.50/million GB-s** (billed as if 128 MB allocated). A DO that stays awake coordinating a webhook backlog pays wall-clock, not 3 cheap ops. Free: 100k requests/day + 13,000 GB-s/day.
- **Guarantees:** strong single-instance ordering/lock (useful for the KV-guard problem on ENG-2369, not as a bus). You would still implement retry/DLQ yourself.
- **Local:** Miniflare via `wrangler dev`. Not under Vite-only `shopify app dev`.
- **Complexity:** high (class, alarms, storage, hibernation). Map standing preference: **KV over Durable Objects**; **most minimal**.
- **Verdict:** wrong primitive for “webhook bus.” Keep DO in fog for *serialized `afterAuth`* if that ever graduates.

### Synchronous (status quo) + Shopify retry

- **Cost:** $0 queue. HTTP Worker request only.
- **Guarantees:** throw → 500 → Shopify retries 8× / 4 h. Idempotence required (`X-Shopify-Webhook-Id` / `X-Shopify-Event-Id`). Subscription auto-delete is documented for **Admin API** registrations after consecutive failures.
- **Constraint:** all work in **5 seconds**. Starter handlers are a session delete / scope persist — well inside. Burst: Shopify already retries; you have no local backlog.
- **Local:** `shopify app dev` as today. No CF account. Matches the map’s DX standing preference.
- **Complexity:** already shipped (ADR 0004).
- **Verdict:** **best fit for control topics.** Weak fit if someone later subscribes to bursting `orders/*` and does non-trivial work.

---

## 5. Recommendation input (tradeoff)

Best fit for **“cost-optimized, minimal, works locally, safe under bursty volume”** is **not one mechanism**:

1. **Do not reject Queues on cost.** At Shopify-plausible volumes on Workers Paid it is cents to low tens of dollars. Free-plan Queues is only honest at **starter-scale control topics** (~10k ops/day ≈ 3.3k webhooks/day with no retries).
2. **Do not put a Queue in front of the two starter control handlers just because the map mentioned one.** That is extra IaC (queue + consumer + DLQ), a `queue()` export that may need a second Worker (ENG-2364), and a local story that fights `shopify app dev`. The work is a D1 write; Shopify’s retry *is* the DLQ.
3. **Do use HMAC-sync + Queues + DLQ** the moment bulk topics (or work that can miss 5s) land. Cost is not the blocker; the 128 KB cap and the Vite-vs-wrangler local seam are.
4. **Never 200 + `waitUntil` for uninstall / GDPR.** Acknowledge-then-lose is worse than a 500.

Tradeoff in one line: **Queues is cheap insurance for volume; it is expensive *design* for the starter’s actual topics.**

---

## Local development (Queues)

[Queues local development](https://developers.cloudflare.com/queues/configuration/local-development/): `npx wrangler@latest dev` simulates Queues via **Miniflare**. Producer+consumer as two Workers: `wrangler dev -c … -c … --persist-to .wrangler/state`. **Consumer concurrency is not supported locally.** **`wrangler dev --remote` is not supported** for Queues. Requires Wrangler ≥ 3.1.0.

This does **not** light up if ADR 0008’s `shopify app dev` → Vite path stays the app-developer entry. D-localdev (ENG-2373) has to pick: in-process fake queue behind an interface, or document that webhook-async is maintainer-only (`wrangler dev`).

---

## Fog for later tickets

- **TanStack Start `queue()` export** — same Worker vs second consumer Worker (ENG-2364 / ENG-2370).
- **Raw-body vs pointer** when a Shopify payload can exceed 128 KB (only if bulk topics are in the deploy plan).
- **Whether TOML-managed HTTPS subscriptions auto-delete** after 8 failures (docs specify Admin API).
- **Queue-consumer billing as Worker “requests”** vs CPU-only — HTTP ingest is definitely a request; treat consumer CPU as the incremental compute cost.

---

## Primary sources

| Claim | Source |
|---|---|
| Ops = 64 KB write/read/delete; 3 ops/message; $0.40/M; Free 10k/day; Paid 1M/month | https://developers.cloudflare.com/queues/platform/pricing/ (retrieved 2026-09-03) |
| Queues on Free plan | https://developers.cloudflare.com/changelog/post/2026-02-04-queues-free-plan/ |
| Limits table, 128 KB, 5k msg/s, 250 concurrency, 15 min consumer | https://developers.cloudflare.com/queues/platform/limits/ |
| `max_retries` default 3, batch defaults, DLQ auto-create | https://developers.cloudflare.com/queues/configuration/configure-queues/ |
| DLQ behaviour | https://developers.cloudflare.com/queues/configuration/dead-letter-queues/ |
| `send` / `queue()` / ack / retry | https://developers.cloudflare.com/queues/configuration/javascript-apis/ |
| Miniflare local, no `--remote` | https://developers.cloudflare.com/queues/configuration/local-development/ |
| Workers $5 Paid, CPU 10 ms Free / 30 s–5 min Paid | https://developers.cloudflare.com/workers/platform/pricing/ |
| `waitUntil` +30 s; HTTP unlimited while connected | https://developers.cloudflare.com/workers/platform/limits/ |
| DO $0.15/M req + $12.50/M GB-s | https://developers.cloudflare.com/workers/platform/pricing/ (Durable Objects) |
| Shopify 5 s / 8 retries / 4 h / 200-only | https://shopify.dev/docs/apps/build/webhooks/verify-deliveries |
| GDPR 200 then 30 days; `shop/redact` +48 h | https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance |
