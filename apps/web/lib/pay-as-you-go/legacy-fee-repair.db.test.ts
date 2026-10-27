import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import type { ReservationBillingEffect, ReservationStatus } from "@louez/db";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type {
  LegacyFeeReport,
  LegacyFeeReportEvent,
  LegacyFeeReportLog,
} from "./legacy-fee-repair";

// The nightly report and the billable_at check on a migrated database: what each
// kind and class catches, the window, and that nothing is written.
process.env.LOUEZ_BILLING = "cloud";

/** The 1st at 04:45 UTC, before the monthly run: February is still open. The window ends at 04:30. */
const BEFORE_RUN = new Date("2026-03-01T04:45:00Z");
/** The 2nd: the monthly run has billed February, for every store. */
const AFTER_RUN = new Date("2026-03-02T04:45:00Z");

const PAYG = "store_rep_payg";
/** Left a plan for pay-as-you-go on 20 February. */
const SWITCHED = "store_rep_switched";
const PLAN = "store_rep_plan";
/** February is invoiced. */
const CLOSED = "store_rep_closed";
/** No subscription row: recordReservationFee charges it as pay-as-you-go, and the monthly run skips it. */
const NO_ROW = "store_rep_no_row";
const FLOW = "store_rep_flow";

const TABLES = [
  "reservations",
  "platform_fee",
  "subscriptions",
  "payments",
  "payment_requests",
  "reservation_activity",
  "pay_as_you_go_invoices",
];

describe(
  "legacy fee report and billable_at check (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let repair: typeof import("./legacy-fee-repair");
    let counter = 0;
    /** Ids are varchar(21). */
    const nextId = (prefix: string) => `${prefix}_${++counter}`;

    before(async () => {
      database = await createTestDatabase("legacy_fee_report");
      // DATABASE_URL now points at the test database.
      louezDb = await import("@louez/db");
      repair = await import("./legacy-fee-repair");

      const pricing = {
        payAsYouGoConfig: { flatRateCents: 123 },
        pricingVersion: "payg-ladder-v1",
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      } as const;
      await louezDb.db.insert(louezDb.subscriptions).values([
        { id: "sub_rep_payg", storeId: PAYG, billingMode: "pay_as_you_go", ...pricing },
        {
          id: "sub_rep_switched",
          storeId: SWITCHED,
          billingMode: "pay_as_you_go",
          ...pricing,
          updatedAt: new Date("2026-02-20T00:00:00Z"),
        },
        {
          id: "sub_rep_plan",
          storeId: PLAN,
          planSlug: "pro",
          billingMode: "subscription",
          ...pricing,
        },
        { id: "sub_rep_closed", storeId: CLOSED, billingMode: "pay_as_you_go", ...pricing },
        { id: "sub_rep_flow", storeId: FLOW, billingMode: "pay_as_you_go", ...pricing },
      ]);
      await louezDb.db.insert(louezDb.payAsYouGoInvoices).values([
        { id: "inv_rep_closed_feb", storeId: CLOSED, billingMonth: "2026-02" },
        { id: "inv_rep_payg_jan", storeId: PAYG, billingMonth: "2026-01" },
      ]);
    });

    after(async () => {
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    async function reservation(
      id: string,
      storeId: string,
      status: ReservationStatus,
      dates: { billableAt?: string; withdrawnAt?: string; updatedAt?: string } = {},
      source = "online",
    ) {
      const updatedAt = dates.updatedAt ?? dates.withdrawnAt ?? dates.billableAt;
      // A fixture, so it may start in any status, with any dates.
      await louezDb.db.insert(louezDb.reservations).values({
        id,
        storeId,
        customerId: "customer",
        number: id,
        status,
        startDate: new Date("2026-03-10T09:00:00Z"),
        endDate: new Date("2026-03-12T09:00:00Z"),
        subtotalAmount: "10.00",
        depositAmount: "0.00",
        totalAmount: "10.00",
        source,
        billableAt: dates.billableAt ? new Date(dates.billableAt) : null,
        withdrawnAt: dates.withdrawnAt ? new Date(dates.withdrawnAt) : null,
        createdAt: new Date("2026-01-05T00:00:00Z"),
        updatedAt: new Date(updatedAt ?? "2026-01-05T00:00:00Z"),
      });
    }

    type Fee = typeof louezDb.platformFees.$inferInsert;
    async function fee(
      reservationId: string,
      storeId: string,
      source: Fee["source"],
      status: Fee["status"],
      billingMonth = "2026-02",
      dedupKey = `${source.startsWith("marketplace_") ? "mkt" : "res"}:${reservationId}`,
    ) {
      await louezDb.db.insert(louezDb.platformFees).values({
        id: nextId("fee"),
        storeId,
        reservationId,
        dedupKey,
        amountCents: 0,
        source,
        status,
        billingMonth,
      });
    }

    async function payment(
      reservationId: string,
      method: "stripe" | "cash",
      status: "pending" | "completed" | "failed",
    ) {
      await louezDb.db.insert(louezDb.payments).values({
        id: nextId("pay"),
        reservationId,
        amount: "10.00",
        type: "rental",
        method,
        status,
      });
    }

    async function paymentRequest(
      reservationId: string,
      storeId: string,
      type: "rental" | "custom",
      expiresAt: string,
    ) {
      const id = nextId("req");
      await louezDb.db.insert(louezDb.paymentRequests).values({
        id,
        storeId,
        reservationId,
        token: id,
        amount: "10.00",
        description: "Rental",
        type,
        status: "pending",
        expiresAt: new Date(expiresAt),
      });
    }

    async function extensionAttempt(reservationId: string, expiresAt: string) {
      await louezDb.db.insert(louezDb.reservationActivity).values({
        id: nextId("act"),
        reservationId,
        activityType: "modified",
        metadata: {
          kind: "rental_extension",
          status: "checkout",
          expiresMs: Date.parse(expiresAt),
        },
      });
    }

    function collectingLog() {
      const events: { level: "info" | "warn"; event: LegacyFeeReportEvent }[] = [];
      const log: LegacyFeeReportLog = {
        info: (event) => events.push({ level: "info", event }),
        warn: (event) => events.push({ level: "warn", event }),
      };
      /** Each logged group as `level kind:class`, with its ids sorted. */
      const groups = () =>
        Object.fromEntries(
          events.map(({ level, event }) => [
            `${level} ${event.payg.kind}:${event.payg.class}`,
            event.payg.candidates.map((candidate) => candidate.reservationId).sort(),
          ]),
        );
      /** The `kind:class` entries that list this reservation. */
      const classesOf = (reservationId: string) =>
        events
          .filter(({ event }) =>
            event.payg.candidates.some((candidate) => candidate.reservationId === reservationId),
          )
          .map(({ event }) => `${event.payg.kind}:${event.payg.class}`)
          .sort();
      return { log, events, groups, classesOf };
    }

    async function checksums() {
      const connection = await database.connect();
      try {
        const [rows] = await connection.query(`CHECKSUM TABLE ${TABLES.join(", ")}`);
        return rows;
      } finally {
        await connection.end();
      }
    }

    test("lists each kind and class in the window, and writes nothing", async () => {
      // A: pay-as-you-go fees never recorded.
      await reservation("rep_a_missed", PAYG, "confirmed", { billableAt: "2026-02-10T09:00:00Z" });
      await reservation("rep_a_first", PAYG, "confirmed", { billableAt: "2026-02-01T00:00:00Z" });
      await reservation("rep_a_march", PAYG, "completed", { billableAt: "2026-03-01T02:00:00Z" });
      await reservation("rep_a_voided_fee", PAYG, "confirmed", {
        billableAt: "2026-02-11T09:00:00Z",
      });
      await fee("rep_a_voided_fee", PAYG, "manual", "voided");
      await reservation("rep_a_before_switch", SWITCHED, "confirmed", {
        billableAt: "2026-02-15T09:00:00Z",
      });
      await reservation("rep_a_after_switch", SWITCHED, "confirmed", {
        billableAt: "2026-02-25T09:00:00Z",
      });
      await reservation("rep_a_webhook", PAYG, "ongoing", { billableAt: "2026-02-12T09:00:00Z" });
      await payment("rep_a_webhook", "stripe", "pending");
      await reservation("rep_a_cash", PAYG, "confirmed", { billableAt: "2026-02-12T12:00:00Z" });
      await payment("rep_a_cash", "cash", "completed");
      // A failed Stripe payment records nothing.
      await reservation("rep_a_failed_payment", PAYG, "confirmed", {
        billableAt: "2026-02-12T15:00:00Z",
      });
      await payment("rep_a_failed_payment", "stripe", "failed");
      await reservation("rep_a_request", PAYG, "confirmed", { billableAt: "2026-02-13T09:00:00Z" });
      await paymentRequest("rep_a_request", PAYG, "rental", "2026-03-05T00:00:00Z");
      // An expired rental request and a custom charge take no fee.
      await reservation("rep_a_stale_request", PAYG, "confirmed", {
        billableAt: "2026-02-14T09:00:00Z",
      });
      await paymentRequest("rep_a_stale_request", PAYG, "rental", "2026-03-01T00:00:00Z");
      await paymentRequest("rep_a_stale_request", PAYG, "custom", "2026-03-05T00:00:00Z");
      await reservation("rep_a_extension", PAYG, "confirmed", {
        billableAt: "2026-02-16T09:00:00Z",
      });
      await extensionAttempt("rep_a_extension", "2026-03-01T05:00:00Z");
      // Expired 5 minutes ago: it may still have been paid, so it stays open 15 minutes.
      await reservation("rep_a_ext_grace", PAYG, "confirmed", {
        billableAt: "2026-02-16T10:00:00Z",
      });
      await extensionAttempt("rep_a_ext_grace", "2026-03-01T04:40:00Z");
      // Expired, and never closed by the extension reconcile.
      await reservation("rep_a_ext_expired", PAYG, "confirmed", {
        billableAt: "2026-02-16T11:00:00Z",
      });
      await extensionAttempt("rep_a_ext_expired", "2026-03-01T04:00:00Z");
      await reservation("rep_a_closed", CLOSED, "confirmed", {
        billableAt: "2026-02-17T09:00:00Z",
      });
      await reservation("rep_a_closed_march", CLOSED, "confirmed", {
        billableAt: "2026-03-01T03:00:00Z",
      });
      await reservation("rep_a_no_row", NO_ROW, "confirmed", {
        billableAt: "2026-02-10T10:00:00Z",
      });
      // Not candidates: a plan store, outside the window, no billable_at, pending.
      await reservation("rep_a_plan", PLAN, "confirmed", { billableAt: "2026-02-10T11:00:00Z" });
      await reservation("rep_a_january", PAYG, "confirmed", {
        billableAt: "2026-01-31T23:59:59Z",
      });
      await reservation("rep_a_last_minutes", PAYG, "confirmed", {
        billableAt: "2026-03-01T04:40:00Z",
      });
      await reservation("rep_a_undated", PAYG, "ongoing");
      await reservation("rep_a_pending", PAYG, "pending");

      // B: marketplace fees never recorded, on any store.
      await reservation(
        "rep_b_plan",
        PLAN,
        "confirmed",
        { billableAt: "2026-02-18T09:00:00Z" },
        "marketplace",
      );
      await reservation(
        "rep_b_payg",
        PAYG,
        "confirmed",
        { billableAt: "2026-02-19T12:00:00Z" },
        "marketplace",
      );
      await reservation(
        "rep_b_recorded",
        PAYG,
        "confirmed",
        { billableAt: "2026-02-19T09:00:00Z" },
        "marketplace",
      );
      await fee("rep_b_recorded", PAYG, "manual", "pending");
      await fee("rep_b_recorded", PAYG, "marketplace_manual", "pending");
      await reservation(
        "rep_b_webhook",
        PLAN,
        "confirmed",
        { billableAt: "2026-02-20T09:00:00Z" },
        "marketplace",
      );
      await payment("rep_b_webhook", "stripe", "completed");
      await reservation(
        "rep_b_closed",
        CLOSED,
        "confirmed",
        { billableAt: "2026-02-21T09:00:00Z" },
        "marketplace",
      );
      await fee("rep_b_closed", CLOSED, "manual", "pending");
      // Payment requests and extensions never take the marketplace fee.
      await reservation(
        "rep_b_open_sessions",
        PLAN,
        "confirmed",
        { billableAt: "2026-02-22T09:00:00Z" },
        "marketplace",
      );
      await paymentRequest("rep_b_open_sessions", PLAN, "rental", "2026-03-05T00:00:00Z");
      await extensionAttempt("rep_b_open_sessions", "2026-03-01T05:00:00Z");

      // V: fees never voided after a withdrawal.
      await reservation("rep_v_missed", PAYG, "cancelled", { withdrawnAt: "2026-02-20T09:00:00Z" });
      await fee("rep_v_missed", PAYG, "manual", "pending");
      // Never billable: no withdrawal date, so the last update dates it.
      await reservation("rep_v_free", PAYG, "rejected", { updatedAt: "2026-02-21T09:00:00Z" });
      await fee("rep_v_free", PAYG, "free", "collected");
      await reservation("rep_v_declined", PAYG, "declined", { updatedAt: "2026-02-22T09:00:00Z" });
      await fee("rep_v_declined", PAYG, "marketplace_waived", "collected");
      await reservation("rep_v_collected", PAYG, "cancelled", {
        withdrawnAt: "2026-02-20T10:00:00Z",
      });
      await fee("rep_v_collected", PAYG, "online", "collected");
      await reservation("rep_v_voided", PAYG, "cancelled", { withdrawnAt: "2026-02-20T11:00:00Z" });
      await fee("rep_v_voided", PAYG, "manual", "voided");
      await reservation("rep_v_free_voided", PAYG, "rejected", {
        updatedAt: "2026-02-21T10:00:00Z",
      });
      await fee("rep_v_free_voided", PAYG, "free", "voided");
      // A cloned store's fee keeps its reservation but not its key.
      await reservation("rep_v_cloned", PAYG, "cancelled", { withdrawnAt: "2026-02-20T12:00:00Z" });
      await fee("rep_v_cloned", PAYG, "manual", "pending", "2026-02", `${PAYG}:fee_cloned`);
      await reservation("rep_v_closed", PAYG, "cancelled", { withdrawnAt: "2026-02-23T09:00:00Z" });
      await fee("rep_v_closed", PAYG, "manual", "pending", "2026-01");
      await reservation("rep_v_one_open", PAYG, "cancelled", {
        withdrawnAt: "2026-02-24T09:00:00Z",
      });
      await fee("rep_v_one_open", PAYG, "manual", "pending", "2026-01");
      await fee("rep_v_one_open", PAYG, "marketplace_manual", "pending", "2026-02");
      // Withdrawn in January, edited since: the withdrawal dates it.
      await reservation("rep_v_january", PAYG, "cancelled", {
        withdrawnAt: "2026-01-20T09:00:00Z",
        updatedAt: "2026-02-25T09:00:00Z",
      });
      await fee("rep_v_january", PAYG, "manual", "pending");
      // Near both ends of the window, where a date bound in local time would shift it.
      await reservation("rep_v_late", PAYG, "cancelled", { withdrawnAt: "2026-03-01T04:20:00Z" });
      await fee("rep_v_late", PAYG, "manual", "pending", "2026-03");
      await reservation("rep_v_too_late", PAYG, "cancelled", {
        withdrawnAt: "2026-03-01T04:35:00Z",
      });
      await fee("rep_v_too_late", PAYG, "manual", "pending", "2026-03");
      await reservation("rep_v_too_early", PAYG, "cancelled", {
        withdrawnAt: "2026-01-31T23:30:00Z",
      });
      await fee("rep_v_too_early", PAYG, "manual", "pending");

      const before = await checksums();
      const { log, events, groups } = collectingLog();
      const report = await repair.reportLegacyFees(BEFORE_RUN, { log });

      assert.deepEqual(report, {
        reported: true,
        window: { from: "2026-02-01T00:00:00.000Z", to: "2026-03-01T04:30:00.000Z" },
        counts: {
          record: {
            mode_changed: 1,
            owned_by_webhook: 1,
            open_session: 3,
            month_closed: 1,
            missed: 11,
          },
          marketplace: { owned_by_webhook: 1, month_closed: 1, missed: 3 },
          void: { month_closed: 1, missed: 5 },
        },
      } satisfies LegacyFeeReport);
      assert.deepEqual(groups(), {
        "warn record:missed": [
          "rep_a_after_switch",
          "rep_a_cash",
          "rep_a_closed_march",
          "rep_a_ext_expired",
          "rep_a_failed_payment",
          "rep_a_first",
          "rep_a_march",
          "rep_a_missed",
          "rep_a_no_row",
          "rep_a_stale_request",
          "rep_b_payg",
        ],
        "info record:mode_changed": ["rep_a_before_switch"],
        "info record:owned_by_webhook": ["rep_a_webhook"],
        "info record:open_session": ["rep_a_ext_grace", "rep_a_extension", "rep_a_request"],
        "info record:month_closed": ["rep_a_closed"],
        "warn marketplace:missed": ["rep_b_open_sessions", "rep_b_payg", "rep_b_plan"],
        "info marketplace:owned_by_webhook": ["rep_b_webhook"],
        "info marketplace:month_closed": ["rep_b_closed"],
        "warn void:missed": [
          "rep_v_declined",
          "rep_v_free",
          "rep_v_late",
          "rep_v_missed",
          "rep_v_one_open",
        ],
        "info void:month_closed": ["rep_v_closed"],
      });

      const logged = events.flatMap(({ event }) => event.payg.candidates);
      assert.deepEqual(
        logged.find((candidate) => candidate.reservationId === "rep_a_missed"),
        { reservationId: "rep_a_missed", storeId: PAYG, at: "2026-02-10T09:00:00.000Z" },
      );
      assert.deepEqual(
        logged.find((candidate) => candidate.reservationId === "rep_v_free"),
        { reservationId: "rep_v_free", storeId: PAYG, at: "2026-02-21T09:00:00.000Z" },
      );
      // The cron puts the result in its HTTP response: counts only.
      assert.doesNotMatch(JSON.stringify(report), /rep_/);

      // February's run has started: a fee recorded now is not billed in February,
      // even for a store with no invoice row, which was not due then (no
      // subscription row, no fee pending). March stays open.
      const afterRun = collectingLog();
      await repair.reportLegacyFees(AFTER_RUN, { log: afterRun.log });
      const expectedAfterRun: Record<string, string[]> = {
        rep_a_no_row: ["record:month_closed"],
        rep_a_missed: ["record:month_closed"],
        rep_a_before_switch: ["record:mode_changed"],
        rep_a_request: ["record:open_session"],
        // Expired since.
        rep_a_extension: ["record:month_closed"],
        rep_b_payg: ["marketplace:month_closed", "record:month_closed"],
        rep_b_plan: ["marketplace:month_closed"],
        rep_v_missed: ["void:month_closed"],
        rep_v_one_open: ["void:month_closed"],
        rep_a_march: ["record:missed"],
        rep_a_last_minutes: ["record:missed"],
        rep_v_late: ["void:missed"],
        rep_v_too_late: ["void:missed"],
      };
      for (const [reservationId, classes] of Object.entries(expectedAfterRun)) {
        assert.deepEqual(afterRun.classesOf(reservationId), classes, reservationId);
      }

      assert.deepEqual(await checksums(), before, "the report wrote nothing");
    });

    test("a confirmation or a cancellation whose effects were lost is listed until they run", async () => {
      const runner = await import("@/lib/billing/reservation-effects");
      const id = "rep_flow";
      await reservation(id, FLOW, "pending");

      const change = async (to: ReservationStatus, now: string) => {
        const result = await louezDb.db.transaction((tx) =>
          louezDb.changeReservationStatus(tx, {
            reservationId: id,
            storeId: FLOW,
            to,
            actor: "ai_chat",
            actorUserId: null,
            now: new Date(now),
          }),
        );
        if (!result.changed) throw new Error(`${id} did not move to ${to}: ${result.reason}`);
        return result.effects;
      };
      const classesNow = async () => {
        const { log, classesOf } = collectingLog();
        await repair.reportLegacyFees(BEFORE_RUN, { log });
        return classesOf(id);
      };
      const runEffects = async (effects: readonly ReservationBillingEffect[]) => {
        const errors: string[] = [];
        await runner.createLegacyFeeEffectRunner({
          log: { error: (_tag, message) => errors.push(message), info: () => undefined },
        })(effects);
        assert.deepEqual(errors, []);
      };

      const confirmation = await change("confirmed", "2026-02-26T10:00:00Z");
      assert.deepEqual(await classesNow(), ["record:missed"]);
      await runEffects(confirmation);
      assert.deepEqual(await classesNow(), []);

      const cancellation = await change("cancelled", "2026-02-27T10:00:00Z");
      assert.deepEqual(await classesNow(), ["void:missed"]);
      await runEffects(cancellation);
      assert.deepEqual(await classesNow(), []);
    });

    test("the billable_at check counts billable reservations without the date", async () => {
      const { checkBillableAt } = await import("@/lib/billing/billable-at-check");
      const errors: string[] = [];
      const check = () =>
        checkBillableAt({ log: { error: (_tag, message) => errors.push(message) } });

      const { missing: before } = await check();
      errors.length = 0;
      await reservation("rep_inv_undated", PAYG, "completed");
      await reservation("rep_inv_cancelled", PAYG, "cancelled");
      await reservation("rep_inv_dated", PAYG, "confirmed", { billableAt: "2026-02-10T09:00:00Z" });

      const { missing } = await check();
      assert.equal(missing, before + 1);
      assert.equal(errors.length, 1);
      assert.match(
        errors[0] ?? "",
        new RegExp(`^${missing} billable reservations have no billable_at`),
      );
    });
  },
);
