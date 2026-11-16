#!/usr/bin/env tsx
/**
 * Sample items for the "needs a look" page (/dashboard/inbox).
 *
 * DEVELOPMENT ONLY - it writes only to a database on this machine
 * (DATABASE_URL's host localhost, 127.0.0.1 or ::1), only when its command
 * says so (--write-sample-data), and never when NODE_ENV is production
 * (`checkSampleDatabase`, ./approvals-guard.ts), with no query string or
 * fragment in DATABASE_URL, and it connects with the fields that guard
 * checked, never the URL itself. Anything else exits, saying why, before
 * anything connects to the database.
 *
 * Without Stripe and a failing outbox at hand, nothing else makes these. In
 * the store, for one of its owners, it writes a sample customer and a sample
 * booking ("SAMPLE-…") paid online, carrying one item of each money kind: a
 * refund Stripe has not confirmed a day after it was asked, a Stripe refund
 * that failed with its credit note standing, and a refund whose credit note
 * the outbox gave up on; and a message to the customer that was not sent. It
 * prints the page's URL. Nothing is sent to Stripe or to anyone.
 *
 * Usage, from apps/web, with DATABASE_URL set (or in .env.local or .env):
 *   pnpm db:seed:needs-a-look --email=owner@example.com --store=<store id or slug> --write-sample-data
 */
import "../load-dotenv";

import { parseArgs } from "node:util";

import { WRITE_SAMPLES_FLAG, checkSampleDatabase } from "./approvals-guard";

function fail(message: string): never {
  console.error(`\x1b[31mERROR: ${message}\x1b[0m`);
  process.exit(1);
}

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    email: { type: "string", short: "e" },
    store: { type: "string", short: "s" },
    "write-sample-data": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help || !values.email || !values.store) {
  console.log(`Usage: pnpm db:seed:needs-a-look --email=<owner's e-mail> --store=<store id or slug> ${WRITE_SAMPLES_FLAG}

Writes a sample booking in the store carrying one item of each money kind the
"needs a look" page shows (a refund not confirmed, a refund failed with its
credit note, a credit note not issued) and a message not sent, then prints the
page's URL. Only to a database on this machine, and only with
${WRITE_SAMPLES_FLAG}.`);
  process.exit(values.help ? 0 : 1);
}

// Before anything connects: the database modules are loaded only past it.
const verdict = checkSampleDatabase({
  databaseUrl: process.env.DATABASE_URL,
  nodeEnv: process.env.NODE_ENV,
  flagged: values["write-sample-data"] === true,
  writes: "a sample booking with its payments, refunds, a credit note and outbox rows",
});
if (!verdict.ok) fail(verdict.reason);
const { connection } = verdict;
const { email, store } = values;

// Loaded only now: the database modules, and the writes, on the fields the
// guard checked.
import("./needs-a-look-write")
  .then(({ writeSampleNeedsALook }) => writeSampleNeedsALook(connection, email, store))
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
