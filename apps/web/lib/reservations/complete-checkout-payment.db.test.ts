import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";
import type { Connection, RowDataPacket } from "mysql2/promise";

import {
  createTestDatabase,
  reservationChangeTestHooks,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "@louez/db/testing";

import type { CompleteCheckoutPaymentInput } from "./complete-checkout-payment";

// The paid checkout's completion as the Connect webhook runs it, on a
// database: `completeCheckoutPayment` fed the webhook's input, which calls no
// Stripe API (the webhook read the session and the PaymentIntent before).
// Each case reads the answer, every row written in each persistence stage and
// the order of the stages, every activity row with its metadata, the fee
// effects the runner gets, and every call the completion makes outside the
// database, with its payload, in order. They describe the completion as it
// is, so a move of its status transaction into packages/api must leave every
// one of them passing unchanged (docs/domain/reservation-changes.md, 6a-3).
//
// The writes are recorded by triggers, each with the id of the transaction
// that wrote it: a stage is one commit, numbered in the order it wrote. A
// transaction that rolls back takes its records with it.

const directory = mkdtempSync(join(tmpdir(), "louez-paid-completion-"));
const stubsPath = join(directory, "stubs.cjs");
writeFileSync(stubsPath, "module.exports = globalThis.__louezPaidCompletionStubs;");
after(() => rmSync(directory, { recursive: true }));

// What the completion calls besides the database: the invoicing, the store's
// and the customer's messages, the platform's notifications, analytics, the
// calendar, the fee runner and the log. The Stripe client is replaced too, by
// one that records any use: the webhook's input needs none.
const STUBBED = new Set([
  "@/lib/billing/reservation-effects",
  "@/lib/discord/platform-notifications",
  "@/lib/evlog",
  "@/lib/integrations/calendar/sync",
  "@/lib/invoicing/delivery",
  "@/lib/invoicing/service",
  "@/lib/notifications/customer-dispatcher",
  "@/lib/notifications/dispatcher",
  "@/lib/product-analytics/analytics",
  "@/lib/stripe/client",
]);

type Call = [name: string, ...args: unknown[]];
const calls: Call[] = [];
/** How many stages committed so far; set once the database exists. */
let stagesSoFar: () => Promise<number> = async () => 0;

const record =
  (name: string, answer: (...args: unknown[]) => unknown = () => undefined) =>
  (...args: unknown[]) => {
    calls.push([name, ...structuredClone(args)]);
    return answer(...args);
  };

/** An awaited call: it also records how many stages had committed when it was made. */
const recordAfterStages =
  (name: string, answer: (...args: unknown[]) => unknown = () => undefined) =>
  async (...args: unknown[]) => {
    const call: Call = [name, ...structuredClone(args)];
    calls.push(call);
    call.push({ afterStages: await stagesSoFar() });
    return answer(...args);
  };

const INVOICE_ATTACHMENTS = [{ filename: "invoice.pdf", url: "https://files.example.test/i.pdf" }];
const SIGNATURE_URL = "https://shop.example.test/contract-signature";

Reflect.set(globalThis, "__louezPaidCompletionStubs", {
  runReservationEffects: recordAfterStages("runReservationEffects"),
  notifyPaymentReceived: record("notifyPaymentReceived", async () => {}),
  notifyReservationConfirmed: record("notifyReservationConfirmed", async () => {}),
  log: {
    error: record("log.error"),
    warn: record("log.warn"),
    info: record("log.info"),
  },
  markReservationForCalendarSync: recordAfterStages("markReservationForCalendarSync"),
  tryPrepareInitialInvoiceEmailDelivery: recordAfterStages(
    "tryPrepareInitialInvoiceEmailDelivery",
    () => ({ attachments: INVOICE_ATTACHMENTS, contractSignatureUrl: SIGNATURE_URL }),
  ),
  tryGenerateInvoiceForPayment: recordAfterStages("tryGenerateInvoiceForPayment", () => ({
    success: true,
  })),
  dispatchCustomerNotification: record("dispatchCustomerNotification", async () => ({})),
  dispatchNotification: record("dispatchNotification", async () => ({})),
  captureProductServerEvent: recordAfterStages("captureProductServerEvent"),
  // The real one, which is pure.
  toAnalyticsAmountCents: (value: number | string | null | undefined) => {
    if (value === null || value === undefined) return null;
    const amount = typeof value === "number" ? value : Number.parseFloat(value);
    return Number.isFinite(amount) ? Math.round(amount * 100) : null;
  },
  stripe: new Proxy(
    {},
    {
      get(_target, key) {
        if (typeof key !== "string" || key === "then") return undefined;
        calls.push(["stripe", key]);
        throw new Error(`The Stripe client was used: ${key}`);
      },
    },
  ),
});

Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: { parentURL?: string },
    next: (specifier: string, context: unknown) => unknown,
  ) {
    if (specifier === "server-only" || specifier === "@/lib/storage/files") {
      return { url: "node:module", shortCircuit: true };
    }
    const parent = context.parentURL ? decodeURIComponent(context.parentURL) : "";
    if (
      parent.endsWith("/lib/reservations/complete-checkout-payment.ts") &&
      STUBBED.has(specifier)
    ) {
      return { url: pathToFileURL(stubsPath).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

const STORE = "store_paid_completion";
const STORE_SLUG = "paid-completion";
/** A store whose minimum rental is three days: the two days booked break its rule. */
const RULES_STORE = "store_paid_rules";
const RULES_STORE_SLUG = "paid-rules";
const STRIPE_ACCOUNT = "acct_paid_completion";
const START = new Date("2030-06-01T09:00:00Z");
const END = new Date("2030-06-03T09:00:00Z");
const CHARGED_AT = new Date("2026-11-13T10:00:00Z");

/**
 * The transaction running the statement, in a trigger: its thread and its
 * event in performance_schema (information_schema's InnoDB table is a cached
 * snapshot, refreshed every 0.1 s).
 */
const TRX = `(SELECT CONCAT(THREAD_ID, ':', EVENT_ID) FROM performance_schema.events_transactions_current WHERE THREAD_ID = PS_CURRENT_THREAD_ID())`;
/** ` <column> <old> > <new>` when it changed, else nothing. */
const changed = (column: string) =>
  `IF(OLD.${column} <=> NEW.${column}, '', CONCAT(' ${column} ', IFNULL(OLD.${column}, 'null'), ' > ', IFNULL(NEW.${column}, 'null')))`;
/** ` <column> set` when it was set, else nothing. */
const set = (column: string) =>
  `IF(OLD.${column} <=> NEW.${column}, '', CONCAT(' ${column} ', IF(NEW.${column} IS NULL, 'cleared', 'set')))`;
/** The entry of an update, or `(no tracked column changed)`. */
const updated = (table: string, parts: string[]) =>
  `CONCAT('${table}', IF(CONCAT(${parts.join(", ")}) = '', ' (no tracked column changed)', CONCAT(${parts.join(", ")})))`;

const WRITE_LOG = [
  `CREATE TABLE test_writes (
     seq INT AUTO_INCREMENT PRIMARY KEY,
     trx VARCHAR(32) NOT NULL,
     entry VARCHAR(1024) NOT NULL
   )`,
  `CREATE TRIGGER test_writes_payments_insert AFTER INSERT ON payments FOR EACH ROW
     INSERT INTO test_writes (trx, entry) VALUES (${TRX}, CONCAT('payments + ', NEW.payment_type, ' ', NEW.payment_status, ' ', NEW.amount, ' ', IFNULL(NEW.currency, 'null'), ' origin ', IFNULL(NEW.origin, 'null')))`,
  `CREATE TRIGGER test_writes_payments_update AFTER UPDATE ON payments FOR EACH ROW
     INSERT INTO test_writes (trx, entry) VALUES (${TRX}, ${updated("payments", [changed("payment_status"), changed("origin"), changed("payment_request_id"), changed("stripe_payment_intent_id"), changed("stripe_charge_id"), changed("stripe_payment_method_id"), changed("stripe_account_id"), changed("gross_minor"), changed("insurance_share_minor"), set("paid_at")])})`,
  `CREATE TRIGGER test_writes_payment_requests_update AFTER UPDATE ON payment_requests FOR EACH ROW
     INSERT INTO test_writes (trx, entry) VALUES (${TRX}, ${updated("payment_requests", [changed("status"), set("completed_at")])})`,
  `CREATE TRIGGER test_writes_activity_insert AFTER INSERT ON reservation_activity FOR EACH ROW
     INSERT INTO test_writes (trx, entry) VALUES (${TRX}, CONCAT('reservation_activity + ', NEW.activity_type))`,
  `CREATE TRIGGER test_writes_reservations_update AFTER UPDATE ON reservations FOR EACH ROW
     INSERT INTO test_writes (trx, entry) VALUES (${TRX}, ${updated("reservations", [changed("reservation_status"), changed("deposit_status"), changed("stripe_customer_id"), changed("stripe_payment_method_id"), set("contract_validated_at"), set("billable_at"), set("withdrawn_at")])})`,
  `CREATE TRIGGER test_writes_products_update AFTER UPDATE ON products FOR EACH ROW
     INSERT INTO test_writes (trx, entry) VALUES (${TRX}, ${updated("products", [changed("quantity")])})`,
  `CREATE TRIGGER test_writes_items_update AFTER UPDATE ON reservation_items FOR EACH ROW
     INSERT INTO test_writes (trx, entry) VALUES (${TRX}, ${updated("reservation_items", [changed("consumed_quantity")])})`,
  `CREATE TRIGGER test_writes_attempts_update AFTER UPDATE ON marketplace_booking_attempts FOR EACH ROW
     INSERT INTO test_writes (trx, entry) VALUES (${TRX}, ${updated("marketplace_booking_attempts", [changed("status")])})`,
];

/** Makes the contract validation of a payment fail, as a lost connection would. */
const FAIL_CONTRACT_VALIDATION = `CREATE TRIGGER test_fail_contract_validation BEFORE INSERT ON reservation_activity FOR EACH ROW
  BEGIN
    IF NEW.activity_type = 'modified' AND JSON_UNQUOTE(JSON_EXTRACT(NEW.metadata, '$.source')) = 'payment' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'contract validation failed';
    END IF;
  END`;

describe("the paid checkout's completion (database)", { skip: skipWithoutTestDatabase() }, () => {
  const hooks = reservationChangeTestHooks();
  let database: TestDatabase;
  let raw: Connection;
  let louezDb: typeof import("@louez/db");
  let completion: typeof import("./complete-checkout-payment");
  let storefront: typeof import("@/lib/storefront-url");
  let counter = 0;
  /** The product whose lock each run of the owner entry is checked for. */
  let watchedProduct: string | null = null;

  before(async () => {
    database = await createTestDatabase("paid_completion");
    louezDb = await import("@louez/db");
    completion = await import("./complete-checkout-payment");
    storefront = await import("@/lib/storefront-url");

    raw = await database.connect();
    for (const statement of WRITE_LOG) await raw.query(statement);
    stagesSoFar = async () => {
      const [rows] = await raw.query<RowDataPacket[]>(
        "SELECT COUNT(DISTINCT trx) AS stages FROM test_writes",
      );
      return Number(rows[0]?.stages);
    };

    const contact = { phone: "+33 6 00 00 00 00", email: "shop@paid.test" };
    const settings = {
      reservationMode: "request" as const,
      currency: "EUR",
      advanceNoticeMinutes: 0,
      pendingBlocksAvailability: false,
    };
    await louezDb.db.insert(louezDb.stores).values([
      {
        id: STORE,
        userId: "owner_paid_completion",
        name: "Paid",
        slug: STORE_SLUG,
        ...contact,
        ownerPhone: "+33 6 11 11 11 11",
        stripeAccountId: STRIPE_ACCOUNT,
        stripeChargesEnabled: true,
        settings,
      },
      {
        id: RULES_STORE,
        userId: "owner_paid_rules",
        name: "Rules",
        slug: RULES_STORE_SLUG,
        ...contact,
        stripeAccountId: STRIPE_ACCOUNT,
        stripeChargesEnabled: true,
        settings: { ...settings, minRentalMinutes: 3 * 24 * 60 },
      },
    ]);
    for (const storeId of [STORE, RULES_STORE]) {
      await louezDb.db.insert(louezDb.customers).values({
        id: customerOf(storeId),
        storeId,
        email: `ada@${storeId}.test`,
        firstName: "Ada",
        lastName: "Customer",
        phone: "+33 6 22 22 22 22",
      });
    }
  });

  after(async () => {
    hooks.beforeReservationLock = null;
    await raw?.end();
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    calls.length = 0;
    hooks.restarts = 0;
    watchedProduct = null;
    // Each run of the owner entry, as it reaches the reservation's row lock:
    // the scope it locks, and whether the watched product is locked by then
    // (another connection asks for it without waiting).
    hooks.beforeReservationLock = async (scope) => {
      const call: Call = ["reservation lock", { ...scope }];
      calls.push(call);
      let productLocked = false;
      if (watchedProduct) {
        const other = await database.connect();
        try {
          await other.beginTransaction();
          await other.query("SELECT id FROM products WHERE id = ? FOR UPDATE NOWAIT", [
            watchedProduct,
          ]);
        } catch (error) {
          productLocked = (error as { errno?: number }).errno === 3572;
          if (!productLocked) throw error;
        } finally {
          await other.rollback();
          await other.end();
        }
      }
      call.push({ productLocked, afterStages: await stagesSoFar() });
    };
    await raw.query("DROP TRIGGER IF EXISTS test_fail_contract_validation");
  });

  const nextId = (prefix: string) =>
    `${prefix}_${String(++counter).padStart(20 - prefix.length, "0")}`;

  const customerOf = (storeId: string) => `cus_ada_${storeId === STORE ? "paid" : "rules"}`;

  /** The writes recorded since the last call, each with its stage: 1 is the first commit. */
  async function writes() {
    const [rows] = await raw.query<RowDataPacket[]>(
      "SELECT trx, entry FROM test_writes ORDER BY seq",
    );
    const stages = new Map<string, number>();
    const entries = rows.map((row) => {
      const trx = String(row.trx);
      if (!stages.has(trx)) stages.set(trx, stages.size + 1);
      return [stages.get(trx), String(row.entry)];
    });
    await raw.query("DELETE FROM test_writes");
    return entries;
  }

  /**
   * A pending booking of `rental` units of a product that has `stock`, and of
   * `consumables` of a consumable product that has `consumableStock` left, with
   * a deposit of 50, for the store's customer. With `request`, the store asked
   * for the rental's payment (a payment request); without, the checkout opened
   * its session, whose payment row is pending.
   */
  async function bookingOf(options: {
    storeId?: string;
    source?: "online" | "marketplace";
    stock?: number;
    consumableStock?: number;
    request?: boolean;
  }) {
    const storeId = options.storeId ?? STORE;
    const productId = nextId("prd");
    const consumableId = nextId("csm");
    await louezDb.db.insert(louezDb.products).values([
      {
        id: productId,
        storeId,
        name: "Kayak",
        price: "40.00",
        pricingMode: "day",
        quantity: options.stock ?? 2,
      },
      {
        id: consumableId,
        storeId,
        name: "Wax",
        price: "10.00",
        pricingMode: "day",
        stockKind: "consumable",
        quantity: options.consumableStock ?? 3,
      },
    ]);
    const id = nextId("res");
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId,
      customerId: customerOf(storeId),
      number: `P-${counter}`,
      status: "pending",
      startDate: START,
      endDate: END,
      subtotalAmount: "100.00",
      depositAmount: "50.00",
      totalAmount: "100.00",
      currency: "EUR",
      source: options.source ?? "online",
    });
    await louezDb.db.insert(louezDb.reservationItems).values([
      {
        id: nextId("itm"),
        reservationId: id,
        productId,
        quantity: 1,
        unitPrice: "40.00",
        depositPerUnit: "50.00",
        totalPrice: "80.00",
        productSnapshot: { name: "Kayak", description: null, images: [] },
      },
      {
        id: nextId("itm"),
        reservationId: id,
        productId: consumableId,
        quantity: 1,
        unitPrice: "20.00",
        depositPerUnit: "0.00",
        totalPrice: "20.00",
        productSnapshot: { name: "Wax", description: null, images: [] },
      },
    ]);
    const sessionId = `cs_test_${id}`;
    let paymentRequestId: string | null = null;
    if (options.request) {
      paymentRequestId = nextId("prq");
      await louezDb.db.insert(louezDb.paymentRequests).values({
        id: paymentRequestId,
        storeId,
        reservationId: id,
        token: `token_${paymentRequestId}`,
        amount: "100.00",
        currency: "EUR",
        description: "Rental",
        type: "rental",
        expiresAt: new Date("2030-05-01T00:00:00Z"),
      });
    } else {
      await louezDb.db.insert(louezDb.payments).values({
        id: nextId("pay"),
        reservationId: id,
        amount: "100.00",
        type: "rental",
        method: "stripe",
        status: "pending",
        stripeCheckoutSessionId: sessionId,
        currency: "EUR",
      });
    }
    watchedProduct = productId;
    await writes();
    return { id, storeId, productId, consumableId, sessionId, paymentRequestId };
  }

  type Booking = Awaited<ReturnType<typeof bookingOf>>;

  /** `checkout.session.completed`, as the Connect webhook hands it to the completion. */
  const webhookInput = (booking: Booking): CompleteCheckoutPaymentInput => ({
    source: "webhook",
    reservationId: booking.id,
    stripe: {
      sessionId: booking.sessionId,
      amountTotalCents: 10000,
      currency: "EUR",
      paymentIntentId: `pi_${booking.id}`,
      chargeId: `ch_${booking.id}`,
      chargeCreatedAt: CHARGED_AT,
      stripeCustomerId: "cus_stripe_ada",
      stripePaymentMethodId: "pm_card_ada",
      stripeAccountId: STRIPE_ACCOUNT,
      paymentIntentMetadata: null,
      sessionMetadata: booking.paymentRequestId
        ? { reservationId: booking.id, paymentRequestId: booking.paymentRequestId }
        : { reservationId: booking.id, checkoutFlow: "storefront_checkout" },
    },
    paymentRequestId: booking.paymentRequestId,
    analytics: {
      is_pay_as_you_go_store: true,
      application_fee_collected_cents: 400,
      reservation_fee_cents: 400,
    },
  });

  async function reservationRow(id: string) {
    const row = await louezDb.db.query.reservations.findFirst({
      where: eq(louezDb.reservations.id, id),
    });
    assert.ok(row);
    return row;
  }

  async function storeRow(storeId: string) {
    const store = await louezDb.db.query.stores.findFirst({
      where: eq(louezDb.stores.id, storeId),
    });
    assert.ok(store);
    return store;
  }

  /** The reservation's status and the deposit's columns. */
  async function stateOf(id: string) {
    const row = await reservationRow(id);
    return {
      status: row.status,
      depositStatus: row.depositStatus,
      stripeCustomerId: row.stripeCustomerId,
      stripePaymentMethodId: row.stripePaymentMethodId,
      contractValidated: row.contractValidatedAt !== null,
      billable: row.billableAt !== null,
    };
  }

  /** The session's payment row, as the claim leaves it. */
  async function paymentOf(booking: Booking) {
    const rows = await louezDb.db
      .select({
        id: louezDb.payments.id,
        amount: louezDb.payments.amount,
        currency: louezDb.payments.currency,
        type: louezDb.payments.type,
        method: louezDb.payments.method,
        status: louezDb.payments.status,
        origin: louezDb.payments.origin,
        paymentRequestId: louezDb.payments.paymentRequestId,
        stripePaymentIntentId: louezDb.payments.stripePaymentIntentId,
        stripeChargeId: louezDb.payments.stripeChargeId,
        stripePaymentMethodId: louezDb.payments.stripePaymentMethodId,
        stripeAccountId: louezDb.payments.stripeAccountId,
        grossMinor: louezDb.payments.grossMinor,
        insuranceShareMinor: louezDb.payments.insuranceShareMinor,
        paidAt: louezDb.payments.paidAt,
      })
      .from(louezDb.payments)
      .where(eq(louezDb.payments.reservationId, booking.id));
    assert.equal(rows.length, 1, "one payment row for the session");
    return rows[0]!;
  }

  async function paymentRequestStatus(id: string) {
    const row = await louezDb.db.query.paymentRequests.findFirst({
      where: eq(louezDb.paymentRequests.id, id),
    });
    return row?.status;
  }

  /** The products' stock and what the lines consumed. */
  async function stockOf(booking: Booking) {
    const products = await louezDb.db
      .select({ id: louezDb.products.id, quantity: louezDb.products.quantity })
      .from(louezDb.products)
      .where(eq(louezDb.products.storeId, booking.storeId));
    const items = await louezDb.db
      .select({
        productId: louezDb.reservationItems.productId,
        consumed: louezDb.reservationItems.consumedQuantity,
      })
      .from(louezDb.reservationItems)
      .where(eq(louezDb.reservationItems.reservationId, booking.id));
    const quantity = (productId: string) => products.find((row) => row.id === productId)?.quantity;
    const consumed = (productId: string) =>
      items.find((row) => row.productId === productId)?.consumed;
    return {
      rental: quantity(booking.productId),
      consumable: quantity(booking.consumableId),
      rentalConsumed: consumed(booking.productId),
      consumableConsumed: consumed(booking.consumableId),
    };
  }

  /** Every activity row of the reservation, sorted by type; dates written now read as "<now>". */
  async function activityOf(id: string) {
    const rows = await louezDb.db
      .select({
        type: louezDb.reservationActivity.activityType,
        userId: louezDb.reservationActivity.userId,
        description: louezDb.reservationActivity.description,
        metadata: louezDb.reservationActivity.metadata,
      })
      .from(louezDb.reservationActivity)
      .where(eq(louezDb.reservationActivity.reservationId, id));
    return rows
      .map((row) => {
        const metadata = { ...(row.metadata as Record<string, unknown> | null) };
        if (typeof metadata.validatedAt === "string") metadata.validatedAt = "<now>";
        return { ...row, metadata };
      })
      .sort((a, b) => a.type.localeCompare(b.type));
  }

  async function attemptStatus(id: string) {
    const row = await louezDb.db.query.marketplaceBookingAttempts.findFirst({
      where: eq(louezDb.marketplaceBookingAttempts.reservationId, id),
    });
    return row?.status;
  }

  const CONTRACT_ROW = {
    type: "modified",
    userId: null,
    description: null,
    metadata: { kind: "automatic_contract_validation", source: "payment", validatedAt: "<now>" },
  };

  const paymentReceivedRow = (booking: Booking) => ({
    type: "payment_received",
    userId: null,
    description: null,
    metadata: {
      paymentIntentId: `pi_${booking.id}`,
      chargeId: `ch_${booking.id}`,
      checkoutSessionId: booking.sessionId,
      amount: 100,
      currency: "EUR",
      method: "stripe",
      type: "rental",
    },
  });

  const RULE_WARNINGS = [
    {
      code: "min_duration",
      key: "errors.minRentalDurationViolation",
      params: { duration: "3d" },
    },
  ];

  /** The `confirmed` row the payment's status change writes. */
  const confirmedRow = (warnings: unknown[] = []) => ({
    type: "confirmed",
    userId: null,
    description: null,
    metadata: {
      actor: "payment",
      newStatus: "confirmed",
      // The capacity verdict of its stock check (slice 2).
      overbooked: false,
      previousStatus: "pending",
      source: "online_payment",
      depositAmount: 50,
      depositStatus: "card_saved",
      cardSaved: true,
      ...(warnings.length > 0 && {
        validationWarnings: warnings,
        validationWarningsCount: warnings.length,
      }),
    },
  });

  const storeInfo = (store: { id: string; name: string; slug: string }) => ({
    id: store.id,
    name: store.name,
    slug: store.slug,
  });

  async function adminStore(storeId: string) {
    const store = await storeRow(storeId);
    return {
      id: store.id,
      name: store.name,
      email: store.email,
      discordWebhookUrl: store.discordWebhookUrl,
      ownerPhone: store.ownerPhone,
      notificationSettings: store.notificationSettings,
      settings: store.settings,
    };
  }

  async function notificationReservation(booking: Booking) {
    const reservation = await reservationRow(booking.id);
    return {
      id: booking.id,
      number: reservation.number,
      startDate: START,
      endDate: END,
      totalAmount: 100,
      currency: "EUR",
    };
  }

  const notificationCustomer = (storeId: string) => ({
    firstName: "Ada",
    lastName: "Customer",
    email: `ada@${storeId}.test`,
    phone: "+33 6 22 22 22 22",
  });

  /** The claimed payment's calls: the invoice, then the store's and the platform's messages. */
  async function paymentCalls(booking: Booking, afterStages: number): Promise<Call[]> {
    const payment = await paymentOf(booking);
    const reservation = await reservationRow(booking.id);
    const store = await storeRow(booking.storeId);
    return [
      ["tryGenerateInvoiceForPayment", payment.id, "stripe_checkout_webhook", { afterStages }],
      [
        "dispatchNotification",
        "payment_received",
        {
          actor: "system",
          store: await adminStore(booking.storeId),
          reservation: await notificationReservation(booking),
          customer: notificationCustomer(booking.storeId),
          payment: { amount: 100, currency: "EUR" },
        },
      ],
      ["notifyPaymentReceived", storeInfo(store), reservation.number, 100, "EUR"],
    ];
  }

  /** The two runs of the owner entry: step 7 locks the reservation alone, step 8 its product first. */
  const lockCalls = (booking: Booking, stages: [number, number]): Call[] => [
    [
      "reservation lock",
      { reservationId: booking.id, storeId: booking.storeId },
      { productLocked: false, afterStages: stages[0] },
    ],
    [
      "reservation lock",
      { reservationId: booking.id, storeId: booking.storeId },
      { productLocked: true, afterStages: stages[1] },
    ],
  ];

  const analyticsCall = (booking: Booking, afterStages: number, statusBefore = "pending"): Call => [
    "captureProductServerEvent",
    {
      distinctId: customerOf(booking.storeId),
      event: "checkout_payment_completed",
      properties: {
        feature: "checkout",
        surface: "storefront",
        store_id: booking.storeId,
        reservation_id: booking.id,
        customer_id: customerOf(booking.storeId),
        source: "stripe_connect_webhook",
        payment_provider: "stripe",
        amount_cents: 10000,
        deposit_amount_cents: 5000,
        currency: "EUR",
        has_deposit: true,
        card_saved: true,
        payment_intent_present: true,
        reservation_status_before: statusBefore,
        payment_request_present: booking.paymentRequestId !== null,
        reservation_confirmed_by_event: statusBefore === "pending",
        is_pay_as_you_go_store: true,
        application_fee_collected_cents: 400,
        reservation_fee_cents: 400,
      },
    },
    { afterStages },
  ];

  /** A confirmation's calls, from the store's message to the calendar. */
  async function confirmationCalls(booking: Booking, afterStages: number): Promise<Call[]> {
    const store = await storeRow(booking.storeId);
    const reservation = await reservationRow(booking.id);
    return [
      [
        "dispatchNotification",
        "reservation_confirmed",
        {
          actor: "system",
          store: await adminStore(booking.storeId),
          reservation: await notificationReservation(booking),
          customer: notificationCustomer(booking.storeId),
        },
      ],
      ["tryPrepareInitialInvoiceEmailDelivery", booking.id, { afterStages }],
      [
        "dispatchCustomerNotification",
        "customer_reservation_confirmed",
        {
          store: {
            id: store.id,
            name: store.name,
            email: store.email,
            logoUrl: store.logoUrl,
            darkLogoUrl: store.darkLogoUrl,
            address: store.address,
            phone: store.phone,
            theme: store.theme,
            settings: store.settings,
            emailSettings: store.emailSettings,
            customerNotificationSettings: store.customerNotificationSettings,
          },
          customer: { id: customerOf(booking.storeId), ...notificationCustomer(booking.storeId) },
          reservation: {
            ...(await notificationReservation(booking)),
            subtotalAmount: 100,
            depositAmount: 50,
            taxEnabled: false,
            taxRate: null,
            subtotalExclTax: null,
            taxAmount: null,
          },
          items: [
            { name: "Kayak", quantity: 1, unitPrice: 40, totalPrice: 80 },
            { name: "Wax", quantity: 1, unitPrice: 20, totalPrice: 20 },
          ],
          reservationUrl: storefront.getStorefrontUrl(
            store.slug,
            `/account/reservations/${booking.id}`,
          ),
          documentAttachments: INVOICE_ATTACHMENTS,
          contractSignatureUrl: SIGNATURE_URL,
        },
      ],
      ["notifyReservationConfirmed", storeInfo(store), reservation.number],
      ["markReservationForCalendarSync", booking.storeId, booking.id, { afterStages }],
    ];
  }

  const completedLog = (
    booking: Booking,
    outcome: { claimed: boolean; reservationConfirmed: boolean },
  ): Call => [
    "log.info",
    {
      checkout: {
        event: "payment_completed",
        source: "webhook",
        reservationId: booking.id,
        ...outcome,
        depositStatus: "card_saved",
      },
    },
  ];

  /** The writes of step 7 (the payment details) and step 8 (the status transaction), confirmed. */
  const confirmationWrites = (stage7: number, stage8: number) => [
    [
      stage7,
      "reservations deposit_status pending > card_saved stripe_customer_id null > cus_stripe_ada stripe_payment_method_id null > pm_card_ada",
    ],
    [stage8, "products quantity 3 > 2"],
    [stage8, "reservation_items consumed_quantity 0 > 1"],
    [stage8, "reservations reservation_status pending > confirmed billable_at set"],
    [stage8, "reservation_activity + confirmed"],
    [stage8, "reservations (no tracked column changed)"],
  ];

  const CONFIRMED_DEPOSIT = {
    depositStatus: "card_saved",
    stripeCustomerId: "cus_stripe_ada",
    stripePaymentMethodId: "pm_card_ada",
  };

  test("a paid request: the claim, its payment_received row and messages, the confirmation and its messages, the calendar", async () => {
    const booking = await bookingOf({ storeId: RULES_STORE, request: true });

    const answer = await completion.completeCheckoutPayment(webhookInput(booking));

    assert.deepEqual(answer, { status: "completed", claimed: true, reservationConfirmed: true });
    assert.deepEqual(await writes(), [
      [1, "payment_requests status pending > completed completed_at set"],
      [1, "payments + rental completed 100.00 EUR origin payment_request"],
      [2, "reservations contract_validated_at set"],
      [2, "reservation_activity + modified"],
      [3, "reservation_activity + payment_received"],
      ...confirmationWrites(4, 5),
    ]);
    const payment = await paymentOf(booking);
    assert.deepEqual(
      { ...payment, id: undefined },
      {
        id: undefined,
        amount: "100.00",
        currency: "EUR",
        type: "rental",
        method: "stripe",
        status: "completed",
        origin: "payment_request",
        paymentRequestId: booking.paymentRequestId,
        stripePaymentIntentId: `pi_${booking.id}`,
        stripeChargeId: `ch_${booking.id}`,
        stripePaymentMethodId: "pm_card_ada",
        stripeAccountId: STRIPE_ACCOUNT,
        grossMinor: 10000,
        insuranceShareMinor: 0,
        paidAt: CHARGED_AT,
      },
    );
    assert.equal(await paymentRequestStatus(booking.paymentRequestId!), "completed");
    assert.deepEqual(await stateOf(booking.id), {
      status: "confirmed",
      ...CONFIRMED_DEPOSIT,
      contractValidated: true,
      billable: true,
    });
    assert.deepEqual(await stockOf(booking), {
      rental: 2,
      consumable: 2,
      rentalConsumed: 0,
      consumableConsumed: 1,
    });
    assert.deepEqual(await activityOf(booking.id), [
      confirmedRow(RULE_WARNINGS),
      CONTRACT_ROW,
      paymentReceivedRow(booking),
    ]);
    assert.deepEqual(calls, [
      ...(await paymentCalls(booking, 2)),
      ...lockCalls(booking, [3, 4]),
      ["runReservationEffects", [], { afterStages: 5 }],
      analyticsCall(booking, 5),
      [
        "log.warn",
        {
          checkout: {
            event: "reservation_confirmed_with_rule_violations",
            source: "webhook",
            reservationId: booking.id,
            storeId: RULES_STORE,
            warnings: RULE_WARNINGS,
          },
        },
      ],
      ...(await confirmationCalls(booking, 5)),
      completedLog(booking, { claimed: true, reservationConfirmed: true }),
    ]);
  });

  test("the same event again: no row, no message, and the confirmation changes nothing", async () => {
    const booking = await bookingOf({ storeId: RULES_STORE, request: true });
    await completion.completeCheckoutPayment(webhookInput(booking));
    const activityBefore = await activityOf(booking.id);
    await writes();
    calls.length = 0;

    const answer = await completion.completeCheckoutPayment(webhookInput(booking));

    assert.deepEqual(answer, { status: "completed", claimed: false, reservationConfirmed: false });
    assert.deepEqual(await writes(), [], "nothing written");
    assert.deepEqual(await stateOf(booking.id), {
      status: "confirmed",
      ...CONFIRMED_DEPOSIT,
      contractValidated: true,
      billable: true,
    });
    assert.deepEqual(await stockOf(booking), {
      rental: 2,
      consumable: 2,
      rentalConsumed: 0,
      consumableConsumed: 1,
    });
    assert.deepEqual(await activityOf(booking.id), activityBefore);
    const payment = await paymentOf(booking);
    assert.deepEqual(calls, [
      [
        "tryGenerateInvoiceForPayment",
        payment.id,
        "stripe_checkout_webhook_existing_payment",
        { afterStages: 0 },
      ],
      // Step 7 finds the reservation confirmed under its lock alone and writes
      // nothing; step 8 reads it confirmed, so it locks its products and takes
      // its consumables again, which changes nothing.
      ...lockCalls(booking, [0, 0]),
      ["runReservationEffects", [], { afterStages: 0 }],
      completedLog(booking, { claimed: false, reservationConfirmed: false }),
    ]);
  });

  test("a stock refusal leaves the paid booking pending; the stock freed, the event again confirms it", async () => {
    // One kayak, booked over the same days by a confirmed booking.
    const booking = await bookingOf({ stock: 1 });
    const other = nextId("res");
    await louezDb.db.insert(louezDb.reservations).values({
      id: other,
      storeId: STORE,
      customerId: customerOf(STORE),
      number: `P-${counter}`,
      status: "confirmed",
      startDate: START,
      endDate: END,
      subtotalAmount: "40.00",
      depositAmount: "0.00",
      totalAmount: "40.00",
      source: "manual",
    });
    await louezDb.db.insert(louezDb.reservationItems).values({
      id: nextId("itm"),
      reservationId: other,
      productId: booking.productId,
      quantity: 1,
      unitPrice: "40.00",
      depositPerUnit: "0.00",
      totalPrice: "40.00",
      productSnapshot: { name: "Kayak", description: null, images: [] },
    });
    await writes();

    const refused = await completion.completeCheckoutPayment(webhookInput(booking));

    assert.deepEqual(refused, { status: "completed", claimed: true, reservationConfirmed: false });
    assert.deepEqual(await writes(), [
      [
        1,
        "payments payment_status pending > completed origin null > checkout stripe_payment_intent_id null > pi_" +
          booking.id +
          " stripe_charge_id null > ch_" +
          booking.id +
          " stripe_payment_method_id null > pm_card_ada stripe_account_id null > " +
          STRIPE_ACCOUNT +
          " gross_minor null > 10000 insurance_share_minor null > 0 paid_at set",
      ],
      [2, "reservations contract_validated_at set"],
      [2, "reservation_activity + modified"],
      [3, "reservation_activity + payment_received"],
      [
        4,
        "reservations deposit_status pending > card_saved stripe_customer_id null > cus_stripe_ada stripe_payment_method_id null > pm_card_ada",
      ],
    ]);
    assert.deepEqual(await stateOf(booking.id), {
      status: "pending",
      ...CONFIRMED_DEPOSIT,
      contractValidated: true,
      billable: false,
    });
    assert.deepEqual(await activityOf(booking.id), [CONTRACT_ROW, paymentReceivedRow(booking)]);
    assert.deepEqual(calls, [
      ...(await paymentCalls(booking, 2)),
      ...lockCalls(booking, [3, 4]),
      ["log.error", "checkout", `Inventory conflict on paid confirmation: ${booking.id}`],
      analyticsCall(booking, 4),
      completedLog(booking, { claimed: true, reservationConfirmed: false }),
    ]);

    // The store cancels the other booking; Stripe sends the event again.
    await louezDb.db
      .update(louezDb.reservations)
      .set({ status: "cancelled" })
      .where(eq(louezDb.reservations.id, other));
    await writes();
    calls.length = 0;

    const confirmed = await completion.completeCheckoutPayment(webhookInput(booking));

    assert.deepEqual(confirmed, {
      status: "completed",
      claimed: false,
      reservationConfirmed: true,
    });
    assert.deepEqual(await writes(), [
      [1, "reservations (no tracked column changed)"],
      [2, "products quantity 3 > 2"],
      [2, "reservation_items consumed_quantity 0 > 1"],
      [2, "reservations reservation_status pending > confirmed billable_at set"],
      [2, "reservation_activity + confirmed"],
      [2, "reservations (no tracked column changed)"],
    ]);
    assert.deepEqual(await stateOf(booking.id), {
      status: "confirmed",
      ...CONFIRMED_DEPOSIT,
      contractValidated: true,
      billable: true,
    });
    assert.deepEqual(await activityOf(booking.id), [
      confirmedRow(),
      CONTRACT_ROW,
      paymentReceivedRow(booking),
    ]);
    const payment = await paymentOf(booking);
    assert.deepEqual(calls, [
      [
        "tryGenerateInvoiceForPayment",
        payment.id,
        "stripe_checkout_webhook_existing_payment",
        { afterStages: 0 },
      ],
      ...lockCalls(booking, [0, 1]),
      ["runReservationEffects", [], { afterStages: 2 }],
      ...(await confirmationCalls(booking, 2)),
      completedLog(booking, { claimed: false, reservationConfirmed: true }),
    ]);
  });

  test("a marketplace booking refused for its consumable: its attempt confirmed, the booking pending", async () => {
    const booking = await bookingOf({ source: "marketplace", consumableStock: 0 });
    await louezDb.db.insert(louezDb.marketplaceBookingAttempts).values({
      id: nextId("att"),
      bookingAttemptId: `attempt-${booking.id}`,
      storeId: STORE,
      quoteTokenHash: "0".repeat(64),
      reservationId: booking.id,
      status: "checkout_pending",
      expiresAt: new Date("2030-05-01T00:00:00Z"),
    });
    await writes();

    const answer = await completion.completeCheckoutPayment(webhookInput(booking));

    assert.deepEqual(answer, { status: "completed", claimed: true, reservationConfirmed: false });
    assert.deepEqual(await writes(), [
      [
        1,
        "payments payment_status pending > completed origin null > checkout stripe_payment_intent_id null > pi_" +
          booking.id +
          " stripe_charge_id null > ch_" +
          booking.id +
          " stripe_payment_method_id null > pm_card_ada stripe_account_id null > " +
          STRIPE_ACCOUNT +
          " gross_minor null > 10000 insurance_share_minor null > 0 paid_at set",
      ],
      [2, "reservations contract_validated_at set"],
      [2, "reservation_activity + modified"],
      [3, "marketplace_booking_attempts status checkout_pending > confirmed"],
      [4, "reservation_activity + payment_received"],
      [
        5,
        "reservations deposit_status pending > card_saved stripe_customer_id null > cus_stripe_ada stripe_payment_method_id null > pm_card_ada",
      ],
    ]);
    assert.equal(await attemptStatus(booking.id), "confirmed");
    assert.deepEqual(await stateOf(booking.id), {
      status: "pending",
      ...CONFIRMED_DEPOSIT,
      contractValidated: true,
      billable: false,
    });
    assert.deepEqual(await stockOf(booking), {
      rental: 2,
      consumable: 0,
      rentalConsumed: 0,
      consumableConsumed: 0,
    });
    assert.deepEqual(await activityOf(booking.id), [CONTRACT_ROW, paymentReceivedRow(booking)]);
    assert.deepEqual(calls, [
      ...(await paymentCalls(booking, 3)),
      ...lockCalls(booking, [4, 5]),
      [
        "log.error",
        {
          checkout: {
            event: "consumable_stock_insufficient_on_confirmation",
            source: "webhook",
            reservationId: booking.id,
            productId: booking.consumableId,
            requestedQuantity: 1,
            availableQuantity: 0,
          },
        },
      ],
      analyticsCall(booking, 5),
      completedLog(booking, { claimed: true, reservationConfirmed: false }),
    ]);
  });

  test("the contract validation throws after the claim; the event again confirms, and the payment_received row and its messages are lost", async () => {
    const booking = await bookingOf({});
    await raw.query(FAIL_CONTRACT_VALIDATION);

    await assert.rejects(
      completion.completeCheckoutPayment(webhookInput(booking)),
      (error: unknown) =>
        error instanceof Error &&
        error.cause instanceof Error &&
        error.cause.message === "contract validation failed",
    );

    assert.deepEqual(await writes(), [
      [
        1,
        "payments payment_status pending > completed origin null > checkout stripe_payment_intent_id null > pi_" +
          booking.id +
          " stripe_charge_id null > ch_" +
          booking.id +
          " stripe_payment_method_id null > pm_card_ada stripe_account_id null > " +
          STRIPE_ACCOUNT +
          " gross_minor null > 10000 insurance_share_minor null > 0 paid_at set",
      ],
    ]);
    assert.deepEqual(await stateOf(booking.id), {
      status: "pending",
      depositStatus: "pending",
      stripeCustomerId: null,
      stripePaymentMethodId: null,
      contractValidated: false,
      billable: false,
    });
    assert.deepEqual(await activityOf(booking.id), []);
    assert.deepEqual(calls, [], "nothing sent");

    // Stripe sends the event again, the database answering this time.
    await raw.query("DROP TRIGGER test_fail_contract_validation");
    calls.length = 0;

    const answer = await completion.completeCheckoutPayment(webhookInput(booking));

    assert.deepEqual(answer, { status: "completed", claimed: false, reservationConfirmed: true });
    assert.deepEqual(await writes(), [
      [1, "reservations contract_validated_at set"],
      [1, "reservation_activity + modified"],
      ...confirmationWrites(2, 3),
    ]);
    assert.deepEqual(await stateOf(booking.id), {
      status: "confirmed",
      ...CONFIRMED_DEPOSIT,
      contractValidated: true,
      billable: true,
    });
    // Today's loss: the redelivery finds the payment claimed, so no
    // payment_received row is written and no payment message is sent (6b).
    assert.deepEqual(await activityOf(booking.id), [confirmedRow(), CONTRACT_ROW]);
    const payment = await paymentOf(booking);
    assert.deepEqual(calls, [
      [
        "tryGenerateInvoiceForPayment",
        payment.id,
        "stripe_checkout_webhook_existing_payment",
        { afterStages: 1 },
      ],
      ...lockCalls(booking, [1, 2]),
      ["runReservationEffects", [], { afterStages: 3 }],
      ...(await confirmationCalls(booking, 3)),
      completedLog(booking, { claimed: false, reservationConfirmed: true }),
    ]);
  });
});
