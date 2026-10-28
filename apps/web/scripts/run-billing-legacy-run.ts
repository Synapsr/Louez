/**
 * Runs one month's pay-as-you-go billing on demand (louez-billing design §8.5 step 4):
 * the cron's monthly run, for a month it no longer bills by itself or after a failure.
 *
 * It bills the same stores as the cron: the stores that were due when the month's run
 * started, at 05:00 UTC on the 1st of the next month (on pay-as-you-go, or with a fee
 * of the month pending then). A store with no invoice row is billed. A draft or failed
 * row is resumed with its frozen amounts and the same Stripe idempotency keys, as a
 * second run always did: a failed charge is attempted again. A paid, open or void row
 * is left alone. Safe to run again.
 *
 * Dry run by default: it lists what --apply would do and writes nothing. --apply holds
 * the run's lock, so it never bills at the same time as the cron of any instance.
 *
 * It refuses the current month, a future month, and the previous month before 05:00 UTC
 * on the 1st, when the cron starts billing it.
 *
 * Targets MIGRATE_DATABASE_URL only and reads no .env file: it runs from a new empty
 * directory, and stops before reading the database if loading the app changed the
 * environment anyway (shell-env.ts). --apply also needs, in the shell,
 * LOUEZ_BILLING=cloud and, when a store has something to invoice, the platform's
 * STRIPE_SECRET_KEY. Without BILLING_SERVICE_URL its marks write nothing: with the
 * billing service on, run `pnpm billing:mark -- --legacy` afterwards. The stores the
 * billing service bills are left out only with LOUEZ_BILLING=cloud and
 * BILLING_SERVICE_URL in the shell, as on the cron's instance: set both for a dry run
 * that matches it once such stores exist.
 *
 * Usage:
 *   MIGRATE_DATABASE_URL="mysql://user:pass@host:port/db" \
 *     pnpm billing:legacy-run -- --month=YYYY-MM [--apply]
 */
import { parseArgs } from "node:util";

import { keepShellEnv } from "./shell-env";

// First, before any module of the app is imported. @louez/db reads DATABASE_URL when it
// loads, and the app's env schema requires secrets this script never uses.
const shell = keepShellEnv({
  DATABASE_URL: process.env.MIGRATE_DATABASE_URL,
  SKIP_ENV_VALIDATION: "true",
});

const USAGE = `Usage: run-billing-legacy-run.ts --month=YYYY-MM [--apply]
  --month=YYYY-MM  The month to bill. Not the current month, a future one, or the
                   previous one before 05:00 UTC on the 1st.
  --apply          Bill it (default: dry run).`;

const cents = (amount: number, currency: string) => `${amount} cents ${currency}`;

/** The app's billing modules, loaded only once the shell's environment is kept. */
async function loadBilling() {
  const [legacyRun, mode, queue] = await Promise.all([
    import("../lib/pay-as-you-go/legacy-run"),
    import("../lib/billing/mode"),
    import("@louez/db/billing-queue"),
  ]);
  return { ...legacyRun, ...mode, ...queue };
}

async function main(): Promise<number> {
  const cli: typeof import("./payg-pricing-cli") = await import("./payg-pricing-cli");
  const core: typeof import("../lib/pay-as-you-go/billing-core") =
    await import("../lib/pay-as-you-go/billing-core");

  const { values } = parseArgs({
    args: cli.scriptArgs(),
    options: {
      month: { type: "string" },
      apply: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }

  const month = values.month;
  if (month === undefined) cli.fail("--month=YYYY-MM is required.");
  if (!core.parseBillingMonth(month)) cli.fail(`--month must be YYYY-MM, got "${month}".`);
  if (!core.canBillMonth(month, new Date())) {
    cli.fail(
      `${month} cannot be billed yet: its run starts at ${core.monthlyBillingRunStart(month).toISOString()}.`,
    );
  }

  const connection = await cli.connectTarget();
  await connection.end();
  const billing = await loadBilling();
  // Fail closed: a module of the app changed the environment, a .env file for instance,
  // so a key or switch this run would use may not be the shell's.
  const changed = shell.changes();
  if (changed.length > 0) {
    cli.fail(
      `Loading the app changed ${changed.join(", ")}: only the shell's variables may count. Stopped before reading any store.`,
    );
  }

  const plan = await billing.planMonthlyBilling(month);
  const toBill = plan.filter((entry) => entry.action === "bill");
  const toResume = plan.filter((entry) => entry.action === "resume");
  const settled = plan.filter((entry) => entry.action === "settled");

  console.log(`\n── ${month}: ${plan.length} stores ──`);
  console.log(`   to bill    ${toBill.length} (no invoice row yet)`);
  for (const entry of toBill) {
    console.log(
      `     ${entry.storeId}  ${entry.locationCount} rentals, invoice ${cents(entry.invoicedAmountCents, entry.currency)}`,
    );
  }
  console.log(`   to resume  ${toResume.length} (a run started and did not settle them)`);
  for (const entry of toResume) {
    console.log(
      `     ${entry.storeId}  ${entry.status}, invoice ${cents(entry.invoicedAmountCents, entry.currency)}, Stripe ${entry.stripeInvoiceId ?? "none yet"}`,
    );
  }
  console.log(`   settled    ${settled.length} (open, paid or void: left alone)`);

  if (!values.apply) {
    console.log("\n🔍 Dry run: nothing was written. Re-run with --apply to bill.");
    return 0;
  }
  if (!billing.isBillingEnabled()) {
    cli.fail("--apply needs LOUEZ_BILLING=cloud: this instance does not bill its stores.");
  }
  const needsStripe = [...toBill, ...toResume].some((entry) => entry.invoicedAmountCents > 0);
  if (needsStripe && !process.env.STRIPE_SECRET_KEY) {
    cli.fail("A store has something to invoice: set STRIPE_SECRET_KEY to the platform's key.");
  }
  if (!billing.isBillingSyncEnabled()) {
    console.log(
      "\n⚠️  BILLING_SERVICE_URL is not set: the run marks nothing for the billing service.",
    );
  }

  const run = await billing.applyMonthlyBilling(month);
  if (!run.ran) {
    cli.fail(
      "Another billing run holds the lock (the cron or this script): try again in a minute.",
    );
  }
  const result = run.value;
  console.log(`\n── Billed ${result.billingMonth} ──`);
  console.log(`   stores processed  ${result.storesProcessed}`);
  console.log(`   invoices created  ${result.invoicesCreated}`);
  console.log(`   invoices paid     ${result.invoicesPaid}`);
  console.log(`   invoices failed   ${result.invoicesFailed}`);
  console.log(`   invoiced          ${result.totalInvoicedCents} cents`);
  for (const failure of result.errors) {
    console.error(`❌ ${failure.storeId}: ${failure.error}`);
  }
  if (result.errors.length > 0) return 1;
  console.log("✅ Done.");
  return 0;
}

main()
  .then((code) => {
    // The billing modules keep the shared database pool open: exit once printed.
    process.exit(code);
  })
  .catch((error: unknown) => {
    console.error("❌ billing:legacy-run failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
