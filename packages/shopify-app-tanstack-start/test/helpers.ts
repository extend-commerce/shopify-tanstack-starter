/**
 * Shared fakes for the ADR 0010 contract tests.
 *
 * - Real `@shopify/shopify-api` (`isTesting`) so HMAC / JWT validation is
 *   exercised for real; secrets + tokens are minted here.
 * - The **web-api** adapter: every package entry point is handed a Web `Request`
 *   (`authenticate.*`, the webhook primitive, the app-proxy helper), which the
 *   node adapter's `{ ...req.headers }` conversion cannot read. Web Crypto is a
 *   Node 22 global, so this adapter runs unmodified under Vitest.
 * - Hand-rolled in-memory `SessionStorage`.
 */
// oxlint-disable-next-line import/no-unassigned-import -- runtime adapter is imported for effect
import '@shopify/shopify-api/adapters/web-api';

import { createHmac } from 'node:crypto';
import { Session, type Shopify } from '@shopify/shopify-api';
import type { SessionStorage } from '@shopify/shopify-app-session-storage';

import { createShopifyApp, type ShopifyApp } from '../src/server/shopify-app';

export const TEST_API_KEY = 'test-api-key';
export const TEST_API_SECRET = 'test-api-secret-shhh';
export const TEST_APP_URL = 'https://app.example.test';
export const TEST_API_VERSION = '2026-07';
export const TEST_SHOP = 'contract-test-shop.myshopify.com';

/** In-memory `SessionStorage` (ADR 0010 contract-test fake). */
export function createMemorySessionStorage(): SessionStorage & { map: Map<string, Session> } {
  const map = new Map<string, Session>();
  return {
    map,
    async storeSession(session) {
      map.set(session.id, session);
      return true;
    },
    async loadSession(id) {
      return map.get(id);
    },
    async deleteSession(id) {
      map.delete(id);
      return true;
    },
    async deleteSessions(ids) {
      ids.forEach((id) => map.delete(id));
      return true;
    },
    async findSessionsByShop(shop) {
      return [...map.values()].filter((s) => s.shop === shop);
    },
  };
}

export interface TestApp {
  shopify: ShopifyApp;
  api: Shopify;
  storage: ReturnType<typeof createMemorySessionStorage>;
}

export function makeTestApp(config: Partial<Parameters<typeof createShopifyApp>[0]> = {}): TestApp {
  const storage = createMemorySessionStorage();
  const shopify = createShopifyApp({
    apiKey: TEST_API_KEY,
    apiSecretKey: TEST_API_SECRET,
    appUrl: TEST_APP_URL,
    apiVersion: TEST_API_VERSION,
    sessionStorage: storage,
    isTesting: true,
    scopes: ['read_products'],
    ...config,
  });
  return { shopify, api: shopify.api, storage };
}

/** Persist a fresh, active offline session so the eager path returns it early. */
export async function storeActiveOfflineSession(
  app: TestApp,
  shop = TEST_SHOP,
  accessToken = 'offline-access-token',
): Promise<Session> {
  const session = new Session({
    id: app.api.session.getOfflineId(shop),
    shop,
    state: '',
    isOnline: false,
    accessToken,
    scope: 'read_products',
  });
  await app.storage.storeSession(session);
  return session;
}

function b64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

/** Mint an HS256 App Bridge session token accepted by `api.session.decodeSessionToken`. */
export function mintSessionToken(
  opts: {
    shop?: string;
    aud?: string;
    secret?: string;
    expiresInSeconds?: number;
    notBeforeSeconds?: number;
  } = {},
): string {
  const {
    shop = TEST_SHOP,
    aud = TEST_API_KEY,
    secret = TEST_API_SECRET,
    expiresInSeconds = 60,
    notBeforeSeconds = 5,
  } = opts;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      iss: `https://${shop}/admin`,
      dest: `https://${shop}`,
      aud,
      sub: '42',
      exp: now + expiresInSeconds,
      nbf: now - notBeforeSeconds,
      iat: now - notBeforeSeconds,
      jti: '00000000-0000-0000-0000-000000000000',
      sid: 'session-id',
    }),
  );
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

/** Build a signed webhook `POST` `Request` (`api.webhooks.validate` accepts it). */
export function makeWebhookRequest(opts: {
  topic: string;
  shop?: string;
  body?: unknown;
  secret?: string;
  method?: string;
  webhookId?: string;
  apiVersion?: string;
  tamperHmac?: boolean;
  omitHmac?: boolean;
}): Request {
  const {
    topic,
    shop = TEST_SHOP,
    body = { ok: true },
    secret = TEST_API_SECRET,
    method = 'POST',
    webhookId = 'wh-1',
    apiVersion = TEST_API_VERSION,
    tamperHmac = false,
    omitHmac = false,
  } = opts;
  const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
  const hmac = createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-shopify-topic': topic,
    'x-shopify-shop-domain': shop,
    'x-shopify-webhook-id': webhookId,
    'x-shopify-api-version': apiVersion,
  };
  if (!omitHmac) headers['x-shopify-hmac-sha256'] = tamperHmac ? `${hmac}tampered` : hmac;
  return new Request('https://app.example.test/webhooks', {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : rawBody,
  });
}

/** Build a signed App Proxy `GET` `Request` URL (`signator: 'appProxy'`, hex). */
export function makeAppProxyRequest(opts: {
  shop?: string;
  secret?: string;
  extraParams?: Record<string, string>;
  tamper?: boolean;
}): Request {
  const { shop = TEST_SHOP, secret = TEST_API_SECRET, extraParams = {}, tamper = false } = opts;
  const params = new URLSearchParams({
    shop,
    logged_in_customer_id: '',
    path_prefix: '/apps/proxy',
    timestamp: String(Math.floor(Date.now() / 1000)),
    ...extraParams,
  });
  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const message = sorted.map(([k, v]) => `${k}=${v}`).join('');
  const signature = createHmac('sha256', secret).update(message).digest('hex');
  params.set('signature', tamper ? `${signature}00` : signature);
  return new Request(`https://app.example.test/proxy/demo?${params.toString()}`, { method: 'GET' });
}

/** A bare `Request` with no `Accept: text/html` → the XHR branch of the failure contract. */
export function xhrRequest(url = 'https://app.example.test/app', init: RequestInit = {}): Request {
  return new Request(url, init);
}

/** Build an HMAC-signed `POST` body `Request` (Flow / fulfillment-service shape). */
export function makeHmacBodyRequest(opts: {
  body?: unknown;
  secret?: string;
  method?: string;
  headers?: Record<string, string>;
  tamper?: boolean;
}): Request {
  const {
    body = {},
    secret = TEST_API_SECRET,
    method = 'POST',
    headers = {},
    tamper = false,
  } = opts;
  const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
  const hmac = createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
  return new Request('https://app.example.test/x', {
    method,
    headers: {
      'content-type': 'application/json',
      'x-shopify-hmac-sha256': tamper ? `${hmac}xx` : hmac,
      ...headers,
    },
    body: method === 'GET' || method === 'HEAD' ? undefined : rawBody,
  });
}
