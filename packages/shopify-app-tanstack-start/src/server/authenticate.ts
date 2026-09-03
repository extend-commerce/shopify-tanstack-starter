/**
 * The `authenticate.*` parity facade (ADR 0010 1).
 *
 * `createShopifyApp(config).authenticate` mirrors
 * `@shopify/shopify-app-react-router` **v2** method names and return shapes (not
 * the yan-ad v1.2.0 fork). Every method takes an **explicit `Request`** and is
 * called server-side only — inside a `createServerFn` handler or a server route,
 * never an isomorphic `beforeLoad` / `loader` (a live client + `Session` must not
 * cross the dehydration boundary — cross-cutting rule #4).
 *
 * `authenticate.<surface>` is the **single implementation**. `adminMiddleware`
 * (ADR 0002 layer 2) is a thin adapter over `authenticate.admin` — see
 * `./auth/admin-middleware.ts`.
 *
 * The middleware idiom stays the starter's primary style; this facade is the
 * equal-status second surface for RR-migration ergonomics and for server routes
 * (which cannot carry function middleware).
 */
import type { JwtPayload, Session, Shopify } from '@shopify/shopify-api';
import type { ShopifyAppInternals } from './config';
import { authenticateAdmin, type AdminMiddlewareContext } from './auth/admin-middleware';
import { createAdminApiContext, type AdminApiContext } from '../clients/admin';
import { createStorefrontApiContext, type StorefrontApiContext } from '../clients/storefront';
import type { Unauthenticated } from '../unauthenticated';
import {
  createAuthenticateWebhook,
  type AuthenticateWebhook,
  type WebhookContext,
} from '../webhooks/handler';

/** RR `EnsureCORSFunction` — mutates + returns the response with CORS headers when
 *  the request originates from a different origin than `appUrl`. */
export type EnsureCORSFunction = (response: Response) => Response;

/** Options accepted by `authenticate.public.checkout` / `.customerAccount` / `.pos`. */
export interface AuthenticatePublicOptions {
  /** Extra request-header names to allow in the CORS `Access-Control-Allow-Headers`. */
  corsHeaders?: string[];
}

/** `authenticate.admin(request)` context — identical to the `adminMiddleware` context (IP-4). */
export type AdminContext = AdminMiddlewareContext;

/** `authenticate.flow(request)` — RR v2 `FlowContext`. */
export interface FlowContext {
  /** Offline session for the shop (`payload.shopify_domain`). */
  session: Session;
  /** Parsed Flow request body. */
  payload: unknown;
  /** Offline Admin client for the shop. */
  admin: AdminApiContext;
}

/** `authenticate.fulfillmentService(request)` — RR v2 `FulfillmentServiceContext`. */
export interface FulfillmentServiceContext {
  /** Offline session for the shop (`X-Shopify-Shop-Domain`). */
  session: Session;
  /** Parsed fulfillment-service request body (`payload.kind` selects the sub-flow). */
  payload: { kind?: string } & Record<string, unknown>;
  /** Offline Admin client for the shop. */
  admin: AdminApiContext;
}

/** `authenticate.pos(request)` — RR v2 `POSContext` (extension session-token helper). */
export interface PosContext {
  /** Decoded + validated session token (`checkAudience: false`). */
  sessionToken: JwtPayload;
  /** Sets CORS headers on a response when the caller's origin differs from `appUrl`. */
  cors: EnsureCORSFunction;
}

/** `authenticate.public.checkout` / `.customerAccount` — RR v2 `CheckoutContext`. */
export interface CheckoutContext {
  /** Decoded + validated session token (`checkAudience: false`). */
  sessionToken: JwtPayload;
  /** Sets CORS headers on a response when the caller's origin differs from `appUrl`. */
  cors: EnsureCORSFunction;
}

/** RR `LiquidResponseFunction` — builds an `application/liquid` `Response`. */
export type LiquidResponseFunction = (
  body: string,
  initAndOptions?: number | (ResponseInit & { layout?: boolean }),
) => Response;

/** `authenticate.public.appProxy(request)` — RR v2 `AppProxyContext`. `session`
 *  / `admin` / `storefront` are present only when the shop has an offline token. */
export interface AppProxyContext {
  /** Render a Liquid `Response` using the shop's theme (or `{ layout: false }`). */
  liquid: LiquidResponseFunction;
  session?: Session;
  admin?: AdminApiContext;
  storefront?: StorefrontApiContext;
}

/** `createShopifyApp(config).authenticate` (ADR 0010 1). */
export interface Authenticate {
  /** Admin data boundary — `{ admin, session, scopes, billing }`. */
  admin: (request: Request) => Promise<AdminContext>;
  /** Webhook primitive — `{ shop, topic, webhookId, apiVersion, payload, session? }`;
   *  throws the RR-exact `400/401/405` failure `Response`. */
  webhook: AuthenticateWebhook;
  /** Shopify Flow extension request. */
  flow: (request: Request) => Promise<FlowContext>;
  /** POS UI extension request. */
  pos: (request: Request, options?: AuthenticatePublicOptions) => Promise<PosContext>;
  /** Fulfillment-service notification request. */
  fulfillmentService: (request: Request) => Promise<FulfillmentServiceContext>;
  public: {
    /** App-proxy request — HMAC via `api.utils.validateHmac(..., { signator: 'appProxy' })`. */
    appProxy: (request: Request) => Promise<AppProxyContext>;
    /** Checkout UI extension request — session-token + CORS helper only. */
    checkout: (request: Request, options?: AuthenticatePublicOptions) => Promise<CheckoutContext>;
    /** Customer Account UI extension request — session-token + CORS helper only.
     *  NO Customer Account GraphQL client (ADR 0003 out-of-scope, unchanged). */
    customerAccount: (
      request: Request,
      options?: AuthenticatePublicOptions,
    ) => Promise<CheckoutContext>;
  };
}

/* -------------------------------------------------------------------------- *
 * Shared helpers
 * -------------------------------------------------------------------------- */

function methodNotAllowed(): Response {
  return new Response(undefined, { status: 405, statusText: 'Method Not Allowed' });
}

function badRequest(): Response {
  return new Response(undefined, { status: 400, statusText: 'Bad Request' });
}

function unauthorized(): Response {
  return new Response(undefined, { status: 401, statusText: 'Unauthorized' });
}

/** `Authorization: Bearer <jwt>` header value, or `undefined`. */
function bearerToken(request: Request): string | undefined {
  const auth = request.headers.get('authorization');
  if (!auth || !auth.toLowerCase().startsWith('bearer ')) return undefined;
  return auth.slice(auth.indexOf(' ') + 1).trim() || undefined;
}

/** RR `ensureCORSHeadersFactory` — only adds headers cross-origin (Origin !== appUrl). */
function createCors(
  internals: ShopifyAppInternals,
  request: Request,
  corsHeaders: string[],
): EnsureCORSFunction {
  const appUrl = internals.config.appUrl;
  return (response: Response): Response => {
    const origin = request.headers.get('origin');
    if (origin && origin !== appUrl) {
      const allowed = new Set(['Authorization', 'Content-Type', ...corsHeaders]);
      response.headers.set('Access-Control-Allow-Origin', '*');
      response.headers.set('Access-Control-Allow-Headers', [...allowed].join(', '));
    }
    return response;
  };
}

/**
 * Shared extension session-token helper (RR `authenticateExtensionFactory`),
 * behind `authenticate.pos` / `authenticate.public.checkout` /
 * `authenticate.public.customerAccount`. Requires a `Bearer` token, validates it
 * with `checkAudience: false`, and returns `{ sessionToken, cors }`. Builds no
 * Admin / Storefront / Customer Account GraphQL client (ADR 0003).
 */
function createExtensionAuth(internals: ShopifyAppInternals) {
  const { api } = internals;
  return async (
    request: Request,
    options: AuthenticatePublicOptions = {},
  ): Promise<CheckoutContext> => {
    const corsHeaders = options.corsHeaders ?? [];

    if (request.method === 'OPTIONS') {
      throw createCors(internals, request, corsHeaders)(new Response(undefined, { status: 204 }));
    }

    const token = bearerToken(request);
    if (!token) throw unauthorized();

    let sessionToken: JwtPayload;
    try {
      sessionToken = await api.session.decodeSessionToken(token, { checkAudience: false });
    } catch {
      throw unauthorized();
    }

    return { sessionToken, cors: createCors(internals, request, corsHeaders) };
  };
}

/** RR `processLiquidBody` — trailing slashes on relative `<form action>` / `<a href>`. */
function processLiquidBody(body: string): string {
  return body
    .replace(/<(form[^>]+)action="(\/[^"?]+)(\?[^"]+)?">/g, '<$1action="$2/$3">')
    .replace(/<(a[^>]+)href="(\/[^"?]+)(\?[^"]+)?">/g, '<$1href="$2/$3">');
}

const liquid: LiquidResponseFunction = (body, initAndOptions) => {
  const processed = processLiquidBody(body);
  if (typeof initAndOptions !== 'object') {
    return new Response(processed, {
      status: initAndOptions ?? 200,
      headers: { 'Content-Type': 'application/liquid' },
    });
  }
  const { layout, ...responseInit } = initAndOptions ?? {};
  const responseBody = layout === false ? `{% layout none %} ${processed}` : processed;
  const headers = new Headers(responseInit.headers);
  headers.set('Content-Type', 'application/liquid');
  return new Response(responseBody, { ...responseInit, headers });
};

/** RR `validateAppProxyHmac` — direct `signator: 'appProxy'` check with the two
 *  RR `_data` retry shapes for app-proxy links that reach loader routes. */
async function validateAppProxyHmac(api: Shopify, url: URL): Promise<boolean> {
  let searchParams = new URLSearchParams(url.search);
  if (!searchParams.get('index')) searchParams.delete('index');

  let isValid = await api.utils.validateHmac(searchParams, { signator: 'appProxy' });
  if (isValid) return true;

  const cleanPath = url.pathname.replace(/^\//, '').replace(/\/$/, '').replaceAll('/', '.');
  const data = `routes%2F${cleanPath}`;

  searchParams = new URLSearchParams(
    `?_data=${data}&${searchParams.toString().replace(/^\?/, '')}`,
  );
  isValid = await api.utils.validateHmac(searchParams, { signator: 'appProxy' });
  if (isValid) return true;

  searchParams = new URLSearchParams(`?_data=${data}._index&${url.search.replace(/^\?/, '')}`);
  return api.utils.validateHmac(searchParams, { signator: 'appProxy' });
}

/* -------------------------------------------------------------------------- *
 * Facade factory
 * -------------------------------------------------------------------------- */

export interface AuthenticateDeps {
  internals: ShopifyAppInternals;
  unauthenticated: Unauthenticated;
}

export function createAuthenticate({ internals, unauthenticated }: AuthenticateDeps): Authenticate {
  const { api, config } = internals;

  const authenticateWebhook = createAuthenticateWebhook({
    api,
    ensureValidOfflineSession: async (shop) => {
      try {
        return await unauthenticated.ensureValidOfflineSession(shop);
      } catch {
        return undefined;
      }
    },
  });

  const extensionAuth = createExtensionAuth(internals);

  async function validateHmacBody(
    request: Request,
    validate: (args: { rawBody: string; rawRequest: Request }) => Promise<{ valid: boolean }>,
  ): Promise<unknown> {
    if (request.method !== 'POST') throw methodNotAllowed();
    const rawBody = await request.text();
    const result = await validate({ rawBody, rawRequest: request });
    if (!result.valid) throw badRequest();
    return JSON.parse(rawBody);
  }

  return {
    admin: (request) => authenticateAdmin(internals, request),

    webhook: authenticateWebhook,

    flow: async (request): Promise<FlowContext> => {
      const payload = (await validateHmacBody(request, (args) => api.flow.validate(args))) as {
        shopify_domain?: string;
      };
      const shop = payload.shopify_domain ?? '';
      const resolved = await unauthenticated.admin(shop).catch(() => undefined);
      if (!resolved) throw badRequest();
      return { session: resolved.session, payload, admin: resolved.admin };
    },

    fulfillmentService: async (request): Promise<FulfillmentServiceContext> => {
      const payload = (await validateHmacBody(request, (args) =>
        api.fulfillmentService.validate(args),
      )) as FulfillmentServiceContext['payload'];
      const shop = request.headers.get('x-shopify-shop-domain') ?? '';
      const resolved = await unauthenticated.admin(shop).catch(() => undefined);
      if (!resolved) throw badRequest();
      return { session: resolved.session, payload, admin: resolved.admin };
    },

    pos: (request, options) => extensionAuth(request, options),

    public: {
      checkout: (request, options) => extensionAuth(request, options),
      customerAccount: (request, options) => extensionAuth(request, options),

      appProxy: async (request): Promise<AppProxyContext> => {
        const url = new URL(request.url);
        const shop = url.searchParams.get('shop') ?? '';

        let valid: boolean;
        try {
          valid = await validateAppProxyHmac(api, url);
        } catch {
          throw badRequest();
        }
        if (!valid) throw badRequest();

        try {
          const session = await unauthenticated.ensureValidOfflineSession(shop);
          return {
            liquid,
            session,
            admin: createAdminApiContext(session, config.apiVersion),
            storefront: createStorefrontApiContext(api, session, config.apiVersion),
          };
        } catch {
          // No offline session on file — RR returns an empty (session-less) context.
          return { liquid, session: undefined, admin: undefined, storefront: undefined };
        }
      },
    },
  };
}

export type { AdminMiddlewareContext, WebhookContext };
