import { z } from "zod";

import { FINANCE_PERIODS, PAYMENT_MOVEMENT_NATURES } from "@louez/utils";

/** Mirrors the `payment_method` enum of the database. */
export const FINANCE_PAYMENT_METHODS = [
  "stripe",
  "cash",
  "card",
  "transfer",
  "check",
  "other",
] as const;
export type FinancePaymentMethod = (typeof FINANCE_PAYMENT_METHODS)[number];

export const FINANCE_MOVEMENT_DIRECTIONS = ["in", "out"] as const;
export type FinanceMovementDirection = (typeof FINANCE_MOVEMENT_DIRECTIONS)[number];

/**
 * What the ledger says of a row's status. `settled` is cash that moved
 * (`completed` or `refunded` in the database), `held` an authorisation.
 */
export const FINANCE_MOVEMENT_STATUSES = [
  "settled",
  "pending",
  "held",
  "failed",
  "cancelled",
] as const;
export type FinanceMovementStatus = (typeof FINANCE_MOVEMENT_STATUSES)[number];

export const FINANCE_PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_FINANCE_PAGE_SIZE = 25;

const moneySchema = z.number();
const paymentMethodSchema = z.enum(FINANCE_PAYMENT_METHODS);
const natureSchema = z.enum(PAYMENT_MOVEMENT_NATURES);

/** A preset, or `custom` with both days (`yyyy-MM-dd`, store timezone, inclusive). */
export const financePeriodInputSchema = z.object({
  period: z.enum(FINANCE_PERIODS).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export type FinancePeriodInput = z.infer<typeof financePeriodInputSchema>;

const financeWindowSchema = z.object({
  period: z.enum(FINANCE_PERIODS),
  from: z.iso.date(),
  to: z.iso.date(),
  timezone: z.string(),
  granularity: z.enum(["day", "month"]),
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export const financeSummaryInputSchema = financePeriodInputSchema;
export type FinanceSummaryInput = z.infer<typeof financeSummaryInputSchema>;

export const financeSummaryOutputSchema = z.object({
  window: financeWindowSchema,
  totals: z.object({
    moneyIn: moneySchema,
    moneyOut: moneySchema,
    net: moneySchema,
    movementCount: z.number().int(),
    /** Growth in percent against the period before; `null` when there is nothing to compare with. */
    moneyInGrowth: z.number().nullable(),
    netGrowth: z.number().nullable(),
  }),
  /** One point per day, or per month on long ranges. `key` is the bucket's first day. */
  series: z.array(z.object({ key: z.iso.date(), moneyIn: moneySchema, moneyOut: moneySchema })),
  byMethod: z.array(
    z.object({
      method: paymentMethodSchema,
      moneyIn: moneySchema,
      moneyOut: moneySchema,
      count: z.number().int(),
    }),
  ),
  /** Not bound to the period: a debt does not depend on the filter. */
  outstanding: z.object({ total: moneySchema, reservationCount: z.number().int() }),
  /** Active holds plus cashed deposits still to give back. */
  depositCount: z.number().int(),
  /** `false` until the store records its first payment: drives the first-use block. */
  hasPayments: z.boolean(),
});
export type FinanceSummary = z.infer<typeof financeSummaryOutputSchema>;

// ---------------------------------------------------------------------------
// Movements
// ---------------------------------------------------------------------------

export const financeMovementFiltersSchema = z.object({
  direction: z.enum(FINANCE_MOVEMENT_DIRECTIONS).optional(),
  method: paymentMethodSchema.optional(),
  nature: natureSchema.optional(),
  status: z.enum(FINANCE_MOVEMENT_STATUSES).optional(),
  minAmount: z.number().min(0).max(99_999_999).optional(),
  maxAmount: z.number().min(0).max(99_999_999).optional(),
  search: z.string().trim().max(100).optional(),
});
export type FinanceMovementFilters = z.infer<typeof financeMovementFiltersSchema>;

export const financeMovementsInputSchema = financePeriodInputSchema
  .extend(financeMovementFiltersSchema.shape)
  .extend({
    page: z.number().int().min(1).max(100_000).optional(),
    pageSize: z.literal(FINANCE_PAGE_SIZES).optional(),
  });
export type FinanceMovementsInput = z.infer<typeof financeMovementsInputSchema>;

export const financeMovementSchema = z.object({
  id: z.string(),
  date: z.date(),
  /** Day of the movement in the store's timezone: the key rows are grouped by. */
  dayKey: z.iso.date(),
  reservationId: z.string(),
  reservationNumber: z.string(),
  customerName: z.string(),
  nature: natureSchema,
  method: paymentMethodSchema,
  status: z.enum(FINANCE_MOVEMENT_STATUSES),
  direction: z.enum(FINANCE_MOVEMENT_DIRECTIONS),
  /** Signed: positive came in, negative went out. Gross for a refunded Stripe charge. */
  amount: moneySchema,
  /** Part of the totals: settled, and not a hold carried by its capture. */
  counted: z.boolean(),
});
export type FinanceMovement = z.infer<typeof financeMovementSchema>;

export const financeMovementsOutputSchema = z.object({
  movements: z.array(financeMovementSchema),
  /** Net of each day shown on the page, over every matching row of that day. */
  days: z.array(
    z.object({
      key: z.iso.date(),
      net: moneySchema,
      moneyIn: moneySchema,
      moneyOut: moneySchema,
    }),
  ),
  totalCount: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type FinanceMovementsOutput = z.infer<typeof financeMovementsOutputSchema>;

export const financeMovementDetailInputSchema = z.object({ paymentId: z.string().length(21) });

const financeRelatedMovementSchema = z.object({
  id: z.string(),
  date: z.date(),
  nature: natureSchema,
  method: paymentMethodSchema,
  status: z.enum(FINANCE_MOVEMENT_STATUSES),
  amount: moneySchema,
});

export const financeMovementDetailOutputSchema = z.object({
  movement: financeMovementSchema.extend({
    /** Amount as stored: differs from `amount` for a Stripe charge brought down to its net. */
    storedAmount: moneySchema,
    currency: z.string(),
    notes: z.string().nullable(),
    stripePaymentIntentId: z.string().nullable(),
    stripeChargeId: z.string().nullable(),
    stripeCheckoutSessionId: z.string().nullable(),
    stripeRefundId: z.string().nullable(),
  }),
  /** The payment this row gives money back for. */
  original: financeRelatedMovementSchema.nullable(),
  /** The rows giving money back for this payment. */
  refunds: z.array(financeRelatedMovementSchema),
  invoice: z
    .object({ id: z.string(), number: z.string(), type: z.enum(["invoice", "credit_note"]) })
    .nullable(),
});
export type FinanceMovementDetail = z.infer<typeof financeMovementDetailOutputSchema>;

// ---------------------------------------------------------------------------
// Outstanding balances
// ---------------------------------------------------------------------------

export const financeOutstandingInputSchema = z.object({
  page: z.number().int().min(1).max(100_000).optional(),
  pageSize: z.literal(FINANCE_PAGE_SIZES).optional(),
});
export type FinanceOutstandingInput = z.infer<typeof financeOutstandingInputSchema>;

export const financeOutstandingOutputSchema = z.object({
  reservations: z.array(
    z.object({
      id: z.string(),
      number: z.string(),
      status: z.enum(["confirmed", "ongoing", "completed"]),
      customerName: z.string(),
      startDate: z.date(),
      endDate: z.date(),
      total: moneySchema,
      paid: moneySchema,
      remaining: moneySchema,
    }),
  ),
  total: moneySchema,
  totalCount: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type FinanceOutstandingOutput = z.infer<typeof financeOutstandingOutputSchema>;

// ---------------------------------------------------------------------------
// Deposits
// ---------------------------------------------------------------------------

export const financeDepositsInputSchema = z.object({});

const financeDepositPartySchema = z.object({
  reservationId: z.string(),
  reservationNumber: z.string(),
  reservationStatus: z.string(),
  customerName: z.string(),
});

export const financeDepositsOutputSchema = z.object({
  /** Authorisation holds still active, soonest to expire first. */
  holds: z.array(
    financeDepositPartySchema.extend({
      paymentId: z.string(),
      amount: moneySchema,
      authorizedAt: z.date(),
      expiresAt: z.date().nullable(),
    }),
  ),
  holdsTotal: moneySchema,
  /** Deposits cashed and not given back in full. */
  toReturn: z.array(
    financeDepositPartySchema.extend({
      cashed: moneySchema,
      returned: moneySchema,
      remaining: moneySchema,
      endDate: z.date(),
    }),
  ),
  toReturnTotal: moneySchema,
  history: z.array(
    financeDepositPartySchema.extend({
      paymentId: z.string(),
      date: z.date(),
      event: z.enum(["cashed", "captured", "returned", "released"]),
      method: paymentMethodSchema,
      amount: moneySchema,
    }),
  ),
});
export type FinanceDepositsOutput = z.infer<typeof financeDepositsOutputSchema>;
