/**
 * Fills the billing facts that payments written before the billing sync lack
 * (louez-billing docs/plans/m1-pr-b-plan.md decisions 6 and 7; docs/api README Q7):
 * `gross_minor` from Stripe's charge for a Stripe payment and from the stored amount
 * for any other, the missing Stripe charge ids, and the missing insurance shares. Each
 * reservation's payments are written in one transaction with its billing mark. Then it
 * sets `billing_sync_state.gross_backfilled_at`, so the heartbeat counts the completed
 * payments still without gross instead of sending null.
 *
 * Dry run by default: it reads Stripe and the database, lists what --apply would write,
 * and writes nothing. A fact is only written where it is empty, so a second run changes
 * nothing. A Stripe failure stops the run with exit code 1: what it wrote stays, and
 * `gross_backfilled_at` stays as it was; run it again. A payment Stripe has no charge
 * for, whose account refuses Louez, or whose charge does not match it, is listed as
 * unresolved and left as it is.
 *
 * What an unresolved gross means: once `gross_backfilled_at` is set, the heartbeat
 * reports each store's completed payments left without gross, and the billing service
 * holds that store's statements every month (reason `invariants`) until those payments
 * get a gross amount or an admin releases the statement (README §7.5). The run lists
 * those stores under "stores held": review that list in the dry run before --apply.
 *
 * If Stripe found none of the payments it was asked for, the key is not the one they
 * were taken with (a test-mode key on live payments, another platform's key): the run
 * stops with exit code 1 and leaves `gross_backfilled_at` as it was. The header shows
 * the key's mode.
 *
 * It also lists the Stripe payments whose charge Stripe refunded more of than Louez's
 * rows record, such as a refund the webhook stamped before 2026-06-18 without netting
 * the payment: the snapshots send none of that refund. It writes nothing for them.
 *
 * On production, --apply needs Téo's OK.
 *
 * Targets MIGRATE_DATABASE_URL only and reads no .env file: it runs from a new empty
 * directory, and stops before reading the database if loading the app changed the
 * environment anyway (shell-env.ts). It needs, in the shell, the platform's
 * STRIPE_SECRET_KEY when a payment needs Stripe (read-only calls on the connected
 * accounts), and, for --apply, LOUEZ_BILLING=cloud. Without BILLING_SERVICE_URL its
 * marks write nothing: with the billing service on, run `pnpm billing:mark -- --all`
 * afterwards.
 *
 * Usage:
 *   MIGRATE_DATABASE_URL="mysql://user:pass@host:port/db" \
 *     pnpm billing:gross-backfill -- [--apply]
 */
import { parseArgs } from "node:util";

import { keepShellEnv } from "./shell-env";

// First, before any module of the app is imported. @louez/db reads DATABASE_URL when it
// loads, and the app's env schema requires secrets this script never uses.
const shell = keepShellEnv({
  DATABASE_URL: process.env.MIGRATE_DATABASE_URL,
  SKIP_ENV_VALIDATION: "true",
});

const USAGE = `Usage: run-billing-gross-backfill.ts [--apply]
  --apply  Write the facts and set gross_backfilled_at (default: dry run).`;

/** The app's modules, loaded only once the shell's environment is kept. */
async function loadBackfill() {
  const [backfill, core, mode, queue, stripe] = await Promise.all([
    import("../lib/billing-sync/gross-backfill"),
    import("../lib/billing-sync/gross-backfill-core"),
    import("../lib/billing/mode"),
    import("@louez/db/billing-queue"),
    import("../lib/stripe/client"),
  ]);
  return { ...backfill, ...core, ...mode, ...queue, ...stripe };
}

async function main(): Promise<number> {
  const cli: typeof import("./payg-pricing-cli") = await import("./payg-pricing-cli");
  const { values } = parseArgs({
    args: cli.scriptArgs(),
    options: {
      apply: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const apply = values.apply;

  const connection = await cli.connectTarget();
  await connection.end();
  const app = await loadBackfill();
  // Fail closed: a module of the app changed the environment, a .env file for instance,
  // so a key or switch this run would use may not be the shell's.
  const changed = shell.changes();
  if (changed.length > 0) {
    cli.fail(
      `Loading the app changed ${changed.join(", ")}: only the shell's variables may count. Stopped before reading any payment.`,
    );
  }
  if (apply && !app.isBillingEnabled()) {
    cli.fail("--apply needs LOUEZ_BILLING=cloud: this instance does not bill its stores.");
  }
  if (apply && !app.isBillingSyncEnabled()) {
    console.log(
      "\n⚠️  BILLING_SERVICE_URL is not set: the backfill marks nothing for the billing service.\n   With the service on, run `pnpm billing:mark -- --all --apply` afterwards.",
    );
  }

  const key = process.env.STRIPE_SECRET_KEY;
  const stripe = key ? app.stripeChargeReads(app.getStripe()) : null;
  const result = await app.runGrossBackfill({ apply, stripe });
  const would = apply ? "" : " (would fill)";

  console.log(`\n── Gross backfill${apply ? "" : " (dry run)"} ──`);
  console.log(`   Stripe key               ${key ? `${app.stripeKeyMode(key)} mode` : "not set"}`);
  console.log(
    `   payments missing a fact  ${result.payments} (${result.reservations} reservations)`,
  );
  console.log(`   read from Stripe         ${result.stripeLookups}`);
  if (result.outcome.kind === "needs_stripe") {
    cli.fail(
      `${result.stripeLookups} payments need Stripe: set STRIPE_SECRET_KEY to the platform's key. Nothing was read or written.`,
    );
  }
  console.log(`   gross_minor              ${result.filled.grossMinor}${would}`);
  console.log(`   stripe_charge_id         ${result.filled.stripeChargeId}${would}`);
  console.log(`   insurance_share_minor    ${result.filled.insuranceShareMinor}${would}`);
  console.log(`   reservations ${apply ? "marked " : "to mark"}     ${result.reservationsChanged}`);
  console.log(`   unresolved               ${result.unresolved.length}`);
  for (const entry of result.unresolved) {
    console.log(
      `     ${entry.paymentId}  reservation ${entry.reservationId}  store ${entry.storeId}  ${entry.facts.join(", ")}: ${entry.reason}`,
    );
  }
  console.log(`   refunds not recorded     ${result.refundGaps.length}`);
  for (const gap of result.refundGaps) {
    console.log(
      `     ${gap.paymentId}  reservation ${gap.reservationId}  store ${gap.storeId}  Stripe refunded ${gap.stripeRefundedMinor}, the snapshot sends ${gap.recordedMinor} (minor units)`,
    );
  }

  if (result.outcome.kind === "stripe_found_none") {
    console.error(
      `\n❌ Stripe found none of the ${result.outcome.lookups} payments it was asked for: STRIPE_SECRET_KEY is not the key they were taken with, or it may read none of their accounts.`,
    );
    console.error(
      apply
        ? "   gross_backfilled_at was left as it was; what was written came from the database only. Run it again with the right key."
        : "   --apply would leave gross_backfilled_at as it is. Run it again with the right key.",
    );
    return 1;
  }

  if (result.outcome.kind === "stripe_failed") {
    const { paymentId, reservationId, error } = result.outcome;
    console.error(
      `\n❌ Stripe failed on payment ${paymentId} (reservation ${reservationId}): ${error}`,
    );
    console.error(
      apply
        ? "   The reservations before it were written; gross_backfilled_at was not set. Run it again."
        : "   Nothing was written. Run it again.",
    );
    return 1;
  }

  console.log(`   stores held              ${result.storesHeld.length}`);
  for (const store of result.storesHeld) {
    console.log(`     ${store.storeId}  ${store.payments} completed payments without gross`);
  }
  const at = result.outcome.grossBackfilledAt;
  const holds =
    result.storesHeld.length === 0
      ? null
      : `the billing service ${apply ? "holds" : "will hold"} the statements of ${result.storesHeld.length === 1 ? "this store" : `these ${result.storesHeld.length} stores`} every month (reason "invariants") until their payments get a gross amount or an admin releases each statement (README §7.5).`;
  if (!apply) {
    console.log(
      `   gross_backfilled_at      ${at ? `already set at ${at.toISOString()}` : "would be set"}`,
    );
    if (holds) console.log(`\n⚠️  Once gross_backfilled_at is set, ${holds}`);
    console.log("\n🔍 Dry run: nothing was written. Re-run with --apply to write.");
    return 0;
  }
  console.log(`   gross_backfilled_at      ${at ? at.toISOString() : "not set"}`);
  if (holds) console.log(`\n⚠️  The heartbeat now reports them: ${holds}`);
  console.log("✅ Done.");
  return 0;
}

main()
  .then((code) => {
    // The app's modules keep the shared database pool open: exit once printed.
    process.exit(code);
  })
  .catch((error: unknown) => {
    console.error(
      "❌ billing:gross-backfill failed:",
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  });
