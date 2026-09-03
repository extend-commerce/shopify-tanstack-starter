/**
 * Type-level test (ADR 0010 2 / ENG-2360 done-when): `admin.graphql()` resolves a
 * Fetch `Response` — RR-exact — NOT the parsed `{ data, errors, extensions }`
 * shape ADR 0003 originally specified.
 *
 * No runtime behaviour — this file fails `tsc` if the contract regresses.
 */
import type { AdminApiContext } from './admin';

type Expect<T extends true> = T;

type GraphqlResult = Awaited<ReturnType<AdminApiContext['graphql']>>;

// The result IS a Fetch Response (inverts the pre-ADR-0010 assertion).
type ResultIsResponse = GraphqlResult extends Response ? true : false;
// `.json()` is still present (typed against the operation's return data).
type ResultHasJson = GraphqlResult extends { json: (...args: never[]) => unknown } ? true : false;

export type AssertGraphqlResultIsResponse = Expect<ResultIsResponse>;
export type AssertGraphqlResultHasJson = Expect<ResultHasJson>;
