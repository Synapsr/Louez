#!/usr/bin/env tsx
/**
 * Sample approvals, for looking at the approval page.
 *
 * DEVELOPMENT ONLY - it writes only to a database on this machine
 * (DATABASE_URL's host localhost, 127.0.0.1 or ::1), only when its command
 * says so (--write-sample-data), and never when NODE_ENV is production
 * (`checkSampleDatabase`, ./approvals-guard.ts), with no query string or
 * fragment in DATABASE_URL, and it connects with the fields that guard
 * checked, never the URL itself. Anything else exits, saying why, before
 * anything connects to the database.
 *
 * No procedure Louez serves asks for a person's approval yet (APPROVAL_LIVE
 * is empty), so nothing else creates one. This writes, for a store and one of
 * its owners, three pending approvals as an agent's request leaves them, one
 * of each consequence the page treats apart: a payment recorded on a
 * reservation (money), a booking confirmed over the turnover buffer (stock
 * override, and the customer's message), and a team member removed (access
 * removed). Each is asked by an API key made for them, "Sample assistant",
 * whose secret nobody holds: it can call nothing. The approvals can be
 * approved and refused on their page; none can be carried out (no procedure
 * presents them, and their binding is random). It prints each page's URL.
 *
 * Usage, from apps/web, with DATABASE_URL set (or in .env.local or .env):
 *   pnpm db:seed:approvals --email=owner@example.com --store=<store id or slug> --write-sample-data
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
  console.log(`Usage: pnpm db:seed:approvals --email=<owner's e-mail> --store=<store id or slug> ${WRITE_SAMPLES_FLAG}

Writes three pending sample approvals in the store, for that owner, and prints
their page URLs: a payment recorded, a booking over the turnover buffer, a
team member removed. Only to a database on this machine, and only with
${WRITE_SAMPLES_FLAG}.`);
  process.exit(values.help ? 0 : 1);
}

// Before anything connects: the database modules are loaded only past it.
const verdict = checkSampleDatabase({
  databaseUrl: process.env.DATABASE_URL,
  nodeEnv: process.env.NODE_ENV,
  flagged: values["write-sample-data"] === true,
});
if (!verdict.ok) fail(verdict.reason);
const { connection } = verdict;
const { email, store } = values;

// Loaded only now: the database modules, and the writes, on the fields the
// guard checked.
import("./approvals-write")
  .then(({ writeSampleApprovals }) => writeSampleApprovals(connection, email, store))
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
