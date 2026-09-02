// Seed stub — intentionally does nothing.
//
// The starter's only persisted table is the Shopify `session` table, which is
// written by `DrizzleSessionStoragePostgres` at runtime, not seeded (ADR 0005:
// "session storage is the only persisted table — no example app table").
//
// `db:seed` stays in the bootstrap chain (`db:up` = compose up -> db:migrate ->
// db:seed) so that an app author who adds their own tables against `schema.ts`
// has a wired seed step with nothing to un-comment.

import { db } from './client';

async function seed(): Promise<void> {
  void db;
  console.log('db:seed — no seed data (session storage is the only persisted table — ADR 0005).');
}

seed()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
