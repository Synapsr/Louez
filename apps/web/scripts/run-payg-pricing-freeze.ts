/**
 * Freeze the pay-as-you-go pricing of every existing store that still follows the env.
 *
 * Writes the given offer onto every subscription row without a config, and creates a
 * row (with the given free reservations) for every store without one; existing rows keep
 * their allowance. Dry run by default: it prints the plan and writes nothing. Idempotent:
 * rows that already have a config are only spelled out (same prices, every tier
 * written), never repriced.
 *
 * Runs before migration 0081 and after it. It never adds the pricing_version column:
 * the migration must do that itself. Louez Cloud ran it on 2026-10-24; with
 * LOUEZ_BILLING=cloud the app also freezes any store it finds unfrozen at start-up, so
 * this is for a dry run or a one-off repair. It ignores LOUEZ_BILLING: it only ever
 * writes to the database it is pointed at.
 *
 * Targets MIGRATE_DATABASE_URL only; no .env file is read.
 *
 * Usage:
 *   MIGRATE_DATABASE_URL="mysql://user:pass@host:port/db" \
 *     pnpm payg:freeze-pricing -- \
 *     --pricing='<PAYG_DEFAULT_PRICING json>'|builtin --free-reservations=15 \
 *     [--apply] [--accept-mismatch] [--report=freeze-report.json]
 */
import { accessSync, constants, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

import type { Connection, RowDataPacket } from "mysql2/promise";

import { resolvePayAsYouGoConfig } from "../lib/pay-as-you-go/config";
import {
  type LegacyPricingTerms,
  applyLegacyPricingFreeze,
  countUnfrozenPricing,
  isEmptyFreezePlan,
  planLegacyPricingFreeze,
} from "../lib/pay-as-you-go/pricing-lock";
import { samePayAsYouGoPricing } from "../lib/pay-as-you-go/pricing-lock-core";
import {
  PRICING_OPTIONS,
  PRICING_USAGE,
  connectTarget,
  describePricing,
  fail,
  readPricingTerms,
  scriptArgs,
} from "./payg-pricing-cli";

const { values } = parseArgs({
  args: scriptArgs(),
  options: {
    ...PRICING_OPTIONS,
    apply: { type: "boolean", default: false },
    "accept-mismatch": { type: "boolean", default: false },
    report: { type: "string" },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(`Usage: run-payg-pricing-freeze.ts [options]\n${PRICING_USAGE}
  --apply                   Write the changes (default: dry run).
  --accept-mismatch         Apply even if --pricing differs from the offer seen in the database.
  --report=<file>           With --apply, write what changed as JSON.`);
  process.exit(0);
}

interface SnapshotRow {
  config: unknown;
  free: number;
  referred: number;
  createdAt: Date;
}

/**
 * The offer the deployment really applies, read from the rows onboarding wrote: their
 * config is the env offer of the day (subscription created with the store, within 10 s).
 */
async function latestOnboardingSnapshots(connection: Connection): Promise<SnapshotRow[]> {
  const [rows] = await connection.query<(SnapshotRow & RowDataPacket)[]>(
    `SELECT sub.pay_as_you_go_config AS config, sub.free_reservations_granted AS free,
            st.referred_by_store_id IS NOT NULL AS referred, sub.created_at AS createdAt
     FROM subscriptions sub JOIN stores st ON st.id = sub.store_id
     WHERE sub.pay_as_you_go_config IS NOT NULL
       AND ABS(TIMESTAMPDIFF(SECOND, sub.created_at, st.created_at)) <= 10
     ORDER BY sub.created_at DESC
     LIMIT 5`,
  );
  return rows;
}

function checkAgainstSnapshots(snapshots: SnapshotRow[], terms: LegacyPricingTerms): boolean {
  console.log("\n── Offer seen in the database (latest onboarding snapshots) ──");
  if (snapshots.length === 0) {
    console.log("   none found: cannot cross-check --pricing. Run the audit script first.");
    return true;
  }
  for (const row of snapshots) {
    const config = typeof row.config === "string" ? JSON.parse(row.config) : row.config;
    console.log(
      `   ${new Date(row.createdAt).toISOString()}  ${describePricing(resolvePayAsYouGoConfig(config))}` +
        `  free=${row.free}${Number(row.referred) ? " (referred)" : ""}`,
    );
  }
  const latest = snapshots[0];
  const latestConfig = typeof latest.config === "string" ? JSON.parse(latest.config) : latest.config;
  const samePricing = samePayAsYouGoPricing(latestConfig, terms.offer);
  const latestUnreferred = snapshots.find((row) => !Number(row.referred));
  const sameFree = !latestUnreferred || latestUnreferred.free === terms.freeReservations;
  console.log(
    `   --pricing ${describePricing(resolvePayAsYouGoConfig(terms.offer))}: ${samePricing ? "matches" : "DIFFERS from"} the latest snapshot`,
  );
  console.log(
    `   --free-reservations ${terms.freeReservations}: ${sameFree ? "matches" : "DIFFERS from"} the latest unreferred snapshot`,
  );
  return samePricing && sameFree;
}

async function main() {
  const terms = readPricingTerms(values);
  const connection = await connectTarget();
  try {
    console.log("\n── Before ──");
    console.log(await countUnfrozenPricing(connection));

    const consistent = checkAgainstSnapshots(await latestOnboardingSnapshots(connection), terms);

    const plan = await planLegacyPricingFreeze(connection, "all");
    console.log(
      `\n── Plan (pricing_version column: ${plan.hasPricingVersion ? "present" : "absent, left to migration 0081"}) ──`,
    );
    console.log(`   rows to tag with a version:   ${plan.rowsToTag}`);
    console.log(`   configs to spell out:         ${plan.rowsToNormalize.length}`);
    console.log(`   rows to freeze:               ${plan.rowsToFreeze.length}`);
    for (const row of plan.rowsToFreeze) {
      console.log(
        `     • ${row.storeSlug ?? "(store deleted)"} ${row.storeId} ${row.currency}` +
          `${row.pricingVersion ? ` [${row.pricingVersion}]` : ""} (keeps its free reservations)`,
      );
    }
    console.log(`   rows to create:               ${plan.storesToCreate.length}`);
    for (const store of plan.storesToCreate) {
      console.log(
        `     • ${store.storeSlug} ${store.storeId} ${store.currency} + ${terms.freeReservations} free`,
      );
    }
    console.log(
      `   frozen offer: ${describePricing(resolvePayAsYouGoConfig(terms.offer))}, ${terms.freeReservations} free reservations for created rows`,
    );

    if (!values.apply) {
      console.log("\n🔍 Dry run: nothing was written. Re-run with --apply to write.");
      return;
    }
    if (!consistent && !values["accept-mismatch"]) {
      fail("--pricing / --free-reservations differ from the database. Check them, or pass --accept-mismatch.");
    }
    if (values.report) {
      // Fail before writing anything rather than after the commit.
      accessSync(dirname(resolve(values.report)), constants.W_OK);
    }
    if (isEmptyFreezePlan(plan)) {
      console.log("\n✅ Nothing to do.");
      return;
    }

    const result = await applyLegacyPricingFreeze(connection, plan, terms);
    console.log("\n── Applied ──");
    console.log(result);
    const report = JSON.stringify({ at: new Date().toISOString(), terms, plan, result }, null, 2);
    if (values.report) {
      try {
        writeFileSync(values.report, report);
        console.log(`📝 Report written to ${values.report}`);
      } catch (error) {
        // The freeze is committed: keep the record on stdout rather than reporting a failure.
        console.warn(`⚠️  Could not write ${values.report} (${String(error)}). Report:\n${report}`);
      }
    }

    console.log("\n── After ──");
    const after = await countUnfrozenPricing(connection);
    console.log(after);
    if (after.rowsWithoutConfig > 0 || after.storesWithoutRow > 0) {
      fail("Some stores are still not frozen (concurrent writes?). Re-run the script.");
    }
    console.log("✅ Every store has a subscription row with a frozen config.");
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error("❌ Freeze failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
