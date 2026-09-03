/**
 * ADR 0010 2 — `admin.graphql` resolves a Fetch `Response` (not the parsed body);
 * an upstream Admin-API 401 comes back AS a `Response` with that status (not
 * thrown) from the bare client, while the `authenticate.admin` wrapper turns that
 * 401 into the thrown retry `Response` (ADR 0002 failure contract).
 *
 * ADR 0010 deviation #3 (resolved) — `createAdminApiContext` is now a true
 * `createAdminApiClient(...).fetch` passthrough, so the real upstream response
 * headers survive onto the returned `Response`. `@shopify/admin-api-client` calls
 * the global `fetch` (not `@shopify/shopify-api`'s abstract fetch), so the fake is
 * installed on `globalThis.fetch` — before the client is built, since
 * `@shopify/graphql-client` captures the `fetch` reference at construction time.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Session } from '@shopify/shopify-api';
import { setAbstractFetchFunc } from '@shopify/shopify-api/runtime';

import { createAdminApiContext } from '../src/clients/admin';
import { RETRY_INVALID_SESSION_HEADER } from '../src/server/auth/headers';
import {
  makeTestApp,
  mintSessionToken,
  storeActiveOfflineSession,
  TEST_API_VERSION,
  TEST_SHOP,
  xhrRequest,
} from './helpers';

const QUERY = `#graphql
  query { shop { name } }
`;

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  // `@shopify/shopify-api`'s web-api adapter captured `fetch` by reference at
  // import time, so restore through its own setter too.
  setAbstractFetchFunc(realFetch);
});

/**
 * Point the Admin client at a canned response. `@shopify/admin-api-client` reads
 * `globalThis.fetch` when the client is constructed, so call this BEFORE building
 * the context under test.
 */
function stubFetch(response: () => Response): void {
  const fake = vi.fn(async () => response()) as unknown as typeof fetch;
  globalThis.fetch = fake;
  setAbstractFetchFunc(fake);
}

describe('createAdminApiContext().graphql', () => {
  function ctx() {
    const app = makeTestApp();
    const session = new Session({
      id: app.api.session.getOfflineId(TEST_SHOP),
      shop: TEST_SHOP,
      state: '',
      isOnline: false,
      accessToken: 'offline-access-token',
      scope: 'read_products',
    });
    return createAdminApiContext(session, TEST_API_VERSION);
  }

  it('resolves a Fetch Response; .json() carries typed data', async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ data: { shop: { name: 'Contract Test' } } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );

    const res = await ctx().graphql(QUERY);
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ shop: { name: 'Contract Test' } });
  });

  it('passes the real upstream response headers straight through (deviation #3)', async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ data: { shop: { name: 'Contract Test' } } }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'X-Shopify-API-Deprecated-Reason': 'https://example.test/deprecation',
            'Retry-After': '2.0',
          },
        }),
    );

    const res = await ctx().graphql(QUERY);
    // Not synthesized from the parsed body — these come off the genuine upstream
    // `Response` the client returned.
    expect(res.headers.get('X-Shopify-API-Deprecated-Reason')).toBe(
      'https://example.test/deprecation',
    );
    expect(res.headers.get('Retry-After')).toBe('2.0');
  });

  it('a simulated upstream 401 comes back as res.status === 401 — NOT thrown', async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ errors: 'Unauthorized' }), {
          status: 401,
          statusText: 'Unauthorized',
          headers: { 'content-type': 'application/json' },
        }),
    );

    const res = await ctx().graphql(QUERY);
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(401);
  });
});

describe('authenticate.admin(...).admin.graphql — 401 retry path', () => {
  it('throws the retry Response and clears the stored access token', async () => {
    const app = makeTestApp();
    await storeActiveOfflineSession(app);
    const request = xhrRequest('https://app.example.test/app', {
      headers: { authorization: `Bearer ${mintSessionToken()}` },
    });

    // Stub before `authenticate.admin` builds the Admin client (fetch is captured
    // at construction). Nothing on the `authenticate.admin` path hits the network
    // — the stored offline session is fresh.
    stubFetch(
      () =>
        new Response(JSON.stringify({ errors: 'Unauthorized' }), {
          status: 401,
          statusText: 'Unauthorized',
          headers: { 'content-type': 'application/json' },
        }),
    );

    const context = await app.shopify.authenticate.admin(request);

    let thrown: unknown;
    try {
      await context.admin.graphql(QUERY);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(401);
    expect((thrown as Response).headers.get(RETRY_INVALID_SESSION_HEADER)).toBe('1');

    const stored = await app.storage.loadSession(app.api.session.getOfflineId(TEST_SHOP));
    expect(stored?.accessToken).toBeFalsy();
  });
});
