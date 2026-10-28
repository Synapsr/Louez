import { and, asc, eq, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";

import {
  billingSyncState,
  db,
  isPaymentReceiptSql,
  markReservation,
  paymentRequests,
  payments,
  reservationItems,
  reservations,
  stores,
} from "@louez/db";
import { isStripeRefundRow } from "@louez/utils";

import {
  insuranceShare,
  normalizeCurrency,
  reservationTotalsMinor,
  toMinor,
  type ReservationTotalsInput,
} from "@/lib/billing-sync/money";
import {
  type RefundLinkRow,
  foldRefundRows,
  paymentKind,
} from "@/lib/billing-sync/snapshots/reservation-payments";
import { SYNC_STATE_ID, updateSyncState } from "@/lib/billing-sync/state";
import { log } from "@/lib/evlog";
import { grossMinorOf, reservationCurrency } from "@/lib/reservations/payment-billing-facts";

import {
  type ChargeLookup,
  type StripeCharge,
  type StripeChargeReads,
  type UnresolvedReason,
  chargeIdFor,
  findStripeCharge,
  grossFromCharge,
} from "./gross-backfill-core";

// The gross backfill (louez-billing docs/plans/m1-pr-b-plan.md decisions 6 and 7; docs/api
// README Q7). Payments written before PR b have no `gross_minor`, often no charge id and
// no `insurance_share_minor`. This fills them, as the write sites fill new payments:
// - `gross_minor`: Stripe's charge amount for a Stripe payment, which refunds never net
//   (the amount column they net cannot give it); the stored amount for any other
//   payment, which nothing nets;
// - `stripe_charge_id` of a Stripe payment, from its PaymentIntent or Checkout Session;
// - `insurance_share_minor` (fees.md §4), from the reservation as it is now, as the
//   snapshot builder computes it for these rows today.
// Each reservation's rows are written in one transaction with its billing mark (DL-13).
// Once a run has gone through every payment without a Stripe failure, it sets
// `billing_sync_state.gross_backfilled_at`: from then on the heartbeat counts the
// completed payments still without gross, per store, instead of sending null, and the
// billing service holds the statements of each store it counts (README §7.5). A run
// in which Stripe found none of the payments it was asked for leaves the column as it
// is: its key is not the one those payments were taken with.
//
// Only payments whose money moved (completed or refunded) and that are not refund rows:
// the heartbeat counts those, and a refund row is never sent as a payment.

const MOVED_STATUSES = ["completed", "refunded"] as const;
/** Reservations whose context is read in one query. */
const BATCH = 100;

export type GrossBackfillFact = "grossMinor" | "stripeChargeId" | "insuranceShareMinor";

export type GrossBackfillUnresolved = {
  readonly paymentId: string;
  readonly reservationId: string;
  readonly storeId: string;
  readonly facts: readonly GrossBackfillFact[];
  readonly reason: UnresolvedReason;
};

/** A Stripe payment whose charge Stripe refunded more of than Louez's rows record. */
export type GrossBackfillRefundGap = {
  readonly paymentId: string;
  readonly reservationId: string;
  readonly storeId: string;
  /** The charge's `amount_refunded`. */
  readonly stripeRefundedMinor: number;
  /** What the snapshot builder sends as Stripe refunds of the payment. */
  readonly recordedMinor: number;
};

export type GrossBackfillOutcome =
  /**
   * Every payment was read. In a dry run, `grossBackfilledAt` is the column as it is;
   * after --apply, as the run left it.
   */
  | { readonly kind: "done"; readonly grossBackfilledAt: Date | null }
  /** Payments need Stripe and no reader was given. Nothing was read from Stripe or written. */
  | { readonly kind: "needs_stripe" }
  /**
   * While `gross_backfilled_at` is unset, Stripe had none of the `lookups` payments it
   * was asked for, or refused every account: a test-mode key on live payments, or
   * another platform's key. What --apply wrote stays (none of it came from Stripe), and
   * the column stays unset.
   */
  | { readonly kind: "stripe_found_none"; readonly lookups: number }
  /**
   * Stripe failed on this payment. Reservations before it were written; it and the
   * ones after were not, and `gross_backfilled_at` was left as it was.
   */
  | {
      readonly kind: "stripe_failed";
      readonly paymentId: string;
      readonly reservationId: string;
      readonly error: string;
    };

export type GrossBackfillResult = {
  readonly apply: boolean;
  /** Payments that lacked a fact when the run started. */
  readonly payments: number;
  readonly reservations: number;
  /** Of `payments`, those whose facts are read from Stripe. */
  readonly stripeLookups: number;
  /** Facts written; in a dry run, the facts --apply would write. */
  readonly filled: Readonly<Record<GrossBackfillFact, number>>;
  /** Reservations whose payments changed, each marked for the billing sync. */
  readonly reservationsChanged: number;
  readonly unresolved: readonly GrossBackfillUnresolved[];
  /**
   * Completed payments left without gross, per store, sorted by store. Once
   * `gross_backfilled_at` is set, the heartbeat reports them and the billing service
   * holds each store's statements (reason `invariants`) until they get a gross amount
   * or an admin releases the statement (README §7.5).
   */
  readonly storesHeld: readonly { readonly storeId: string; readonly payments: number }[];
  readonly refundGaps: readonly GrossBackfillRefundGap[];
  readonly outcome: GrossBackfillOutcome;
};

export type GrossBackfillEvent = {
  billing:
    | {
        event: "gross_backfill";
        apply: boolean;
        outcome: GrossBackfillOutcome["kind"];
        payments: number;
        stripeLookups: number;
        filled: Record<GrossBackfillFact, number>;
        reservationsChanged: number;
        unresolved: number;
        storesHeld: number;
        refundGaps: number;
      }
    | {
        event: "gross_backfill_stripe_failed";
        paymentId: string;
        reservationId: string;
        storeId: string;
        error: string;
      };
};

export interface GrossBackfillLog {
  info(event: GrossBackfillEvent): void;
  warn(event: GrossBackfillEvent): void;
  error(event: GrossBackfillEvent): void;
}

/** A payment that lacks a fact. */
type Candidate = {
  readonly id: string;
  readonly reservationId: string;
  readonly storeId: string;
  readonly type: (typeof payments.$inferSelect)["type"];
  readonly method: (typeof payments.$inferSelect)["method"];
  readonly status: (typeof payments.$inferSelect)["status"];
  readonly amount: string;
  readonly currency: string | null;
  readonly stripePaymentIntentId: string | null;
  readonly stripeChargeId: string | null;
  readonly stripeCheckoutSessionId: string | null;
  readonly stripeRefundId: string | null;
  readonly stripeAccountId: string | null;
  readonly grossMinor: number | null;
  readonly insuranceShareMinor: number | null;
  readonly origin: (typeof payments.$inferSelect)["origin"];
  readonly paymentRequestId: string | null;
};

/** A row of the reservation, as its refund rows are folded onto its payments. */
type ReservationPaymentRow = RefundLinkRow & { readonly amount: string };

/** What a payment of a reservation is read against. */
type ReservationContext = {
  readonly storeStripeAccountId: string | null;
  /** The reservation's currency, for every payment whose method is not `stripe` (Q4). */
  readonly currency: string;
  readonly totals: ReservationTotalsInput;
  readonly customRequestIds: ReadonlySet<string>;
  /** Every payment row of the reservation, refund rows included. */
  readonly rows: readonly ReservationPaymentRow[];
};

/**
 * The share of an extension is computed as a rental's (fees.md §4), so the activity rows
 * that tell the two apart for rows without an origin are not read.
 */
const NO_EXTENSIONS: ReadonlySet<string> = new Set();

/** The facts one payment gets, each set only where the row has none. */
type PaymentFill = {
  readonly paymentId: string;
  grossMinor?: number;
  stripeChargeId?: string;
  insuranceShareMinor?: number;
};

const isStripe = (row: Candidate) => row.method === "stripe";

/** A Stripe payment without gross, or without the charge id it should hold. */
const needsCharge = (row: Candidate) =>
  isStripe(row) &&
  (row.grossMinor === null || (row.stripeChargeId === null && row.type !== "deposit_hold"));

const hasStripeReference = (row: Candidate) =>
  row.stripeChargeId !== null ||
  row.stripePaymentIntentId !== null ||
  row.stripeCheckoutSessionId !== null;

async function loadCandidates(): Promise<Candidate[]> {
  return db
    .select({
      id: payments.id,
      reservationId: payments.reservationId,
      storeId: reservations.storeId,
      type: payments.type,
      method: payments.method,
      status: payments.status,
      amount: payments.amount,
      currency: payments.currency,
      stripePaymentIntentId: payments.stripePaymentIntentId,
      stripeChargeId: payments.stripeChargeId,
      stripeCheckoutSessionId: payments.stripeCheckoutSessionId,
      stripeRefundId: payments.stripeRefundId,
      stripeAccountId: payments.stripeAccountId,
      grossMinor: payments.grossMinor,
      insuranceShareMinor: payments.insuranceShareMinor,
      origin: payments.origin,
      paymentRequestId: payments.paymentRequestId,
    })
    .from(payments)
    .innerJoin(reservations, eq(reservations.id, payments.reservationId))
    .where(
      and(
        inArray(payments.status, [...MOVED_STATUSES]),
        isPaymentReceiptSql(),
        or(
          isNull(payments.grossMinor),
          isNull(payments.insuranceShareMinor),
          and(
            eq(payments.method, "stripe"),
            isNull(payments.stripeChargeId),
            ne(payments.type, "deposit_hold"),
          ),
        ),
      ),
    )
    .orderBy(asc(payments.reservationId), asc(payments.id));
}

/** The context of each reservation, read as the snapshot builder reads it. */
async function loadContexts(
  reservationIds: readonly string[],
): Promise<Map<string, ReservationContext>> {
  const ids = [...reservationIds];
  const [rows, items, customRequests, paymentRows] = await Promise.all([
    db
      .select({
        id: reservations.id,
        storeId: reservations.storeId,
        createdAt: reservations.createdAt,
        currency: reservations.currency,
        source: reservations.source,
        totalAmount: reservations.totalAmount,
        subtotalAmount: reservations.subtotalAmount,
        depositAmount: reservations.depositAmount,
        deliveryFee: reservations.deliveryFee,
        discountAmount: reservations.discountAmount,
        subtotalExclTax: reservations.subtotalExclTax,
        taxAmount: reservations.taxAmount,
        tulipInsuranceAmount: reservations.tulipInsuranceAmount,
        storeSettings: stores.settings,
        storeStripeAccountId: stores.stripeAccountId,
      })
      .from(reservations)
      .innerJoin(stores, eq(stores.id, reservations.storeId))
      .where(inArray(reservations.id, ids)),
    db
      .select({
        reservationId: reservationItems.reservationId,
        productId: reservationItems.productId,
        taxRate: reservationItems.taxRate,
        totalPrice: reservationItems.totalPrice,
      })
      .from(reservationItems)
      .where(inArray(reservationItems.reservationId, ids)),
    db
      .select({
        id: paymentRequests.id,
        reservationId: paymentRequests.reservationId,
        storeId: paymentRequests.storeId,
      })
      .from(paymentRequests)
      .where(and(inArray(paymentRequests.reservationId, ids), eq(paymentRequests.type, "custom"))),
    db
      .select({
        reservationId: payments.reservationId,
        id: payments.id,
        status: payments.status,
        amount: payments.amount,
        stripePaymentIntentId: payments.stripePaymentIntentId,
        stripeChargeId: payments.stripeChargeId,
        stripeCheckoutSessionId: payments.stripeCheckoutSessionId,
        stripeRefundId: payments.stripeRefundId,
        refundOfPaymentId: payments.refundOfPaymentId,
      })
      .from(payments)
      .where(inArray(payments.reservationId, ids)),
  ]);

  const contexts = new Map<string, ReservationContext>();
  for (const { id, storeId, storeSettings, storeStripeAccountId, ...reservation } of rows) {
    contexts.set(id, {
      storeStripeAccountId,
      currency: reservationCurrency(reservation.currency, storeSettings),
      totals: {
        reservation,
        storeSettings,
        items: items.filter((item) => item.reservationId === id),
      },
      customRequestIds: new Set(
        customRequests
          .filter((request) => request.reservationId === id && request.storeId === storeId)
          .map((request) => request.id),
      ),
      rows: paymentRows.filter((row) => row.reservationId === id),
    });
  }
  return contexts;
}

type Lookup = (accountId: string, row: Candidate) => Promise<ChargeLookup>;

/**
 * Looks up each payment's charge. An account that refused the platform is not asked
 * again. `answered` counts the lookups Stripe found something for.
 */
function chargeReader(reads: StripeChargeReads): {
  readonly lookup: Lookup;
  readonly counts: { readonly asked: number; readonly answered: number };
} {
  const refused = new Set<string>();
  const counts = { asked: 0, answered: 0 };
  const lookup: Lookup = async (accountId, row) => {
    if (refused.has(accountId)) return { reason: "account_inaccessible" };
    counts.asked += 1;
    const found = await findStripeCharge(reads, accountId, row);
    if ("charge" in found || found.reason === "no_charge") counts.answered += 1;
    else if (found.reason === "account_inaccessible") refused.add(accountId);
    return found;
  };
  return { lookup, counts };
}

type Planned = {
  readonly fill: PaymentFill;
  readonly unresolved: Array<{ facts: GrossBackfillFact[]; reason: UnresolvedReason }>;
  /** The charge read from Stripe, if any. */
  readonly charge: StripeCharge | null;
};

/**
 * A Stripe payment's charge, on the account that took it: the payment's own, else, for
 * rows written before payments had one, its store's (README Q5).
 */
function chargeOf(
  row: Candidate,
  accountId: string | null,
  lookup: Lookup | null,
): Promise<ChargeLookup> | ChargeLookup | { readonly reason: "no_connected_account" } {
  if (!hasStripeReference(row)) return { reason: "no_stripe_reference" };
  if (accountId === null) return { reason: "no_connected_account" };
  // runGrossBackfill stops before any payment when it has no reader and one is needed.
  if (lookup === null) throw new Error("a Stripe reader is needed and none was given");
  return lookup(accountId, row);
}

/**
 * The facts of one payment. Throws when Stripe fails; a charge Stripe does not have is
 * unresolved.
 */
async function planPayment(
  row: Candidate,
  context: ReservationContext,
  lookup: Lookup | null,
): Promise<Planned> {
  const fill: PaymentFill = { paymentId: row.id };
  const unresolved: Planned["unresolved"] = [];
  let charge: StripeCharge | null = null;
  const currency = paymentCurrency(row, context);

  if (needsCharge(row)) {
    const missing: GrossBackfillFact[] = [];
    if (row.grossMinor === null) missing.push("grossMinor");
    if (row.stripeChargeId === null && row.type !== "deposit_hold") missing.push("stripeChargeId");
    const found = await chargeOf(row, row.stripeAccountId ?? context.storeStripeAccountId, lookup);
    if ("reason" in found) {
      unresolved.push({ facts: missing, reason: found.reason });
    } else {
      charge = found.charge;
      if (row.grossMinor === null) {
        const gross = grossFromCharge({
          type: row.type,
          amount: row.amount,
          currency,
          charge: found.charge,
        });
        if ("reason" in gross) unresolved.push({ facts: ["grossMinor"], reason: gross.reason });
        else fill.grossMinor = gross.grossMinor;
      }
      const chargeId = chargeIdFor(row.type, found.charge);
      if (row.stripeChargeId === null && chargeId !== null) fill.stripeChargeId = chargeId;
    }
  } else if (row.grossMinor === null) {
    const gross = grossMinorOf(row.amount, currency);
    if (gross === null) unresolved.push({ facts: ["grossMinor"], reason: "unsupported_currency" });
    else fill.grossMinor = gross;
  }

  if (row.insuranceShareMinor === null) {
    const kind = paymentKind(row, {
      customRequestIds: context.customRequestIds,
      extensionPaymentIds: NO_EXTENSIONS,
    });
    const grossMinor = row.grossMinor ?? fill.grossMinor;
    if (kind !== "rental" && kind !== "extension") {
      // fees.md §4: every other kind has a share of 0.
      fill.insuranceShareMinor = 0;
    } else if (grossMinor === undefined) {
      unresolved.push({ facts: ["insuranceShareMinor"], reason: "gross_unknown" });
    } else {
      const share = shareOf(context, grossMinor);
      if (share === null) {
        unresolved.push({ facts: ["insuranceShareMinor"], reason: "totals_unreadable" });
      } else {
        fill.insuranceShareMinor = share;
      }
    }
  }
  return { fill, unresolved, charge };
}

/** A Stripe payment's own currency, any other payment's the reservation's (Q4). */
function paymentCurrency(row: Candidate, context: ReservationContext): string {
  return isStripe(row) ? normalizeCurrency(row.currency, context.currency) : context.currency;
}

/** Deposits carry no commission, and Stripe counts a released authorisation as refunded. */
const REFUND_CHECKED_TYPES: ReadonlySet<Candidate["type"]> = new Set([
  "rental",
  "damage",
  "adjustment",
]);

type PlannedPayment = { readonly row: Candidate; readonly plan: Planned };

type RefundGap = Omit<GrossBackfillRefundGap, "reservationId" | "storeId">;

/**
 * The refund gaps of a reservation's payments whose charge this run read, once their
 * charge ids are final.
 */
function refundGapsOf(
  planned: readonly PlannedPayment[],
  context: ReservationContext,
): RefundGap[] {
  const given = new Map<string, string>();
  for (const { plan } of planned) {
    if (plan.fill.stripeChargeId !== undefined)
      given.set(plan.fill.paymentId, plan.fill.stripeChargeId);
  }
  // Folded with the charge ids given, as the builder will fold them.
  const { originals, refundsOf } = foldRefundRows(
    context.rows.map((row) => {
      const chargeId = given.get(row.id);
      return chargeId === undefined ? row : { ...row, stripeChargeId: chargeId };
    }),
  );
  const gaps: RefundGap[] = [];
  for (const { row, plan } of planned) {
    const grossMinor = row.grossMinor ?? plan.fill.grossMinor;
    const original = originals.find((candidate) => candidate.id === row.id);
    // A charge another payment holds is compared on that payment.
    if (plan.charge === null || grossMinor === undefined || !original) continue;
    if (original.stripeChargeId !== plan.charge.id) continue;
    const gap = refundGapOf({
      row,
      grossMinor,
      charge: plan.charge,
      currency: paymentCurrency(row, context),
      refunds: refundsOf(original),
    });
    if (gap) gaps.push({ paymentId: row.id, ...gap });
  }
  return gaps;
}

/**
 * What Stripe refunded of the payment's charge beyond what the snapshot builder sends
 * (`buildPaymentSnapshots`): the Stripe refund rows folded onto it, plus, when the
 * payment carries a refund id, the part its amount was netted by. A refund the webhook
 * stamped before 2026-06-18 netted nothing and has no row, so the builder sends none.
 * `refunds` are the rows folded onto it, with the charge ids this run gives.
 */
function refundGapOf(input: {
  readonly row: Candidate;
  readonly grossMinor: number;
  readonly charge: StripeCharge;
  readonly currency: string;
  readonly refunds: readonly ReservationPaymentRow[];
}): Omit<RefundGap, "paymentId"> | null {
  const { row, grossMinor, charge, currency } = input;
  if (!REFUND_CHECKED_TYPES.has(row.type)) return null;
  const minor = (amount: string): number | null => {
    const result = toMinor(amount, currency);
    return "minor" in result ? result.minor : null;
  };
  let linkedMinor = 0;
  for (const refund of input.refunds) {
    if (!isStripeRefundRow(refund)) continue;
    const amount = minor(refund.amount);
    if (amount === null) return null;
    linkedMinor += amount;
  }
  const netMinor = minor(row.amount);
  if (netMinor === null) return null;
  const nettedMinor =
    row.stripeRefundId === null ? 0 : Math.max(0, grossMinor - netMinor - linkedMinor);
  const recordedMinor = linkedMinor + nettedMinor;
  if (charge.amount_refunded <= recordedMinor) return null;
  return { stripeRefundedMinor: charge.amount_refunded, recordedMinor };
}

/** fees.md §4, from the reservation's totals now; null when they cannot be read. */
function shareOf(context: ReservationContext, grossMinor: number): number | null {
  try {
    const totals = reservationTotalsMinor(context.totals);
    return insuranceShare({
      insuranceMinor: totals.insuranceMinor,
      totalInclTaxMinor: totals.totalInclTaxMinor,
      grossMinor,
    });
  } catch {
    // A stored amount Louez cannot convert, such as a three-decimal currency.
    return null;
  }
}

/** Charge ids that a receipt already holds. */
async function heldChargeIds(chargeIds: readonly string[]): Promise<Set<string>> {
  if (chargeIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ chargeId: payments.stripeChargeId })
    .from(payments)
    .where(and(inArray(payments.stripeChargeId, [...chargeIds]), isPaymentReceiptSql()));
  return new Set(rows.flatMap((row) => (row.chargeId === null ? [] : [row.chargeId])));
}

/**
 * Writes the facts of one reservation's payments where they are still empty, with its
 * billing mark, in one transaction. Returns the payments changed.
 */
async function writeFills(
  reservation: { readonly id: string; readonly storeId: string },
  fills: readonly PaymentFill[],
): Promise<number> {
  return db.transaction(async (tx) => {
    let changed = 0;
    for (const fill of fills) {
      const empty: SQL[] = [];
      if (fill.grossMinor !== undefined) empty.push(isNull(payments.grossMinor));
      if (fill.stripeChargeId !== undefined) empty.push(isNull(payments.stripeChargeId));
      if (fill.insuranceShareMinor !== undefined) empty.push(isNull(payments.insuranceShareMinor));
      if (empty.length === 0) continue;
      const [header] = await tx
        .update(payments)
        .set({
          ...(fill.grossMinor === undefined
            ? {}
            : { grossMinor: sql`COALESCE(${payments.grossMinor}, ${fill.grossMinor})` }),
          ...(fill.stripeChargeId === undefined
            ? {}
            : {
                stripeChargeId: sql`COALESCE(${payments.stripeChargeId}, ${fill.stripeChargeId})`,
              }),
          ...(fill.insuranceShareMinor === undefined
            ? {}
            : {
                insuranceShareMinor: sql`COALESCE(${payments.insuranceShareMinor}, ${fill.insuranceShareMinor})`,
              }),
          // Kept: for a charge older webhooks netted and stamped with its refund id, it
          // is the only date Louez has of that refund (reservation-payments.ts).
          updatedAt: sql`${payments.updatedAt}`,
        })
        .where(and(eq(payments.id, fill.paymentId), or(...empty)));
      if (header.affectedRows > 0) changed += 1;
    }
    if (changed > 0) await markReservation(tx, reservation);
    return changed;
  });
}

const FACTS: readonly GrossBackfillFact[] = ["grossMinor", "stripeChargeId", "insuranceShareMinor"];

const hasFact = (fill: PaymentFill) => FACTS.some((fact) => fill[fact] !== undefined);

/**
 * Fills the billing facts older payments lack. A dry run (`apply: false`) reads Stripe
 * and the database and writes nothing. Safe to run again: a fact is only written where
 * it is empty, and a run that finds nothing to fill writes nothing.
 *
 * Stripe calls happen outside the transactions. A Stripe failure stops the run: what was
 * written stays, and the next run picks up the rest.
 */
export async function runGrossBackfill(options: {
  readonly apply: boolean;
  /** Null without a Stripe key: the run then stops if a payment needs Stripe. */
  readonly stripe: StripeChargeReads | null;
  readonly log?: GrossBackfillLog;
}): Promise<GrossBackfillResult> {
  const logger = options.log ?? log;
  const candidates = await loadCandidates();
  const byReservation = new Map<string, Candidate[]>();
  for (const row of candidates) {
    const rows = byReservation.get(row.reservationId);
    if (rows) rows.push(row);
    else byReservation.set(row.reservationId, [row]);
  }
  const stripeLookups = candidates.filter(
    (row) => needsCharge(row) && hasStripeReference(row),
  ).length;

  const filled: Record<GrossBackfillFact, number> = {
    grossMinor: 0,
    stripeChargeId: 0,
    insuranceShareMinor: 0,
  };
  const unresolved: GrossBackfillUnresolved[] = [];
  const refundGaps: GrossBackfillRefundGap[] = [];
  /** Completed payments left without gross, by store. */
  const withoutGross = new Map<string, number>();
  let reservationsChanged = 0;
  const finish = (outcome: GrossBackfillOutcome): GrossBackfillResult => {
    const storesHeld = [...withoutGross]
      .map(([storeId, count]) => ({ storeId, payments: count }))
      .sort((a, b) => (a.storeId < b.storeId ? -1 : a.storeId > b.storeId ? 1 : 0));
    const result: GrossBackfillResult = {
      apply: options.apply,
      payments: candidates.length,
      reservations: byReservation.size,
      stripeLookups,
      filled,
      reservationsChanged,
      unresolved,
      storesHeld,
      refundGaps,
      outcome,
    };
    const event: GrossBackfillEvent = {
      billing: {
        event: "gross_backfill",
        apply: options.apply,
        outcome: outcome.kind,
        payments: result.payments,
        stripeLookups,
        filled,
        reservationsChanged,
        unresolved: unresolved.length,
        storesHeld: storesHeld.length,
        refundGaps: refundGaps.length,
      },
    };
    if (outcome.kind === "done" && unresolved.length === 0 && refundGaps.length === 0)
      logger.info(event);
    else logger.warn(event);
    return result;
  };

  if (stripeLookups > 0 && options.stripe === null) return finish({ kind: "needs_stripe" });
  const reader = options.stripe === null ? null : chargeReader(options.stripe);
  const lookup = reader?.lookup ?? null;
  /** Charge ids this run gives a payment, so no two payments get the same one. */
  const given = new Set<string>();

  const reservationIds = [...byReservation.keys()];
  for (let start = 0; start < reservationIds.length; start += BATCH) {
    const batch = reservationIds.slice(start, start + BATCH);
    const contexts = await loadContexts(batch);
    for (const reservationId of batch) {
      const rows = byReservation.get(reservationId) ?? [];
      const context = contexts.get(reservationId);
      const first = rows[0];
      // Deleted since the candidates were read.
      if (!context || !first) continue;
      const storeId = first.storeId;

      const planned: PlannedPayment[] = [];
      for (const row of rows) {
        let plan: Planned;
        try {
          plan = await planPayment(row, context, lookup);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.error({
            billing: {
              event: "gross_backfill_stripe_failed",
              paymentId: row.id,
              reservationId,
              storeId,
              error: message,
            },
          });
          return finish({
            kind: "stripe_failed",
            paymentId: row.id,
            reservationId,
            error: message,
          });
        }
        planned.push({ row, plan });
        for (const entry of plan.unresolved) {
          unresolved.push({ paymentId: row.id, reservationId, storeId, ...entry });
        }
      }
      const fills = planned.map(({ plan }) => plan.fill);

      const chargeIds = fills.flatMap((fill) =>
        fill.stripeChargeId === undefined ? [] : [fill.stripeChargeId],
      );
      const held = await heldChargeIds(chargeIds);
      for (const fill of fills) {
        const chargeId = fill.stripeChargeId;
        if (chargeId === undefined) continue;
        if (held.has(chargeId) || given.has(chargeId)) {
          delete fill.stripeChargeId;
          unresolved.push({
            paymentId: fill.paymentId,
            reservationId,
            storeId,
            facts: ["stripeChargeId"],
            reason: "charge_shared",
          });
        } else {
          given.add(chargeId);
        }
      }

      for (const { row, plan } of planned) {
        if (row.status === "completed" && (row.grossMinor ?? plan.fill.grossMinor) === undefined)
          withoutGross.set(storeId, (withoutGross.get(storeId) ?? 0) + 1);
      }
      for (const gap of refundGapsOf(planned, context)) {
        refundGaps.push({ reservationId, storeId, ...gap });
      }

      const toWrite = fills.filter(hasFact);
      if (toWrite.length === 0) continue;
      if (options.apply) {
        const changed = await writeFills({ id: reservationId, storeId }, toWrite);
        if (changed === 0) continue;
      }
      reservationsChanged += 1;
      for (const fill of toWrite) {
        for (const fact of FACTS) if (fill[fact] !== undefined) filled[fact] += 1;
      }
    }
  }

  const backfilledAt = await readGrossBackfilledAt();
  // Stripe found nothing: the key is not the one these payments were taken with. Once
  // the column is set, a run reads only what stayed unresolved, which Stripe may lack.
  if (
    backfilledAt === null &&
    reader !== null &&
    reader.counts.asked > 0 &&
    reader.counts.answered === 0
  ) {
    return finish({ kind: "stripe_found_none", lookups: reader.counts.asked });
  }
  if (!options.apply || backfilledAt !== null) {
    return finish({ kind: "done", grossBackfilledAt: backfilledAt });
  }
  // A second run keeps the first run's time.
  await updateSyncState({
    grossBackfilledAt: sql`COALESCE(${billingSyncState.grossBackfilledAt}, CURRENT_TIMESTAMP(3))`,
  });
  return finish({ kind: "done", grossBackfilledAt: await readGrossBackfilledAt() });
}

/** Read without creating the state row (readSyncState does), so a dry run writes nothing. */
async function readGrossBackfilledAt(): Promise<Date | null> {
  const [row] = await db
    .select({ at: billingSyncState.grossBackfilledAt })
    .from(billingSyncState)
    .where(eq(billingSyncState.id, SYNC_STATE_ID));
  return row?.at ?? null;
}
