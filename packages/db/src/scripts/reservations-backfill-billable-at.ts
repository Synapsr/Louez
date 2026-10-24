/**
 * Reruns the billable_at / withdrawn_at backfill of migration 0083, from the
 * migration file itself, so the SQL lives in one place. It fills NULLs only.
 *
 * Run it after a deploy (rows the old version confirmed while the new one
 * booted), on databases built with `db:push`, and whenever the invariant
 * `countBillableReservationsWithoutBillableAt` is above 0.
 *
 *   pnpm --filter @louez/db reservations:backfill-billable-at            # count only
 *   pnpm --filter @louez/db reservations:backfill-billable-at --apply    # backfill
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import { config } from "dotenv";
import { sql } from "drizzle-orm";

import type { Database } from "../index";

const BACKFILL_MIGRATION = fileURLToPath(
  new URL("../migrations/0083_backfill_reservation_billable_at.sql", import.meta.url),
);

export interface BackfillResult {
  /** Rows that received a `billable_at`. */
  billableAt: number;
  /** Rows that received a `withdrawn_at`. */
  withdrawnAt: number;
}

/** Runs the two statements of migration 0083 and counts the rows each one changed. */
export async function backfillReservationBillableAt(database: Database): Promise<BackfillResult> {
  // Split as the migrator splits a migration file.
  const statements = (await readFile(BACKFILL_MIGRATION, "utf8"))
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  const [billableAtStatement, withdrawnAtStatement] = statements;
  if (statements.length !== 2 || !billableAtStatement || !withdrawnAtStatement) {
    throw new Error(`Expected 2 statements in ${BACKFILL_MIGRATION}, found ${statements.length}`);
  }

  // In this order: withdrawn_at only goes to rows that have a billable_at.
  const [billableAt] = await database.execute(sql.raw(billableAtStatement));
  const [withdrawnAt] = await database.execute(sql.raw(withdrawnAtStatement));
  return { billableAt: billableAt.affectedRows, withdrawnAt: withdrawnAt.affectedRows };
}

function printUsage(): void {
  console.log(`Usage:
  pnpm --filter @louez/db reservations:backfill-billable-at [--dry-run]
  pnpm --filter @louez/db reservations:backfill-billable-at --apply
`);
}

function parseApply(argv: string[]): boolean {
  let apply = false;
  for (const arg of argv) {
    // pnpm forwards the "--" separator itself on some versions.
    if (arg === "--") continue;
    if (arg === "--apply") apply = true;
    else if (arg === "--dry-run") apply = false;
    else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      printUsage();
      process.exit(1);
    }
  }
  return apply;
}

async function main(): Promise<void> {
  const apply = parseApply(process.argv.slice(2));

  config({ path: ".env.local", quiet: true });
  config({ path: ".env", quiet: true });
  const { db, countBillableReservationsWithoutBillableAt } = await import("../index");

  try {
    const changed = apply ? await backfillReservationBillableAt(db) : null;
    const missing = await countBillableReservationsWithoutBillableAt(db);
    console.log(
      JSON.stringify(
        {
          mode: apply ? "apply" : "dry-run",
          changed,
          billableWithoutBillableAt: missing,
        },
        null,
        2,
      ),
    );
  } finally {
    await db.$client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
