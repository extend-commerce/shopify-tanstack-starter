# web

The embedded Shopify admin app (ADR 0006 / 0007). App Bridge + Polaris web
components on TanStack Start, wired to `shopify-app-tanstack-start`.

## `shopify.authenticate.*` — the RR-parity facade (ADR 0010)

`shopify.server.ts` re-exports `authenticate` off the `createShopifyApp` return.
Every method takes an explicit `Request` and runs **server-side only** — inside a
server route handler or a `createServerFn` handler, never an isomorphic
`beforeLoad` / `loader`.

The middleware idiom is still the primary style (`adminMiddleware` on Admin
`createServerFn`s, `requestMiddleware` global). `authenticate.*` is the
equal-status alternative, and the only option for **server routes** (which cannot
carry function middleware).

Wired examples in this app:

- `authenticate.admin` — via `adminMiddleware` in `app/server/generate-product.ts`.
- `authenticate.webhook` — via `shopify.handlers.webhooks(...)` in
  `app/routes/webhooks/*`.
- `authenticate.public.appProxy` — `app/routes/proxy/$.ts` (+ the
  `AppProxyProvider` / `AppProxyLink` demo on `/app/proxy-demo`).

### Flow, POS, and fulfillment service — no example route

These need real extension configuration to exercise (verified later via a
dedicated test app — ADR 0010 7), so the starter ships no route for them. Each is
a server route calling the matching `authenticate.*` method:

#### Flow action

```ts
// app/routes/flow/action.ts
import { createFileRoute } from '@tanstack/react-router';
import { shopify } from '~/shopify.server';

const handler = async (request: Request): Promise<Response> => {
  try {
    const { session, payload, admin } = await shopify.authenticate.flow(request);
    // `payload` is the parsed Flow action body; `admin` is an offline Admin
    // client for `session.shop`. Do the work, then acknowledge with 200.
    void session;
    void payload;
    void admin;
    return new Response(null, { status: 200 });
  } catch (error) {
    if (error instanceof Response) return error; // 400 bad HMAC / 405 non-POST
    throw error;
  }
};

export const Route = createFileRoute('/flow/action')({
  server: { handlers: { POST: ({ request }) => handler(request) } },
});
```

#### POS UI extension

```ts
// app/routes/pos/data.ts
import { createFileRoute } from '@tanstack/react-router';
import { shopify } from '~/shopify.server';

const handler = async (request: Request): Promise<Response> => {
  try {
    const { sessionToken, cors } = await shopify.authenticate.pos(request);
    // `sessionToken` is the decoded extension JWT. Wrap every response in `cors`.
    return cors(Response.json({ ok: true, sub: sessionToken.sub }));
  } catch (error) {
    if (error instanceof Response) return error; // 401 missing / bad Bearer
    throw error;
  }
};

export const Route = createFileRoute('/pos/data')({
  server: {
    handlers: {
      GET: ({ request }) => handler(request),
      OPTIONS: ({ request }) => handler(request), // CORS preflight → 204 via `cors`
    },
  },
});
```

#### Fulfillment service

```ts
// app/routes/fulfillment/notify.ts
import { createFileRoute } from '@tanstack/react-router';
import { shopify } from '~/shopify.server';

const handler = async (request: Request): Promise<Response> => {
  try {
    const { session, payload, admin } = await shopify.authenticate.fulfillmentService(request);
    // `payload.kind` selects the sub-flow (`FULFILLMENT_REQUEST` /
    // `CANCELLATION_REQUEST`); `admin` is an offline client for `session.shop`.
    void session;
    void admin;
    if (payload.kind === 'FULFILLMENT_REQUEST') {
      // fetch assigned fulfillment orders, accept / reject, ...
    }
    return new Response(null, { status: 200 });
  } catch (error) {
    if (error instanceof Response) return error; // 400 bad HMAC / 405 non-POST
    throw error;
  }
};

export const Route = createFileRoute('/fulfillment/notify')({
  server: { handlers: { POST: ({ request }) => handler(request) } },
});
```

Any new public route must be added to `EXCLUDE_PATHS` in
`app/shopify.exclude-paths.ts`, or the eager embedded-auth middleware forces it
through the bounce.
