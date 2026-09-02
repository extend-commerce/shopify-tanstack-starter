import { useState } from 'react';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';

import { generateProduct, type GenerateProductResult } from '~/server/generate-product';

/**
 * `/app` index (ADR 0007 index page). `<s-page>`, a thin `loader` read, and the
 * canonical write path: a `POST` server fn (`generateProduct`, carrying
 * `adminMiddleware`) invoked from `useMutation`, then `router.invalidate()`.
 *
 * The result is rendered as `<pre>` JSON plus an `<s-link>` deep link into the
 * admin — `shopify://admin/...` is resolved by App Bridge when embedded (inert on
 * the rare non-embedded render, acceptable for a demo — ADR 0007 Consequences).
 */
export const Route = createFileRoute('/_authenticated/app/')({
  loader: ({ context }) => ({ shop: context.shop }),
  component: AppIndex,
});

function AppIndex() {
  const { shop } = Route.useLoaderData();
  const router = useRouter();
  const [result, setResult] = useState<GenerateProductResult | null>(null);

  const mutation = useMutation({
    mutationFn: () => generateProduct(),
    onSuccess: async (data) => {
      setResult(data);
      await router.invalidate();
    },
  });

  const productId = result?.product.id.split('/').pop();

  return (
    <s-page heading="Shopify TanStack Starter">
      <s-section heading="Admin GraphQL demo">
        <s-paragraph>
          Signed in as <s-text>{shop}</s-text>. Click below to run a <s-text>productCreate</s-text>{' '}
          followed by a <s-text>productVariantsBulkUpdate</s-text> against the Admin API.
        </s-paragraph>

        <s-button
          variant="primary"
          onClick={() => mutation.mutate()}
          {...(mutation.isPending ? { loading: '' } : {})}
        >
          Generate a product
        </s-button>

        {mutation.isError ? (
          <s-banner tone="critical">
            {mutation.error instanceof Error ? mutation.error.message : 'Request failed.'}
          </s-banner>
        ) : null}

        {result ? (
          <s-stack direction="block" gap="base">
            <s-link href={`shopify://admin/products/${productId}`}>
              View {result.product.title} in the admin
            </s-link>
            <pre>
              <code>{JSON.stringify(result, null, 2)}</code>
            </pre>
          </s-stack>
        ) : null}
      </s-section>
    </s-page>
  );
}
