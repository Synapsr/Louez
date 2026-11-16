import {
  ConsumableStockError,
  db,
  getBlockingReservationStatuses,
  isReservationChangeBusyError,
  markReservation,
  productUnits,
  readReservationStockDemand,
  reconcileReservationStock,
  reservationActivity,
  reservationItems,
  reservationStatusConsumesStock,
  reservations,
  runReservationChange,
  type ReservationStatus,
  type Transaction,
} from "@louez/db";
import type { PricingBreakdown } from "@louez/types";
import { evaluateReservationRules, getRentalPaid, isPooledCombinationKey } from "@louez/utils";
import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  describeShortfallLine,
  reservationErrors,
  type CapacityShortfall,
  type DateChange,
  type DateChangeDashboardReason,
  type Reservation,
} from "../contracts/reservations";
import type { Credential, Transport } from "../platform/actor";
import { raiseConfirmation, type ConfirmationRefusal } from "../platform/confirmation";
import { enqueueEffects } from "../platform/effects";
import { sha256, stableStringify } from "../platform/hash";
import type { ApiEvent, ApiEventStore, ApiPorts } from "../platform/ports";
import type { ApprovalPresentation } from "./approval-display";
import { moveDatesPresentation } from "./approval-presentations";
import { resolveDateChangeRequests } from "./date-change-requests";
import { getReservation, type ReservationReader } from "./reservations";
import {
  computeReservationTotals,
  getReservationItemTaxFields,
  priceCart,
  type PricedCart,
  type ReservationTotals,
} from "./price-cart";
import { loadPricingCatalog, type PricingCatalog } from "./pricing-catalog";
import { NOT_RECORDED, recordedPromotion } from "./pricing-facts";
import { validateReservationContract } from "./reservation-contract-validation";
import { isReservationEditable } from "./reservation-editable";
import {
  ReservationCapacityShortfallError,
  ReservationInventoryError,
  ReservationTurnoverBufferShortfallError,
  ReservationUnitConflictError,
  checkDateChangeInventory,
  stockDemandOf,
  type StockDemandLine,
} from "./reservation-inventory";
import { compareReservationDemand, fingerprintReservationEdit } from "./util.reservation-edit";

/**
 * A reservation's dates moved by the store, from the API and agents
 * (`reservations.update`, docs/domain/reservation-changes.md, slice 12a).
 *
 * The rule: the change is priced by the checkout's own pricing
 * (`loadPricingCatalog`, `priceCart`) and the tax engine
 * (`computeReservationTotals`) under the locks, and goes on only when that
 * pricing gives the reservation's stored prices back to the cent over its
 * stored window: every line's total and tax figures, the subtotal, the tax
 * and the total. Otherwise, or when the reservation holds a fact this change
 * cannot derive again (insurance, a custom or hand-priced line, a promo code
 * or a discount, a marketplace price, an open extension checkout, an address
 * delivery, a product or variant gone, a fact never recorded), it refuses with
 * `RESERVATION_EDIT_IN_DASHBOARD` and the reason: it never reprices
 * approximately. The stock is checked as the store's confirmation checks it,
 * over the new window, with the edit's demand rule
 * (`checkDateChangeInventory`).
 *
 * The lines keep their ids, products, variants, quantities and units; the
 * deposit and the delivery fee are kept as stored. It never calls the
 * insurer, the routing service, Stripe or an e-mail: the customer's message,
 * when asked for, is a row of the outbox written with the change.
 *
 * Lock order (docs/code-review/04-data-layer.md, DL-12): the owner entry
 * `runReservationChange` locks the reservation's products by id, then the
 * reservation, then the stock check locks the units it holds. The work may
 * run three times: it holds no outside effect.
 */

/** Who moves the dates, on which store, and where the effects go. */
export interface DateChangeCaller {
  storeId: string;
  /** The signed-in user, recorded on the activity row. */
  userId: string | null;
  /** The key, the grant or the session the call came with, recorded on the activity row. */
  credential: Pick<Credential, "kind" | "id">;
  transport: Transport;
  /** May read customers: the preview then names the customer and where the message goes. */
  customers: boolean;
  /** How the answer's reservation is read for this caller (its customer and payments shown or not). */
  reader: ReservationReader;
  store: ApiEventStore;
  ports: Pick<ApiPorts, "afterCommit" | "dispatchEffects" | "emailConfigured">;
}

export interface DateChangeRequest {
  id: string;
  /** Absent: the start stays as stored. */
  startDate?: Date;
  /** Absent: the end stays as stored. */
  endDate?: Date;
  notifyCustomer: boolean;
  /** Book over the returnable stock the new dates find short, on purpose (S3). */
  allowOverbooking?: boolean;
  /** Pass the lines only the turnover buffer stops, on purpose, for this change only (S4, D5). */
  overrideTurnoverBuffer?: boolean;
}

/** The message the customer gets of a date change, when the caller asks for it. */
export const DATE_CHANGE_MESSAGE = "reservation_modified";

/** What a date change will do, under its locks, for its confirmation. */
export interface DateChangePreview {
  summary: string;
  reservation: {
    id: string;
    number: string;
    status: ReservationStatus;
    currency: string;
    previousStartDate: string;
    previousEndDate: string;
    startDate: string;
    endDate: string;
    previousTotal: string;
    total: string;
    previousTaxAmount: string | null;
    taxAmount: string | null;
    subtotalExclTax: string | null;
    /** Kept as stored. */
    deposit: string;
    /** New total less the previous one: owed when positive. */
    difference: string;
  };
  /** Null when the caller may not read customers. */
  customer: { name: string; email: string } | null;
  /** Each line, old and new price. */
  lines: Array<{
    id: string;
    product: string;
    quantity: number;
    previousTotal: string;
    total: string;
  }>;
  /**
   * The stock verdict of the new dates, counted without the buffer: the lines
   * short on the stock. Empty when the stock covers them, or when no check
   * was needed (the window stays inside the stored one, or the reservation
   * holds no stock yet).
   */
  capacity: { overbooked: boolean; shortfalls: CapacityShortfall[] };
  /** Sent with `allowOverbooking`: the lines booked over the stock (none when it covers them). */
  overbooking: { shortfalls: CapacityShortfall[] } | null;
  /** Sent with `overrideTurnoverBuffer`: the lines passed past the buffer, and the buffer. */
  turnoverBuffer: { shortfalls: CapacityShortfall[]; turnoverBufferMinutes: number } | null;
  /** The units the lines hold, which move with the dates. */
  units: Array<{ line: string; unit: string }>;
  /** The message the customer gets, on which channel, and where to a caller who may read customers. */
  messages: Array<{ message: typeof DATE_CHANGE_MESSAGE; channel: "email" | "sms"; to?: string }>;
  warnings: DateChange["warnings"];
  /** Where the messages go and in which language, never shown: the confirmation binds it. */
  recipientsHash: string;
  /** The reservation's stock demand (lines, units), never shown: the confirmation binds it. */
  demand: StockDemandLine[];
  /** The reservation as the change read it (`fingerprintReservationEdit`), never shown: bound. */
  fingerprint: string;
}

/** Asks the caller under the change's locks: null goes on, a refusal stops, raised after the transaction. */
export type DateChangeConfirmStep = (
  preview: DateChangePreview,
  tx: Transaction,
  presentation: ApprovalPresentation | null,
) => Promise<ConfirmationRefusal | null>;

/** The activity's actor, as the reservation's history shows it. */
const activityActor = (transport: Transport) =>
  transport === "rpc" ? "store_user" : transport === "mcp" ? "mcp" : "api";

/** An instant the whole-second columns hold as it is. */
const isWholeSecond = (at: Date) => Number.isFinite(at.getTime()) && at.getTime() % 1000 === 0;

const cents = (value: number | string) => Math.round(Number(value) * 100);
const decimal = (minor: number) => (minor / 100).toFixed(2);
/** An amount as the checkout writes it (`create-reservation.ts`): two decimals. */
const money = (value: number) => value.toFixed(2);
const nullableMoney = (value: number | null) => (value === null ? null : money(value));
/** Two amounts, stored and computed, equal to the cent (both absent counts as equal). */
const sameCents = (stored: string | null, computed: number | null) =>
  stored === null || computed === null
    ? stored === null && computed === null
    : cents(stored) === cents(computed);

async function readLocked(tx: Transaction, id: string, storeId: string) {
  return tx.query.reservations.findFirst({
    where: and(eq(reservations.id, id), eq(reservations.storeId, storeId)),
    with: {
      store: true,
      customer: true,
      payments: true,
      items: {
        with: { assignedUnits: true },
        orderBy: (item, { asc }) => [asc(item.createdAt), asc(item.id)],
      },
    },
  });
}
type LockedReservation = NonNullable<Awaited<ReturnType<typeof readLocked>>>;
type LockedItem = LockedReservation["items"][number];

/** An extension the customer is paying for: its activity row says so until it expires. */
async function hasOpenExtensionCheckout(tx: Transaction, reservationId: string, now: number) {
  const rows = await tx
    .select({ metadata: reservationActivity.metadata })
    .from(reservationActivity)
    .where(
      and(
        eq(reservationActivity.reservationId, reservationId),
        eq(reservationActivity.activityType, "modified"),
      ),
    );
  return rows.some(({ metadata }) => {
    const attempt = metadata as { kind?: unknown; status?: unknown; expiresMs?: unknown } | null;
    return (
      attempt?.kind === "rental_extension" &&
      attempt.status === "checkout" &&
      typeof attempt.expiresMs === "number" &&
      attempt.expiresMs > now
    );
  });
}

/**
 * Why this reservation's dates cannot move here, read from what it stores,
 * before any price: null when nothing stops it.
 */
function storedFactRefusal(locked: LockedReservation): DateChangeDashboardReason | null {
  if (locked.source === "marketplace") return "marketplace";
  if (
    locked.tulipInsuranceOptIn ||
    locked.tulipContractId ||
    Number(locked.tulipInsuranceAmount ?? 0) > 0
  ) {
    return "insured";
  }
  if (
    locked.returnMethod === "address" ||
    locked.deliveryOption === "delivery" ||
    Number(locked.deliveryFee ?? 0) > 0
  ) {
    return "delivery";
  }
  if (
    locked.items.length === 0 ||
    locked.items.some(
      (item) => item.isCustomItem || !item.productId || item.pricingBreakdown?.isManualOverride,
    )
  ) {
    return "custom_or_manual_lines";
  }
  if (Number(locked.discountAmount ?? 0) > 0 || locked.promoCodeId) return "discount_or_promo_code";
  if (!locked.currency) return "booking_facts_missing";
  return null;
}

/** The priced lines of a window, in the lines' order; null when a line's product is not in the catalogue. */
function priceWindow(
  catalog: PricingCatalog,
  items: readonly LockedItem[],
  window: { start: Date; end: Date },
  now: Date,
): PricedCart | null {
  const priced = priceCart({
    catalog,
    now,
    lines: items.map((item) => ({
      productId: item.productId ?? "",
      quantity: item.quantity,
      startDate: window.start.toISOString(),
      endDate: window.end.toISOString(),
    })),
  });
  return priced.ok ? priced.cart : null;
}

/** The tax engine over a priced window, with the delivery fee and the deposit as stored. */
const totalsOf = (cart: PricedCart, locked: LockedReservation) =>
  computeReservationTotals({
    lines: cart.lines,
    insuranceAmount: 0,
    discountAmount: 0,
    deliveryFee: Number(locked.deliveryFee ?? 0),
    totalDeposit: Number(locked.depositAmount),
    taxSettings: locked.store.settings?.tax,
    // A row older than its own currency is in the store's (M2).
    currency: locked.currency ?? locked.store.settings?.currency ?? null,
  });

/**
 * Whether today's pricing gives the stored prices back, to the cent: each
 * line's total and tax figures, the subtotal, the tax and the total. A line
 * that holds no tax figures while the reservation does was booked before
 * they were recorded.
 */
function reproduces(
  locked: LockedReservation,
  cart: PricedCart,
  totals: ReservationTotals,
): "yes" | "prices_not_reproducible" | "booking_facts_missing" {
  const linesMatch = cart.lines.every((line, index) => {
    const item = locked.items[index];
    return item !== undefined && sameCents(item.totalPrice, line.subtotal);
  });
  const reservationMatches =
    sameCents(locked.subtotalAmount, totals.subtotal) &&
    sameCents(locked.totalAmount, totals.total) &&
    sameCents(locked.taxAmount, totals.taxAmount) &&
    sameCents(locked.subtotalExclTax, totals.subtotalExclTax) &&
    sameCents(locked.taxRate, totals.taxRate);
  if (!linesMatch || !reservationMatches) return "prices_not_reproducible";
  const lineTaxMatches = cart.lines.every((line, index) => {
    const item = locked.items[index];
    const tax = getReservationItemTaxFields(totals, line, index);
    return (
      item !== undefined &&
      sameCents(item.taxRate, tax.taxRate) &&
      sameCents(item.taxAmount, tax.taxAmount) &&
      sameCents(item.totalExclTax, tax.totalExclTax)
    );
  });
  if (lineTaxMatches) return "yes";
  // Taxes on, and lines with no figures of their own: the booking predates them.
  return totals.taxEnabled && locked.items.some((item) => item.taxAmount === null)
    ? "booking_facts_missing"
    : "prices_not_reproducible";
}

/** A line whose exact combination no unit of its product carries any more. */
async function hasVanishedVariant(
  tx: Transaction,
  locked: LockedReservation,
  catalog: PricingCatalog,
) {
  const exact = locked.items.flatMap((item) => {
    const product = item.productId ? catalog.get(item.productId) : undefined;
    return product?.trackUnits &&
      item.combinationKey &&
      !isPooledCombinationKey(product.bookingAttributeAxes, item.combinationKey)
      ? [{ productId: product.id, combinationKey: item.combinationKey }]
      : [];
  });
  if (exact.length === 0) return false;
  const rows = await tx
    .select({ productId: productUnits.productId, combinationKey: productUnits.combinationKey })
    .from(productUnits)
    .where(
      inArray(
        productUnits.productId,
        exact.map((line) => line.productId),
      ),
    );
  const carried = new Set(rows.map((row) => `${row.productId}\u0000${row.combinationKey}`));
  return exact.some((line) => !carried.has(`${line.productId}\u0000${line.combinationKey}`));
}

/**
 * The line's pricing breakdown as the checkout writes it, from the new
 * window's price. A line that recorded its promotion keeps it recorded
 * (slice 9): the one its new price applied, which the pricing guard has shown
 * is the stored one still in force, or `null` for none. A line that recorded
 * nothing records the promotion its new price applied, if any, as before.
 */
function breakdownOf(
  catalog: PricingCatalog,
  cart: PricedCart,
  totals: ReservationTotals,
  index: number,
  window: { start: Date; end: Date },
  stored: Pick<LockedItem, "pricingBreakdown">,
): PricingBreakdown {
  const recorded = recordedPromotion(stored) !== NOT_RECORDED;
  const line = cart.lines[index]!;
  const product = catalog.get(line.productId);
  const tax = getReservationItemTaxFields(totals, line, index);
  return {
    basePrice: product?.price ?? line.unitPrice,
    effectivePrice: line.unitPrice,
    duration: line.duration,
    durationMinutes: (window.end.getTime() - window.start.getTime()) / 60_000,
    pricingMode: product?.pricingMode ?? "day",
    pricingKind: line.pricingKind,
    discountPercent: line.promotion
      ? line.promotion.percentage
      : line.originalSubtotal > 0 && line.savings > 0
        ? (line.savings / line.originalSubtotal) * 100
        : null,
    discountAmount: line.savings,
    tierApplied: null,
    ...(recorded || line.promotion ? { promotion: line.promotion ?? null } : {}),
    taxRate: tax.taxRate,
    taxAmount: tax.taxAmount,
    subtotalExclTax: tax.totalExclTax,
    subtotalInclTax:
      tax.totalExclTax !== null && tax.taxAmount !== null
        ? tax.totalExclTax + tax.taxAmount
        : line.subtotal,
  };
}

/**
 * The customer's "booking modified" message: one e-mail, the dashboard's
 * modification e-mail, sent by the outbox (`reservation.modifiedEmail`) to
 * the address read here. None unless the caller asked for it.
 */
function messagesOf(locked: LockedReservation, notify: boolean): DateChangePreview["messages"] {
  if (!notify || !locked.customer?.email) return [];
  return [{ message: DATE_CHANGE_MESSAGE, channel: "email" }];
}

const addressOf = (channel: "email" | "sms", locked: LockedReservation) =>
  (channel === "email" ? locked.customer?.email : locked.customer?.phone) ?? undefined;

/** What the new dates leave to watch, none of which refuses the change. */
function warningsOf(
  locked: LockedReservation,
  window: { start: Date; end: Date },
  newTotal: number,
  currency: string,
): DateChange["warnings"] {
  const warnings: DateChange["warnings"] = evaluateReservationRules({
    startDate: window.start,
    endDate: window.end,
    storeSettings: locked.store.settings,
  }).map(({ key, params }) => ({ key, ...(params ? { params } : {}) }));
  if (
    locked.payments.some(
      (payment) => payment.status === "pending" && payment.stripeCheckoutSessionId !== null,
    )
  ) {
    warnings.push({ key: "reservationDates.openPaymentSession" });
  }
  if (
    locked.depositStatus === "authorized" &&
    locked.depositAuthorizationExpiresAt &&
    locked.depositAuthorizationExpiresAt < window.end
  ) {
    warnings.push({
      key: "reservationDates.depositHoldLapsesBeforeEnd",
      params: { expiresAt: locked.depositAuthorizationExpiresAt.toISOString() },
    });
  }
  // Only what was paid in the reservation's currency has paid it (M6).
  const paid = cents(getRentalPaid(locked.payments, currency));
  const total = cents(newTotal);
  if (paid > 0 && total > paid) {
    warnings.push({
      key: "reservationDates.balanceOwed",
      params: { amount: decimal(total - paid), currency },
    });
  } else if (paid > total) {
    warnings.push({
      key: "reservationDates.overpaid",
      params: { amount: decimal(paid - total), currency },
    });
  }
  return warnings;
}

const describeLines = (shortfalls: readonly CapacityShortfall[], suffix: string) =>
  shortfalls
    .map(
      (shortfall) =>
        `${describeShortfallLine(shortfall)}, ${shortfall.requested} asked, ${shortfall.available} free${suffix}`,
    )
    .join("; ");

type Outcome =
  | { kind: "not_found" }
  | { kind: "refused"; error: Error }
  | { kind: "confirm"; refusal: ConfirmationRefusal }
  | { kind: "unchanged"; result: DateChange; reservation: Reservation }
  | {
      kind: "changed";
      result: DateChange;
      reservation: Reservation;
      effectIds: string[];
      status: ReservationStatus;
      lines: number;
    };

/**
 * Moves a reservation's dates, as the store asks from the API or an agent.
 * Refuses, before anything is asked or written: a reservation that is not
 * the store's (`RESERVATION_NOT_FOUND`), not editable
 * (`RESERVATION_NOT_EDITABLE`), a window that is no real window
 * (`RESERVATION_WINDOW_INVALID`), a reservation whose dates must move in the
 * dashboard (`RESERVATION_EDIT_IN_DASHBOARD`, with the reason), then the
 * stock's refusals. The same dates as stored answer `changed: false` and
 * write nothing. `confirm` is asked under the locks; once it passes, the
 * prices, the totals, the dates and the activity row are written, and the
 * customer's message is queued, in one transaction.
 */
export async function changeReservationDates(
  caller: DateChangeCaller,
  request: DateChangeRequest,
  options: { confirm?: DateChangeConfirmStep } = {},
): Promise<{ reservation: Reservation } & DateChange> {
  const { storeId } = caller;
  const { id } = request;
  // The instants are priced, checked, bound and stored as they are: the
  // columns hold whole seconds, so a fraction would price one window and
  // store another. The contract refuses one; so does any other caller.
  for (const [field, at] of [
    ["startDate", request.startDate],
    ["endDate", request.endDate],
  ] as const) {
    if (at && !isWholeSecond(at)) throw reservationErrors.dateNotWholeSeconds(field, at);
  }

  // A plain read first: a reservation that cannot change is refused before
  // any lock; the same rule is checked again under the lock.
  const [current] = await db
    .select({ status: reservations.status })
    .from(reservations)
    .where(and(eq(reservations.id, id), eq(reservations.storeId, storeId)));
  if (!current) throw reservationErrors.notFound(id);
  if (!isReservationEditable(current.status)) {
    throw reservationErrors.notEditable(id, current.status);
  }
  // A message promised that cannot go is refused before anything is asked.
  if (request.notifyCustomer && caller.ports.emailConfigured?.() === false) {
    throw reservationErrors.customerUnreachable(id, "email_not_configured");
  }

  let outcome: Outcome;
  try {
    outcome = await runReservationChange({ reservationId: id, storeId }, async (tx, lock) => {
      const locked = await readLocked(tx, id, storeId);
      if (!locked) return { kind: "not_found" };
      if (!isReservationEditable(locked.status)) {
        return { kind: "refused", error: reservationErrors.notEditable(id, locked.status) };
      }
      const previous = { start: locked.startDate, end: locked.endDate };
      const window = {
        start: request.startDate ?? locked.startDate,
        end: request.endDate ?? locked.endDate,
      };
      if (window.end.getTime() <= window.start.getTime()) {
        const error = reservationErrors.datesInvalid(
          "end_not_after_start",
          window.start,
          window.end,
        );
        return { kind: "refused", error };
      }
      if (locked.status === "ongoing" && window.start.getTime() !== previous.start.getTime()) {
        const error = reservationErrors.datesInvalid(
          "ongoing_start_moved",
          window.start,
          window.end,
        );
        return { kind: "refused", error };
      }

      // What this change cannot derive again: the dashboard's to do.
      const dashboard = (reason: DateChangeDashboardReason): Outcome => ({
        kind: "refused",
        error: reservationErrors.editInDashboard(id, reason),
      });
      if (request.notifyCustomer && !locked.customer?.email) {
        return { kind: "refused", error: reservationErrors.customerUnreachable(id, "no_email") };
      }
      const stored = storedFactRefusal(locked);
      if (stored) return dashboard(stored);
      const now = new Date();
      if (await hasOpenExtensionCheckout(tx, id, now.getTime())) {
        return dashboard("extension_checkout_open");
      }
      const settings = locked.store.settings;
      const catalog = await loadPricingCatalog(tx, {
        storeId,
        productIds: locked.items.flatMap((item) => (item.productId ? [item.productId] : [])),
        timezone: settings?.timezone,
      });
      if (locked.items.some((item) => !item.productId || !catalog.has(item.productId))) {
        return dashboard("product_unavailable");
      }
      if (await hasVanishedVariant(tx, locked, catalog)) return dashboard("variant_unavailable");

      // The pricing guard: today's rules over the stored window give the stored prices back.
      const storedCart = priceWindow(catalog, locked.items, previous, now);
      if (!storedCart) return dashboard("product_unavailable");
      const verdict = reproduces(locked, storedCart, totalsOf(storedCart, locked));
      if (verdict !== "yes") return dashboard(verdict);

      const currency = locked.currency!.toUpperCase();
      const previousResult = {
        previousStartDate: previous.start,
        previousEndDate: previous.end,
        previousTotal: money(Number(locked.totalAmount)),
      };

      // The same dates: nothing to do, nothing written, nothing sent.
      if (
        window.start.getTime() === previous.start.getTime() &&
        window.end.getTime() === previous.end.getTime()
      ) {
        return {
          kind: "unchanged",
          // The answer is this transaction's read, never one made after it.
          reservation: await getReservation(caller.reader, id, tx),
          result: {
            changed: false,
            ...previousResult,
            difference: "0.00",
            warnings: [],
            capacity: { overbooked: false, shortfalls: [] },
            customerMessage: null,
          },
        };
      }

      // The new prices, by the same engine.
      const cart = priceWindow(catalog, locked.items, window, now);
      if (!cart) return dashboard("product_unavailable");
      const totals = totalsOf(cart, locked);
      if (!Number.isFinite(totals.total) || totals.total > 99_999_999.99) {
        return dashboard("prices_not_reproducible");
      }

      // The stock over the new window, as a confirmation checks it, when the
      // reservation holds stock; only a window reaching outside the stored
      // one asks more of it, and may refuse.
      const blockingStatuses = getBlockingReservationStatuses(
        settings?.pendingBlocksAvailability ?? true,
      );
      const holdsStock = blockingStatuses.some((status) => status === locked.status);
      const demand = compareReservationDemand(
        { start: previous.start, end: previous.end, lines: locked.items },
        { start: window.start, end: window.end, lines: locked.items },
        (productId) => catalog.get(productId)?.bookingAttributeAxes,
      );
      const allowOverbooking = request.allowOverbooking === true;
      const overrideTurnoverBuffer = request.overrideTurnoverBuffer === true;
      const stock = holdsStock
        ? await checkDateChangeInventory(tx, id, storeId, window, {
            refuses: demand.raisedProductIds.size > 0,
            allowOverbooking,
            overrideTurnoverBuffer,
          })
        : null;
      const bookedOver = stock?.verdict ? stock.bookedOver : [];
      const pastBuffer = stock?.pastBuffer ?? [];

      // The preview, its confirmation and the message share one read.
      const name = [locked.customer?.firstName, locked.customer?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();
      const customer =
        caller.customers && locked.customer ? { name, email: locked.customer.email } : null;
      const messages = messagesOf(locked, request.notifyCustomer);
      const difference = decimal(cents(totals.total) - cents(locked.totalAmount));
      const warnings = warningsOf(locked, window, totals.total, currency);
      const lines = cart.lines.map((line, index) => {
        const item = locked.items[index]!;
        return {
          id: item.id,
          product: item.productSnapshot?.name || line.productName,
          quantity: item.quantity,
          previousTotal: money(Number(item.totalPrice)),
          total: money(line.subtotal),
        };
      });
      const preview = buildPreview({
        locked,
        caller,
        currency,
        window,
        totals,
        difference,
        lines,
        customer,
        messages,
        warnings,
        capacity: { overbooked: bookedOver.length > 0, shortfalls: bookedOver },
        overbooking: allowOverbooking ? { shortfalls: bookedOver } : null,
        turnoverBuffer: overrideTurnoverBuffer
          ? { shortfalls: pastBuffer, turnoverBufferMinutes: stock?.turnoverBufferMinutes ?? 0 }
          : null,
        demand: stockDemandOf(await readReservationStockDemand(tx, lock, null)),
      });
      if (options.confirm) {
        const presentation =
          allowOverbooking || overrideTurnoverBuffer ? moveDatesPresentation(preview) : null;
        const refusal = await options.confirm(preview, tx, presentation);
        // Committed: the new preview stays recorded for its token.
        if (refusal) return { kind: "confirm", refusal };
      }

      // The write, as the extension writes its plan: each line's prices and
      // tax figures, the reservation's totals and dates.
      for (const [index, line] of cart.lines.entries()) {
        const item = locked.items[index]!;
        const tax = getReservationItemTaxFields(totals, line, index);
        await tx
          .update(reservationItems)
          .set({
            unitPrice: money(line.unitPrice),
            totalPrice: money(line.subtotal),
            taxRate: nullableMoney(tax.taxRate),
            taxAmount: nullableMoney(tax.taxAmount),
            priceExclTax: nullableMoney(tax.priceExclTax),
            totalExclTax: nullableMoney(tax.totalExclTax),
            pricingBreakdown: breakdownOf(catalog, cart, totals, index, window, item),
            // A product line: the engine applied its rate.
            taxExempt: false,
          })
          .where(and(eq(reservationItems.id, item.id), eq(reservationItems.reservationId, id)));
      }
      const changedAt = new Date();
      await tx
        .update(reservations)
        .set({
          startDate: window.start,
          endDate: window.end,
          subtotalAmount: money(totals.subtotal),
          totalAmount: money(totals.total),
          subtotalExclTax: nullableMoney(totals.subtotalExclTax),
          taxAmount: nullableMoney(totals.taxAmount),
          taxRate: nullableMoney(totals.taxRate),
          // A recorded fact is the one these amounts were computed with (slice 9).
          taxDisplayMode: totals.displayMode,
          updatedAt: changedAt,
          // The inbox dates a late pickup or return from its last schedule change.
          scheduleChangedAt: changedAt,
        })
        .where(and(eq(reservations.id, id), eq(reservations.storeId, storeId)));
      await resolveDateChangeRequests(tx, id, window.start, window.end, locked.status);
      // Dates and totals are in the billing snapshot.
      await markReservation(tx, { id, storeId });
      // Then what the dashboard's edit does after its write.
      await validateReservationContract(tx, id, storeId, "confirmation");
      if (reservationStatusConsumesStock(locked.status)) {
        await reconcileReservationStock(tx, id, storeId);
      }

      const overridden = bookedOver.length > 0 || pastBuffer.length > 0;
      await tx.insert(reservationActivity).values({
        id: nanoid(),
        reservationId: id,
        userId: caller.userId,
        activityType: "modified",
        metadata: {
          actor: activityActor(caller.transport),
          previous: {
            startDate: previous.start,
            endDate: previous.end,
            subtotalAmount: Number(locked.subtotalAmount),
            depositAmount: Number(locked.depositAmount),
            totalAmount: Number(locked.totalAmount),
          },
          updated: {
            startDate: window.start,
            endDate: window.end,
            subtotalAmount: Number(money(totals.subtotal)),
            depositAmount: Number(locked.depositAmount),
            totalAmount: Number(money(totals.total)),
          },
          difference: Number(difference),
          currency,
          ...stock?.verdict?.activityMetadata,
          // Booked over the stock or past the buffer: by which key, grant or session.
          ...(overridden
            ? { credential: { kind: caller.credential.kind, id: caller.credential.id } }
            : {}),
          ...(warnings.length > 0 ? { validationWarnings: warnings } : {}),
          notifyCustomer: request.notifyCustomer,
        },
        createdAt: stock?.verdict?.activityAt,
      });

      const effectIds = await enqueueDateChangeMessages(tx, caller, locked, preview);
      return {
        kind: "changed",
        // Read after the write, before the commit: this change's own result,
        // whatever commits after it.
        reservation: await getReservation(caller.reader, id, tx),
        status: locked.status,
        lines: locked.items.length,
        effectIds,
        result: {
          changed: true,
          ...previousResult,
          difference,
          warnings,
          capacity: { overbooked: bookedOver.length > 0, shortfalls: bookedOver },
          customerMessage:
            effectIds.length > 0
              ? { channel: "email", to: caller.customers ? (locked.customer?.email ?? null) : null }
              : null,
        },
      };
    });
  } catch (error) {
    if (isReservationChangeBusyError(error)) throw reservationErrors.busy(id);
    if (error instanceof ReservationUnitConflictError) {
      throw reservationErrors.datesUnitsUnavailable(error.conflicts);
    }
    if (error instanceof ReservationCapacityShortfallError) {
      throw reservationErrors.datesInsufficientCapacity(error.shortfalls);
    }
    if (error instanceof ReservationTurnoverBufferShortfallError) {
      throw reservationErrors.datesTurnoverBufferShortfall(error.shortfalls);
    }
    if (error instanceof ConsumableStockError || error instanceof ReservationInventoryError) {
      throw error.message === "errors.reservationNotFound"
        ? reservationErrors.notFound(id)
        : reservationErrors.itemsUnavailable(error.message);
    }
    throw error;
  }

  if (outcome.kind === "not_found") throw reservationErrors.notFound(id);
  if (outcome.kind === "confirm") return raiseConfirmation(outcome.refusal);
  if (outcome.kind === "refused") throw outcome.error;
  if (outcome.kind === "unchanged") {
    return { reservation: outcome.reservation, ...outcome.result };
  }

  if (outcome.effectIds.length > 0) {
    try {
      caller.ports.dispatchEffects(outcome.effectIds);
    } catch (error) {
      // The rows stay pending: the cron sends them.
      console.error("Dispatching the effects of a date change failed:", error);
    }
  }
  emit(caller, {
    type: "reservation.datesChanged",
    store: caller.store,
    reservationId: id,
    transport: caller.transport,
    status: outcome.status,
    itemCount: outcome.lines,
    warningCount: outcome.result.warnings.length,
    notifyCustomer: request.notifyCustomer,
  });
  return { reservation: outcome.reservation, ...outcome.result };
}

function buildPreview(facts: {
  locked: LockedReservation;
  caller: DateChangeCaller;
  currency: string;
  window: { start: Date; end: Date };
  totals: ReservationTotals;
  difference: string;
  lines: DateChangePreview["lines"];
  customer: DateChangePreview["customer"];
  messages: DateChangePreview["messages"];
  warnings: DateChange["warnings"];
  capacity: DateChangePreview["capacity"];
  overbooking: DateChangePreview["overbooking"];
  turnoverBuffer: DateChangePreview["turnoverBuffer"];
  demand: StockDemandLine[];
}): DateChangePreview {
  const { locked, caller, currency, window, totals, customer, messages } = facts;
  const total = money(totals.total);
  const previousTotal = money(Number(locked.totalAmount));
  const who = customer ? `${customer.name} (${customer.email})` : "the customer";
  const label = `reservation #${locked.number}${customer ? ` for ${customer.name}` : ""}`;
  const summary = [
    `Move ${label} from ${locked.startDate.toISOString()} – ${locked.endDate.toISOString()} to ${window.start.toISOString()} – ${window.end.toISOString()}.`,
    `Its total goes from ${previousTotal} to ${total} ${currency} (difference ${facts.difference} ${currency}), priced by today's rules, which give its stored prices back; the deposit stays ${money(Number(locked.depositAmount))} ${currency}. Nothing is charged or refunded.`,
    facts.overbooking
      ? facts.overbooking.shortfalls.length > 0
        ? `The stock cannot cover the new dates, and they are booked over it all the same: ${describeLines(facts.overbooking.shortfalls, "")}. The reservation's history records it.`
        : "The stock covers the new dates: nothing is booked over it."
      : null,
    facts.turnoverBuffer
      ? facts.turnoverBuffer.shortfalls.length > 0
        ? `These lines fit the stock but not the ${facts.turnoverBuffer.turnoverBufferMinutes}-minute turnover buffer, and move all the same: ${describeLines(facts.turnoverBuffer.shortfalls, " with the buffer")}. The reservation's history records it.`
        : "The turnover buffer stops no line: nothing goes past it."
      : null,
    messages.length > 0
      ? `${who} gets the "booking modified" message by ${messages.map((entry) => entry.channel).join(" and ")}.`
      : "No message goes to the customer.",
  ]
    .filter(Boolean)
    .join(" ");
  const units = facts.locked.items.flatMap((item) =>
    item.assignedUnits.map((unit) => ({ line: item.id, unit: unit.identifierSnapshot })),
  );
  return {
    summary,
    reservation: {
      id: locked.id,
      number: locked.number,
      status: locked.status,
      currency,
      previousStartDate: locked.startDate.toISOString(),
      previousEndDate: locked.endDate.toISOString(),
      startDate: window.start.toISOString(),
      endDate: window.end.toISOString(),
      previousTotal,
      total,
      previousTaxAmount: locked.taxAmount === null ? null : money(Number(locked.taxAmount)),
      taxAmount: nullableMoney(totals.taxAmount),
      subtotalExclTax: nullableMoney(totals.subtotalExclTax),
      deposit: money(Number(locked.depositAmount)),
      difference: facts.difference,
    },
    customer,
    lines: facts.lines,
    capacity: facts.capacity,
    overbooking: facts.overbooking,
    turnoverBuffer: facts.turnoverBuffer,
    units,
    // Where each goes, to a caller who may read customers; otherwise only that it goes.
    messages: caller.customers
      ? messages.map((entry) => ({ ...entry, to: addressOf(entry.channel, locked) }))
      : messages,
    warnings: facts.warnings,
    recipientsHash: sha256(
      stableStringify({
        locale: locked.locale,
        recipients: messages.map((entry) => ({
          channel: entry.channel,
          to: addressOf(entry.channel, locked),
        })),
      }),
    ),
    demand: facts.demand,
    fingerprint: fingerprintReservationEdit(locked, locked.items),
  };
}

/**
 * The customer's message of a date change, queued in the change's
 * transaction (E1), to the address its preview named and its confirmation
 * bound (`recipientsHash`): none unless the caller asked for it.
 */
function enqueueDateChangeMessages(
  tx: Transaction,
  caller: DateChangeCaller,
  locked: LockedReservation,
  preview: DateChangePreview,
): Promise<string[]> {
  const to = locked.customer?.email;
  if (preview.messages.length === 0 || !to) return Promise.resolve([]);
  return enqueueEffects(tx, caller.storeId, [
    {
      type: "reservation.modifiedEmail",
      orderingKey: `reservation:${locked.id}:customer:email`,
      reservationId: locked.id,
      customerId: locked.customerId,
      payload: {
        storeId: caller.storeId,
        reservationId: locked.id,
        to,
        previousPeriod: {
          startDate: locked.startDate.toISOString(),
          endDate: locked.endDate.toISOString(),
        },
        period: { startDate: preview.reservation.startDate, endDate: preview.reservation.endDate },
        userId: caller.userId,
      },
    },
  ]);
}

/** An effect must never fail a write that has committed. */
function emit(caller: DateChangeCaller, event: ApiEvent) {
  try {
    caller.ports.afterCommit(event);
  } catch (error) {
    console.error("A reservation effect failed after its commit:", error);
  }
}
