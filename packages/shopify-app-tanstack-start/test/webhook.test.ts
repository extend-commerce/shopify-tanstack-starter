/**
 * ADR 0010 6 — `authenticate.webhook` primitive + `handlers.webhooks` factory.
 *
 * Pins the RR status matrix (200 / 400 / 401 / 405 / 500), the topic-map
 * `/` <-> `_` normalization, and the `session: undefined` path.
 */
import { describe, expect, it, vi } from 'vitest';

import { makeTestApp, makeWebhookRequest, storeActiveOfflineSession, TEST_SHOP } from './helpers';

describe('authenticate.webhook (primitive)', () => {
  it('success → { shop, topic, webhookId, apiVersion, payload, session }', async () => {
    const app = makeTestApp();
    await storeActiveOfflineSession(app);
    const ctx = await app.shopify.authenticate.webhook(
      makeWebhookRequest({ topic: 'app/uninstalled', body: { id: 1 } }),
    );
    expect(ctx.shop).toBe(TEST_SHOP);
    // `api.webhooks.validate` canonicalizes the delivered `X-Shopify-Topic` to
    // its storage/enum form; the factory's `normalizeTopic` bridges both forms
    // (see the normalization tests below).
    expect(ctx.topic).toBe('APP_UNINSTALLED');
    expect(ctx.webhookId).toBe('wh-1');
    expect(ctx.apiVersion).toBe('2026-07');
    expect(ctx.payload).toEqual({ id: 1 });
    expect(ctx.session?.shop).toBe(TEST_SHOP);
  });

  it('no offline session on file → session is undefined (still resolves)', async () => {
    const app = makeTestApp();
    const ctx = await app.shopify.authenticate.webhook(
      makeWebhookRequest({ topic: 'app/uninstalled' }),
    );
    expect(ctx.session).toBeUndefined();
    expect(ctx.shop).toBe(TEST_SHOP);
  });

  it('non-POST → throws a 405 Response', async () => {
    const app = makeTestApp();
    await expect(
      app.shopify.authenticate.webhook(
        makeWebhookRequest({ topic: 'app/uninstalled', method: 'GET' }),
      ),
    ).rejects.toSatisfy((e) => e instanceof Response && e.status === 405);
  });

  it('tampered HMAC → throws a 401 Response', async () => {
    const app = makeTestApp();
    await expect(
      app.shopify.authenticate.webhook(
        makeWebhookRequest({ topic: 'app/uninstalled', tamperHmac: true }),
      ),
    ).rejects.toSatisfy((e) => e instanceof Response && e.status === 401);
  });

  it('missing HMAC header → throws a 400 Response', async () => {
    const app = makeTestApp();
    await expect(
      app.shopify.authenticate.webhook(
        makeWebhookRequest({ topic: 'app/uninstalled', omitHmac: true }),
      ),
    ).rejects.toSatisfy((e) => e instanceof Response && e.status === 400);
  });

  it('valid HMAC but non-JSON body → throws a 400 Response', async () => {
    const app = makeTestApp();
    await expect(
      app.shopify.authenticate.webhook(
        makeWebhookRequest({ topic: 'app/uninstalled', body: 'not-json{' }),
      ),
    ).rejects.toSatisfy((e) => e instanceof Response && e.status === 400);
  });
});

describe('handlers.webhooks (factory)', () => {
  it('single handler resolves → 200', async () => {
    const app = makeTestApp();
    const seen: unknown[] = [];
    const route = app.shopify.handlers.webhooks(async (ctx) => {
      seen.push(ctx.topic);
    });
    const res = await route({ request: makeWebhookRequest({ topic: 'app/uninstalled' }) });
    expect(res.status).toBe(200);
    expect(seen).toEqual(['APP_UNINSTALLED']);
  });

  it('handler throws → 500 (so Shopify retries)', async () => {
    const app = makeTestApp();
    const route = app.shopify.handlers.webhooks(async () => {
      throw new Error('boom');
    });
    const res = await route({ request: makeWebhookRequest({ topic: 'app/uninstalled' }) });
    expect(res.status).toBe(500);
  });

  it('non-POST → 405', async () => {
    const app = makeTestApp();
    const route = app.shopify.handlers.webhooks(async () => {});
    const res = await route({
      request: makeWebhookRequest({ topic: 'app/uninstalled', method: 'GET' }),
    });
    expect(res.status).toBe(405);
  });

  it('tampered HMAC → 401', async () => {
    const app = makeTestApp();
    const route = app.shopify.handlers.webhooks(async () => {});
    const res = await route({
      request: makeWebhookRequest({ topic: 'app/uninstalled', tamperHmac: true }),
    });
    expect(res.status).toBe(401);
  });

  it('single-handler expectedTopic mismatch → 400', async () => {
    const app = makeTestApp();
    const route = app.shopify.handlers.webhooks(async () => {}, {
      expectedTopic: 'app/uninstalled',
    });
    const res = await route({
      request: makeWebhookRequest({ topic: 'products/update' }),
    });
    expect(res.status).toBe(400);
  });

  it('map mode: unknown topic is acknowledged with 200 (never a non-2xx)', async () => {
    const app = makeTestApp();
    const warn = vi.fn();
    const route = app.shopify.handlers.webhooks({ 'app/uninstalled': async () => {} });
    // logger.warning is best-effort; just assert the status contract.
    void warn;
    const res = await route({ request: makeWebhookRequest({ topic: 'orders/create' }) });
    expect(res.status).toBe(200);
  });

  it('topic-map normalization: slash key matches an ENUM_FORM delivery', async () => {
    const app = makeTestApp();
    const hits: string[] = [];
    const route = app.shopify.handlers.webhooks({
      'customers/data_request': async () => {
        hits.push('slash-key');
      },
    });
    const res = await route({
      request: makeWebhookRequest({ topic: 'CUSTOMERS_DATA_REQUEST' }),
    });
    expect(res.status).toBe(200);
    expect(hits).toEqual(['slash-key']);
  });

  it('topic-map normalization: ENUM_FORM key matches a slash-form delivery', async () => {
    const app = makeTestApp();
    const hits: string[] = [];
    const route = app.shopify.handlers.webhooks({
      CUSTOMERS_REDACT: async () => {
        hits.push('enum-key');
      },
    });
    const res = await route({ request: makeWebhookRequest({ topic: 'customers/redact' }) });
    expect(res.status).toBe(200);
    expect(hits).toEqual(['enum-key']);
  });

  it('session: undefined reaches the handler when no offline token is stored', async () => {
    const app = makeTestApp();
    let received: unknown = 'unset';
    const route = app.shopify.handlers.webhooks(async (ctx) => {
      received = ctx.session;
    });
    const res = await route({ request: makeWebhookRequest({ topic: 'app/uninstalled' }) });
    expect(res.status).toBe(200);
    expect(received).toBeUndefined();
  });
});
