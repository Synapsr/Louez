import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { RowDataPacket } from "mysql2/promise";
import type Stripe from "stripe";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { keepShellEnv } from "@/scripts/shell-env";

import type { MonthlyBillingEvent, MonthlyBillingLog } from "./legacy-run";

// The monthly pay-as-you-go run on a migrated database (louez-billing design §8.5
// step 4): the cron's catch-up, `billing:legacy-run`, and the guards that keep a month
// from being billed twice when they overlap. Stripe is a stub: no network, no mail.
//
// One file for the run and its script: the run's lock is a MySQL named lock, which is
// shared by every database on the server, and node --test runs files in parallel.
//
// Neither this file nor the script it spawns reads a .env file: this process runs from
// an empty directory, as the script does (scripts/shell-env.ts), and the script starts
// from a directory whose .env would turn billing on with a Stripe key.
const shell = keepShellEnv({ SKIP_ENV_VALIDATION: "true", STRIPE_SECRET_KEY: "sk_test_stub" });

const APP_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = join(APP_ROOT, "scripts/run-billing-legacy-run.ts");
const TSX_LOADER = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
/** A lost lock or a held Stripe call fails the suite instead of hanging it. */
const DATABASE_SUITE = { skip: skipWithoutTestDatabase(), timeout: 120_000 };
/** spawnSync blocks the suite's timer: the script is killed after this instead. */
const SCRIPT_TIMEOUT_MS = 30_000;
const NOVEMBER = "2026-11";
const NOVEMBER_RUN = new Date("2026-12-01T05:00:00Z");
const NEXT_MINUTE = new Date("2026-12-01T05:01:00Z");
const CARD_CUSTOMER = "cus_card";
const NO_CARD_CUSTOMER = "cus_no_card";

/** The run's lock, as billingLockName("legacy-run") names it. */
const LOCK = "louez:billing:legacy-run";

interface FakeInvoice {
  id: string;
  customer: string;
  status: "draft" | "open" | "paid";
  collectionMethod: string;
  storeId: string;
  items: number[];
}

/**
 * Stripe's platform account, in memory. A call with an idempotency key Stripe has
 * seen returns the first call's result, as Stripe does for 24 hours.
 */
function createFakeStripe() {
  const invoices = new Map<string, FakeInvoice>();
  const results = new Map<string, Promise<unknown>>();
  const calls: string[] = [];
  const failingCustomers = new Set<string>();
  let gate: { reached: () => void; opened: Promise<void> } | null = null;

  const once = (key: string | undefined, run: () => Promise<unknown>) => {
    if (!key) return run();
    const known = results.get(key);
    if (known) return known;
    const result = run();
    results.set(key, result);
    return result;
  };
  const invoice = (id: string) => {
    const found = invoices.get(id);
    if (!found) throw new Error(`No such invoice: ${id}`);
    return found;
  };
  const view = (found: FakeInvoice) => ({
    id: found.id,
    object: "invoice",
    customer: found.customer,
    status: found.status,
    collection_method: found.collectionMethod,
  });

  return {
    calls,
    failingCustomers,
    /** Invoices by store, with their line amounts. */
    invoicesByStore() {
      const byStore: Record<string, number[][]> = {};
      for (const found of invoices.values()) {
        (byStore[found.storeId] ??= []).push(found.items);
      }
      return byStore;
    },
    /** Holds the next invoice creation until the returned `open` is called. */
    holdNextInvoice() {
      let reached = () => {};
      let open = () => {};
      const reachedGate = new Promise<void>((resolve) => (reached = resolve));
      const opened = new Promise<void>((resolve) => (open = resolve));
      gate = { reached, opened };
      return { reached: reachedGate, open };
    },
    reset() {
      invoices.clear();
      results.clear();
      calls.length = 0;
      failingCustomers.clear();
      gate = null;
    },
    customers: {
      async retrieve(id: string) {
        calls.push(`customers.retrieve ${id}`);
        if (failingCustomers.has(id)) throw new Error(`Stripe is unreachable for ${id}`);
        return {
          id,
          object: "customer",
          invoice_settings: { default_payment_method: id === CARD_CUSTOMER ? "pm_card" : null },
          default_source: null,
        };
      },
      async create() {
        throw new Error("the run created a Stripe customer: every test store has one");
      },
    },
    invoices: {
      create(params: Stripe.InvoiceCreateParams, options?: Stripe.RequestOptions) {
        return once(options?.idempotencyKey, async () => {
          calls.push(`invoices.create ${options?.idempotencyKey}`);
          const held = gate;
          if (held) {
            gate = null;
            held.reached();
            await held.opened;
          }
          const created: FakeInvoice = {
            id: `in_${invoices.size + 1}`,
            customer: String(params.customer),
            status: "draft",
            collectionMethod: String(params.collection_method),
            storeId: params.metadata ? String(params.metadata.storeId) : "",
            items: [],
          };
          invoices.set(created.id, created);
          return view(created);
        });
      },
      async retrieve(id: string) {
        calls.push(`invoices.retrieve ${id}`);
        return view(invoice(id));
      },
      finalizeInvoice(id: string, _params?: unknown, options?: Stripe.RequestOptions) {
        return once(options?.idempotencyKey, async () => {
          calls.push(`invoices.finalizeInvoice ${options?.idempotencyKey}`);
          const found = invoice(id);
          found.status = "open";
          return view(found);
        });
      },
      pay(id: string, _params?: unknown, options?: Stripe.RequestOptions) {
        return once(options?.idempotencyKey, async () => {
          calls.push(`invoices.pay ${options?.idempotencyKey}`);
          const found = invoice(id);
          if (found.customer !== CARD_CUSTOMER) throw new Error("card_declined");
          found.status = "paid";
          return view(found);
        });
      },
    },
    invoiceItems: {
      create(params: Stripe.InvoiceItemCreateParams, options?: Stripe.RequestOptions) {
        return once(options?.idempotencyKey, async () => {
          calls.push(`invoiceItems.create ${options?.idempotencyKey}`);
          invoice(String(params.invoice)).items.push(Number(params.amount));
          return { id: `ii_${calls.length}`, object: "invoiceitem" };
        });
      },
    },
  };
}

describe("monthly pay-as-you-go billing (database)", DATABASE_SUITE, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let legacyRun: typeof import("./legacy-run");
  let billing: typeof import("./billing");
  const fake = createFakeStripe();
  const events: Array<{ level: "info" | "warn" | "error"; event: MonthlyBillingEvent }> = [];
  const logs: MonthlyBillingLog = {
    info: (event) => events.push({ level: "info", event }),
    warn: (event) => events.push({ level: "warn", event }),
    error: (event) => events.push({ level: "error", event }),
  };
  const env = { billing: process.env.LOUEZ_BILLING, url: process.env.BILLING_SERVICE_URL };

  before(async () => {
    database = await createTestDatabase("legacy_run");
    // DATABASE_URL now points at the test database.
    louezDb = await import("@louez/db");
    legacyRun = await import("./legacy-run");
    billing = await import("./billing");
    const { getStripe } = await import("@/lib/stripe/client");
    assert.deepEqual(shell.changes(), ["DATABASE_URL"], "loading the app changed the environment");
    const stripe = getStripe();
    for (const [resource, methods] of [
      [stripe.customers, fake.customers],
      [stripe.invoices, fake.invoices],
      [stripe.invoiceItems, fake.invoiceItems],
    ] as const) {
      for (const [name, method] of Object.entries(methods)) Reflect.set(resource, name, method);
    }
  });
  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });
  beforeEach(async () => {
    process.env.LOUEZ_BILLING = "cloud";
    // Marks write queue rows; nothing sends them.
    process.env.BILLING_SERVICE_URL = "http://billing.invalid";
    fake.reset();
    events.length = 0;
    await sql(
      "DELETE FROM pay_as_you_go_invoices",
      "DELETE FROM platform_fee",
      "DELETE FROM subscriptions",
      "DELETE FROM stores",
      "DELETE FROM billing_sync_queue",
    );
  });
  afterEach(() => {
    for (const [name, value] of [
      ["LOUEZ_BILLING", env.billing],
      ["BILLING_SERVICE_URL", env.url],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  async function sql(...statements: string[]): Promise<void> {
    const connection = await database.connect();
    try {
      for (const statement of statements) await connection.query(statement);
    } finally {
      await connection.end();
    }
  }

  async function select<T>(statement: string, map: (row: RowDataPacket) => T): Promise<T[]> {
    const connection = await database.connect();
    try {
      const [rows] = await connection.query<RowDataPacket[]>(statement);
      return rows.map(map);
    } finally {
      await connection.end();
    }
  }

  /**
   * A store, its subscription row (none when `mode` is null) and its fee rows of
   * `month`. The row is last changed when it is created; a fee is recorded on the 15th
   * of its month, unless `recordedAt` says.
   */
  async function seedStore(store: {
    id: string;
    mode: "pay_as_you_go" | "subscription" | null;
    customer?: string;
    subscribedAt?: string;
    month?: string;
    fees?: ReadonlyArray<{ source: string; status: string; cents: number; recordedAt?: string }>;
  }): Promise<void> {
    const connection = await database.connect();
    try {
      await connection.query(
        `INSERT INTO stores (id, user_id, name, slug, settings) VALUES (?, 'owner', ?, ?, ?)`,
        [store.id, store.id, store.id, JSON.stringify({ currency: "EUR", country: "FR" })],
      );
      if (store.mode) {
        const subscribedAt = store.subscribedAt ?? "2026-06-01 10:00:00";
        await connection.query(
          `INSERT INTO subscriptions (id, store_id, billing_mode, stripe_customer_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            `sub_${store.id}`,
            store.id,
            store.mode,
            store.customer ?? null,
            subscribedAt,
            subscribedAt,
          ],
        );
      }
      for (const [index, fee] of (store.fees ?? []).entries()) {
        const id = `${store.id}_${index}`;
        await connection.query(
          `INSERT INTO platform_fee (id, store_id, reservation_id, dedup_key, amount_cents,
                                     platform_fee_source, platform_fee_status, billing_month, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            store.id,
            `res_${id}`,
            `res:${id}`,
            fee.cents,
            fee.source,
            fee.status,
            store.month,
            fee.recordedAt ?? `${store.month}-15 10:00:00`,
          ],
        );
      }
    } finally {
      await connection.end();
    }
  }

  /**
   * After November's run started: lr_plan moves to pay-as-you-go, and lr_late, a store
   * with no subscription row, records a pending November fee. Neither was due at 05:00.
   */
  async function qualifyAfterTheRun(at: string): Promise<void> {
    await sql(
      `UPDATE subscriptions SET billing_mode = 'pay_as_you_go', updated_at = '${at}'
       WHERE store_id = 'lr_plan'`,
    );
    await seedStore({
      id: "lr_late",
      mode: null,
      month: NOVEMBER,
      fees: [{ source: "manual", status: "pending", cents: 175, recordedAt: at }],
    });
  }

  /**
   * November's stores: one paid by card, one marketplace fee on a hosted invoice, one
   * collected at source, one idle, and two the run leaves out.
   */
  async function seedNovember(): Promise<void> {
    const month = NOVEMBER;
    await seedStore({
      id: "lr_paid",
      mode: "pay_as_you_go",
      customer: CARD_CUSTOMER,
      month,
      fees: [
        { source: "manual", status: "pending", cents: 150 },
        { source: "manual", status: "pending", cents: 150 },
        { source: "online", status: "collected", cents: 200 },
      ],
    });
    await seedStore({
      id: "lr_open",
      mode: "subscription",
      customer: NO_CARD_CUSTOMER,
      month,
      fees: [{ source: "marketplace_manual", status: "pending", cents: 100 }],
    });
    await seedStore({
      id: "lr_void",
      mode: "pay_as_you_go",
      month,
      fees: [{ source: "online", status: "collected", cents: 250 }],
    });
    await seedStore({ id: "lr_idle", mode: "pay_as_you_go" });
    // Opened as November's run started, not before: it has no fee in November.
    await seedStore({ id: "lr_new", mode: "pay_as_you_go", subscribedAt: "2026-12-01 05:00:00" });
    // On a plan, with nothing pending.
    await seedStore({ id: "lr_plan", mode: "subscription" });
  }

  const NOVEMBER_STORES = ["lr_idle", "lr_open", "lr_paid", "lr_void"];

  async function invoiceRows(month = NOVEMBER) {
    return select(
      `SELECT store_id, payg_invoice_status AS status, invoiced_amount_cents, stripe_invoice_id
       FROM pay_as_you_go_invoices WHERE billing_month = '${month}' ORDER BY store_id`,
      (row) => ({
        storeId: String(row.store_id),
        status: String(row.status),
        invoicedAmountCents: Number(row.invoiced_amount_cents),
        stripeInvoiceId: row.stripe_invoice_id === null ? null : String(row.stripe_invoice_id),
      }),
    );
  }

  const statusByStore = async (month = NOVEMBER) =>
    Object.fromEntries((await invoiceRows(month)).map((row) => [row.storeId, row.status]));

  /** The cron's call at `now`, which must have run under the lock. */
  async function catchUp(now: Date) {
    const run = await legacyRun.runMonthlyBillingCatchUp(now, { log: logs });
    assert.equal(run.ran, true, "the lock was free");
    if (!run.ran) throw new Error("unreachable");
    return run.value;
  }

  test("the 05:00 run bills each store of the month once; later calls find it billed", async () => {
    await seedNovember();

    const run = await catchUp(NOVEMBER_RUN);
    assert.equal(run.billingMonth, NOVEMBER);
    assert.equal(run.due, true);
    if (!run.due) return;
    assert.deepEqual(
      {
        storesProcessed: run.billing.storesProcessed,
        invoicesCreated: run.billing.invoicesCreated,
        invoicesPaid: run.billing.invoicesPaid,
        totalInvoicedCents: run.billing.totalInvoicedCents,
        errors: run.billing.errors,
      },
      {
        storesProcessed: 4,
        invoicesCreated: 4,
        invoicesPaid: 1,
        totalInvoicedCents: 400,
        errors: [],
      },
    );
    assert.deepEqual(await statusByStore(), {
      lr_idle: "void",
      lr_open: "open",
      lr_paid: "paid",
      lr_void: "void",
    });
    assert.deepEqual(fake.invoicesByStore(), { lr_paid: [[300]], lr_open: [[100]] });
    assert.deepEqual(
      events.map(({ level, event }) => ({ level, event: event.payg.event })),
      [{ level: "info", event: "monthly_billing" }],
    );

    // The paid invoice settled its fees; the hosted one waits for its webhook.
    const fees = await select(
      `SELECT id, platform_fee_status AS status, invoice_id FROM platform_fee ORDER BY id`,
      (row) => `${row.id} ${row.status}${row.invoice_id ? " invoiced" : ""}`,
    );
    assert.deepEqual(fees, [
      "lr_open_0 pending",
      "lr_paid_0 billed invoiced",
      "lr_paid_1 billed invoiced",
      "lr_paid_2 collected",
      "lr_void_0 collected",
    ]);

    // Each billed store's month is marked for the billing service (DL-13).
    const marks = await select(
      `SELECT aggregate_id FROM billing_sync_queue
       WHERE aggregate_type = 'legacy_month' ORDER BY aggregate_id`,
      (row) => String(row.aggregate_id),
    );
    assert.deepEqual(
      marks,
      NOVEMBER_STORES.map((store) => `${store}:${NOVEMBER}`),
    );

    // Every later call of the month finds every store billed and calls no one.
    const rows = await invoiceRows();
    const calls = fake.calls.length;
    for (const now of [
      NEXT_MINUTE,
      new Date("2026-12-20T13:37:00Z"),
      new Date("2027-01-01T04:59:00Z"),
    ]) {
      assert.deepEqual(
        await catchUp(now),
        { billingMonth: NOVEMBER, due: false },
        now.toISOString(),
      );
    }
    assert.deepEqual(await invoiceRows(), rows);
    assert.equal(fake.calls.length, calls);
  });

  test("a run missed on the 1st is billed by the first call after it, as a late run", async () => {
    await seedNovember();

    // Before 05:00 UTC on the 1st the due month is still October: November waits.
    const early = await catchUp(new Date("2026-12-01T04:59:00Z"));
    assert.equal(early.billingMonth, "2026-10");
    assert.deepEqual(await invoiceRows(), []);
    events.length = 0;

    // Before the late call: two stores qualify only now, and lr_paid's row changes,
    // a reward say. Its November fees were pending at 05:00, so it was due.
    await qualifyAfterTheRun("2026-12-02 09:00:00");
    await sql(
      `UPDATE subscriptions SET updated_at = '2026-12-02 09:00:00' WHERE store_id = 'lr_paid'`,
    );

    const run = await catchUp(new Date("2026-12-03T10:00:00Z"));
    assert.equal(run.billingMonth, NOVEMBER);
    assert.equal(run.due && run.billing.storesProcessed, 4);
    // The stores the 05:00 run would have billed, and no other.
    assert.deepEqual(Object.keys(await statusByStore()), NOVEMBER_STORES);
    assert.deepEqual(fake.invoicesByStore(), { lr_paid: [[300]], lr_open: [[100]] });
    const [first] = events;
    assert.equal(first?.level, "warn");
    assert.ok(first?.event.payg.event === "monthly_billing" && first.event.payg.late);
  });

  test("a store that qualifies after 05:00 is left as the 05:00 run left it", async () => {
    await seedNovember();
    await catchUp(NOVEMBER_RUN);
    const rows = await invoiceRows();
    const calls = fake.calls.length;
    events.length = 0;

    // Mid-December: lr_plan moves to pay-as-you-go, and lr_late records a November fee.
    await qualifyAfterTheRun("2026-12-15 09:00:00");

    // The run on time never bills them, so the catch-up does not either.
    assert.deepEqual(await catchUp(new Date("2026-12-15T10:00:00Z")), {
      billingMonth: NOVEMBER,
      due: false,
    });
    assert.deepEqual(await invoiceRows(), rows);
    assert.equal(fake.calls.length, calls);
    assert.deepEqual(events, []);
    // Nor does the script: they are not in its plan.
    const plan = await legacyRun.planMonthlyBilling(NOVEMBER);
    assert.deepEqual(plan.map((entry) => entry.storeId).sort(), NOVEMBER_STORES);
  });

  test("a month is billed only under the run's lock", async () => {
    await seedNovember();
    // billing.ts bills one store; only legacy-run.ts bills a month's stores.
    for (const name of ["runMonthlyPayAsYouGoBilling", "billStoresForMonth"]) {
      assert.equal(name in billing, false, name);
    }

    const holder = await database.connect();
    try {
      await holder.query("SELECT GET_LOCK(?, 0)", [LOCK]);
      assert.deepEqual(await legacyRun.runMonthlyBillingCatchUp(NOVEMBER_RUN, { log: logs }), {
        ran: false,
      });
      assert.deepEqual(await legacyRun.applyMonthlyBilling(NOVEMBER), { ran: false });
    } finally {
      await holder.query("SELECT RELEASE_LOCK(?)", [LOCK]);
      await holder.end();
    }
    assert.deepEqual(await invoiceRows(), []);
    assert.deepEqual(fake.calls, []);
  });

  test("a run cut short is finished by the next call, which skips the stores it reached", async () => {
    await seedNovember();
    // The 05:00 run billed one store, then the process died.
    await billing.billStoreForMonth("lr_paid", NOVEMBER);
    assert.deepEqual(await statusByStore(), { lr_paid: "paid" });
    const paidCalls = fake.calls.length;

    const run = await catchUp(NEXT_MINUTE);
    assert.equal(run.due && run.billing.storesProcessed, 3);
    assert.deepEqual(await statusByStore(), {
      lr_idle: "void",
      lr_open: "open",
      lr_paid: "paid",
      lr_void: "void",
    });
    // No Stripe call for the store already billed: one invoice each.
    assert.ok(fake.calls.slice(paidCalls).every((call) => !call.includes("lr_paid")));
    assert.ok(!fake.calls.slice(paidCalls).includes(`customers.retrieve ${CARD_CUSTOMER}`));
    assert.deepEqual(fake.invoicesByStore(), { lr_paid: [[300]], lr_open: [[100]] });
  });

  test("a store a run left unfinished is resumed by the script, never by the cron", async () => {
    await seedNovember();
    // Stripe fails for one store during the 05:00 run: its row stays a draft.
    fake.failingCustomers.add(CARD_CUSTOMER);
    const run = await catchUp(NOVEMBER_RUN);
    assert.deepEqual(run.due && run.billing.errors, [
      { storeId: "lr_paid", error: `Stripe is unreachable for ${CARD_CUSTOMER}` },
    ]);
    assert.deepEqual(
      events.map(({ level, event }) => `${level} ${event.payg.event}`),
      ["warn monthly_billing", "error monthly_billing_store_failed"],
    );
    const [draft] = (await invoiceRows()).filter((row) => row.storeId === "lr_paid");
    assert.deepEqual(
      {
        status: draft?.status,
        cents: draft?.invoicedAmountCents,
        stripe: draft?.stripeInvoiceId,
      },
      { status: "draft", cents: 300, stripe: null },
    );

    // The cron leaves it to the operator: every store has its row.
    fake.failingCustomers.clear();
    const calls = fake.calls.length;
    assert.deepEqual(await catchUp(NEXT_MINUTE), { billingMonth: NOVEMBER, due: false });
    assert.equal(fake.calls.length, calls);

    const plan = await legacyRun.planMonthlyBilling(NOVEMBER);
    assert.deepEqual(plan.map((entry) => `${entry.storeId} ${entry.action}`).sort(), [
      "lr_idle settled",
      "lr_open settled",
      "lr_paid resume",
      "lr_void settled",
    ]);

    // `billing:legacy-run --apply` resumes it, on its frozen amounts, and touches no other store.
    const applied = await legacyRun.applyMonthlyBilling(NOVEMBER);
    assert.equal(applied.ran && applied.value.errors.length, 0);
    assert.deepEqual(await statusByStore(), {
      lr_idle: "void",
      lr_open: "open",
      lr_paid: "paid",
      lr_void: "void",
    });
    assert.deepEqual(fake.invoicesByStore(), { lr_paid: [[300]], lr_open: [[100]] });
    assert.ok(!fake.calls.slice(calls).some((call) => call.includes("lr_open")));

    // A second --apply finds every store settled and calls no one.
    const settled = fake.calls.length;
    const again = await legacyRun.applyMonthlyBilling(NOVEMBER);
    assert.equal(again.ran && again.value.invoicesCreated, 0);
    assert.equal(fake.calls.length, settled);
  });

  test("overlapping runs of the cron and the script bill the month once", async () => {
    await seedNovember();
    // The 05:00 run holds the lock while Stripe creates its first invoice.
    const hold = fake.holdNextInvoice();
    const first = legacyRun.runMonthlyBillingCatchUp(NOVEMBER_RUN, { log: logs });
    await hold.reached;

    // Another instance's 05:00 call, the next minute's call and the script all skip.
    assert.deepEqual(await legacyRun.runMonthlyBillingCatchUp(NOVEMBER_RUN, { log: logs }), {
      ran: false,
    });
    assert.deepEqual(await legacyRun.runMonthlyBillingCatchUp(NEXT_MINUTE, { log: logs }), {
      ran: false,
    });
    assert.deepEqual(await legacyRun.applyMonthlyBilling(NOVEMBER), { ran: false });

    hold.open();
    const run = await first;
    assert.equal(run.ran && run.value.due && run.value.billing.storesProcessed, 4);
    assert.deepEqual(Object.keys(await statusByStore()), NOVEMBER_STORES);
    assert.deepEqual(fake.invoicesByStore(), { lr_paid: [[300]], lr_open: [[100]] });

    // Once it is done, the script finds the month billed.
    const calls = fake.calls.length;
    const applied = await legacyRun.applyMonthlyBilling(NOVEMBER);
    assert.equal(applied.ran && applied.value.invoicesCreated, 0);
    assert.equal(fake.calls.length, calls);
  });

  test("without the lock, two runs of one store at once still make one invoice", async () => {
    // As during a deploy, when an instance without the lock runs the 05:00 billing.
    await seedNovember();
    const hold = fake.holdNextInvoice();
    const runs = Promise.all([
      billing.billStoreForMonth("lr_paid", NOVEMBER),
      billing.billStoreForMonth("lr_paid", NOVEMBER),
    ]);
    await hold.reached;
    hold.open();
    const outcomes = await runs;

    assert.deepEqual(
      outcomes.map((outcome) => outcome.invoiceCreated).sort(),
      [false, true],
      "one run claimed the row, the other resumed it",
    );
    assert.deepEqual(await invoiceRows(), [
      { storeId: "lr_paid", status: "paid", invoicedAmountCents: 300, stripeInvoiceId: "in_1" },
    ]);
    assert.deepEqual(fake.invoicesByStore(), { lr_paid: [[300]] });
    assert.equal(fake.calls.filter((call) => call.startsWith("invoices.pay")).length, 1);
  });

  describe("pnpm billing:legacy-run", () => {
    const MARCH = "2026-03";
    /** Where the script starts: a .env that would turn billing on, with a Stripe key. */
    let startDirectory = "";

    before(() => {
      startDirectory = mkdtempSync(join(tmpdir(), "louez-legacy-run-cli-"));
      writeFileSync(
        join(startDirectory, ".env"),
        "LOUEZ_BILLING=cloud\nSTRIPE_SECRET_KEY=sk_test_sentinel_never_used\n",
      );
      // Loaded first by one test: the script then cannot leave this directory.
      writeFileSync(join(startDirectory, "no-chdir.mjs"), "process.chdir = () => {};\n");
    });
    after(() => {
      if (startDirectory) rmSync(startDirectory, { recursive: true, force: true });
    });

    function runScript(
      args: string[],
      options: { env?: Record<string, string>; cannotLeaveDirectory?: boolean } = {},
    ) {
      // Only what the script needs: no Stripe key, billing switch or database but the target.
      const env: NodeJS.ProcessEnv = {
        NODE_ENV: "test",
        TSX_TSCONFIG_PATH: join(APP_ROOT, "tsconfig.json"),
        MIGRATE_DATABASE_URL: database.url,
        ...options.env,
      };
      for (const name of ["PATH", "HOME", "TMPDIR"]) {
        const value = process.env[name];
        if (value !== undefined) env[name] = value;
      }
      const preload = options.cannotLeaveDirectory
        ? ["--import", pathToFileURL(join(startDirectory, "no-chdir.mjs")).href]
        : [];
      const result = spawnSync(
        process.execPath,
        ["--import", TSX_LOADER, ...preload, SCRIPT, ...args],
        {
          cwd: startDirectory,
          encoding: "utf8",
          env,
          timeout: SCRIPT_TIMEOUT_MS,
        },
      );
      const output = `${result.stdout}\n${result.stderr}`;
      if (!options.cannotLeaveDirectory) {
        assert.doesNotMatch(
          output,
          /injecting env \([1-9]/,
          "the script loaded the .env it started next to",
        );
      }
      return { status: result.status, output };
    }

    /** March: one store owes an invoice, one is settled at source, one is idle. */
    async function seedMarch(): Promise<void> {
      await seedStore({
        id: "lr_due",
        mode: "pay_as_you_go",
        subscribedAt: "2026-01-10 10:00:00",
        month: MARCH,
        fees: [{ source: "manual", status: "pending", cents: 150 }],
      });
      await seedStore({
        id: "lr_source",
        mode: "pay_as_you_go",
        subscribedAt: "2026-01-10 10:00:00",
        month: MARCH,
        fees: [{ source: "online", status: "collected", cents: 250 }],
      });
      await seedStore({
        id: "lr_quiet",
        mode: "pay_as_you_go",
        subscribedAt: "2026-01-10 10:00:00",
      });
    }

    test("it refuses a month that is not one, the current month and a future one", () => {
      const now = new Date();
      const current = now.toISOString().slice(0, 7);
      const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
        .toISOString()
        .slice(0, 7);
      for (const [args, message] of [
        [[], /--month=YYYY-MM is required/],
        [["--month=2026-13"], /--month must be YYYY-MM/],
        [["--month", "march"], /--month must be YYYY-MM/],
        [[`--month=${current}`], /cannot be billed yet: its run starts at/],
        [["--month", next, "--apply"], /cannot be billed yet/],
      ] as const) {
        const { status, output } = runScript([...args]);
        assert.equal(status, 1, output);
        assert.match(output, message);
      }
    });

    test("a dry run lists what --apply would do and writes nothing", async () => {
      await seedMarch();
      await sql(
        `INSERT INTO pay_as_you_go_invoices (id, store_id, billing_month, invoiced_amount_cents, payg_invoice_status)
         VALUES ('inv_quiet', 'lr_quiet', '${MARCH}', 0, 'void')`,
      );

      const { status, output } = runScript([`--month=${MARCH}`]);
      assert.equal(status, 0, output);
      assert.match(output, /2026-03: 3 stores/);
      assert.match(output, /to bill {4}2 /);
      assert.match(output, /lr_due {2}1 rentals, invoice 150 cents eur/);
      assert.match(output, /lr_source {2}1 rentals, invoice 0 cents eur/);
      assert.match(output, /to resume {2}0 /);
      assert.match(output, /settled {4}1 /);
      assert.match(output, /Dry run: nothing was written/);
      assert.deepEqual(await statusByStore(MARCH), { lr_quiet: "void" });
    });

    test("--apply needs LOUEZ_BILLING=cloud and a Stripe key in the shell, whatever a .env says", async () => {
      await seedMarch();

      const off = runScript([`--month=${MARCH}`, "--apply"]);
      assert.equal(off.status, 1, off.output);
      assert.match(off.output, /--apply needs LOUEZ_BILLING=cloud/);

      const noKey = runScript([`--month=${MARCH}`, "--apply"], {
        env: { LOUEZ_BILLING: "cloud" },
      });
      assert.equal(noKey.status, 1, noKey.output);
      assert.match(noKey.output, /set STRIPE_SECRET_KEY/);
      assert.deepEqual(await invoiceRows(MARCH), []);
    });

    test("if the script cannot leave its directory, the environment check stops it", async () => {
      await seedMarch();
      // Nothing to invoice, so even a broken check could not reach Stripe.
      await sql(`UPDATE platform_fee SET platform_fee_status = 'voided' WHERE store_id = 'lr_due'`);

      const { status, output } = runScript([`--month=${MARCH}`, "--apply"], {
        cannotLeaveDirectory: true,
      });
      assert.equal(status, 1, output);
      assert.match(
        output,
        /Loading the app changed LOUEZ_BILLING, STRIPE_SECRET_KEY: only the shell's variables may count/,
      );
      assert.doesNotMatch(output, new RegExp(`── ${MARCH}`));
      assert.deepEqual(await invoiceRows(MARCH), []);
    });

    test("--apply bills a month with nothing to invoice, and a second one changes nothing", async () => {
      await seedMarch();
      // Nothing left to invoice: the pending fee was voided.
      await sql(`UPDATE platform_fee SET platform_fee_status = 'voided' WHERE store_id = 'lr_due'`);

      const env = { LOUEZ_BILLING: "cloud" };
      const first = runScript([`--month=${MARCH}`, "--apply"], { env });
      assert.equal(first.status, 0, first.output);
      assert.match(first.output, /BILLING_SERVICE_URL is not set/);
      assert.match(first.output, /invoices created {2}3/);
      const rows = await invoiceRows(MARCH);
      assert.deepEqual(
        rows.map((row) => `${row.storeId} ${row.status} ${row.invoicedAmountCents}`),
        ["lr_due void 0", "lr_quiet void 0", "lr_source void 0"],
      );

      const second = runScript([`--month=${MARCH}`, "--apply"], { env });
      assert.equal(second.status, 0, second.output);
      assert.match(second.output, /settled {4}3 /);
      assert.match(second.output, /invoices created {2}0/);
      assert.deepEqual(await invoiceRows(MARCH), rows);
    });

    test("--apply refuses while another run holds the lock, and writes nothing", async () => {
      await seedMarch();
      await sql(`UPDATE platform_fee SET platform_fee_status = 'voided' WHERE store_id = 'lr_due'`);
      const holder = await database.connect();
      try {
        await holder.query("SELECT GET_LOCK(?, 0)", [LOCK]);
        const held = runScript([`--month=${MARCH}`, "--apply"], {
          env: { LOUEZ_BILLING: "cloud" },
        });
        assert.equal(held.status, 1, held.output);
        assert.match(held.output, /Another billing run holds the lock/);
        assert.deepEqual(await invoiceRows(MARCH), []);
      } finally {
        await holder.query("SELECT RELEASE_LOCK(?)", [LOCK]);
        await holder.end();
      }
    });
  });
});
