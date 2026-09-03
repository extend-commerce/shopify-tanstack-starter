/**
 * WS4 — Webhook primitive + handler-factory sugar (ADR 0004 + ADR 0010 6).
 *
 * Webhooks arrive as TanStack Start *server routes* under `webhookPath` (default
 * `/webhooks`) — never `createServerFn` (BUILD-PLAN 6 rule 6: outside callers
 * post HMAC bodies, server fns are same-origin RPC with auto-CSRF).
 *
 * ADR 0010 6 splits this into:
 *   - `authenticateWebhook(request)` — the **primitive**: validate → parse →
 *     load session. Throws the RR-exact failure `Response` (`400/401/405`) on
 *     bad method / HMAC / headers / body. Returned by `shopify.authenticate.webhook`.
 *   - `bindWebhookHandlers` / `handlers.webhooks` / `createWebhookHandler` — the
 *     **sugar**: the polymorphic "one route file, dispatch by topic" factory,
 *     reimplemented on top of the primitive.
 *
 * Runtime-agnostic (ADR 0009): Web `Request`/`Response` only; HMAC is
 * `api.webhooks.validate` (never a hand-rolled `node:crypto` HMAC); no `node:*`.
 *
 * ── IP-8 status contract (matches RR `authenticate.webhook`) ───────────────────
 *   200  empty  — handler resolved; also map-mode unknown topic (acknowledged)
 *   400         — non-POST body unreadable · `validate` threw · missing headers /
 *                 hmac / body / topic · unparseable JSON payload · single-handler
 *                 `expectedTopic` mismatch
 *   401         — `validate` returned `reason: 'invalid_hmac'`
 *   405         — request method !== POST
 *   500         — the `WebhookHandler` threw (so Shopify retries)
 */
import type { Session, Shopify } from '@shopify/shopify-api';

/** Payload handed to every webhook handler. No `admin` client is built by default
 *  (ADR 0004): a handler that needs one calls `unauthenticated.admin(shop)`. */
export interface WebhookContext {
  /** Shop domain, e.g. `example.myshopify.com` (from the validated request). */
  shop: string;
  /** Topic in `resource/action` form, e.g. `app/uninstalled` (`X-Shopify-Topic`). */
  topic: string;
  /** `X-Shopify-Webhook-Id` — stable per delivery, useful for idempotency. */
  webhookId: string;
  /** `X-Shopify-API-Version` of the delivered payload. */
  apiVersion: string;
  /** Parsed JSON body (`{}` when the body is empty). */
  payload: unknown;
  /** Offline session via `ensureValidOfflineSession(shop)`; `undefined` when the
   *  app is already uninstalled / no offline token is on file. */
  session?: Session;
}

/** A single-topic handler. Return value is ignored; a throw yields `500`. */
export type WebhookHandler = (ctx: WebhookContext) => Promise<void>;

/** Topic-keyed handler map for the splat-route (map) call shape. Keys are
 *  `resource/action` (matching `shopify.app.toml` subscriptions); the enum-ish
 *  `RESOURCE_ACTION` form is also tolerated. */
export type WebhookHandlerMap = Record<string, WebhookHandler>;

/** Resolves the offline session for a shop; `undefined` when none. Defined for
 *  real by WS3 (`src/unauthenticated.ts` `ensureValidOfflineSession`) and passed
 *  in by `createShopifyApp`; declared narrowly here so this file typechecks
 *  standalone and merges without importing a not-yet-existing module. */
export type EnsureValidOfflineSession = (shop: string) => Promise<Session | undefined>;

/** Minimal logger seam. Defaults to `api.logger` (`ShopifyLogger`). */
export interface WebhookLogger {
  warning?: (message: string) => void | Promise<void>;
  error?: (message: string) => void | Promise<void>;
}

export interface WebhookRouteOptions {
  /** Single-handler mode only: return `400` if the delivered topic is not this
   *  one (one route file per topic — ADR 0004). Ignored in map mode. */
  expectedTopic?: string;
}

/** The plain server-route handler a TanStack Start route file wires in. */
export type WebhookRoute = (args: { request: Request }) => Promise<Response>;

/** The polymorphic factory (`shopify.handlers.webhooks` / `createWebhookHandler`). */
export type WebhookFactory = (
  handlerOrMap: WebhookHandler | WebhookHandlerMap,
  options?: WebhookRouteOptions,
) => WebhookRoute;

/** Dependencies `createShopifyApp` pre-binds into the primitive + factory (the IP-3 seam). */
export interface WebhookDeps {
  /** The `@shopify/shopify-api` instance built inside `createShopifyApp`. */
  api: Shopify;
  /** WS3's `ensureValidOfflineSession`. Omit → handlers get `session: undefined`. */
  ensureValidOfflineSession?: EnsureValidOfflineSession;
  /** Override the default `api.logger`. */
  logger?: WebhookLogger;
}

/** `authenticate.webhook(request)` (ADR 0010 6). */
export type AuthenticateWebhook = (request: Request) => Promise<WebhookContext>;

function resolveLogger(deps: WebhookDeps): WebhookLogger {
  const { api } = deps;
  return (
    deps.logger ?? {
      warning: (message) => api.logger?.warning?.(message),
      error: (message) => api.logger?.error?.(message),
    }
  );
}

/**
 * The webhook **primitive** (ADR 0010 6): validate → parse → load session.
 *
 * Throws the RR-exact failure `Response` (`405` non-POST · `401` bad HMAC ·
 * `400` unreadable body / `validate` threw / other invalid / unparseable JSON).
 * On success resolves `{ shop, topic, webhookId, apiVersion, payload, session? }`
 * — `session` is `undefined` when the app is already uninstalled.
 */
export function createAuthenticateWebhook(deps: WebhookDeps): AuthenticateWebhook {
  const { api, ensureValidOfflineSession } = deps;
  const logger = resolveLogger(deps);

  return async function authenticateWebhook(request: Request): Promise<WebhookContext> {
    if (request.method !== 'POST') {
      throw textResponse(405, 'Method Not Allowed', { allow: 'POST' });
    }

    let rawBody: string;
    try {
      rawBody = await request.text();
    } catch {
      throw textResponse(400, 'Bad Request');
    }

    let validation;
    try {
      validation = await api.webhooks.validate({ rawBody, rawRequest: request });
    } catch {
      throw textResponse(400, 'Bad Request');
    }

    if (!validation.valid) {
      throw validation.reason === 'invalid_hmac'
        ? textResponse(401, 'Unauthorized')
        : textResponse(400, 'Bad Request');
    }

    const { topic, webhookId, apiVersion, domain: shop } = validation;

    let payload: unknown;
    try {
      payload = rawBody.length > 0 ? JSON.parse(rawBody) : {};
    } catch {
      throw textResponse(400, 'Bad Request');
    }

    let session: Session | undefined;
    if (ensureValidOfflineSession) {
      try {
        session = await ensureValidOfflineSession(shop);
      } catch (error) {
        // App already uninstalled / no offline session on file (ADR 0004:
        // `session` may be `undefined`). The caller still runs; one that needs a
        // session throws → 500 → Shopify retries.
        session = undefined;
        await logger.warning?.(
          `[webhooks] no offline session for ${shop} (topic=${topic}): ${errText(error)}`,
        );
      }
    }

    return { shop, topic, webhookId, apiVersion, payload, session };
  };
}

/**
 * Pre-bind the webhook factory against `createShopifyApp`'s dependencies —
 * **sugar over `createAuthenticateWebhook`** (ADR 0010 6).
 *
 * `createShopifyApp` calls this once and assigns the result to
 * `handlers.webhooks` on its return object (IP-3), e.g.
 * `bindWebhookHandlers({ api, ensureValidOfflineSession, logger })`.
 */
export function bindWebhookHandlers(deps: WebhookDeps): WebhookFactory {
  const authenticateWebhook = createAuthenticateWebhook(deps);
  const logger = resolveLogger(deps);

  return (handlerOrMap, options) => {
    const single = isWebhookHandler(handlerOrMap) ? handlerOrMap : undefined;
    const map = single ? undefined : (handlerOrMap as WebhookHandlerMap);

    return async ({ request }) => {
      let ctx: WebhookContext;
      try {
        ctx = await authenticateWebhook(request);
      } catch (error) {
        // The primitive throws the `400/401/405` failure `Response`s directly.
        if (error instanceof Response) return error;
        throw error;
      }

      const { topic, webhookId, shop } = ctx;

      // Single-handler mode: optional topic guard → 400 on mismatch.
      if (single && options?.expectedTopic && !topicsMatch(topic, options.expectedTopic)) {
        return textResponse(400, 'Bad Request');
      }

      // Map mode: an undeclared topic is acknowledged (200) + logged, never a
      // non-2xx (a non-2xx drives Shopify retries and auto-disables the sub).
      let handler = single;
      if (map) {
        handler = resolveFromMap(map, topic);
        if (!handler) {
          await logger.warning?.(
            `[webhooks] no handler for topic "${topic}" (shop=${shop}, webhookId=${webhookId}) — acknowledged with 200`,
          );
          return new Response(null, { status: 200 });
        }
      }

      try {
        // `handler` is defined here: single-mode always, map-mode returned early
        // above when the lookup missed.
        await handler!(ctx);
      } catch (error) {
        await logger.error?.(
          `[webhooks] handler for "${topic}" (shop=${shop}, webhookId=${webhookId}) threw: ${errText(error)}`,
        );
        return textResponse(500, 'Internal Server Error');
      }

      return new Response(null, { status: 200 });
    };
  };
}

/** Shape `createShopifyApp` returns (IP-3), narrowed to what this module reads. */
export interface ShopifyAppLike {
  api: Shopify;
  handlers?: { webhooks?: WebhookFactory };
  ensureValidOfflineSession?: EnsureValidOfflineSession;
  unauthenticated?: {
    admin?: (shop: string) => Promise<{ session?: Session }>;
  };
}

/**
 * ADR 0004's re-exported form: `createWebhookHandler(shopify, handlerOrMap, opts)`
 * from `shopify-app-tanstack-start/webhooks`.
 *
 * Prefers the factory `createShopifyApp` already pre-bound (`shopify.handlers
 * .webhooks`). Falls back to building one from `shopify.api` — deriving the
 * session resolver from `shopify.ensureValidOfflineSession` or, last resort,
 * `shopify.unauthenticated.admin` (which does build an Admin client — the
 * pre-bound path avoids that).
 */
export function createWebhookHandler(
  shopify: ShopifyAppLike,
  handlerOrMap: WebhookHandler | WebhookHandlerMap,
  options?: WebhookRouteOptions,
): WebhookRoute {
  if (shopify.handlers?.webhooks) {
    return shopify.handlers.webhooks(handlerOrMap, options);
  }
  return bindWebhookHandlers({
    api: shopify.api,
    ensureValidOfflineSession: deriveEnsureValidOfflineSession(shopify),
  })(handlerOrMap, options);
}

function deriveEnsureValidOfflineSession(
  shopify: ShopifyAppLike,
): EnsureValidOfflineSession | undefined {
  if (shopify.ensureValidOfflineSession) return shopify.ensureValidOfflineSession;
  const unauthAdmin = shopify.unauthenticated?.admin;
  if (!unauthAdmin) return undefined;
  return async (shop) => {
    try {
      return (await unauthAdmin(shop)).session;
    } catch {
      return undefined;
    }
  };
}

function isWebhookHandler(value: WebhookHandler | WebhookHandlerMap): value is WebhookHandler {
  return typeof value === 'function';
}

/** Header topics are lowercase `resource/action` (`customers/data_request`);
 *  fold `/` → `_` so the enum-ish `CUSTOMERS_DATA_REQUEST` form also matches.
 *  `_` is never folded to `/` (that would split `data_request`). */
function normalizeTopic(topic: string): string {
  return topic.trim().toLowerCase().replace(/\//g, '_');
}

function topicsMatch(a: string, b: string): boolean {
  return normalizeTopic(a) === normalizeTopic(b);
}

function resolveFromMap(map: WebhookHandlerMap, topic: string): WebhookHandler | undefined {
  const exact = map[topic];
  if (exact) return exact;
  const target = normalizeTopic(topic);
  for (const key of Object.keys(map)) {
    if (normalizeTopic(key) === target) return map[key];
  }
  return undefined;
}

function textResponse(status: number, body: string, headers?: Record<string, string>): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', ...headers },
  });
}

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
