import { createFileRoute, redirect } from '@tanstack/react-router';

/**
 * `/` — the non-embedded fallback (ADR 0007 §route tree; revises ADR 0002).
 *
 * The embedded entry URL is `https://<host>/?embedded=1&host=…&id_token=…&shop=…`.
 * When `shop` / `host` are present we bounce to `/app`, **preserving the raw
 * query string** — App Bridge reads `host` / `shop` from the document's query
 * params, so a bare `redirect({ to: '/app' })` drops them and breaks App Bridge
 * init (prototype finding 1). `redirect({ href })` keeps the string verbatim.
 *
 * Without a resolvable `shop` (someone typed the bare app URL) we render a
 * minimal banner. NO login form, NO shop-domain entry field, NO other redirect —
 * a managed-install embedded app reached without a shop context has nothing
 * useful to ask (ADR 0007 §Why).
 *
 * `/` is on the IP-7 exclusion list, so the eager auth middleware never runs here.
 */
export const Route = createFileRoute('/')({
  beforeLoad: ({ location }) => {
    const params = new URLSearchParams(location.searchStr);
    if (params.get('shop') || params.get('host')) {
      throw redirect({ href: `/app${location.searchStr}` });
    }
  },
  component: RootIndex,
});

function RootIndex() {
  return (
    <s-page heading="Shopify TanStack Starter">
      <s-section>
        <s-banner tone="warning">This app must be opened from your Shopify admin.</s-banner>
      </s-section>
    </s-page>
  );
}
