import { z } from "zod";

import { apiError } from "../platform/errors";
import { handoffLinkSchema } from "./handoffs";
import { resourceLinksSchema } from "./links";

/**
 * What Louez bills a store, read-only, as the billing pages show it
 * (apps/web settings/billing and settings/subscription). The figures come
 * from the billing code, never computed here.
 */

const moneySchema = z.object({
  amount: z.string().describe("Decimal string, such as 12.50."),
  currency: z.string(),
});
export type BillingMoney = z.infer<typeof moneySchema>;

const GATE_REASONS = [
  "payment_method_required",
  "payment_overdue",
  "suspended",
  "balance_limit_reached",
] as const;

const CARD_STATES = ["saved", "missing", "unknown", "not_needed", "in_louez"] as const;

/** A plan Louez sells (Pro, Ultra…), when one is in force or ending. */
const planSchema = z.object({
  slug: z.string(),
  name: z.string(),
  /** The subscription's state, as Stripe last told Louez. */
  status: z.string(),
  interval: z.enum(["monthly", "yearly"]).nullable(),
  currentPeriodEnd: z.date().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  /** A change that starts at the end of the paid period: another plan, or pay-as-you-go. */
  pendingChange: z
    .object({ planSlug: z.string(), interval: z.enum(["monthly", "yearly"]).nullable() })
    .nullable(),
});

/** Louez's own pay-as-you-go terms and this month, for a store its legacy code bills. */
const payAsYouGoSchema = z.object({
  /** The fee per reservation, by rank in the month (1-based; `to` null: no upper bound). */
  bands: z.array(
    z.object({ from: z.number().int(), to: z.number().int().nullable(), fee: moneySchema }),
  ),
  freeReservations: z.object({ granted: z.number().int(), remaining: z.number().int() }),
  month: z.object({
    period: z.string().describe("YYYY-MM"),
    reservations: z.number().int(),
    fees: moneySchema,
    collectedAtSource: moneySchema,
    due: moneySchema.describe("What the month-end invoice would ask if the month closed now."),
  }),
});

const invoiceSchema = z.object({
  period: z.string(),
  amount: moneySchema,
  status: z.enum(["open", "paid", "failed", "void"]),
  paidAt: z.date().nullable(),
});

/** What the billing service shows (stores it bills). */
const serviceSchema = z.object({
  /** False when the billing service could not be read now; the rest of this object is then empty. */
  reachable: z.boolean(),
  month: z
    .object({
      period: z.string(),
      statementAt: z.string(),
      currencies: z.array(z.object({ atSource: moneySchema, due: moneySchema })),
    })
    .nullable(),
  /** The unpaid balance and its limit. */
  balance: z
    .object({
      owed: moneySchema,
      limit: moneySchema.nullable(),
      standing: z.enum(["ok", "near", "reached"]),
    })
    .nullable(),
});

export const billingStatusSchema = z.object({
  /**
   * Who bills the store: `none` (this instance bills nobody), `legacy`
   * (Louez's own plans and pay-as-you-go), `service` (Louez's billing service).
   */
  billing: z.enum(["none", "legacy", "service"]),
  /** `subscription`: a plan; `pay_as_you_go`: a fee per reservation. Null when nobody bills. */
  mode: z.enum(["subscription", "pay_as_you_go"]).nullable(),
  plan: planSchema.nullable(),
  /** The offer's name and the billing service's notice, in its words. */
  offer: z.string().nullable(),
  notice: z.string().nullable(),
  payAsYouGo: payAsYouGoSchema.nullable(),
  card: z
    .object({
      state: z.enum(CARD_STATES),
      brand: z.string().nullable(),
      last4: z.string().nullable(),
      expMonth: z.number().int().nullable(),
      expYear: z.number().int().nullable(),
      expired: z.boolean(),
    })
    .nullable()
    .describe("The card Louez charges its fees on; null when nobody bills the store."),
  /** The month-end invoices of Louez's pay-as-you-go, newest first. */
  invoices: z.array(invoiceSchema),
  service: serviceSchema.nullable(),
  /** Whether Louez billing lets the store take new bookings now, and why not. */
  gate: z.object({
    acceptsReservations: z.boolean(),
    reason: z.enum(GATE_REASONS).nullable(),
    since: z.date().nullable(),
  }),
  /** Whether billing_start_card_setup can run for this caller now, and why not. */
  cardSetup: z.object({
    available: z.boolean(),
    reason: z.enum(["not_billed_by_service", "owner_only", "off", "in_louez"]).nullable(),
  }),
  links: resourceLinksSchema,
});
export type BillingStatus = z.infer<typeof billingStatusSchema>;

export const getBillingStatusInput = z.object({});
export const startCardSetupInput = z.object({});
export const startCardSetupOutput = handoffLinkSchema;

export const billingErrors = {
  cardSetupUnavailable: (reason: string) =>
    apiError("CONFLICT", "CARD_SETUP_UNAVAILABLE", {
      message:
        reason === "owner_only"
          ? "Only the store's owner adds the billing card."
          : reason === "not_billed_by_service"
            ? "Louez's billing service does not bill this store, so it has no billing card to add here. Read billing_get_status."
            : "The billing card cannot be added now. Read billing_get_status.",
      i18nKey: "errors.permissionDenied",
      details: { reason },
    }),
};
