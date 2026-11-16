import { and, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  assertStoreCanTakeReservations,
  consumeReservationStock,
  customers,
  db,
  getBlockingReservationStatuses,
  insertReservation,
  isReservationChangeBusyError,
  isStoreNotAcceptingReservationsError,
  markReservation,
  productAccessories,
  products,
  reservationActivity,
  reservationItems,
  reservations,
  runReservationTransaction,
  storeIntegrations,
  storeTulipIntegrations,
  stores,
  toWholeSeconds,
  type ReservationBillingEffect,
  type ReservationDemandLine,
  type Transaction,
} from "@louez/db";
import {
  STORE_NOT_ACCEPTING_RESERVATIONS_ERROR,
  withCustomerNotificationDefaults,
  type BookingAttributeAxis,
  type ProductSnapshot,
  type StoreSettings,
  type UnitAttributes,
} from "@louez/types";
import {
  DEFAULT_COMBINATION_KEY,
  billingFromCustomer,
  buildCombinationKey,
  canonicalizeAttributes,
  evaluateReservationRules,
  getDeliveryAvailability,
  hasCompleteAttributes,
  normalizeCurrency,
} from "@louez/utils";
import { isPossiblePhoneNumberInput } from "@louez/validations";

import { productErrors } from "../contracts/products";
import {
  reservationCreateErrors,
  type CreateReservationInput,
  type CreateShortfall,
} from "../contracts/reservation-create";
import { reservationErrors } from "../contracts/reservations";
import type { Credential, Transport } from "../platform/actor";
import { raiseConfirmation, type ConfirmationRefusal } from "../platform/confirmation";
import { approvalErrors, platformErrors } from "../platform/errors";
import { enqueueEffects, type ApiEffect } from "../platform/effects";
import { recordOperationTarget } from "../platform/operations";
import { sha256, stableStringify } from "../platform/hash";
import type { ApiEventStore, ApiPorts } from "../platform/ports";
import type { ApprovalPresentation } from "./approval-display";
import { createReservationPresentation } from "./approval-presentations";
import { capacityVerdictMetadata, turnoverBufferVerdictMetadata } from "./capacity-verdict";
import { buildPrimaryLocationSnapshot } from "./location-snapshots";
import {
  computeReservationTotals,
  getReservationItemTaxFields,
  priceCart,
  type PricedCart,
  type ReservationTotals,
} from "./price-cart";
import { loadPricingCatalog, type PricingCatalog } from "./pricing-catalog";
import { validateRequiredAccessoryLines } from "./required-accessories";
import { validateReservationContract } from "./reservation-contract-validation";
import {
  lockReservationProducts,
  reserveInventory,
  splitShortfallsByTurnoverBuffer,
  stockDemandOf,
  type LineShortfall,
  type StockDemandLine,
} from "./reservation-inventory";
import { generateUniqueReservationNumber } from "./reservation-number";

/**
 * The store's creation of a reservation, for its agents and its members
 * (`reservations.create`): a quote or a confirmed booking of catalog
 * products, picked up at the store's main location, for a customer of the
 * store or one found or added by e-mail.
 *
 * - **Price**: the checkout's (`loadPricingCatalog`, `priceCart`,
 *   `computeReservationTotals`): the catalog, the product's promotion, the
 *   seasonal prices and the tax engine, read under the product locks, in the
 *   currency the checkout writes on a new reservation. The lines keep the
 *   pricing facts the checkout stores.
 * - **Stock**: a confirmation's (S1–S4): the lines checked without the
 *   turnover buffer, then with it (`splitShortfallsByTurnoverBuffer`); a
 *   line short only with the buffer refuses unless `overrideTurnoverBuffer`,
 *   one short on the stock refuses unless `allowOverbooking`; a consumable
 *   short on hand refuses whatever the flags. Required accessories are
 *   checked: the caller composes the cart (slice 3).
 * - **Asked**: `change` always; `customer_message` when a message goes;
 *   `stock_override` when either flag is sent, even with nothing short. The
 *   refusals come first; the confirmation is asked under the locks.
 * - **Written** in one owner-entry transaction (READ COMMITTED, run again on
 *   a lost deadlock, three runs at most, so nothing outside the database
 *   runs in it): the store row's lock, the products by id, the customer, the
 *   number, the row through `insertReservation` (the card gate for a
 *   confirmed booking), its lines, its activity row, the consumables taken
 *   and the contract validated for a confirmed booking, and the outbox rows
 *   of its messages. After the commit: the fee, the dispatch of the outbox,
 *   and the app's own effects (`afterCommit`).
 *
 * Lock order (docs/code-review/04-data-layer.md): the store row, then the
 * products by id (`lockProductRows`, through `lockReservationProducts`), then
 * the new reservation's rows. The store row's lock is what makes the number
 * unique among the creations of this service: each draws and checks its
 * number while it holds it.
 */

/** Who creates, on which store, and where the effects go. */
export interface ReservationCreateCaller {
  storeId: string;
  /** The signed-in user the connection acts for, on the activity row. */
  userId: string | null;
  credential: Pick<Credential, "kind" | "id">;
  transport: Transport;
  store: ApiEventStore;
  ports: Pick<ApiPorts, "afterCommit" | "runReservationEffects" | "dispatchEffects"> & {
    emailConfigured?: ApiPorts["emailConfigured"];
  };
}

export type CreateMessageKind = "quote" | "confirmation";

/** What the creation will do, under its locks, for its confirmation. */
export interface ReservationCreatePreview {
  summary: string;
  status: "quote" | "confirmed";
  /** The customer: one of the store's, or the one this creation adds. */
  customer: {
    id: string | null;
    created: boolean;
    name: string;
    email: string;
  };
  window: { startDate: string; endDate: string };
  currency: string;
  /** Each line with its price, as the checkout prices it. */
  lines: Array<{
    line: number;
    productId: string;
    productName: string;
    quantity: number;
    selectedAttributes: UnitAttributes | null;
    unitPrice: string;
    totalPrice: string;
    promotion: boolean;
  }>;
  totals: {
    subtotal: string;
    taxAmount: string | null;
    taxIncluded: boolean;
    total: string;
    deposit: string;
  };
  /** Sent with `allowOverbooking`: the lines booked over the stock (none when it covers them). */
  overbooking: { shortfalls: CreateShortfall[] } | null;
  /** Sent with `overrideTurnoverBuffer`: the lines passed past the buffer, and the buffer. */
  turnoverBuffer: { shortfalls: CreateShortfall[]; turnoverBufferMinutes: number } | null;
  /** The e-mail the customer gets, or why none goes. */
  message: {
    sends: boolean;
    kind: CreateMessageKind | null;
    channel: "email" | null;
    to: string | null;
    reason: "not_asked" | "store_disabled" | "email_not_configured" | null;
  };
  warnings: Array<{ key: string; params?: Record<string, string | number> }>;
  /** Where the message goes, never shown: bound. */
  recipientsHash: string;
  /** The stock the booking asks for, never shown: bound (`stockDemandOf`). */
  demand: StockDemandLine[];
}

/** How a branch was asked, as the confirmation rule decides it (`confirmationStep`). */
export type CreateAskedStep = (preview: ReservationCreatePreview) => "approval" | "token" | "none";

export type CreateConfirmStep = (
  preview: ReservationCreatePreview,
  tx: Transaction,
  presentation: ApprovalPresentation | null,
) => Promise<ConfirmationRefusal | null>;

/** What the creation answers, before its reservation is read back. */
export interface CreatedReservation {
  id: string;
  number: string;
  customer: { id: string; created: boolean };
  capacity: {
    overbooked: boolean;
    shortfalls: CreateShortfall[];
    pastTurnoverBuffer: CreateShortfall[];
  };
  message: {
    sent: boolean;
    kind: CreateMessageKind | null;
    to: string | null;
    reason: ReservationCreatePreview["message"]["reason"];
  };
  warnings: ReservationCreatePreview["warnings"];
}

type LockedProduct = typeof products.$inferSelect;

/** The customer as the request names it, resolved by a read under the store's lock. */
type ResolvedCustomer =
  | { kind: "existing"; row: typeof customers.$inferSelect }
  | {
      kind: "new";
      email: string;
      firstName: string;
      lastName: string;
      phone: string | null;
    };

/** E-mail as the creation keeps it: trimmed and lowercased. */
export const normalizeCustomerEmail = (email: string) => email.trim().toLowerCase();

/** Money as the checkout writes it on its rows. */
const money = (amount: number) => amount.toFixed(2);

/** The e-mail each status sends, and the customer notification setting it follows. */
const MESSAGE_OF = {
  quote: { kind: "quote", setting: "customer_quote_sent", effect: "reservation.quoteEmail" },
  confirmed: {
    kind: "confirmation",
    setting: "customer_reservation_confirmed",
    effect: "reservation.confirmationEmail",
  },
} as const;

/**
 * What a line chose, read against the product under its lock: its exact
 * combination when every axis has a value, none when it left a choice open
 * (any unit that matches what it did choose serves it). The dashboard's
 * manual creation reads it the same way.
 */
function lineChoice(
  product: { trackUnits: boolean | null; bookingAttributeAxes: BookingAttributeAxis[] | null },
  requested: UnitAttributes | undefined,
): { combinationKey: string | null; selectedAttributes: UnitAttributes | null } {
  const axes = product.bookingAttributeAxes ?? [];
  const chosen = canonicalizeAttributes(axes, requested);
  const combinationKey =
    axes.length > 0
      ? hasCompleteAttributes(axes, chosen)
        ? buildCombinationKey(axes, chosen)
        : null
      : product.trackUnits
        ? DEFAULT_COMBINATION_KEY
        : null;
  return { combinationKey, selectedAttributes: Object.keys(chosen).length > 0 ? chosen : null };
}

/** The first field this version refuses, in the order of `RESERVATION_CREATE_REFUSED_OPTIONS`. */
function refusedOption(input: CreateReservationInput) {
  const set = (value: unknown) => value !== undefined && value !== null;
  if (set(input.customLines)) return reservationCreateErrors.optionNotAvailable("custom_lines");
  if (input.lines.some((line) => set(line.unitPrice) || set(line.priceOverride))) {
    return reservationCreateErrors.optionNotAvailable("price_override");
  }
  if (set(input.depositOverride)) {
    return reservationCreateErrors.optionNotAvailable("deposit_override");
  }
  if (set(input.discountAmount)) return reservationCreateErrors.optionNotAvailable("discount");
  if (set(input.promoCode)) return reservationCreateErrors.optionNotAvailable("promo_code");
  if (set(input.delivery)) return reservationCreateErrors.optionNotAvailable("delivery");
  if (set(input.insurance) || set(input.tulipInsuranceOptIn)) {
    return reservationCreateErrors.optionNotAvailable("insurance");
  }
  if (input.status === "pending") {
    return reservationCreateErrors.optionNotAvailable(
      "pending",
      "A pending booking is the customer's own request or checkout: create a quote for them to accept, or a confirmed booking.",
    );
  }
  return null;
}

/**
 * Whether the store requires insurance on every booking, as its Tulip
 * integration is stored: refused when it does, even if this instance could
 * not reach the insurer now, since that would be read as the store's choice.
 */
async function requiresInsurance(tx: Transaction, storeId: string): Promise<boolean> {
  const [row] = await tx
    .select({ publicMode: storeTulipIntegrations.publicMode })
    .from(storeIntegrations)
    .innerJoin(
      storeTulipIntegrations,
      eq(storeTulipIntegrations.integrationId, storeIntegrations.id),
    )
    .where(
      and(
        eq(storeIntegrations.storeId, storeId),
        eq(storeIntegrations.providerKey, "tulip"),
        eq(storeIntegrations.enabled, true),
      ),
    )
    .limit(1);
  return row?.publicMode === "required";
}

/** The store row, locked: every creation of this service waits for the one before it. */
async function lockStore(tx: Transaction, storeId: string) {
  await tx.execute(sql`SELECT id FROM stores WHERE id = ${storeId} FOR UPDATE`);
  const [store] = await tx.select().from(stores).where(eq(stores.id, storeId));
  return store ?? null;
}

/** The required accessories the lines lack, each with its products' names. */
async function missingAccessories(
  tx: Transaction,
  storeId: string,
  lines: ReadonlyArray<{ productId: string; quantity: number }>,
  locked: Map<string, LockedProduct>,
) {
  const productIds = [...new Set(lines.map((line) => line.productId))];
  // Read after the product locks: the links as they are when the booking is written.
  const requiredAccessories = await tx
    .select({
      parentProductId: productAccessories.productId,
      accessoryProductId: productAccessories.accessoryId,
      quantity: productAccessories.quantity,
    })
    .from(productAccessories)
    .innerJoin(products, eq(productAccessories.productId, products.id))
    .where(
      and(
        eq(products.storeId, storeId),
        eq(productAccessories.required, true),
        inArray(productAccessories.productId, productIds),
      ),
    );
  const check = validateRequiredAccessoryLines({ lines: [...lines], requiredAccessories });
  if (check.valid) return [];
  const unknown = check.missing
    .map((entry) => entry.accessoryProductId)
    .filter((id) => !locked.has(id));
  const names = new Map([...locked.values()].map((product) => [product.id, product.name]));
  if (unknown.length > 0) {
    const rows = await tx
      .select({ id: products.id, name: products.name })
      .from(products)
      .where(and(eq(products.storeId, storeId), inArray(products.id, unknown)));
    for (const row of rows) names.set(row.id, row.name);
  }
  return check.missing.map((entry) => ({
    productId: entry.parentProductId,
    productName: names.get(entry.parentProductId) ?? entry.parentProductId,
    accessoryProductId: entry.accessoryProductId,
    accessoryName: names.get(entry.accessoryProductId) ?? entry.accessoryProductId,
    requiredQuantity: entry.requiredQuantity,
    providedQuantity: entry.providedQuantity,
  }));
}

/** A consumable the lines ask more of than the store has on hand, as taking it would find. */
function consumableShort(
  lines: ReadonlyArray<{ productId: string; quantity: number }>,
  locked: Map<string, LockedProduct>,
): boolean {
  const asked = new Map<string, number>();
  for (const line of lines) {
    const product = locked.get(line.productId);
    if (product?.stockKind !== "consumable") continue;
    asked.set(line.productId, (asked.get(line.productId) ?? 0) + line.quantity);
  }
  return [...asked].some(
    ([productId, quantity]) => quantity > (locked.get(productId)?.quantity ?? 0),
  );
}

/** A shortfall of the creation, by its line, with the choice the check read. */
const ofLine = ({ lineIndex, shortfall, choice }: LineShortfall): CreateShortfall => ({
  ...shortfall,
  line: lineIndex,
  selectedAttributes: choice,
});

/** The shortfalls in the preview's sentence. */
const describe = (shortfalls: readonly CreateShortfall[], free: string) =>
  shortfalls
    .map(
      (shortfall) =>
        `${shortfall.productName}${
          shortfall.selectedAttributes
            ? ` (${Object.entries(shortfall.selectedAttributes)
                .map(([key, value]) => `${key}: ${value}`)
                .join(", ")})`
            : ""
        }, ${shortfall.requested} asked, ${shortfall.available} ${free}`,
    )
    .join("; ");

function summaryOf(preview: Omit<ReservationCreatePreview, "summary">): string {
  const { customer, window, totals, currency, status, message } = preview;
  const who = `${customer.name} (${customer.email}${customer.created ? ", a new customer" : ""})`;
  const what = preview.lines
    .map((line) => `${line.quantity} × ${line.productName} at ${line.totalPrice} ${currency}`)
    .join(", ");
  return [
    `Create a ${status === "quote" ? "quote" : "confirmed booking"} for ${who}, from ${window.startDate} to ${window.endDate}: ${what}.`,
    `Total ${totals.total} ${currency}${totals.taxAmount !== null ? ` (tax ${totals.taxAmount} ${currency}${totals.taxIncluded ? " included" : ""})` : ""}, deposit ${totals.deposit} ${currency}.`,
    status === "confirmed"
      ? "Its items leave the stock for these dates."
      : "A quote takes no stock until it is confirmed.",
    preview.turnoverBuffer
      ? preview.turnoverBuffer.shortfalls.length === 0
        ? "The turnover buffer stops no line."
        : `These lines fit the stock but not the ${preview.turnoverBuffer.turnoverBufferMinutes}-minute turnover buffer, and are booked past it: ${describe(preview.turnoverBuffer.shortfalls, "free with the buffer")}.`
      : null,
    preview.overbooking
      ? preview.overbooking.shortfalls.length === 0
        ? "The stock covers it: nothing is booked over the stock."
        : `The stock cannot cover it, and it is booked over the stock: ${describe(preview.overbooking.shortfalls, "free")}.`
      : null,
    message.sends
      ? `${customer.name} gets the ${message.kind} e-mail at ${message.to}.`
      : message.reason === "not_asked"
        ? "No message goes to the customer."
        : message.reason === "store_disabled"
          ? `No message goes to the customer: the store does not send the ${status === "quote" ? "quote" : "confirmation"} e-mail.`
          : "No message goes to the customer: this instance sends no e-mail.",
    preview.warnings.length > 0
      ? `Outside the store's booking rules: ${preview.warnings.map((warning) => warning.key).join(", ")}.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");
}

type Outcome =
  | { kind: "refused"; error: Error }
  | { kind: "confirm"; refusal: ConfirmationRefusal }
  | {
      kind: "created";
      created: CreatedReservation;
      effects: ReservationBillingEffect[];
      effectIds: string[];
      facts: Record<string, string | number | boolean | null>;
    };

/**
 * Creates the reservation, as the class comment says. `confirm` is asked
 * under the locks, once every refusal is behind; a refusal of it commits
 * its preview only, and is raised once the transaction is over.
 */
export async function createStoreReservation(
  caller: ReservationCreateCaller,
  input: CreateReservationInput,
  options: { confirm?: CreateConfirmStep; asked?: CreateAskedStep } = {},
): Promise<CreatedReservation> {
  const option = refusedOption(input);
  if (option) throw option;
  const status = input.status as "quote" | "confirmed";
  const start = new Date(input.startDate);
  const end = new Date(input.endDate);
  if (!(end.getTime() > start.getTime())) throw reservationCreateErrors.windowInvalid();
  if ("email" in input.customer && input.customer.phone) {
    if (!isPossiblePhoneNumberInput(input.customer.phone)) {
      throw reservationCreateErrors.invalidPhone();
    }
  }
  const { storeId } = caller;
  const allowOverbooking = input.allowOverbooking === true;
  const overrideTurnoverBuffer = input.overrideTurnoverBuffer === true;
  const emailConfigured = caller.ports.emailConfigured?.() !== false;

  let outcome: Outcome;
  try {
    outcome = await runReservationTransaction(async (tx): Promise<Outcome> => {
      const refuse = (error: Error): Outcome => ({ kind: "refused", error });
      // The store row first: the lock order's first lock, under which the number is drawn.
      const store = await lockStore(tx, storeId);
      if (!store) return refuse(platformErrors.noStore());
      const settings: StoreSettings | null = store.settings;

      if (await requiresInsurance(tx, storeId))
        return refuse(reservationCreateErrors.insuranceRequired());
      if (getDeliveryAvailability(settings?.delivery, store).deliveryOnly) {
        return refuse(reservationCreateErrors.deliveryRequired());
      }

      // The products by id, then read as they are under their locks.
      const locked = await lockReservationProducts(
        tx,
        storeId,
        input.lines.map((line) => line.productId),
      );
      for (const line of input.lines) {
        const product = locked.get(line.productId);
        if (!product) return refuse(productErrors.notFound(line.productId));
        if (product.status !== "active") {
          return refuse(
            reservationCreateErrors.productNotBookable(product.id, product.status ?? "draft"),
          );
        }
      }

      // The customer, resolved and locked before the preview, so what is shown and
      // bound is what is written: an existing customer's row is held to the commit;
      // a new one is added after the ask, and checked again then (`resolveCustomer`).
      let customer: ResolvedCustomer;
      if ("id" in input.customer) {
        const [row] = await tx
          .select()
          .from(customers)
          .where(and(eq(customers.id, input.customer.id), eq(customers.storeId, storeId)))
          .for("update");
        if (!row) return refuse(reservationCreateErrors.customerNotFound(input.customer.id));
        customer = { kind: "existing", row };
      } else {
        const email = normalizeCustomerEmail(input.customer.email);
        const [row] = await tx
          .select()
          .from(customers)
          .where(and(eq(customers.storeId, storeId), eq(customers.email, email)))
          .for("update");
        customer = row
          ? { kind: "existing", row }
          : {
              kind: "new",
              email,
              firstName: input.customer.firstName,
              lastName: input.customer.lastName,
              phone: input.customer.phone ?? null,
            };
      }
      const customerEmail = (
        customer.kind === "existing" ? customer.row.email : customer.email
      ).trim();
      if (input.notifyCustomer && !customerEmail) {
        return refuse(
          reservationCreateErrors.customerNoEmail(
            customer.kind === "existing" ? customer.row.id : "new",
          ),
        );
      }

      // The composition rule: the caller composes the cart.
      const missing = await missingAccessories(tx, storeId, input.lines, locked);
      if (missing.length > 0)
        return refuse(reservationCreateErrors.requiredAccessoriesMissing(missing));

      // The price: the checkout's, read under the locks.
      const now = new Date();
      const catalog: PricingCatalog = await loadPricingCatalog(tx, {
        storeId,
        productIds: input.lines.map((line) => line.productId),
        timezone: settings?.timezone,
      });
      const priced = priceCart({
        catalog,
        lines: input.lines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          startDate: start.toISOString(),
          endDate: end.toISOString(),
        })),
        now,
      });
      if (!priced.ok) return refuse(productErrors.notFound(priced.missingProductId));
      const cart: PricedCart = priced.cart;
      const totals: ReservationTotals = computeReservationTotals({
        lines: cart.lines,
        insuranceAmount: 0,
        discountAmount: 0,
        deliveryFee: 0,
        totalDeposit: cart.totalDeposit,
        taxSettings: settings?.tax,
      });
      const currency = normalizeCurrency(settings?.currency);

      // The stock: a confirmation's check, without the buffer then with it.
      const choices = input.lines.map((line) =>
        lineChoice(locked.get(line.productId)!, line.selectedAttributes),
      );
      if (consumableShort(input.lines, locked)) {
        return refuse(reservationErrors.itemsUnavailable("errors.consumableInsufficientStock"));
      }
      const turnoverBufferMinutes = settings?.turnoverBufferMinutes ?? 0;
      const check = (bufferMinutes: number) =>
        reserveInventory({
          tx,
          storeId,
          lockedProductsById: locked,
          lines: input.lines.map((line, index) => ({
            productId: line.productId,
            quantity: line.quantity,
            selectedAttributes: choices[index]?.selectedAttributes ?? undefined,
            combinationKey: choices[index]?.combinationKey ?? null,
            pooled: choices[index]?.combinationKey === null,
          })),
          window: { start, end },
          turnoverBufferMinutes: bufferMinutes,
          blockingStatuses: getBlockingReservationStatuses(
            settings?.pendingBlocksAvailability ?? true,
          ),
          skipConsumableCheck: true,
          skipRequiredAccessoryCheck: true,
          onShortfall: "collect",
        });
      const unbuffered = await check(0);
      if (!unbuffered.ok) return refuse(productErrors.notFound(input.lines[0]!.productId));
      const split = await splitShortfallsByTurnoverBuffer(check, turnoverBufferMinutes, {
        withBuffer: false,
        check: unbuffered,
      });
      if (!split.ok) return refuse(productErrors.notFound(input.lines[0]!.productId));
      const bookedOver = split.capacity.map(ofLine);
      const pastBuffer = split.bufferOnly.map(ofLine);
      // The order of a confirmation's refusals: the buffer's lines, then the stock's.
      if (pastBuffer.length > 0 && !overrideTurnoverBuffer) {
        return refuse(reservationCreateErrors.turnoverBufferShortfall(pastBuffer));
      }
      if (bookedOver.length > 0 && !allowOverbooking) {
        return refuse(reservationCreateErrors.insufficientCapacity(bookedOver));
      }
      // The card gate, before anyone is asked; the insert asks it again.
      if (status === "confirmed") await assertStoreCanTakeReservations(tx, storeId);

      const warnings = evaluateReservationRules({
        startDate: start,
        endDate: end,
        storeSettings: settings,
      }).map(({ key, params }) => ({ key, ...(params ? { params } : {}) }));

      // The message, as its sender will decide it: the store's setting, and e-mail at all.
      const said = MESSAGE_OF[status];
      const prefs = withCustomerNotificationDefaults(store.customerNotificationSettings)[
        said.setting
      ];
      const reason: ReservationCreatePreview["message"]["reason"] = !input.notifyCustomer
        ? "not_asked"
        : !prefs.enabled || !prefs.email
          ? "store_disabled"
          : !emailConfigured
            ? "email_not_configured"
            : null;
      const message: ReservationCreatePreview["message"] =
        reason === null
          ? { sends: true, kind: said.kind, channel: "email", to: customerEmail, reason: null }
          : { sends: false, kind: null, channel: null, to: null, reason };

      const demandLines: ReservationDemandLine[] = input.lines.map((line, index) => {
        const product = locked.get(line.productId)!;
        return {
          line: String(index),
          product: line.productId,
          quantity: line.quantity,
          combinationKey: choices[index]?.combinationKey ?? null,
          selectedAttributes: choices[index]?.selectedAttributes ?? null,
          axes: product.bookingAttributeAxes ?? null,
          units: [],
          ...(product.stockKind === "consumable"
            ? { consumable: { consumed: 0, takes: status === "confirmed" ? line.quantity : 0 } }
            : {}),
        };
      });

      const customerName =
        customer.kind === "existing"
          ? `${customer.row.firstName} ${customer.row.lastName}`.trim()
          : `${customer.firstName} ${customer.lastName}`.trim();
      const draft: Omit<ReservationCreatePreview, "summary"> = {
        status,
        customer: {
          id: customer.kind === "existing" ? customer.row.id : null,
          created: customer.kind === "new",
          name: customerName,
          email: customerEmail,
        },
        window: { startDate: start.toISOString(), endDate: end.toISOString() },
        currency,
        lines: cart.lines.map((line, index) => ({
          line: index,
          productId: line.productId,
          productName: line.productName,
          quantity: line.quantity,
          selectedAttributes: choices[index]?.selectedAttributes ?? null,
          unitPrice: money(line.unitPrice),
          totalPrice: money(line.subtotal),
          promotion: Boolean(line.promotion),
        })),
        totals: {
          subtotal: money(totals.subtotal),
          taxAmount: totals.taxAmount === null ? null : money(totals.taxAmount),
          taxIncluded: totals.displayMode === "inclusive",
          total: money(totals.total),
          deposit: money(totals.deposit),
        },
        overbooking: allowOverbooking ? { shortfalls: bookedOver } : null,
        turnoverBuffer: overrideTurnoverBuffer
          ? { shortfalls: pastBuffer, turnoverBufferMinutes }
          : null,
        message,
        warnings,
        recipientsHash: sha256(
          stableStringify({ locale: null, recipients: message.sends ? [message.to] : [] }),
        ),
        demand: stockDemandOf(demandLines),
      };
      const preview: ReservationCreatePreview = { ...draft, summary: summaryOf(draft) };
      if (options.confirm) {
        const refusal = await options.confirm(preview, tx, createReservationPresentation(preview));
        // Committed: the new preview stays recorded for its token. Nothing else was written.
        if (refusal) return { kind: "confirm", refusal };
      }

      // --- Writes, once asked ------------------------------------------------
      const resolved = await resolveCustomer(tx, storeId, customer, {
        country: settings?.country ?? "FR",
        createdVia: caller.transport === "rpc" ? "dashboard" : "api",
      });
      // A new customer was shown, and another write added this e-mail since
      // the read: the insert waited for it under the e-mail's unique key and
      // found its customer. A call that was asked was bound to "a new
      // customer" and never writes for another: thrown, so the transaction
      // rolls back, the token or the approval it carried out with it, and the
      // caller gets a new preview that names the existing customer. A call
      // nobody asked uses the existing customer unchanged (`created: false`).
      if (customer.kind === "new" && !resolved.created) {
        const step = options.asked?.(preview) ?? "none";
        if (step === "approval") throw approvalErrors.invalid("state_changed");
        if (step === "token") throw platformErrors.confirmationInvalid();
      }
      const reservationId = nanoid();
      const number = await generateUniqueReservationNumber(storeId, 5, tx);
      const primary = buildPrimaryLocationSnapshot(store);
      const inserted = await insertReservation(tx, {
        id: reservationId,
        storeId,
        customerId: resolved.row.id,
        number,
        status,
        source: "manual",
        startDate: start,
        endDate: end,
        subtotalAmount: money(totals.subtotal),
        depositAmount: money(totals.deposit),
        totalAmount: money(totals.total),
        subtotalExclTax: totals.subtotalExclTax === null ? null : money(totals.subtotalExclTax),
        taxAmount: totals.taxAmount === null ? null : money(totals.taxAmount),
        taxRate: totals.taxRate === null ? null : money(totals.taxRate),
        discountAmount: money(totals.discount),
        deliveryFee: money(totals.deliveryFee),
        // Frozen at creation, as the checkout writes it.
        currency,
        internalNotes: input.internalNotes || null,
        // Staff books on the customer's behalf: the profile's identity bills it.
        billingSnapshot: billingFromCustomer(resolved.row),
        tulipInsuranceOptIn: false,
        tulipInsuranceAmount: null,
        outboundMethod: "store",
        returnMethod: "store",
        deliveryOption: "pickup",
        pickupLocationId: null,
        returnLocationId: null,
        pickupLocationSnapshot: primary,
        returnLocationSnapshot: primary,
      });

      for (const [index, line] of cart.lines.entries()) {
        const choice = choices[index]!;
        const product = catalog.get(line.productId)!;
        const tax = getReservationItemTaxFields(totals, line, index);
        const snapshot: ProductSnapshot = {
          name: product.name,
          description: null,
          images: product.images.slice(0, 1),
          combinationKey: choice.combinationKey,
          selectedAttributes: choice.selectedAttributes,
        };
        await tx.insert(reservationItems).values({
          id: nanoid(),
          reservationId,
          productId: line.productId,
          isCustomItem: false,
          quantity: line.quantity,
          unitPrice: money(line.unitPrice),
          depositPerUnit: money(line.depositPerUnit),
          totalPrice: money(line.subtotal),
          // The checkout's pricing facts: a line with a promotion keeps its breakdown.
          ...(line.promotion
            ? {
                pricingBreakdown: {
                  basePrice: product.price,
                  effectivePrice: line.unitPrice,
                  duration: line.duration,
                  pricingMode: product.pricingMode,
                  pricingKind: line.pricingKind,
                  discountPercent: line.promotion.percentage,
                  discountAmount: line.promotion.discountAmount,
                  tierApplied: null,
                  promotion: line.promotion,
                  taxRate: tax.taxRate,
                  taxAmount: tax.taxAmount,
                  subtotalExclTax: tax.totalExclTax,
                  subtotalInclTax:
                    tax.totalExclTax !== null && tax.taxAmount !== null
                      ? tax.totalExclTax + tax.taxAmount
                      : line.subtotal,
                },
              }
            : {}),
          productSnapshot: snapshot,
          combinationKey: choice.combinationKey,
          selectedAttributes: choice.selectedAttributes,
          taxRate: tax.taxRate?.toFixed(2) ?? null,
          taxAmount: tax.taxAmount?.toFixed(2) ?? null,
          priceExclTax: tax.priceExclTax?.toFixed(2) ?? null,
          totalExclTax: tax.totalExclTax?.toFixed(2) ?? null,
        });
      }

      // Its lines change what the billing snapshot reads: marked in this transaction (DL-13).
      await markReservation(tx, { id: reservationId, storeId });
      // The operation names the reservation it created, with it: a key whose
      // answer is lost after this commit still finds it (`recoverCreatedReservation`).
      await recordOperationTarget(tx, reservationId);

      const credential = { kind: caller.credential.kind, id: caller.credential.id };
      await tx.insert(reservationActivity).values({
        id: nanoid(),
        reservationId,
        userId: caller.userId,
        activityType: "created",
        metadata: {
          source: "manual",
          channel: caller.transport,
          status,
          credential,
          customerCreated: resolved.created,
          // The stock verdict, counted without the buffer (slice 5b), and what the buffer's flag passed.
          ...capacityVerdictMetadata(bookedOver),
          ...(overrideTurnoverBuffer
            ? turnoverBufferVerdictMetadata(pastBuffer, turnoverBufferMinutes)
            : {}),
          ...(allowOverbooking ? { allowOverbooking: true } : {}),
          ...(warnings.length > 0
            ? { validationWarnings: warnings, validationWarningsCount: warnings.length }
            : {}),
          ...(message.sends
            ? { customerMessage: message.kind, customerMessageTo: resolved.row.email }
            : { customerMessageReason: message.reason }),
        },
        // Whole seconds, as a status change dates its row.
        createdAt: toWholeSeconds(new Date()),
      });

      if (status === "confirmed") {
        // What a confirmation does: the consumables taken, the contract validated.
        await consumeReservationStock(tx, inserted.lock);
        await validateReservationContract(tx, reservationId, storeId, "confirmation");
      }

      const effects: ApiEffect[] = [
        // To the customer's address as their row holds it: the one the sender checks.
        ...(message.sends
          ? [
              {
                type: said.effect,
                orderingKey: `reservation:${reservationId}:customer:email`,
                reservationId,
                customerId: resolved.row.id,
                payload: { storeId, reservationId, to: resolved.row.email },
              } as ApiEffect,
            ]
          : []),
        // The platform's notice of a new reservation, as the dashboard's creation sends it.
        ...(["discord", "fromhello"] as const).map(
          (channel): ApiEffect => ({
            type: "reservation.createdPlatformNotification",
            orderingKey: `reservation:${reservationId}:platform:${channel}`,
            reservationId,
            payload: { channel, storeId, reservationId, totalAmount: money(totals.total) },
          }),
        ),
      ];
      const effectIds = await enqueueEffects(tx, storeId, effects);

      return {
        kind: "created",
        created: {
          id: reservationId,
          number,
          customer: { id: resolved.row.id, created: resolved.created },
          capacity: {
            overbooked: bookedOver.length > 0,
            shortfalls: bookedOver,
            pastTurnoverBuffer: overrideTurnoverBuffer ? pastBuffer : [],
          },
          message: {
            sent: message.sends,
            kind: message.kind,
            to: message.sends ? resolved.row.email : null,
            reason: message.reason,
          },
          warnings,
        },
        effects: inserted.effects,
        effectIds,
        facts: {
          transport: caller.transport,
          reservation_id: reservationId,
          customer_id: resolved.row.id,
          customer_created: resolved.created,
          reservation_status: status,
          line_count: cart.lines.length,
          total_quantity: cart.lines.reduce((sum, line) => sum + line.quantity, 0),
          sent_as_quote: status === "quote",
          notify_customer: input.notifyCustomer,
          message_sent: message.sends,
          overbooked: bookedOver.length > 0,
          past_turnover_buffer: pastBuffer.length > 0 && overrideTurnoverBuffer,
          subtotal_amount_cents: Math.round(totals.subtotal * 100),
          deposit_amount_cents: Math.round(totals.deposit * 100),
          total_amount_cents: Math.round(totals.total * 100),
          currency,
        },
      };
    });
  } catch (error) {
    if (isReservationChangeBusyError(error)) throw reservationCreateErrors.busy();
    if (isStoreNotAcceptingReservationsError(error)) {
      emit(caller, () =>
        caller.ports.afterCommit({
          type: "reservation.gateRefused",
          store: caller.store,
          transport: caller.transport,
          reason: error.reason,
        }),
      );
      throw reservationErrors.storeNotAccepting(STORE_NOT_ACCEPTING_RESERVATIONS_ERROR);
    }
    throw error;
  }

  if (outcome.kind === "refused") throw outcome.error;
  if (outcome.kind === "confirm") return raiseConfirmation(outcome.refusal);

  // Right after commit: a booking created confirmed records its pay-as-you-go fee.
  await caller.ports.runReservationEffects(outcome.effects);
  emit(caller, () => caller.ports.dispatchEffects(outcome.effectIds));
  emit(caller, () =>
    caller.ports.afterCommit({
      type: "reservation.created",
      store: caller.store,
      reservationId: outcome.created.id,
      facts: outcome.facts,
    }),
  );
  return outcome.created;
}

/**
 * What a creation answered, read back from its reservation and its `created`
 * activity row: for a key whose answer was lost after the commit
 * (`meta.recoverUnknown`). The reservation is read as it is now; what the
 * creation decided (the customer added or found, the stock verdicts, the
 * message, the warnings) as its row recorded it.
 */
export async function recoverCreatedReservation(
  storeId: string,
  reservationId: string,
): Promise<CreatedReservation> {
  const [reservation] = await db
    .select({
      id: reservations.id,
      number: reservations.number,
      customerId: reservations.customerId,
    })
    .from(reservations)
    .where(and(eq(reservations.id, reservationId), eq(reservations.storeId, storeId)));
  if (!reservation) throw new Error("The reservation an operation created is gone.");
  const [row] = await db
    .select({ metadata: reservationActivity.metadata })
    .from(reservationActivity)
    .where(
      and(
        eq(reservationActivity.reservationId, reservationId),
        eq(reservationActivity.activityType, "created"),
      ),
    )
    .limit(1);
  const facts = (row?.metadata ?? {}) as {
    customerCreated?: boolean;
    status?: "quote" | "confirmed";
    overbookingShortfalls?: CreateShortfall[];
    turnoverBufferShortfalls?: CreateShortfall[];
    validationWarnings?: CreatedReservation["warnings"];
    customerMessage?: CreateMessageKind;
    customerMessageTo?: string;
    customerMessageReason?: CreatedReservation["message"]["reason"];
  };
  const shortfalls = facts.overbookingShortfalls ?? [];
  return {
    id: reservation.id,
    number: reservation.number,
    customer: { id: reservation.customerId, created: facts.customerCreated === true },
    capacity: {
      overbooked: shortfalls.length > 0,
      shortfalls,
      pastTurnoverBuffer: facts.turnoverBufferShortfalls ?? [],
    },
    message: facts.customerMessage
      ? {
          sent: true,
          kind: facts.customerMessage,
          to: facts.customerMessageTo ?? null,
          reason: null,
        }
      : { sent: false, kind: null, to: null, reason: facts.customerMessageReason ?? null },
    warnings: (facts.validationWarnings ?? []).map(({ key, params }) => ({
      key,
      ...(params ? { params } : {}),
    })),
  };
}

/**
 * The customer the booking goes to. A new one is added against the store's
 * unique (store, e-mail): when another write added that e-mail meanwhile,
 * the insert waits for it, then changes nothing, and the customer it added
 * is used as is (`created: false`), its details untouched.
 */
async function resolveCustomer(
  tx: Transaction,
  storeId: string,
  customer: ResolvedCustomer,
  defaults: { country: string; createdVia: "dashboard" | "api" },
): Promise<{ row: typeof customers.$inferSelect; created: boolean }> {
  if (customer.kind === "existing") return { row: customer.row, created: false };
  const id = nanoid();
  await tx
    .insert(customers)
    .values({
      id,
      storeId,
      email: customer.email,
      firstName: customer.firstName,
      lastName: customer.lastName,
      phone: customer.phone,
      country: defaults.country,
      createdVia: defaults.createdVia,
    })
    // A duplicate e-mail writes nothing: the row that holds it is used as it is.
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });
  const [row] = await tx
    .select()
    .from(customers)
    .where(and(eq(customers.storeId, storeId), eq(customers.email, customer.email)));
  if (!row) throw new Error("The customer written in this transaction could not be read back.");
  return { row, created: row.id === id };
}

/** An effect must never fail a write that has committed. */
function emit(_caller: ReservationCreateCaller, run: () => void) {
  try {
    run();
  } catch (error) {
    console.error("A reservation creation's effect failed after its commit:", error);
  }
}
