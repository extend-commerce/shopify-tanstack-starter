/**
 * ADR 0010 1 — the `authenticate.*` parity facade: success return shape +
 * failure behaviour (status / headers / thrown `Response`) for each surface.
 * `authenticate.webhook` has its own file (`webhook.test.ts`);
 * `authenticate.admin`'s Admin-API 401 path is in `admin-graphql.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { RETRY_INVALID_SESSION_HEADER } from '../src/server/auth/headers';
import {
  makeAppProxyRequest,
  makeHmacBodyRequest,
  makeTestApp,
  mintSessionToken,
  storeActiveOfflineSession,
  TEST_API_KEY,
  TEST_SHOP,
  xhrRequest,
} from './helpers';

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error;
  }
}

describe('authenticate.admin', () => {
  it('success → { admin, session, scopes, billing }', async () => {
    const app = makeTestApp();
    await storeActiveOfflineSession(app);
    const token = mintSessionToken();

    const ctx = await app.shopify.authenticate.admin(
      xhrRequest('https://app.example.test/app', { headers: { authorization: `Bearer ${token}` } }),
    );

    expect(ctx.session.shop).toBe(TEST_SHOP);
    expect(ctx.session.isOnline).toBe(false);
    expect(typeof ctx.admin.graphql).toBe('function');
    expect(typeof ctx.scopes.request).toBe('function');
    expect(typeof ctx.billing.require).toBe('function');
  });

  it('no session token → throws 401 + X-Shopify-Retry-Invalid-Session-Request', async () => {
    const app = makeTestApp();
    const error = await caught(app.shopify.authenticate.admin(xhrRequest()));
    expect(error).toBeInstanceOf(Response);
    expect((error as Response).status).toBe(401);
    expect((error as Response).headers.get(RETRY_INVALID_SESSION_HEADER)).toBe('1');
  });

  it('undecodable Bearer token → throws 401', async () => {
    const app = makeTestApp();
    const error = await caught(
      app.shopify.authenticate.admin(
        xhrRequest('https://app.example.test/app', {
          headers: { authorization: 'Bearer not-a-jwt' },
        }),
      ),
    );
    expect(error).toBeInstanceOf(Response);
    expect((error as Response).status).toBe(401);
  });

  it('scopes.request(...) throws the 401 re-authorize Response', async () => {
    const app = makeTestApp();
    await storeActiveOfflineSession(app);
    const ctx = await app.shopify.authenticate.admin(
      xhrRequest('https://app.example.test/app', {
        headers: { authorization: `Bearer ${mintSessionToken()}` },
      }),
    );
    const error = await caught(ctx.scopes.request(['write_orders']));
    expect(error).toBeInstanceOf(Response);
    expect((error as Response).status).toBe(401);
    expect(
      (error as Response).headers.get('X-Shopify-API-Request-Failure-Reauthorize-Url'),
    ).toContain('write_orders');
  });
});

describe('authenticate.flow', () => {
  it('success → { session, payload, admin }', async () => {
    const app = makeTestApp();
    await storeActiveOfflineSession(app);
    const ctx = await app.shopify.authenticate.flow(
      makeHmacBodyRequest({ body: { shopify_domain: TEST_SHOP, properties: { a: 1 } } }),
    );
    expect(ctx.session.shop).toBe(TEST_SHOP);
    expect(ctx.payload).toMatchObject({ shopify_domain: TEST_SHOP });
    expect(typeof ctx.admin.graphql).toBe('function');
  });

  it('non-POST → throws 405', async () => {
    const app = makeTestApp();
    const error = await caught(
      app.shopify.authenticate.flow(
        makeHmacBodyRequest({ method: 'GET', body: { shopify_domain: TEST_SHOP } }),
      ),
    );
    expect((error as Response).status).toBe(405);
  });

  it('bad HMAC → throws 400', async () => {
    const app = makeTestApp();
    const error = await caught(
      app.shopify.authenticate.flow(
        makeHmacBodyRequest({ tamper: true, body: { shopify_domain: TEST_SHOP } }),
      ),
    );
    expect((error as Response).status).toBe(400);
  });

  it('valid HMAC but no offline session for the shop → throws 400', async () => {
    const app = makeTestApp();
    const error = await caught(
      app.shopify.authenticate.flow(makeHmacBodyRequest({ body: { shopify_domain: TEST_SHOP } })),
    );
    expect((error as Response).status).toBe(400);
  });
});

describe('authenticate.fulfillmentService', () => {
  it('success → { session, payload, admin }; payload.kind preserved', async () => {
    const app = makeTestApp();
    await storeActiveOfflineSession(app);
    const ctx = await app.shopify.authenticate.fulfillmentService(
      makeHmacBodyRequest({
        body: { kind: 'FULFILLMENT_REQUEST' },
        headers: { 'x-shopify-shop-domain': TEST_SHOP },
      }),
    );
    expect(ctx.session.shop).toBe(TEST_SHOP);
    expect(ctx.payload.kind).toBe('FULFILLMENT_REQUEST');
    expect(typeof ctx.admin.graphql).toBe('function');
  });

  it('non-POST → throws 405', async () => {
    const app = makeTestApp();
    const error = await caught(
      app.shopify.authenticate.fulfillmentService(
        makeHmacBodyRequest({ method: 'PUT', headers: { 'x-shopify-shop-domain': TEST_SHOP } }),
      ),
    );
    expect((error as Response).status).toBe(405);
  });

  it('bad HMAC → throws 400', async () => {
    const app = makeTestApp();
    const error = await caught(
      app.shopify.authenticate.fulfillmentService(
        makeHmacBodyRequest({ tamper: true, headers: { 'x-shopify-shop-domain': TEST_SHOP } }),
      ),
    );
    expect((error as Response).status).toBe(400);
  });
});

describe('authenticate.pos / public.checkout / public.customerAccount (extension session-token helper)', () => {
  const surfaces = ['pos', 'checkout', 'customerAccount'] as const;

  function call(
    app: ReturnType<typeof makeTestApp>,
    surface: (typeof surfaces)[number],
    request: Request,
  ) {
    return surface === 'pos'
      ? app.shopify.authenticate.pos(request)
      : app.shopify.authenticate.public[surface](request);
  }

  for (const surface of surfaces) {
    it(`${surface}: success → { sessionToken, cors }`, async () => {
      const app = makeTestApp();
      const token = mintSessionToken();
      const ctx = await call(
        app,
        surface,
        xhrRequest('https://app.example.test/x', { headers: { authorization: `Bearer ${token}` } }),
      );
      expect(ctx.sessionToken.aud).toBe(TEST_API_KEY);
      expect(typeof ctx.cors).toBe('function');
      // `cors` is a no-op when the request has no cross-origin `Origin`.
      const passthrough = ctx.cors(new Response('ok'));
      expect(passthrough.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });

    it(`${surface}: missing Bearer → throws 401`, async () => {
      const app = makeTestApp();
      const error = await caught(call(app, surface, xhrRequest('https://app.example.test/x')));
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(401);
    });

    it(`${surface}: OPTIONS preflight → throws a 204 with CORS headers`, async () => {
      const app = makeTestApp();
      const error = await caught(
        call(
          app,
          surface,
          new Request('https://app.example.test/x', {
            method: 'OPTIONS',
            headers: { origin: 'https://extensions.shopifycdn.com' },
          }),
        ),
      );
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(204);
      expect((error as Response).headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  }
});

describe('authenticate.public.appProxy', () => {
  it('valid signature + offline session → { liquid, session, admin, storefront }', async () => {
    const app = makeTestApp();
    await storeActiveOfflineSession(app);
    const ctx = await app.shopify.authenticate.public.appProxy(makeAppProxyRequest({}));
    expect(ctx.session?.shop).toBe(TEST_SHOP);
    expect(typeof ctx.admin?.graphql).toBe('function');
    expect(typeof ctx.storefront?.graphql).toBe('function');
    expect(typeof ctx.liquid).toBe('function');
  });

  it('valid signature + no offline session → session-less context (still has liquid)', async () => {
    const app = makeTestApp();
    const ctx = await app.shopify.authenticate.public.appProxy(makeAppProxyRequest({}));
    expect(ctx.session).toBeUndefined();
    expect(ctx.admin).toBeUndefined();
    expect(ctx.storefront).toBeUndefined();
    expect(typeof ctx.liquid).toBe('function');
  });

  it('bad signature → throws 400', async () => {
    const app = makeTestApp();
    const error = await caught(
      app.shopify.authenticate.public.appProxy(makeAppProxyRequest({ tamper: true })),
    );
    expect(error).toBeInstanceOf(Response);
    expect((error as Response).status).toBe(400);
  });

  it('liquid() → application/liquid Response; relative <a href> gets a trailing slash', async () => {
    const app = makeTestApp();
    const ctx = await app.shopify.authenticate.public.appProxy(makeAppProxyRequest({}));
    const res = ctx.liquid('<a href="/apps/proxy/next">next</a>', { layout: false });
    expect(res.headers.get('Content-Type')).toBe('application/liquid');
    const text = await res.text();
    expect(text).toContain('{% layout none %}');
    expect(text).toContain('href="/apps/proxy/next/"');
  });
});
