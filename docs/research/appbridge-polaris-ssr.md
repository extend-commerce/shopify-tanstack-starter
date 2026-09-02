# App Bridge + Polaris in a non-Shopify-scaffold SSR app

**Ticket:** [ENG-2324](https://linear.app/extend-commerce/issue/ENG-2324/app-bridge-polaris-in-a-non-shopify-scaffold-ssr-app)
**Question:** How to run Shopify App Bridge (React) + Polaris inside a TanStack Start SSR app that was not scaffolded by Shopify CLI (`apps/web`, embedded admin).
**Date:** 2026-08-28
**Scope:** Clone-and-go only. Shopify CLI scaffold compatibility is out of scope.
**Related:** [ENG-2322](https://linear.app/extend-commerce/issue/ENG-2322/map-the-shopifyshopify-app-react-router-package-surface) (`docs/research/rr-package-surface.md`); grilling ticket [ENG-2330](https://linear.app/extend-commerce/issue/ENG-2330/decide-app-shell-polaris-app-bridge-tanstack-router).

---

## Decisions so far

Use the **App Home web-component stack**, not legacy React Polaris. Inject **CDN** `app-bridge.js` + `polaris.js` into the document `<head>` (TanStack Start supports this; prefer raw tags in `__root.tsx` over hoping `HeadContent` order is identical to Shopify’s checker). Initialise App Bridge from the `shopify-api-key` meta tag — **no** `createApp()` / `host` / React `Provider`. Feed package auth via App Bridge **ID token** (née session token) → `@shopify/shopify-api` `auth.tokenExchange`. Nav is **`<s-app-nav>`**, not `<ui-nav-menu>`. Port RR’s `shopify:navigate` listener to TanStack `useNavigate`. **Recommend a cheap `/prototype` ticket** for iframe SPA nav, head-tag order, custom-element hydration, and script-load order.

---

## 1. Polarise stack choice — web components, not `@shopify/polaris`

Current Polarise for **admin App Home** is the **web-components / app-home** stack. Official App Home docs say you render UI with Polarise web components (`s-page`, `s-button`, …) loaded from CDN, and talk to the admin with App Bridge. They are custom elements; they work in any framework, including React. Types are a companion npm package, not a runtime. ([App Home](https://shopify.dev/docs/api/app-home), [Polaris web components](https://shopify.dev/docs/api/app-home/web-components))

Do **not** take `@shopify/polaris` React (`AppProvider`, `i18n`, `linkComponent`, `Page`, CSS import) as the path for this port:

- Shopify’s own React Router package has **no** `@shopify/polaris` or `@shopify/app-bridge-react` dependency. Polarise is `polaris.js`; App Bridge is `app-bridge.js`. (`docs/research/rr-package-surface.md`; `AppProvider` source below.)
- `@shopify/shopify-app-react-router` `AppProvider` “Adds Polarise Web components and the App Bridge script to the route.” ([AppProvider](https://shopify.dev/docs/api/shopify-app-react-router/latest/entrypoints/appprovider))
- Polarise React (`@shopify/polaris` **13.9.5** as of 2026-08-10) still exists, still documents `AppProvider` + `linkComponent`, and still peers **React 18 only**. That is the **legacy** design-system package, not App Home. ([npm `@shopify/polaris`](https://www.npmjs.com/package/@shopify/polaris), [Polaris React App provider](https://polaris.shopify.com/components/utilities/app-provider?example=app-provider-with-link-component))
- Polarise React `Page` has a long-standing SSR hydration mismatch on small breakpoints (media-query header). ([Shopify/polaris#11886](https://github.com/Shopify/polaris/issues/11886))

### Packages to use

| Role | Package / URL | Version checked 2026-08-28 | Notes |
|---|---|---|---|
| App Bridge runtime | `https://cdn.shopify.com/shopifycloud/app-bridge.js` | unversioned CDN | Required. Auto-updates. ([App Bridge APIs](https://shopify.dev/docs/api/app-home/apis)) |
| Polarise UI runtime | `https://cdn.shopify.com/shopifycloud/polaris.js` | unversioned CDN | Required for `s-*` components. ([Web components](https://shopify.dev/docs/api/app-home/web-components)) |
| App Bridge types | `@shopify/app-bridge-types` | **0.7.2** | DevDep. Pin `@latest` per Shopify so types track CDN. |
| Polarise types | `@shopify/polaris-types` | **1.0.7** | DevDep. `compilerOptions.types` or triple-slash. Engines `node >= 22.18.0`. |
| App Bridge React (optional) | `@shopify/app-bridge-react` | **4.2.13** | `useAppBridge`, `NavMenu`, `TitleBar`, `Modal`. Peers `react`/`react-dom` `*` (docs still say 18+). **Not** required if you use `s-*` tags + `window.shopify`. |
| **Do not use for App Home** | `@shopify/polaris` | 13.9.5 | React components + CSS. CSS/Vite/React 19 pain lives here. |
| **Do not import in TanStack Start** | `@shopify/shopify-app-react-router/react` `AppProvider` | 2.0.0 | Calls `useNavigate()` from **react-router**. Copy the behaviour; do not depend on the package. |

Shopify’s Polarise-app-home skill: never import from `@shopify/polaris`, `@shopify/polaris-react`, or `@shopify/polaris-web-components`. `s-*` tags are global; `useAppBridge` comes from `@shopify/app-bridge-react` if you want the hook.

`tsconfig`:

```json
{
  "compilerOptions": {
    "types": ["@shopify/app-bridge-types", "@shopify/polaris-types"]
  }
}
```

([`@shopify/polaris-types` README](https://www.npmjs.com/package/@shopify/polaris-types); [App Home](https://shopify.dev/docs/api/app-home))

---

## 2. Head injection — script tag + `shopify-api-key`

### What Shopify requires

App Bridge is **not** an npm init. Put this in the HTML **head**, server-rendered on first paint (not client-only):

```html
<head>
  <meta name="shopify-api-key" content="%SHOPIFY_API_KEY%" />
  <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
</head>
```

`%SHOPIFY_API_KEY%` is the app **client ID** (public). The CDN script reads the meta tag, detects the admin iframe, and installs the `shopify` global. No `host`, no `forceRedirect`, no `createApp()`. ([App Bridge APIs](https://shopify.dev/docs/api/app-home/apis), [migration guide](https://shopify.dev/docs/api/app-bridge/migration-guide), [Config API](https://shopify.dev/docs/api/app-home/apis/authentication-and-data/config))

Polarise web components are a **second** CDN script:

```html
<script src="https://cdn.shopify.com/shopifycloud/polaris.js"></script>
```

Official Polarise docs show `shopify-api-key` + `polaris.js` alone. Official App Bridge docs show `shopify-api-key` + `app-bridge.js` alone. The React Router package injects **both**. Combined head used by Shopify’s own `AppProvider` and by the “without a template” auth tutorial:

```html
<meta name="shopify-api-key" content="YOUR_CLIENT_ID" />
<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
<script src="https://cdn.shopify.com/shopifycloud/polaris.js"></script>
```

Constants in `shopify-app-js`:

- `APP_BRIDGE_URL` = `https://cdn.shopify.com/shopifycloud/app-bridge.js`
- `POLARIS_URL` = `https://cdn.shopify.com/shopifycloud/polaris.js`
- `CDN_URL` = `https://cdn.shopify.com`

(`packages/apps/shopify-app-react-router/src/server/authenticate/const.ts`, `src/shared/const.ts`)

**Must be in the initial HTML.** Shopify staff: the `shopify-api-key` meta tag “needs to be available on page load, it cannot be client side rendered.” ([community thread](https://community.shopify.dev/t/shopify-idtoken-does-not-resolve/28349))

Config extras (optional meta tags **before** the scripts): `shopify-disabled-features` (`fetch`, `auto-redirect`), `shopify-app-origins` (allowlist for authenticated fetch to other origins). Shop, host, locale are set by the admin iframe automatically. ([Config API](https://shopify.dev/docs/api/app-home/apis/authentication-and-data/config))

Older bounce HTML in RR uses `<script data-api-key src=app-bridge.js>`. Current public docs use the **meta tag**. Prefer the meta tag for App Home pages; bounce pages can keep `data-api-key` if copying RR helpers.

### Does TanStack Start’s head management support it? **Yes.**

TanStack Start owns the document shell in `src/routes/__root.tsx`. You render `<html><head>…</head><body>…</body></html>` yourself. ([Start routing](https://tanstack.com/start/latest/docs/framework/react/guide/routing))

Two supported mechanisms:

1. **Raw tags in `<head>` (recommended for App Bridge)** — place meta + both CDN scripts **before** `<HeadContent />` so they are in the first-paint HTML and not reordered behind Vite/Start asset tags:

   ```tsx
   <head>
     <meta name="shopify-api-key" content={apiKey} />
     <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" />
     <script src="https://cdn.shopify.com/shopifycloud/polaris.js" />
     <HeadContent />
   </head>
   ```

   This matches how Shopify’s React Router **root** puts Inter/preconnect in `<head>` and how App Home docs show Remix `root.tsx`. Client ID is public; baking `process.env.SHOPIFY_API_KEY` / `import.meta.env.VITE_SHOPIFY_API_KEY` into the SSR document is acceptable (RR loader does the same).

2. **`Route.head()` + `<HeadContent />`** — `head()` returns `{ title, meta, links, styles, scripts }`. `scripts` here render **in `<head>`**. A separate `scripts:` route option + `<Scripts />` renders **body** scripts (hydration). ([Document head management](https://tanstack.com/router/latest/docs/guide/document-head-management))

   ```ts
   head: () => ({
     meta: [{ name: 'shopify-api-key', content: apiKey }],
     scripts: [
       { src: 'https://cdn.shopify.com/shopifycloud/app-bridge.js' },
       { src: 'https://cdn.shopify.com/shopifycloud/polaris.js' },
     ],
   })
   ```

   **Do not** put App Bridge on the body `scripts` option. It must run from `<head>` before React hydrates so `shopify` exists. `ScriptOnce` is for inline one-shot scripts, not CDN App Bridge.

RR also **preloads** both scripts on HTML responses:

```
Link: <https://cdn.shopify.com>; rel="preconnect",
      <https://cdn.shopify.com/shopifycloud/app-bridge.js>; rel="preload"; as="script",
      <https://cdn.shopify.com/shopifycloud/polaris.js>; rel="preload"; as="script"
```

(`addDocumentResponseHeaders` in `authenticate/helpers/add-response-headers.ts`)

Port that on TanStack HTML responses (root `headers` / middleware), together with CSP (section 8).

### Head-order uncertainty

App Store embedded checks look for “latest App Bridge script loaded from Shopify’s CDN.” Community reports of Next.js apps failing the check even with tags present; causes included CSP `connect-src` missing `cdn.shopify.com`, Cloudflare bot challenges, and **client-rendered** meta tags. Docs do **not** require the pair to be the first two children of `<head>`, but staff have said they must be in the first HTML. Vite/Start will inject charset, modulepreloads, and HMR after/around `HeadContent`. Putting Shopify tags as **raw siblings before `HeadContent`** is the conservative port. Whether the checker is order-sensitive is **prototype-worthy**.

**Script order** `app-bridge.js` vs `polaris.js` is also disputed: official combined examples put App Bridge first; a Shopify staff reply on the forums said Polarise-first avoids custom-element registration races with `@shopify/app-bridge-react`. ([forum: script order](https://community.shopify.dev/t/order-of-polaris-app-bridge-scripts-loading-on-the-page/33012)) Default to **App Bridge then Polarise** (docs + RR preload order); flag a prototype if `s-*` or `NavMenu` render as unknown elements.

---

## 3. App Bridge init, ID token, token exchange

### Init against the embedded context

After the CDN script runs inside the admin iframe:

- `shopify` global is available (or `useAppBridge()` returns it / an SSR-safe proxy). ([useAppBridge](https://shopify.dev/docs/api/app-home/apis/react-hooks/useappbridge))
- `shopify.config.shop`, `.host`, `.locale` come from the host. `.apiKey` comes from the meta tag. ([Config API](https://shopify.dev/docs/api/app-home/apis/authentication-and-data/config))
- App Bridge v4 **must not** coexist with npm `@shopify/app-bridge` `createApp()`. Staff: missing `shop`/`host` errors are the old package. ([community](https://community.shopify.dev/t/shopify-app-submission-embedded-app-checks/29323))

`useAppBridge` exists specifically so SSR code does not touch `window.shopify`. Requires `@shopify/app-bridge-react@v4` **and** the CDN script. ([useAppBridge](https://shopify.dev/docs/api/app-home/apis/react-hooks/useappbridge), [migration guide React](https://shopify.dev/docs/api/app-bridge/migration-guide-react))

### ID token (session token)

An **ID token** (previously “session token”) is a ~1 minute JWT proving a logged-in Shopify user in a specific shop. It has **no API scopes**. You never send it to Admin GraphQL. ([ID tokens](https://shopify.dev/docs/apps/build/authentication-authorization/id-tokens))

How the frontend gets it:

1. **Default:** App Bridge’s fetch interceptor adds `Authorization: Bearer <id_token>` and `Accept-Language` on requests to **your app origin** (and allowlisted `shopify-app-origins`). ([Resource Fetching](https://shopify.dev/docs/api/app-home/apis/authentication-and-data/resource-fetching-api))
2. **Explicit:** `await shopify.idToken()` — required for WebSockets, non-fetch transports, or if you disable the interceptor (`shopify-disabled-features: fetch`). ([ID Token API](https://shopify.dev/docs/api/app-home/apis/authentication-and-data/id-token-api), [implement token exchange](https://shopify.dev/docs/apps/build/authentication-authorization/implement-token-exchange?lang=node))

First document load may also carry `id_token` as a query param (RR bounce / App Bridge reload). Subsequent XHR uses the Bearer header. (`docs/research/rr-package-surface.md`)

Direct Admin GraphQL from the browser uses `fetch('shopify:admin/api/graphql.json', …)` and requires TOML `embedded_app_direct_api_access = true`. That path does **not** use your backend token exchange. ([App Home](https://shopify.dev/docs/api/app-home))

### How the token feeds package auth

Backend (this port: `@shopify/shopify-api`, not RR `authenticate.admin`):

1. Read Bearer or `id_token`.
2. `api.session.decodeSessionToken(token)` — HS256 with client secret; check `exp`, `nbf`, `aud` (= client ID), `iss`/`dest` hostnames. ([ID tokens](https://shopify.dev/docs/apps/build/authentication-authorization/id-tokens))
3. `api.auth.tokenExchange({ shop, sessionToken, requestedTokenType, expiring })` POSTs to `https://{shop}/admin/oauth/access_token` with:
   - `grant_type`: `urn:ietf:params:oauth:grant-type:token-exchange`
   - `subject_token`: the ID token
   - `subject_token_type`: `urn:ietf:params:oauth:token-type:id_token`
   - `requested_token_type`: offline or online URN
   - `expiring`: `'1'` for expiring offline (required for public Admin API apps by 2027-01-01)
4. Store the resulting `Session` (`accessToken`, optional `refreshToken`). **Never** send access tokens to the browser. ([Access tokens](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens), [shopify-api `tokenExchange`](https://github.com/Shopify/shopify-app-js/blob/main/packages/apps/shopify-api/docs/reference/auth/tokenExchange.md), [token-exchange.ts](https://github.com/Shopify/shopify-app-js/blob/main/packages/apps/shopify-api/lib/auth/oauth/token-exchange.ts))

Shopify’s **without a template** walkthrough is the canonical non-CLI path. ([implement token exchange](https://shopify.dev/docs/apps/build/authentication-authorization/implement-token-exchange?lang=node))

Invalid / expired ID token:

- Local JWT fail or Shopify `400 invalid_subject_token` → **401** + `X-Shopify-Retry-Invalid-Session-Request: 1` on XHR so App Bridge refreshes the ID token and retries once. Document requests bounce to the session-token page. Do **not** 502 a stale ID token. ([implement token exchange](https://shopify.dev/docs/apps/build/authentication-authorization/implement-token-exchange?lang=node), RR `RETRY_INVALID_SESSION_HEADER`)

Fetch interceptor caveats (community, not docs): some non-Remix apps see expired/missing `Authorization` on auto-injected fetch; workaround is manual `shopify.idToken()` per request. Treat as **prototype** against TanStack server functions / relative `fetch`. ([forum](https://community.shopify.dev/t/app-bridge-v4-cdn-automatic-fetch-authorization-sends-expired-undefined-tokens-x-shopify-retry-invalid-session-request-doesnt-recover/32004))

---

## 4. Polarise `AppProvider` / `linkComponent` — do not port

Ticket items `AppProvider` i18n + `linkComponent` belong to **legacy Polarise React**. App Home web components:

- Have **no** React `AppProvider`.
- Need **no** i18n JSON (`@shopify/polaris/locales/en.json`). Locale is `shopify.config.locale` from the admin. ([Config API](https://shopify.dev/docs/api/app-home/apis/authentication-and-data/config))
- Need **no** `linkComponent`. In-app links are `<s-link href="/path">` or `<a href="/path">`; App Bridge intercepts relative navigation. ([Navigation API](https://shopify.dev/docs/api/app-home/apis/user-interface-and-interactions/navigation-api), [App nav](https://shopify.dev/docs/api/app-home/app-bridge-web-components/app-nav))

The **other** `AppProvider` (`@shopify/shopify-app-react-router/react`) is framework glue: CDN scripts + `shopify:navigate` → `react-router` `useNavigate()`. Port that glue to TanStack; do not install the RR package (peer `react-router ^7`). Source:

```ts
// packages/apps/shopify-app-react-router/src/react/components/AppProvider/AppProvider.tsx
document.addEventListener('shopify:navigate', handleNavigate);
const href = (event.target as HTMLElement)?.getAttribute('href');
if (href) navigate(href);
```

TanStack equivalent: same listener calling `useNavigate()` from `@tanstack/react-router` (or `router.navigate({ to: href })`).

---

## 5. Nav menu — `<s-app-nav>`, not `<ui-nav-menu>`

| API | Status |
|---|---|
| `<ui-nav-menu>` + `<a rel="home">` | **Legacy.** Removed from current docs. Forum 2026-06: docs gone; still works for some apps. Staff suggested `<s-app-nav>`. ([forum](https://community.shopify.dev/t/is-ui-nav-menu-deprecated/35216), [forum sales channel](https://community.shopify.dev/t/cdn-app-bridge-not-showing-navmenu-in-sales-channel/25696)) |
| App Bridge 3 `NavigationMenu.create` | Legacy. Migration guide replacement is `<s-app-nav>`. ([migration guide](https://shopify.dev/docs/api/app-bridge/migration-guide)) |
| `<s-app-nav>` + `<s-link href>` | **Current.** Desktop left sidebar; mobile title-bar dropdown. Relative `href` only. `rel="home"` overrides default `/` and hides that item. Active item is URL-matched. No nesting. ([App nav](https://shopify.dev/docs/api/app-home/app-bridge-web-components/app-nav)) |
| `<NavMenu>` from `@shopify/app-bridge-react` | React wrapper still used in the **official React Router template** around React Router `<Link>`. Shopify staff: React wrappers are “legacy mode,” not immediately deprecated. ([RR template docs](https://shopify.dev/docs/api/shopify-app-react-router/latest), [forum script order](https://community.shopify.dev/t/order-of-polaris-app-bridge-scripts-loading-on-the-page/33012)) |

Recommended for this port:

```html
<s-app-nav>
  <s-link href="/app" rel="home">Home</s-link>
  <s-link href="/app/templates">Templates</s-link>
  <s-link href="/app/settings">Settings</s-link>
</s-app-nav>
```

Docs: click “navigates the app to this route without a full page reload.” That SPA behaviour is what RR wires with `shopify:navigate` → `useNavigate`. Without that listener, sidebar clicks can reload the iframe (TanStack Router never sees them).

Programmatic nav: `open('/path', '_self')`, `history.pushState`, or the browser Navigation API. Admin resources: `shopify://admin/products/123` with `target="_top"`. ([Navigation API](https://shopify.dev/docs/api/app-home/apis/user-interface-and-interactions/navigation-api))

---

## 6. Wiring Polarise links + nav to TanStack Router

Facts already enough to **design** the shell:

1. Render `<s-app-nav>` once in the authenticated layout (same place RR puts `NavMenu`).
2. Listen for `shopify:navigate`, read `href`, call TanStack `navigate({ to: href })`.
3. In-iframe links: prefer `<s-link href>` / `<a href>` so App Bridge can intercept; or TanStack `<Link>` for in-iframe SPA moves (history API — App Bridge v4 documents `history.pushState` as the replacement for `History.Action.PUSH`). ([migration guide](https://shopify.dev/docs/api/app-bridge/migration-guide))
4. Keep the **parent** admin URL in sync: App Bridge intercepts history; TanStack should use the same history object (default). If admin URL and iframe URL diverge after client nav, that is a prototype finding.
5. Do **not** implement Polarise React `linkComponent`.

Behaviour to **prototype** (cannot prove from docs alone): whether `s-app-nav` clicks always emit `shopify:navigate` under TanStack Start SSR HTML; whether TanStack `<Link>` inside `NavMenu` is redundant if `s-link` already SPA-navigates; whether full document requests (loader refetch) still carry `id_token` / session cookie after client-side nav.

---

## 7. Known issues — Polarise CSS / App Bridge / Vite SSR / React 18–19

### Polarise CSS

If you **do not** install `@shopify/polaris`, you **do not** import `styles.css`. Polarise web components ship styles inside `polaris.js`. The historical Vite/Webpack failures (`Can't resolve '@shopify/polaris/styles.css'`, then `dist/styles.css`, then `build/esm/styles.css`) are **avoided**. ([Shopify/polaris#3134](https://github.com/Shopify/polaris/issues/3134); Remix template still uses `?url` import **only** on the legacy Polarise React path.)

RR preconnects `https://cdn.shopify.com` and preloads Inter: `https://cdn.shopify.com/static/fonts/inter/v4/styles.css` (React Router `root.tsx`). Optional for visual match.

### Vite SSR

CDN scripts are **not** Vite-bundled, so they skip `ssr.noExternal` / CJS-in-node_modules issues. Remaining Vite concerns:

- `ssr.noExternal` for `@shopify/polaris` / `@shopify/polaris-viz` **only if** someone adds those packages.
- Custom elements in SSR HTML: React serializes unknown tags; `polaris.js` upgrades them after parse. Hydration must see the same attributes.
- Do not `ssr.external` a package that then `import`s Polarise CSS.

### React 18 vs 19

- App Bridge React 4 docs: React **18 or higher**. npm 4.2.13 peers `react`/`react-dom` `*`. ([migration guide React](https://shopify.dev/docs/api/app-bridge/migration-guide-react), [npm](https://www.npmjs.com/package/@shopify/app-bridge-react))
- Polarise React 13 peers **`^18.0.0` only** — another reason not to use it on a React 19 Start app.
- Polarise **web components** + React 19 SSR: reported hydration mismatches on `<s-page>` slotted actions (`slot="breadcrumb-actions"`: server `style={{display:"none"}}` vs client text) and `<s-banner onDismiss>`. Shopify logged the breadcrumb bug against a stock `shopify app init` app. ([forum: React 19 page actions](https://community.shopify.dev/t/react-19-cause-ssr-issue-with-page-actions/23661), [forum: s-banner onDismiss](https://community.shopify.dev/t/polaris-banner-web-component-ssr-issue-with-ondismiss/25290))
- Function props on custom elements (`onClick` / `onDismiss`) do not round-trip through SSR HTML the way React DOM props do. Prefer native events / `useEffect` listeners for anything that hydrates. This is **prototype-worthy** on the Start + React 19 combo you actually ship.

### App Bridge

- Ad blockers can block ID token issuance (App Store automated auth check). ([ID tokens](https://shopify.dev/docs/apps/build/authentication-authorization/id-tokens))
- CSP `script-src` / `connect-src` must allow `https://cdn.shopify.com` (and typically `https://*.shopify.com`) or the script loads but runtime calls fail.
- `disabledFeatures: ['auto-redirect']` if you need a non-embedded landing route.

---

## 8. Document headers (required companion, not Polarise)

Embedded HTML responses must send shop-specific CSP:

```
Content-Security-Policy: frame-ancestors https://{shop}.myshopify.com https://admin.shopify.com;
```

RR also allows `https://*.spin.dev`, `https://admin.myshopify.io`, `https://admin.shop.dev`. Headers must be on **every HTML route**. Standalone (exit-iframe / OAuth) uses `frame-ancestors 'none'`. ([iframe protection](https://shopify.dev/docs/apps/build/security/set-up-iframe-protection), RR `addDocumentResponseHeaders`)

TanStack Start: set this in root route `headers` / request middleware. Shop comes from the session token `dest` or `?shop=` on first load.

---

## 9. Implications for the port (ENG-2330 app shell)

Grill the shell against this, not against Polarise React tutorials:

1. **`__root.tsx` document shell** — raw `shopify-api-key` + `app-bridge.js` + `polaris.js` before `<HeadContent />`; `<Scripts />` stays at end of `<body>` for Start hydration only.
2. **Authenticated layout** (RR `app.tsx` equivalent) — TanStack `AppProvider`-alike: Polarise script is already in head; this layout only (a) `shopify:navigate` → `useNavigate`, (b) `<s-app-nav>`, (c) `<Outlet />`. Do not wrap with `@shopify/polaris` `AppProvider`.
3. **No `linkComponent` / i18n provider.** Locale from `shopify.config.locale` if UI copy needs it.
4. **Nav:** `<s-app-nav>` + `<s-link>`. Skip `<ui-nav-menu>`. Optional `@shopify/app-bridge-react` `NavMenu` only if the prototype shows `s-app-nav` failing under Start.
5. **Auth:** App Bridge fetch → Bearer ID token → `decodeSessionToken` + `tokenExchange` (ENG-2322). Shell must not block on Polarise. 401 + retry header on XHR; bounce HTML on documents.
6. **Headers:** CSP `frame-ancestors` + CDN `Link` preload on HTML.
7. **UI:** `s-page` / `s-section` / `s-button` with no Polarise CSS import. Budget React 19 slot hydration. Keep page actions simple until the prototype says slots are safe.
8. **Direct API** (`shopify:admin/api/graphql.json`) is optional and orthogonal to token exchange; enable in TOML if the shell wants client-side Admin reads.
9. **Do not** depend on `@shopify/shopify-app-react-router` in `apps/web`. Copy the two React behaviours (scripts + `shopify:navigate`).

---

## 10. Should we prototype?

**Yes — one cheap `/prototype` ticket.** Architectural choices above are decided from docs + RR source. The following are **behavioural** and cheap to settle in a throwaway Start app embedded in a dev store:

| Uncertainty | Why docs are not enough | Cheap test |
|---|---|---|
| **Head-tag order vs App Bridge / App Store check** | Docs show tags in `<head>`; checker failures in Next.js were environmental. Start injects extra head assets. | Curl the SSR HTML: meta + both scripts present, not `async`/`type=module`. Open in admin; `window.shopify` defined before hydration. Optional: tags before vs after `HeadContent`. |
| **`shopify:navigate` → TanStack Router** | RR source is the only spec for the event. Docs claim `s-link` SPA-navigates without saying the app router is invoked. | Click sidebar + in-page `s-link`; assert no full iframe reload; TanStack match changes; admin URL updates. |
| **`<s-app-nav>` vs `NavMenu` + TanStack `<Link>`** | Official template still uses `NavMenu`+RR `Link`; current docs use `s-app-nav`. | Render both in the prototype; keep whichever actually highlights + navigates. |
| **`app-bridge.js` vs `polaris.js` load order** | Docs vs staff forum disagree. | Swap order; look for unknown `s-*` elements / console registration errors. |
| **React 19 custom-element hydration** | Confirmed on Remix/RR + `s-page` slots and `s-banner onDismiss`; not proven on Start. | SSR a `s-page` with and without slotted breadcrumb/primary action; watch hydration warnings. Prefer `useEffect` listeners if props mismatch. |
| **Fetch interceptor vs Start server functions** | Interceptor targets same-origin `fetch`. Start may use different URLs / RPC. Community reports missing/expired auto tokens. | Same-origin `fetch('/api/...')` has Bearer; a server function call does or does not. If not, call `shopify.idToken()` and attach the header. |

**Not prototype-worthy** (already enough to decide): Polarise React vs web components; CDN vs `createApp()`; token-exchange grant parameters; dropping `AppProvider` i18n/`linkComponent`; replacing `ui-nav-menu`; depending on `@shopify/shopify-api` rather than RR `AppProvider`.

Prototype is **shell-only**: `__root` scripts, one layout, two routes, nav, `idToken()` logged, no product CRUD.

---

## Claim → source index

| Claim | Source |
|---|---|
| App Home = App Bridge CDN + Polarise web components | https://shopify.dev/docs/api/app-home |
| `shopify-api-key` + `app-bridge.js` | https://shopify.dev/docs/api/app-home/apis ; https://shopify.dev/docs/api/app-bridge/migration-guide |
| `polaris.js` + `@shopify/polaris-types` | https://shopify.dev/docs/api/app-home/web-components |
| Config meta tags / shop / locale | https://shopify.dev/docs/api/app-home/apis/authentication-and-data/config |
| ID token vs access token; 1 min TTL | https://shopify.dev/docs/apps/build/authentication-authorization/id-tokens |
| Fetch interceptor | https://shopify.dev/docs/api/app-home/apis/authentication-and-data/resource-fetching-api |
| `shopify.idToken()` | https://shopify.dev/docs/api/app-home/apis/authentication-and-data/id-token-api |
| Token exchange grant + 401 retry header | https://shopify.dev/docs/apps/build/authentication-authorization/implement-token-exchange?lang=node ; https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens |
| `shopify.auth.tokenExchange` | https://github.com/Shopify/shopify-app-js/blob/main/packages/apps/shopify-api/lib/auth/oauth/token-exchange.ts |
| `useAppBridge` SSR proxy | https://shopify.dev/docs/api/app-home/apis/react-hooks/useappbridge |
| Remove App Bridge React `Provider` | https://shopify.dev/docs/api/app-bridge/migration-guide-react |
| `<s-app-nav>` | https://shopify.dev/docs/api/app-home/app-bridge-web-components/app-nav |
| `ui-nav-menu` undocumented | https://community.shopify.dev/t/is-ui-nav-menu-deprecated/35216 |
| Navigation / history API | https://shopify.dev/docs/api/app-home/apis/user-interface-and-interactions/navigation-api |
| RR `AppProvider` scripts + `shopify:navigate` | `shopify-app-js` `…/AppProvider/AppProvider.tsx` |
| RR CSP + preload | `…/authenticate/helpers/add-response-headers.ts` |
| CSP `frame-ancestors` | https://shopify.dev/docs/apps/build/security/set-up-iframe-protection |
| TanStack `head` / `HeadContent` / `Scripts` | https://tanstack.com/router/latest/docs/guide/document-head-management ; https://tanstack.com/start/latest/docs/framework/react/guide/routing |
| npm versions | registry `@shopify/app-bridge-react@4.2.13`, `@shopify/app-bridge-types@0.7.2`, `@shopify/polaris-types@1.0.7`, `@shopify/polaris@13.9.5` |
| Polarise React SSR Page mismatch | https://github.com/Shopify/polaris/issues/11886 |
| React 19 `s-page` slot hydration | https://community.shopify.dev/t/react-19-cause-ssr-issue-with-page-actions/23661 |
| Meta must be first paint | https://community.shopify.dev/t/shopify-idtoken-does-not-resolve/28349 |
| Script order staff comment | https://community.shopify.dev/t/order-of-polaris-app-bridge-scripts-loading-on-the-page/33012 |
