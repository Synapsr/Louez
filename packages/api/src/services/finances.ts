import { ORPCError } from "@orpc/server";
import { and, asc, count, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";

import {
  customers,
  db,
  invoicePayments,
  invoices,
  isStripeRefundPaymentSql,
  payments,
  reservations,
} from "@louez/db";
import {
  classifyPaymentMovement,
  getFinanceDayBounds,
  getFinanceDayKey,
  getFinanceGrowth,
  getFinanceWindow,
  getPaymentMovementNature,
  resolveFinanceTimezone,
  type FinancePeriodInput,
  type FinanceWindow,
} from "@louez/utils";
import type {
  FinanceDepositsOutput,
  FinanceMovement,
  FinanceMovementDetail,
  FinanceMovementFilters,
  FinanceMovementStatus,
  FinanceMovementsOutput,
  FinanceOutstandingOutput,
  FinanceSummary,
} from "@louez/validations";

/**
 * Cash ledger of a store (dashboard → Finances).
 *
 * The rule lives in `classifyPaymentMovement` (`@louez/utils`); the fragments
 * below are the same rule in SQL so totals never load rows. `payments` has no
 * `storeId`: every query joins `reservations` and filters on its store.
 */

const DEFAULT_PAGE_SIZE = 25;
const DEPOSIT_LIST_LIMIT = 100;
const DEPOSIT_HISTORY_LIMIT = 20;
/** A till-closing sheet longer than this is an export, not a printout. */
const RECAP_ROW_LIMIT = 1000;

type OutstandingStatus = FinanceOutstandingOutput["reservations"][number]["status"];
const OUTSTANDING_STATUSES: OutstandingStatus[] = ["confirmed", "ongoing", "completed"];

const linkedRefund = alias(payments, "linked_refund");
const captureRow = alias(payments, "capture_row");

const toMoney = (value: string | number | null | undefined): number =>
  Math.round(Number(value ?? 0) * 100) / 100;

/**
 * Binds an instant the way Drizzle writes timestamps (UTC wall clock). A bare
 * `Date` in a `sql` template would be formatted in the process timezone.
 */
const at = (date: Date) => sql.param(date, payments.createdAt);

/** A payment counts on the day it was cashed in, falling back to its creation. */
const movementDateSql = sql`COALESCE(${payments.paidAt}, ${payments.createdAt})`;

const isRefundRowSql = sql`(${payments.refundOfPaymentId} IS NOT NULL OR ${isStripeRefundPaymentSql()})`;

const isMoneyBackSql = sql`(${isRefundRowSql} OR ${payments.type} = 'deposit_return')`;

/** After a capture, the hold and the capture both carry money: the capture wins. */
const depositCapturedSql = sql`EXISTS (
  SELECT 1 FROM ${payments} AS ${captureRow}
  WHERE ${captureRow.reservationId} = ${payments.reservationId}
    AND ${captureRow.type} = 'deposit_capture'
    AND ${captureRow.status} = 'completed'
)`;

const isCountedSql = sql`(
  ${payments.status} IN ('completed', 'refunded')
  AND NOT (${payments.type} = 'deposit_hold' AND ${payments.status} = 'completed' AND ${depositCapturedSql})
)`;

/** What the webhook took off a Stripe charge, added back to read it gross. */
const linkedStripeRefundsSql = sql`COALESCE((
  SELECT SUM(${linkedRefund.amount}) FROM ${payments} AS ${linkedRefund}
  WHERE ${linkedRefund.refundOfPaymentId} = ${payments.id}
    AND ${linkedRefund.status} = 'completed'
    AND ${isStripeRefundPaymentSql(linkedRefund)}
), 0)`;

/** Positive came in, negative went out. Only Stripe charges can have Stripe refunds to add back. */
const signedAmountSql = sql`(CASE
  WHEN ${isMoneyBackSql} THEN -ABS(${payments.amount})
  WHEN ${payments.method} = 'stripe' THEN ${payments.amount} + ${linkedStripeRefundsSql}
  ELSE ${payments.amount} END)`;

const moneyInSql = sql<string>`COALESCE(SUM(CASE WHEN ${signedAmountSql} > 0 THEN ${signedAmountSql} ELSE 0 END), 0)`;
const moneyOutSql = sql<string>`COALESCE(SUM(CASE WHEN ${signedAmountSql} < 0 THEN -${signedAmountSql} ELSE 0 END), 0)`;

const customerNameSql = sql<string>`TRIM(CONCAT(COALESCE(${customers.firstName}, ''), ' ', COALESCE(${customers.lastName}, '')))`;

const inWindow = (start: Date, end: Date) => [
  sql`${movementDateSql} >= ${at(start)}`,
  sql`${movementDateSql} < ${at(end)}`,
];

const LEDGER_STATUS: Record<string, FinanceMovementStatus> = {
  completed: "settled",
  refunded: "settled",
  pending: "pending",
  authorized: "held",
  failed: "failed",
  cancelled: "cancelled",
};

const statusCondition = (status: FinanceMovementStatus | undefined) => {
  switch (status) {
    case "settled":
      return isCountedSql;
    case "pending":
      return eq(payments.status, "pending");
    case "held":
      return eq(payments.status, "authorized");
    case "failed":
      return eq(payments.status, "failed");
    case "cancelled":
      return eq(payments.status, "cancelled");
    default:
      // What a till reads: cash that moved, plus what is on its way.
      return sql`(${isCountedSql} OR ${payments.status} IN ('pending', 'authorized'))`;
  }
};

const natureCondition = (nature: FinanceMovementFilters["nature"]) => {
  if (!nature) return undefined;
  if (nature === "deposit_return") return eq(payments.type, "deposit_return");
  if (nature === "refund") return sql`(${isRefundRowSql} AND ${payments.type} <> 'deposit_return')`;
  return sql`(${payments.type} = ${nature} AND NOT ${isRefundRowSql})`;
};

const searchCondition = (search: string | undefined) => {
  const term = search?.trim();
  if (!term) return undefined;
  const pattern = `%${term}%`;
  return or(
    like(reservations.number, pattern),
    like(customers.firstName, pattern),
    like(customers.lastName, pattern),
    like(customers.companyName, pattern),
    sql`CONCAT(${customers.firstName}, ' ', ${customers.lastName}) LIKE ${pattern}`,
  );
};

const movementConditions = (
  storeId: string,
  window: FinanceWindow,
  filters: FinanceMovementFilters,
) => [
  eq(reservations.storeId, storeId),
  ...inWindow(window.start, window.end),
  statusCondition(filters.status),
  filters.direction === "in" ? sql`${signedAmountSql} >= 0` : undefined,
  filters.direction === "out" ? sql`${signedAmountSql} < 0` : undefined,
  filters.method ? eq(payments.method, filters.method) : undefined,
  natureCondition(filters.nature),
  filters.minAmount === undefined
    ? undefined
    : sql`ABS(${signedAmountSql}) >= ${filters.minAmount}`,
  filters.maxAmount === undefined
    ? undefined
    : sql`ABS(${signedAmountSql}) <= ${filters.maxAmount}`,
  searchCondition(filters.search),
];

const movementColumns = {
  id: payments.id,
  type: payments.type,
  status: payments.status,
  method: payments.method,
  storedAmount: payments.amount,
  refundOfPaymentId: payments.refundOfPaymentId,
  stripeRefundId: payments.stripeRefundId,
  stripePaymentIntentId: payments.stripePaymentIntentId,
  stripeCheckoutSessionId: payments.stripeCheckoutSessionId,
  paidAt: payments.paidAt,
  createdAt: payments.createdAt,
  reservationId: reservations.id,
  reservationNumber: reservations.number,
  customerName: customerNameSql,
  linkedStripeRefunds: sql<string>`${linkedStripeRefundsSql}`,
  depositCaptured: sql<number>`${depositCapturedSql}`,
};

interface MovementRow {
  id: string;
  type: (typeof payments.type.enumValues)[number];
  status: string;
  method: (typeof payments.method.enumValues)[number];
  storedAmount: string;
  refundOfPaymentId: string | null;
  stripeRefundId: string | null;
  stripePaymentIntentId: string | null;
  stripeCheckoutSessionId: string | null;
  paidAt: Date | null;
  createdAt: Date;
  reservationId: string;
  reservationNumber: string;
  customerName: string | null;
  linkedStripeRefunds: string | number | null;
  depositCaptured: number | boolean | string | null;
}

/** Page rows go through the pure rule, so the list can never disagree with its tests. */
const toMovement = (row: MovementRow, timezone: string): FinanceMovement => {
  const payment = { ...row, amount: row.storedAmount };
  const nature = getPaymentMovementNature(payment);
  const movement = classifyPaymentMovement(payment, {
    depositCaptured: Number(row.depositCaptured) === 1 || row.depositCaptured === true,
    linkedStripeRefunds: toMoney(row.linkedStripeRefunds),
  });
  const givesBack = nature === "refund" || nature === "deposit_return";
  const amount =
    movement.kind === "settled"
      ? movement.amount
      : toMoney(Math.abs(Number(row.storedAmount))) * (givesBack ? -1 : 1);
  const date = row.paidAt ?? row.createdAt;

  return {
    id: row.id,
    date,
    dayKey: getFinanceDayKey(date, timezone),
    reservationId: row.reservationId,
    reservationNumber: row.reservationNumber,
    customerName: row.customerName?.trim() ?? "",
    nature,
    method: row.method,
    status: LEDGER_STATUS[row.status] ?? "pending",
    direction: amount < 0 ? "out" : "in",
    amount,
    counted: movement.kind === "settled",
  };
};

// ---------------------------------------------------------------------------
// Outstanding balances
// ---------------------------------------------------------------------------

/**
 * Rental balance per reservation, the reading of `getUpcomingRevenue` in the
 * sales analytics: manual refunds restored, Stripe refund rows ignored since
 * their charge is already net, deposits never counted.
 */
const buildOutstanding = (storeId: string, now: Date) => {
  const original = alias(payments, "original_payment");
  const paid = db
    .select({
      reservationId: payments.reservationId,
      amount: sql<string>`SUM(CASE
      WHEN ${isStripeRefundPaymentSql()} THEN 0
      WHEN ${payments.refundOfPaymentId} IS NULL AND ${payments.type} = 'rental' THEN ${payments.amount}
      WHEN ${original.type} = 'rental' AND ${original.status} = 'completed' THEN -${payments.amount}
      ELSE 0 END)`.as("net_paid"),
    })
    .from(payments)
    .innerJoin(reservations, eq(payments.reservationId, reservations.id))
    .leftJoin(
      original,
      and(
        eq(payments.refundOfPaymentId, original.id),
        eq(payments.reservationId, original.reservationId),
      ),
    )
    .where(
      and(
        eq(reservations.storeId, storeId),
        eq(payments.status, "completed"),
        sql`${movementDateSql} < ${at(now)}`,
      ),
    )
    .groupBy(payments.reservationId)
    .as("rental_paid");

  // Match the reservation payment form's handling of older totals that include a deposit.
  const rentalAmount = sql<string>`(CASE
    WHEN ${reservations.totalAmount} <= 0 THEN ${reservations.subtotalAmount}
    WHEN ${reservations.depositAmount} > 0 AND ${reservations.totalAmount} - ${reservations.subtotalAmount} >= ${reservations.depositAmount} - 0.01
      THEN GREATEST(0, ${reservations.totalAmount} - ${reservations.depositAmount})
    ELSE ${reservations.totalAmount} END)`;
  const paidAmount = sql<string>`GREATEST(0, COALESCE(${paid.amount}, 0))`;
  const remaining = sql<string>`GREATEST(0, ${rentalAmount} - ${paidAmount})`;
  const where = and(
    eq(reservations.storeId, storeId),
    inArray(reservations.status, OUTSTANDING_STATUSES),
    sql`${remaining} > 0`,
  );

  return { paid, rentalAmount, paidAmount, remaining, where };
};

const getOutstandingTotals = async (storeId: string, now: Date) => {
  const { paid, remaining, where } = buildOutstanding(storeId, now);
  const [row] = await db
    .select({ total: sql<string>`COALESCE(SUM(${remaining}), 0)`, reservationCount: count() })
    .from(reservations)
    .leftJoin(paid, eq(paid.reservationId, reservations.id))
    .where(where);
  return { total: toMoney(row?.total), reservationCount: Number(row?.reservationCount ?? 0) };
};

export async function getFinanceOutstanding(params: {
  storeId: string;
  now?: Date;
  page?: number;
  pageSize?: number;
}): Promise<FinanceOutstandingOutput> {
  const now = params.now ?? new Date();
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;
  const { paid, rentalAmount, paidAmount, remaining, where } = buildOutstanding(
    params.storeId,
    now,
  );

  const [rows, totals] = await Promise.all([
    db
      .select({
        id: reservations.id,
        number: reservations.number,
        status: reservations.status,
        customerName: customerNameSql,
        startDate: reservations.startDate,
        endDate: reservations.endDate,
        total: rentalAmount,
        paid: paidAmount,
        remaining,
      })
      .from(reservations)
      .leftJoin(customers, eq(reservations.customerId, customers.id))
      .leftJoin(paid, eq(paid.reservationId, reservations.id))
      .where(where)
      // The oldest rental first: it is the debt most overdue.
      .orderBy(asc(reservations.startDate), asc(reservations.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    getOutstandingTotals(params.storeId, now),
  ]);

  return {
    reservations: rows.flatMap((row) => {
      const status = OUTSTANDING_STATUSES.find((candidate) => candidate === row.status);
      if (!status) return [];
      return [
        {
          id: row.id,
          number: row.number,
          status,
          customerName: row.customerName?.trim() ?? "",
          startDate: row.startDate,
          endDate: row.endDate,
          total: toMoney(row.total),
          paid: toMoney(row.paid),
          remaining: toMoney(row.remaining),
        },
      ];
    }),
    total: totals.total,
    totalCount: totals.reservationCount,
    page,
    pageSize,
  };
}

// ---------------------------------------------------------------------------
// Deposits
// ---------------------------------------------------------------------------

const depositOriginal = alias(payments, "deposit_original");

const depositCashedSql = sql<string>`COALESCE(SUM(CASE
  WHEN ${payments.type} = 'deposit' AND NOT ${isRefundRowSql} THEN ${payments.amount}
  ELSE 0 END), 0)`;

/**
 * What was handed back against a cashed deposit. A Stripe refund row is left
 * out (it refunds a card charge, never a deposit cashed by hand), and so is the
 * refund of a capture, which gives back damage money rather than the deposit.
 */
const depositReturnedSql = sql<string>`COALESCE(SUM(CASE
  WHEN ${payments.type} = 'deposit_return'
    AND NOT ${isStripeRefundPaymentSql()}
    AND (${payments.refundOfPaymentId} IS NULL OR ${depositOriginal.type} = 'deposit')
  THEN ${payments.amount}
  ELSE 0 END), 0)`;

const depositsToReturnQuery = (storeId: string) =>
  db
    .select({
      reservationId: reservations.id,
      reservationNumber: reservations.number,
      reservationStatus: reservations.status,
      endDate: reservations.endDate,
      customerName: sql<string>`MAX(${customerNameSql})`.as("customer_name"),
      cashed: depositCashedSql.as("cashed"),
      returned: depositReturnedSql.as("returned"),
    })
    .from(payments)
    .innerJoin(reservations, eq(payments.reservationId, reservations.id))
    .leftJoin(customers, eq(reservations.customerId, customers.id))
    .leftJoin(depositOriginal, eq(payments.refundOfPaymentId, depositOriginal.id))
    .where(
      and(
        eq(reservations.storeId, storeId),
        eq(payments.status, "completed"),
        inArray(payments.type, ["deposit", "deposit_return"]),
      ),
    )
    .groupBy(reservations.id, reservations.number, reservations.status, reservations.endDate)
    .having(sql`${depositCashedSql} - ${depositReturnedSql} > 0`);

const activeHoldConditions = (storeId: string) =>
  and(
    eq(reservations.storeId, storeId),
    eq(payments.type, "deposit_hold"),
    eq(payments.status, "authorized"),
  );

const getDepositCount = async (storeId: string): Promise<number> => {
  const toReturn = depositsToReturnQuery(storeId).as("deposits_to_return");
  const [[holds], [returns]] = await Promise.all([
    db
      .select({ total: count() })
      .from(payments)
      .innerJoin(reservations, eq(payments.reservationId, reservations.id))
      .where(activeHoldConditions(storeId)),
    db.select({ total: count() }).from(toReturn),
  ]);
  return Number(holds?.total ?? 0) + Number(returns?.total ?? 0);
};

const DEPOSIT_EVENTS = {
  deposit: "cashed",
  deposit_capture: "captured",
  deposit_return: "returned",
  deposit_hold: "released",
} as const;

export async function getFinanceDeposits(params: {
  storeId: string;
}): Promise<FinanceDepositsOutput> {
  const { storeId } = params;
  // A released hold has no `paidAt`: it moved when its row was last touched.
  const historyDateSql = sql`(CASE WHEN ${payments.status} = 'cancelled' THEN ${payments.updatedAt} ELSE ${movementDateSql} END)`;

  const [holds, [holdsTotal], toReturn, history] = await Promise.all([
    db
      .select({
        paymentId: payments.id,
        amount: payments.amount,
        authorizedAt: payments.createdAt,
        expiresAt: payments.authorizationExpiresAt,
        reservationId: reservations.id,
        reservationNumber: reservations.number,
        reservationStatus: reservations.status,
        customerName: customerNameSql,
      })
      .from(payments)
      .innerJoin(reservations, eq(payments.reservationId, reservations.id))
      .leftJoin(customers, eq(reservations.customerId, customers.id))
      .where(activeHoldConditions(storeId))
      // Soonest to expire first; holds without a known expiry go last.
      .orderBy(
        sql`${payments.authorizationExpiresAt} IS NULL`,
        asc(payments.authorizationExpiresAt),
        asc(payments.id),
      )
      .limit(DEPOSIT_LIST_LIMIT),
    db
      .select({ total: sql<string>`COALESCE(SUM(${payments.amount}), 0)` })
      .from(payments)
      .innerJoin(reservations, eq(payments.reservationId, reservations.id))
      .where(activeHoldConditions(storeId)),
    depositsToReturnQuery(storeId)
      // A finished rental still holding a deposit is the one to act on.
      .orderBy(
        sql`${reservations.status} = 'completed' DESC`,
        asc(reservations.endDate),
        asc(reservations.id),
      )
      .limit(DEPOSIT_LIST_LIMIT),
    db
      .select({
        paymentId: payments.id,
        type: payments.type,
        status: payments.status,
        method: payments.method,
        amount: payments.amount,
        paidAt: payments.paidAt,
        createdAt: payments.createdAt,
        updatedAt: payments.updatedAt,
        reservationId: reservations.id,
        reservationNumber: reservations.number,
        reservationStatus: reservations.status,
        customerName: customerNameSql,
      })
      .from(payments)
      .innerJoin(reservations, eq(payments.reservationId, reservations.id))
      .leftJoin(customers, eq(reservations.customerId, customers.id))
      .where(
        and(
          eq(reservations.storeId, storeId),
          or(
            and(
              inArray(payments.type, ["deposit", "deposit_capture", "deposit_return"]),
              eq(payments.status, "completed"),
            ),
            and(eq(payments.type, "deposit_hold"), eq(payments.status, "cancelled")),
          ),
        ),
      )
      .orderBy(desc(historyDateSql), desc(payments.id))
      .limit(DEPOSIT_HISTORY_LIMIT),
  ]);

  const toReturnRows = toReturn.map((row) => ({
    reservationId: row.reservationId,
    reservationNumber: row.reservationNumber,
    reservationStatus: row.reservationStatus,
    customerName: row.customerName?.trim() ?? "",
    cashed: toMoney(row.cashed),
    returned: toMoney(row.returned),
    remaining: toMoney(Number(row.cashed) - Number(row.returned)),
    endDate: row.endDate,
  }));

  return {
    holds: holds.map((row) => ({
      paymentId: row.paymentId,
      amount: toMoney(row.amount),
      authorizedAt: row.authorizedAt,
      expiresAt: row.expiresAt,
      reservationId: row.reservationId,
      reservationNumber: row.reservationNumber,
      reservationStatus: row.reservationStatus,
      customerName: row.customerName?.trim() ?? "",
    })),
    holdsTotal: toMoney(holdsTotal?.total),
    toReturn: toReturnRows,
    toReturnTotal: toMoney(toReturnRows.reduce((sum, row) => sum + row.remaining, 0)),
    history: history.flatMap((row) => {
      if (row.type === "rental" || row.type === "damage" || row.type === "adjustment") return [];
      return [
        {
          paymentId: row.paymentId,
          date: row.status === "cancelled" ? row.updatedAt : (row.paidAt ?? row.createdAt),
          event: DEPOSIT_EVENTS[row.type],
          method: row.method,
          amount: toMoney(Math.abs(Number(row.amount))),
          reservationId: row.reservationId,
          reservationNumber: row.reservationNumber,
          reservationStatus: row.reservationStatus,
          customerName: row.customerName?.trim() ?? "",
        },
      ];
    }),
  };
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export async function getFinanceSummary(params: {
  storeId: string;
  timezone?: string | null;
  period: FinancePeriodInput;
  now?: Date;
}): Promise<FinanceSummary> {
  const { storeId } = params;
  const now = params.now ?? new Date();
  const window = getFinanceWindow(params.period, now, params.timezone);

  const ledger = (start: Date, end: Date) =>
    and(eq(reservations.storeId, storeId), isCountedSql, ...inWindow(start, end));

  // Bucket boundaries are instants, so grouping does not depend on MySQL timezone tables.
  const bucketSql = window.buckets.length
    ? sql<number>`(CASE ${sql.join(
        window.buckets.map(
          (bucket, index) => sql`WHEN ${movementDateSql} < ${at(bucket.end)} THEN ${index}`,
        ),
        sql` `,
      )} END)`
    : null;

  const [byMethod, [previous], series, outstanding, depositCount, [anyPayment]] = await Promise.all(
    [
      db
        .select({
          method: payments.method,
          moneyIn: moneyInSql,
          moneyOut: moneyOutSql,
          total: count(),
        })
        .from(payments)
        .innerJoin(reservations, eq(payments.reservationId, reservations.id))
        .where(ledger(window.start, window.end))
        .groupBy(payments.method),
      db
        .select({ moneyIn: moneyInSql, moneyOut: moneyOutSql })
        .from(payments)
        .innerJoin(reservations, eq(payments.reservationId, reservations.id))
        .where(ledger(window.previousStart, window.previousEnd)),
      bucketSql
        ? db
            .select({ bucket: bucketSql, moneyIn: moneyInSql, moneyOut: moneyOutSql })
            .from(payments)
            .innerJoin(reservations, eq(payments.reservationId, reservations.id))
            .where(ledger(window.start, window.end))
            .groupBy(bucketSql)
        : Promise.resolve([]),
      getOutstandingTotals(storeId, now),
      getDepositCount(storeId),
      db
        .select({ id: payments.id })
        .from(payments)
        .innerJoin(reservations, eq(payments.reservationId, reservations.id))
        .where(eq(reservations.storeId, storeId))
        .limit(1),
    ],
  );

  const methods = byMethod
    .map((row) => ({
      method: row.method,
      moneyIn: toMoney(row.moneyIn),
      moneyOut: toMoney(row.moneyOut),
      count: Number(row.total),
    }))
    .sort((a, b) => b.moneyIn - a.moneyIn || b.moneyOut - a.moneyOut);
  const moneyIn = toMoney(methods.reduce((sum, row) => sum + row.moneyIn, 0));
  const moneyOut = toMoney(methods.reduce((sum, row) => sum + row.moneyOut, 0));
  const previousIn = toMoney(previous?.moneyIn);
  const previousNet = toMoney(previousIn - toMoney(previous?.moneyOut));
  const byBucket = new Map(series.map((row) => [Number(row.bucket), row]));

  return {
    window: {
      period: window.period,
      from: window.from,
      to: window.to,
      timezone: window.timezone,
      granularity: window.granularity,
    },
    totals: {
      moneyIn,
      moneyOut,
      net: toMoney(moneyIn - moneyOut),
      movementCount: methods.reduce((sum, row) => sum + row.count, 0),
      moneyInGrowth: getFinanceGrowth(moneyIn, previousIn),
      netGrowth: getFinanceGrowth(toMoney(moneyIn - moneyOut), previousNet),
    },
    series: window.buckets.map((bucket, index) => ({
      key: bucket.key,
      moneyIn: toMoney(byBucket.get(index)?.moneyIn),
      moneyOut: toMoney(byBucket.get(index)?.moneyOut),
    })),
    byMethod: methods,
    outstanding,
    depositCount,
    hasPayments: Boolean(anyPayment),
  };
}

// ---------------------------------------------------------------------------
// Movements
// ---------------------------------------------------------------------------

const selectMovements = (conditions: ReturnType<typeof movementConditions>) =>
  db
    .select(movementColumns)
    .from(payments)
    .innerJoin(reservations, eq(payments.reservationId, reservations.id))
    .leftJoin(customers, eq(reservations.customerId, customers.id))
    .where(and(...conditions))
    .orderBy(desc(movementDateSql), desc(payments.id));

export async function getFinanceMovements(params: {
  storeId: string;
  timezone?: string | null;
  period: FinancePeriodInput;
  filters?: FinanceMovementFilters;
  page?: number;
  pageSize?: number;
  now?: Date;
}): Promise<FinanceMovementsOutput> {
  const window = getFinanceWindow(params.period, params.now ?? new Date(), params.timezone);
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;
  const conditions = movementConditions(params.storeId, window, params.filters ?? {});

  const [rows, [total]] = await Promise.all([
    selectMovements(conditions)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ total: count() })
      .from(payments)
      .innerJoin(reservations, eq(payments.reservationId, reservations.id))
      .leftJoin(customers, eq(reservations.customerId, customers.id))
      .where(and(...conditions)),
  ]);

  const movements = rows.map((row) => toMovement(row, window.timezone));
  const days = await getDaySubtotals(
    [...new Set(movements.map((movement) => movement.dayKey))],
    window.timezone,
    conditions,
  );

  return { movements, days, totalCount: Number(total?.total ?? 0), page, pageSize };
}

/**
 * Net of each day on the page, over every matching row of that day — a day
 * split across two pages still shows its full subtotal. Days are bucketed on
 * the store's midnights, passed as instants.
 */
const getDaySubtotals = async (
  dayKeys: string[],
  timezone: string,
  conditions: ReturnType<typeof movementConditions>,
): Promise<FinanceMovementsOutput["days"]> => {
  if (dayKeys.length === 0) return [];
  const days = [...dayKeys].sort().map((key) => ({ key, ...getFinanceDayBounds(key, timezone) }));
  const daySql = sql<number>`(CASE ${sql.join(
    days.map(
      (day, index) =>
        sql`WHEN ${movementDateSql} >= ${at(day.start)} AND ${movementDateSql} < ${at(day.end)} THEN ${index}`,
    ),
    sql` `,
  )} END)`;

  const rows = await db
    .select({ day: daySql, moneyIn: moneyInSql, moneyOut: moneyOutSql })
    .from(payments)
    .innerJoin(reservations, eq(payments.reservationId, reservations.id))
    .leftJoin(customers, eq(reservations.customerId, customers.id))
    // Pending and held rows are listed but never part of a subtotal.
    .where(and(...conditions, isCountedSql, sql`${daySql} IS NOT NULL`))
    .groupBy(daySql);

  const byDay = new Map(rows.map((row) => [Number(row.day), row]));
  return days.map((day, index) => {
    const moneyIn = toMoney(byDay.get(index)?.moneyIn);
    const moneyOut = toMoney(byDay.get(index)?.moneyOut);
    return { key: day.key, moneyIn, moneyOut, net: toMoney(moneyIn - moneyOut) };
  });
};

/** Every settled movement of the period, for the till-closing printout and the CSV export. */
export async function getFinanceRecap(params: {
  storeId: string;
  timezone?: string | null;
  period: FinancePeriodInput;
  now?: Date;
  limit?: number;
}): Promise<{ movements: FinanceMovement[]; truncated: boolean }> {
  const window = getFinanceWindow(params.period, params.now ?? new Date(), params.timezone);
  const limit = params.limit ?? RECAP_ROW_LIMIT;
  const rows = await selectMovements(
    movementConditions(params.storeId, window, { status: "settled" }),
  ).limit(limit + 1);

  return {
    movements: rows.slice(0, limit).map((row) => toMovement(row, window.timezone)),
    truncated: rows.length > limit,
  };
}

/**
 * The period's settled movements with what an accountant reconciles against:
 * the stored amount, the refund link and the Stripe ids. Bounded by the
 * period, which `getFinanceWindow` caps at a year.
 */
export async function getFinanceExport(params: {
  storeId: string;
  timezone?: string | null;
  period: FinancePeriodInput;
  now?: Date;
}) {
  const window = getFinanceWindow(params.period, params.now ?? new Date(), params.timezone);
  const rows = await db
    .select({
      ...movementColumns,
      currency: payments.currency,
      notes: payments.notes,
      stripeChargeId: payments.stripeChargeId,
    })
    .from(payments)
    .innerJoin(reservations, eq(payments.reservationId, reservations.id))
    .leftJoin(customers, eq(reservations.customerId, customers.id))
    .where(and(...movementConditions(params.storeId, window, { status: "settled" })))
    .orderBy(asc(movementDateSql), asc(payments.id));

  return {
    timezone: window.timezone,
    rows: rows.map((row) => ({
      ...toMovement(row, window.timezone),
      storedAmount: toMoney(row.storedAmount),
      currency: row.currency ?? "EUR",
      notes: row.notes,
      refundOfPaymentId: row.refundOfPaymentId,
      stripePaymentIntentId: row.stripePaymentIntentId,
      stripeChargeId: row.stripeChargeId,
      stripeRefundId: row.stripeRefundId,
    })),
  };
}

export async function getFinanceMovementDetail(params: {
  storeId: string;
  timezone?: string | null;
  paymentId: string;
}): Promise<FinanceMovementDetail> {
  const timezone = resolveFinanceTimezone(params.timezone);
  const detailColumns = {
    ...movementColumns,
    currency: payments.currency,
    notes: payments.notes,
    stripeChargeId: payments.stripeChargeId,
  };
  const related = (condition: ReturnType<typeof eq>) =>
    db
      .select(detailColumns)
      .from(payments)
      .innerJoin(reservations, eq(payments.reservationId, reservations.id))
      .leftJoin(customers, eq(reservations.customerId, customers.id))
      // The store filter is what keeps another store's payment out of reach.
      .where(and(eq(reservations.storeId, params.storeId), condition))
      .orderBy(asc(movementDateSql), asc(payments.id));

  const [row] = await related(eq(payments.id, params.paymentId)).limit(1);
  if (!row) throw new ORPCError("NOT_FOUND", { message: "errors.paymentNotFound" });

  const [originals, refunds, [invoice]] = await Promise.all([
    row.refundOfPaymentId
      ? related(eq(payments.id, row.refundOfPaymentId)).limit(1)
      : Promise.resolve([]),
    related(eq(payments.refundOfPaymentId, row.id)),
    db
      .select({ id: invoices.id, number: invoices.number, type: invoices.type })
      .from(invoicePayments)
      .innerJoin(invoices, eq(invoicePayments.invoiceId, invoices.id))
      .where(and(eq(invoicePayments.paymentId, row.id), eq(invoices.storeId, params.storeId)))
      .limit(1),
  ]);

  const toRelated = (relatedRow: (typeof refunds)[number]) => {
    const movement = toMovement(relatedRow, timezone);
    return {
      id: movement.id,
      date: movement.date,
      nature: movement.nature,
      method: movement.method,
      status: movement.status,
      amount: movement.amount,
    };
  };
  const [original] = originals;

  return {
    movement: {
      ...toMovement(row, timezone),
      storedAmount: toMoney(row.storedAmount),
      currency: row.currency ?? "EUR",
      notes: row.notes,
      stripePaymentIntentId: row.stripePaymentIntentId,
      stripeChargeId: row.stripeChargeId,
      stripeCheckoutSessionId: row.stripeCheckoutSessionId,
      stripeRefundId: row.stripeRefundId,
    },
    original: original ? toRelated(original) : null,
    refunds: refunds.map(toRelated),
    invoice: invoice ?? null,
  };
}
