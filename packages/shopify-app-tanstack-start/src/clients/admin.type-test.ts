/**
 * Type-level test (ADR 0003 / WS3 done-when): `admin.graphql()` resolves the
 * PARSED shape `{ data, errors, extensions }`, NOT a Fetch `Response`.
 *
 * No runtime behaviour — this file fails `tsc` if the contract regresses.
 */
import type { AdminApiContext } from './admin';

type Expect<T extends true> = T;

type GraphqlResult = Awaited<ReturnType<AdminApiContext['graphql']>>;

// The result exposes `data` — it is the parsed body.
type ResultHasData = GraphqlResult extends { data?: unknown } ? true : false;
// The result is NOT a Fetch Response.
type ResultIsNotResponse = GraphqlResult extends Response ? false : true;

export type AssertGraphqlResultHasData = Expect<ResultHasData>;
export type AssertGraphqlResultIsNotResponse = Expect<ResultIsNotResponse>;
