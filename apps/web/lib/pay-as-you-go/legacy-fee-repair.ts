import {
  and,
  eq,
  exists,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  ne,
  not,
  notExists,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import {
  BILLABLE_RESERVATION_STATUSES,
  db,
  isFeeVoidingReservationStatus,
  payAsYouGoInvoices,
  paymentRequests,
  payments,
  platformFees,
  reservationActivity,
  reservations,
  subscriptions,
} from "@louez/db";

import { isBillingEnabled } from "@/lib/billing/mode";
import { log } from "@/lib/evlog";

import { firstUnbilledMonthStart } from "./billing-core";
import {
  legacyFeeReportWindow,
  summarizeLegacyFeeCandidates,
  type LegacyFeeCandidate,
  type LegacyFeeCandidateGroup,
  type LegacyFeeCounts,
  type LegacyFeeKind,
} from "./legacy-fee-repair-core";
import { billingMonthOf } from "./metering";

type PlatformFeeSource = (typeof platformFees.$inferSelect)["source"];

/** The rows recordReservationFee takes as recorded, in any status. */
const RESERVATION_FEE_SOURCES: PlatformFeeSource[] = ["online", "manual", "free"];
/** The rows recordMarketplaceFee takes as recorded, in any status. */
const MARKETPLACE_FEE_SOURCES: PlatformFeeSource[] = [
  "marketplace_online",
  "marketplace_manual",
  "marketplace_waived",
];
const FEE_VOIDING_STATUSES = reservations.status.enumValues.filter(isFeeVoidingReservationStatus);

/** One log event per kind and class found. */
export type LegacyFeeReportEvent = {
  payg: {
    event: "legacy_fee_candidates";
    window: { from: string; to: string };
  } & LegacyFeeCandidateGroup;
};

export interface LegacyFeeReportLog {
  info(event: LegacyFeeReportEvent): void;
  warn(event: LegacyFeeReportEvent): void;
}

export type LegacyFeeReport =
  | { reported: false; reason: "billing_off" }
  | { reported: true; window: { from: string; to: string }; counts: LegacyFeeCounts };

/** A condition read as a boolean. MySQL returns 0 or 1. */
const flag = (condition: SQL) => sql<boolean>`${condition}`.mapWith((value) => Number(value) === 1);

/** drizzle's `or` may return undefined, which `flag` cannot take. */
const either = (first: SQL, second: SQL) => sql`(${first} OR ${second})`;

/**
 * A date bound as drizzle binds a timestamp column. A bare Date in `sql` goes to
 * the driver as local time.
 */
const timestampParam = (date: Date) => sql.param(date, reservations.updatedAt);

const one = { one: sql`1` };

/** A query row, with the flags its kind reads. */
interface CandidateRow {
  reservationId: string;
  storeId: string;
  at: Date | null;
  modeChanged?: boolean;
  ownedByWebhook?: boolean;
  openSession?: boolean;
  monthClosed: boolean;
}

function toCandidates(kind: LegacyFeeKind, rows: readonly CandidateRow[]): LegacyFeeCandidate[] {
  return rows.flatMap(({ reservationId, storeId, at, ...row }) =>
    at
      ? [
          {
            kind,
            reservationId,
            storeId,
            at,
            flags: {
              modeChanged: row.modeChanged ?? false,
              ownedByWebhook: row.ownedByWebhook ?? false,
              openSession: row.openSession ?? false,
              monthClosed: row.monthClosed,
            },
          },
        ]
      : [],
  );
}

/**
 * Lists the fee effects of the last two months that may have been lost: fees
 * never recorded (A, B) and fees never voided (V), each with a class that says
 * why it may be fine. Counts go in the result, ids in the log, `missed` at warn.
 * It writes nothing. Without billing, it returns before any database call.
 */
export async function reportLegacyFees(
  now: Date,
  options: { log?: LegacyFeeReportLog } = {},
): Promise<LegacyFeeReport> {
  if (!isBillingEnabled()) return { reported: false, reason: "billing_off" };
  const logger = options.log ?? log;
  const window = legacyFeeReportWindow(now);
  const unbilledFrom = firstUnbilledMonthStart(now);

  const hasFee = (sources: PlatformFeeSource[]) =>
    exists(
      db
        .select(one)
        .from(platformFees)
        .where(
          and(
            eq(platformFees.reservationId, reservations.id),
            inArray(platformFees.source, sources),
          ),
        ),
    );

  const billableInWindow = and(
    inArray(reservations.status, [...BILLABLE_RESERVATION_STATUSES]),
    gte(reservations.billableAt, window.from),
    lt(reservations.billableAt, window.to),
  );

  // The Connect webhook records the fee of a Stripe rental payment, with the
  // collected amount.
  const ownedByWebhook = flag(
    exists(
      db
        .select(one)
        .from(payments)
        .where(
          and(
            eq(payments.reservationId, reservations.id),
            eq(payments.type, "rental"),
            eq(payments.method, "stripe"),
            inArray(payments.status, ["pending", "completed"]),
          ),
        ),
    ),
  );

  // A rental payment request and an extension checkout take the pay-as-you-go
  // fee at source while no fee row exists, never the marketplace fee. A manual
  // fee billed first would be paid twice. A session that expired in the last 15
  // minutes may still have been paid: its webhook or the extension reconcile may
  // not have run yet.
  const sessionsOpenAt = window.to;
  const openSession = flag(
    either(
      exists(
        db
          .select(one)
          .from(paymentRequests)
          .where(
            and(
              eq(paymentRequests.reservationId, reservations.id),
              eq(paymentRequests.type, "rental"),
              eq(paymentRequests.status, "pending"),
              gt(paymentRequests.expiresAt, sessionsOpenAt),
            ),
          ),
      ),
      exists(
        db
          .select(one)
          .from(reservationActivity)
          .where(
            and(
              eq(reservationActivity.reservationId, reservations.id),
              eq(reservationActivity.activityType, "modified"),
              sql`JSON_UNQUOTE(JSON_EXTRACT(${reservationActivity.metadata}, '$.kind')) = 'rental_extension'`,
              sql`JSON_UNQUOTE(JSON_EXTRACT(${reservationActivity.metadata}, '$.status')) = 'checkout'`,
              // Its Stripe session expires at expiresMs (extension-service.ts).
              sql`CAST(JSON_UNQUOTE(JSON_EXTRACT(${reservationActivity.metadata}, '$.expiresMs')) AS UNSIGNED) > ${sessionsOpenAt.getTime()}`,
            ),
          ),
      ),
    ),
  );

  // The month recordReservationFee would use, billingMonthOf(billable_at), is
  // closed once its run has started: a fee recorded since does not make its
  // store due for that month (monthlyBillingStoreIds). A store that was due is
  // billed by the run, or by the cron's catch-up on a later call, long before
  // this report: only one the catch-up keeps failing on, with an error logged
  // on every call, could still bill such a fee. An invoice row for the month
  // closes it too. DATE_FORMAT reads the session time zone, as drizzle's
  // timestamp reads do.
  const billableMonthClosed = flag(
    either(
      lt(reservations.billableAt, unbilledFrom),
      exists(
        db
          .select(one)
          .from(payAsYouGoInvoices)
          .where(
            and(
              eq(payAsYouGoInvoices.storeId, reservations.storeId),
              eq(
                payAsYouGoInvoices.billingMonth,
                sql`DATE_FORMAT(${reservations.billableAt}, '%Y-%m')`,
              ),
            ),
          ),
      ),
    ),
  );

  // A: pay-as-you-go stores, and stores with no subscription row, which
  // recordReservationFee also charges as pay-as-you-go.
  const records = await db
    .select({
      reservationId: reservations.id,
      storeId: reservations.storeId,
      at: reservations.billableAt,
      // Leaving a plan sets updated_at. Other updates do too: they can only hide a candidate.
      modeChanged: flag(gte(subscriptions.updatedAt, reservations.billableAt)),
      ownedByWebhook,
      openSession,
      monthClosed: billableMonthClosed,
    })
    .from(reservations)
    .leftJoin(subscriptions, eq(subscriptions.storeId, reservations.storeId))
    .where(
      and(
        billableInWindow,
        or(eq(subscriptions.billingMode, "pay_as_you_go"), isNull(subscriptions.id)),
        not(hasFee(RESERVATION_FEE_SOURCES)),
      ),
    );

  // B: on any store. The marketplace fee does not depend on pay-as-you-go.
  const marketplaceFees = await db
    .select({
      reservationId: reservations.id,
      storeId: reservations.storeId,
      at: reservations.billableAt,
      ownedByWebhook,
      monthClosed: billableMonthClosed,
    })
    .from(reservations)
    .where(
      and(
        billableInWindow,
        eq(reservations.source, "marketplace"),
        not(hasFee(MARKETPLACE_FEE_SOURCES)),
      ),
    );

  // V: a fee voidReservationFee would void. It finds the fees by key: a cloned
  // store's rows have other keys, and it would never void them.
  const voidableFee = and(
    eq(platformFees.reservationId, reservations.id),
    or(
      eq(platformFees.dedupKey, sql`CONCAT('res:', ${reservations.id})`),
      eq(platformFees.dedupKey, sql`CONCAT('mkt:', ${reservations.id})`),
    ),
    ne(platformFees.status, "voided"),
    or(
      eq(platformFees.status, "pending"),
      inArray(platformFees.source, ["free", "marketplace_waived"]),
    ),
  );
  const withdrawalTime =
    sql<Date>`COALESCE(${reservations.withdrawnAt}, ${reservations.updatedAt})`.mapWith(
      reservations.updatedAt,
    );
  const voids = await db
    .select({
      reservationId: reservations.id,
      storeId: reservations.storeId,
      at: withdrawalTime,
      // Closed when none of those fees is in a month still open: one the monthly
      // run has not passed yet, with no invoice row for this store.
      monthClosed: flag(
        notExists(
          db
            .select(one)
            .from(platformFees)
            .where(
              and(
                voidableFee,
                gte(platformFees.billingMonth, billingMonthOf(unbilledFrom)),
                notExists(
                  db
                    .select(one)
                    .from(payAsYouGoInvoices)
                    .where(
                      and(
                        eq(payAsYouGoInvoices.storeId, platformFees.storeId),
                        eq(payAsYouGoInvoices.billingMonth, platformFees.billingMonth),
                      ),
                    ),
                ),
              ),
            ),
        ),
      ),
    })
    .from(reservations)
    .where(
      and(
        inArray(reservations.status, FEE_VOIDING_STATUSES),
        gte(withdrawalTime, timestampParam(window.from)),
        lt(withdrawalTime, timestampParam(window.to)),
        exists(db.select(one).from(platformFees).where(voidableFee)),
      ),
    );

  const candidates = [
    ...toCandidates("record", records),
    ...toCandidates("marketplace", marketplaceFees),
    ...toCandidates("void", voids),
  ];

  const { counts, groups } = summarizeLegacyFeeCandidates(candidates);
  const reportWindow = { from: window.from.toISOString(), to: window.to.toISOString() };
  for (const group of groups) {
    const event: LegacyFeeReportEvent = {
      payg: { event: "legacy_fee_candidates", window: reportWindow, ...group },
    };
    if (group.class === "missed") logger.warn(event);
    else logger.info(event);
  }

  return { reported: true, window: reportWindow, counts };
}
