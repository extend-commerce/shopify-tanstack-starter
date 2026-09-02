import { createServerFn } from '@tanstack/react-start';

import { adminMiddleware } from '~/shopify.middleware';

/**
 * The Admin GraphQL demo (ADR 0007 Q3), ported verbatim from the React Router
 * template's `app._index` action: create a random product, then set its single
 * variant's price with a chained second mutation.
 *
 * Shape of the starter's canonical write path (ADR 0007 data-flow):
 *   - a `POST` `createServerFn` carrying `adminMiddleware` (IP-4) — the ONLY way
 *     Admin API access happens; the access token never reaches a loader/route.
 *   - the client calls it from `useMutation`, then `router.invalidate()`.
 *
 * `context.admin.graphql(...)` returns the PARSED `{ data, errors, extensions }`
 * (cross-cutting rule #5 / ADR 0003) — NOT a Fetch `Response`. There is no
 * `.json()` unwrap and no `.status` on the result.
 *
 * The `#graphql`-tagged template strings below are what `pnpm --filter web
 * graphql-codegen` reads to generate `app/types/admin.generated.d.ts` (IP-5).
 */

const PRODUCT_CREATE_MUTATION = `#graphql
  mutation populateProduct($product: ProductCreateInput!) {
    productCreate(product: $product) {
      product {
        id
        title
        handle
        status
        variants(first: 10) {
          edges {
            node {
              id
              price
              barcode
              createdAt
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
` as const;

const VARIANT_UPDATE_MUTATION = `#graphql
  mutation shopifyTanstackTemplateUpdateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
        price
        barcode
        createdAt
      }
      userErrors {
        field
        message
      }
    }
  }
` as const;

const COLORS = ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple'];

export interface GenerateProductResult {
  product: {
    id: string;
    title: string;
    handle: string;
    status: string;
    variants: { edges: Array<{ node: { id: string; price: string | null } }> };
  };
  variant: { id: string; price: string | null } | null;
}

export const generateProduct = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .handler(async ({ context }): Promise<GenerateProductResult> => {
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];

    const createResponse = await context.admin.graphql(PRODUCT_CREATE_MUTATION, {
      variables: { product: { title: `${color} Snowboard` } },
    });

    const created = createResponse.data?.productCreate;
    if (createResponse.errors || created?.userErrors?.length) {
      throw new Error(
        `productCreate failed: ${JSON.stringify(createResponse.errors ?? created?.userErrors)}`,
      );
    }

    const product = created?.product as GenerateProductResult['product'] | undefined;
    if (!product) {
      throw new Error('productCreate returned no product');
    }

    const firstVariantId = product.variants.edges[0]?.node?.id;
    let variant: GenerateProductResult['variant'] = null;

    if (firstVariantId) {
      const variantResponse = await context.admin.graphql(VARIANT_UPDATE_MUTATION, {
        variables: {
          productId: product.id,
          variants: [{ id: firstVariantId, price: '99.99' }],
        },
      });

      const updated = variantResponse.data?.productVariantsBulkUpdate;
      if (variantResponse.errors || updated?.userErrors?.length) {
        throw new Error(
          `productVariantsBulkUpdate failed: ${JSON.stringify(
            variantResponse.errors ?? updated?.userErrors,
          )}`,
        );
      }
      variant = (updated?.productVariants?.[0] as GenerateProductResult['variant']) ?? null;
    }

    return { product, variant };
  });
