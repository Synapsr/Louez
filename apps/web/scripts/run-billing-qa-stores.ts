/**
 * Creates the test stores of the 4 % launch rehearsal on the dev database
 * (louez-billing docs/plans/launch-runbook.md, A8), so each test starts from a store
 * already in the state it needs. Every store goes through Louez's own writes and
 * billing marks, so the dev app's relay sends it to the billing service like a store
 * created in the dashboard.
 *
 * The stores, all owned by --owner-email, with slugs ending in the series number:
 *   - qa-facturation-en-ligne-<n>: published, three products, and the Stripe test
 *     account of --stripe-account when given: online payment (A8 tests 5 to 7).
 *   - qa-facturation-especes-<n>: published, three products, three confirmed bookings
 *     paid in cash, so it owes commission: the ledger and the balance limit (9, 16).
 *   - qa-facturation-neuve-<n>: published, three products, nothing else: the billing
 *     pages, the card and the plans (8, 11 to 15).
 *
 * A store created now is a new store: the service bills it, so it gets no
 * pay-as-you-go row, as in the onboarding. Its bookings wait until the service has
 * sent the store its own policy version (about two minutes): the script waits for the
 * store to take bookings, up to five minutes, then writes them.
 *
 * Dry run by default. A store whose slug exists is left as it is, so a second run
 * changes nothing; --series=2 makes a fresh set. Refuses the production database.
 *
 * Usage:
 *   MIGRATE_DATABASE_URL="mysql://user:pass@host:6984/louez" \
 *     pnpm billing:qa-stores -- --owner-email=<email> [--stripe-account=acct_…] \
 *       [--series=1] [--apply]
 */
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";

import { keepShellEnv } from "./shell-env";

const DEV_BILLING_ORIGIN = "https://billing.louez.app";

// First, before any module of the app is imported: @louez/db reads DATABASE_URL when it
// loads, and the marks write only with the billing sync on.
const shell = keepShellEnv({
  DATABASE_URL: process.env.MIGRATE_DATABASE_URL,
  SKIP_ENV_VALIDATION: "true",
  LOUEZ_BILLING: "cloud",
  BILLING_SERVICE_URL: DEV_BILLING_ORIGIN,
});

const USAGE = `Usage: run-billing-qa-stores.ts --owner-email=<email> [options]
  --owner-email=<email>     The dev user who owns the stores (must exist).
  --stripe-account=acct_…   A Stripe test account for the online-payment store.
  --series=<n>              Suffix of the slugs (default 1); a new number makes a new set.
  --apply                   Write (default: dry run).`;

const WAIT_FOR_POLICY_MS = 5 * 60_000;

type Kind = "en-ligne" | "especes" | "neuve";

const STORES: ReadonlyArray<{ kind: Kind; name: string }> = [
  { kind: "en-ligne", name: "Paiement en ligne" },
  { kind: "especes", name: "Paiements en espèces" },
  { kind: "neuve", name: "Boutique neuve" },
];

const PRODUCTS = [
  { name: "Vélo de ville", price: "25.00" },
  { name: "Kayak", price: "40.00" },
  { name: "Paddle", price: "30.00" },
];

const CASH_BOOKINGS = [
  { product: 0, days: 2, amount: "50.00" },
  { product: 1, days: 1, amount: "40.00" },
  { product: 2, days: 3, amount: "90.00" },
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<number> {
  const cli: typeof import("./payg-pricing-cli") = await import("./payg-pricing-cli");
  const { values } = parseArgs({
    args: cli.scriptArgs(),
    options: {
      "owner-email": { type: "string" },
      "stripe-account": { type: "string" },
      series: { type: "string", default: "1" },
      apply: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const ownerEmail = values["owner-email"];
  if (!ownerEmail) cli.fail(`--owner-email is required.\n${USAGE}`);
  const stripeAccount = values["stripe-account"] ?? null;
  if (stripeAccount !== null && !/^acct_[A-Za-z0-9]+$/.test(stripeAccount)) {
    cli.fail("--stripe-account must be a Stripe account id (acct_…).");
  }
  const series = Number(values.series);
  if (!Number.isInteger(series) || series < 1) cli.fail("--series must be a whole number from 1.");

  const target = new URL(process.env.DATABASE_URL ?? "");
  if (target.port === "6053") cli.fail("Refusing the production database (port 6053).");

  const connection = await cli.connectTarget();
  await connection.end();

  const [louez, payments, reservationEffects, validations, countries, { and, eq }] =
    await Promise.all([
      import("@louez/db"),
      import("../lib/reservations/dashboard-payment-writes"),
      import("../lib/billing/reservation-effects"),
      import("@louez/validations"),
      import("../lib/utils/countries"),
      import("drizzle-orm"),
    ]);
  const { db } = louez;
  const changed = shell.changes();
  if (changed.length > 0) {
    cli.fail(`Loading the app changed the environment (${changed.join(", ")}): stopping.`);
  }

  const id = (key: string) =>
    createHash("sha256").update(`billing-qa-stores:${series}:${key}`).digest("hex").slice(0, 21);

  const [owner] = await db
    .select({ id: louez.users.id })
    .from(louez.users)
    .where(eq(louez.users.email, ownerEmail));
  if (!owner) cli.fail(`No user with the email ${ownerEmail} on this database.`);

  const settings = {
    reservationMode: "payment" as const,
    minRentalMinutes: 60,
    maxRentalMinutes: null,
    advanceNoticeMinutes: 0,
    turnoverBufferMinutes: 0,
    businessHours: validations.defaultBusinessHours,
    country: "FR",
    timezone: countries.getTimezoneForCountry("FR"),
    currency: "EUR",
  };

  const created: { kind: Kind; storeId: string; slug: string }[] = [];
  for (const store of STORES) {
    const slug = `qa-facturation-${store.kind}-${series}`;
    const storeId = id(`${store.kind}:store`);
    const [existing] = await db
      .select({ id: louez.stores.id })
      .from(louez.stores)
      .where(eq(louez.stores.slug, slug));
    if (existing) {
      console.log(`= ${slug}: exists (${existing.id}), left as it is`);
      continue;
    }
    const online = store.kind === "en-ligne" && stripeAccount !== null;
    console.log(
      `+ ${slug}: store ${storeId}, ${PRODUCTS.length} products` +
        (online ? `, Stripe ${stripeAccount}` : "") +
        (store.kind === "especes" ? `, ${CASH_BOOKINGS.length} bookings paid in cash` : ""),
    );
    if (!values.apply) continue;

    await db.transaction(async (tx) => {
      await tx.insert(louez.stores).values({
        id: storeId,
        userId: owner.id,
        name: `QA facturation · ${store.name} ${series}`,
        slug,
        email: ownerEmail,
        address: "Place de la République, Paris",
        settings,
        onboardingCompleted: true,
        stripeAccountId: online ? stripeAccount : null,
        stripeChargesEnabled: online,
        stripeOnboardingComplete: online,
      });
      await tx.insert(louez.storeMembers).values({
        storeId,
        userId: owner.id,
        role: "owner",
      });
      for (const [n, product] of PRODUCTS.entries()) {
        await tx.insert(louez.products).values({
          id: id(`${store.kind}:product:${n}`),
          storeId,
          name: product.name,
          price: product.price,
          pricingMode: "day",
          basePeriodMinutes: 1440,
          quantity: 5,
          status: "active",
        });
      }
      // As the onboarding: both aggregates marked, and no pay-as-you-go row, since the
      // service bills a store created after T.
      await louez.markStore(tx, storeId);
      await louez.markLegacyStore(tx, storeId);
    });
    created.push({ kind: store.kind, storeId, slug });
  }

  const cash = created.find((store) => store.kind === "especes");
  if (values.apply && cash) {
    console.log(`… waiting for the service to open ${cash.slug} to bookings`);
    const deadline = Date.now() + WAIT_FOR_POLICY_MS;
    let open = false;
    while (Date.now() < deadline) {
      open = (await louez.readReservationGate(db, cash.storeId)).accepts;
      if (open) break;
      await sleep(10_000);
    }
    if (!open) {
      console.error(
        `${cash.slug} still takes no bookings after 5 minutes: is the dev app's cron running?` +
          ` Run the script again once it does; it adds the bookings to the existing store.`,
      );
      return 1;
    }
    await addCashBookings(cash.storeId);
  } else if (values.apply) {
    // A store left as it is may still lack its bookings, if an earlier run timed out.
    const slug = `qa-facturation-especes-${series}`;
    const [store] = await db
      .select({ id: louez.stores.id })
      .from(louez.stores)
      .where(eq(louez.stores.slug, slug));
    if (store) await addCashBookings(store.id);
  }

  async function addCashBookings(storeId: string): Promise<void> {
    const customerId = id("especes:customer");
    const [customer] = await db
      .select({ id: louez.customers.id })
      .from(louez.customers)
      .where(and(eq(louez.customers.id, customerId), eq(louez.customers.storeId, storeId)));
    if (customer) {
      console.log("= cash bookings: already there");
      return;
    }
    const now = new Date();
    const effects = await db.transaction(async (tx) => {
      const inserted = [];
      await tx.insert(louez.customers).values({
        id: customerId,
        storeId,
        email: "client.especes@example.test",
        firstName: "Client",
        lastName: "Espèces",
      });
      for (const [n, booking] of CASH_BOOKINGS.entries()) {
        const product = PRODUCTS[booking.product];
        const reservationId = id(`especes:reservation:${n}`);
        const start = new Date(now);
        start.setUTCDate(start.getUTCDate() + 1 + n);
        start.setUTCHours(8, 0, 0, 0);
        const end = new Date(start);
        end.setUTCDate(end.getUTCDate() + booking.days);
        const { effects } = await louez.insertReservation(tx, {
          id: reservationId,
          storeId,
          customerId,
          number: `QA-${n + 1}`,
          status: "confirmed",
          startDate: start,
          endDate: end,
          subtotalAmount: booking.amount,
          depositAmount: "0.00",
          totalAmount: booking.amount,
          currency: "EUR",
        });
        inserted.push(...effects);
        await tx.insert(louez.reservationItems).values({
          id: id(`especes:item:${n}`),
          reservationId,
          productId: id(`especes:product:${booking.product}`),
          quantity: 1,
          unitPrice: booking.amount,
          depositPerUnit: "0.00",
          totalPrice: booking.amount,
          productSnapshot: { name: product.name, description: null, images: [] },
        });
        await payments.insertRecordedPayment(tx, {
          id: id(`especes:payment:${n}`),
          reservationId,
          storeId,
          storeSettings: { currency: "EUR" },
          type: "rental",
          method: "cash",
          amount: booking.amount,
          origin: "manual",
          paidAt: now,
          notes: null,
        });
      }
      return inserted;
    });
    // As every insert: the fee effects run once the bookings are committed.
    await reservationEffects.runReservationEffects(effects);
    console.log(`+ cash bookings: ${CASH_BOOKINGS.length} confirmed and paid`);
  }

  if (!values.apply) console.log("\nDry run: nothing written. Add --apply to write.");
  await db.$client.end();
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
