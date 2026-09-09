import { and, eq, inArray, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import { validateRequiredAccessoryLines } from "@louez/api/services";
import { loadPricingCatalog, type PricingCatalog } from "@louez/api/services/pricing-catalog";
import {
  aiAdvisorConversations,
  db,
  getBlockingReservationStatuses,
  productAccessories,
  products,
  reservationActivity,
  reservationItems,
  reservations,
  stores,
  type Transaction,
} from "@louez/db";
import type { ProductSnapshot, StoreSettings } from "@louez/types";
import type { CreateReservationCustomerInput } from "@louez/validations";
import { advisorValidationCovers } from "@louez/utils";

import { env } from "@/env";
import { isAdvisorReachableForStore } from "@/lib/ai/advisor/eligibility";
import { timingSafeEqualStrings } from "@/lib/catalog-auth";
import { log } from "@/lib/evlog";
import { getEffectiveReservationMode } from "@/lib/reservation-mode";
import { createReservationInstantAccessUrl } from "@/lib/reservations/instant-access";
import { normalizePhoneNumber } from "@/lib/sms/phone";

import { applyPromoCode, consumePromoCode, type AppliedPromoCode } from "./apply-promo-code";
import { notifyRequestReceived, runPostCreationEffects } from "./post-creation-effects";
import {
  computeReservationTotals,
  getReservationItemTaxFields,
  INSURANCE_TAX_LINE_ID,
  priceCart,
  type PricedCart,
  type ReservationTotals,
} from "./price-cart";
import { generateUniqueReservationNumber } from "./reservation-number";
import {
  failReservation,
  type CreateReservationRequest,
  type CreateReservationResult,
  type QuoteReservationRequest,
  type QuoteReservationResult,
  type ReservationFailure,
  type ReservationSource,
} from "./reservation.types";
import {
  getReservationLineKey,
  lockReservationProducts,
  preflightStock,
  reserveInventory,
  type ResolvedLineCombination,
} from "./reserve-inventory";
import {
  resolveDelivery,
  validateDeliveryMinimumOrder,
  type ResolvedDelivery,
} from "./resolve-delivery";
import { resolveTulipInsurance, type TulipInsuranceResolution } from "./resolve-tulip-insurance";
import { startCheckoutPayment } from "./start-checkout-payment";
import {
  resolveCustomerCompanyIdentity,
  upsertCustomer,
  type CustomerCompanyIdentity,
} from "./upsert-customer";
import {
  getRentalWindow,
  validateRentalDuration,
  validateRentalWindow,
  type RentalWindow,
} from "./validate-rental-window";

const NANOID_21_REGEX = /^[A-Za-z0-9_-]{21}$/;
const INSURANCE_ITEM_NAME = "Garantie casse/vol";
const EMPTY_CUSTOMER: CreateReservationCustomerInput = { email: "", firstName: "", lastName: "" };

type StoreRow = typeof stores.$inferSelect;

type AdvisorConversation = {
  id: string;
  reservationId: string | null;
};

interface PreparedReservation {
  store: StoreRow;
  storeCountry: string;
  window: RentalWindow;
  catalog: PricingCatalog;
  cart: PricedCart;
  delivery: ResolvedDelivery;
  insurance: TulipInsuranceResolution;
  promo: AppliedPromoCode | null;
  totals: ReservationTotals;
  customerPhone: string | null;
  companyIdentity: CustomerCompanyIdentity;
  advisorConversation: AdvisorConversation | null;
}

type PrepareInput = QuoteReservationRequest & {
  customer: CreateReservationCustomerInput;
  advisorConversationId?: string;
  clientAmounts: { subtotal: number; deposit: number; total: number } | null;
};

const getErrorKey = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message.startsWith("errors.") ? error.message : fallback;

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const differs = (left: number, right: number): boolean => Math.abs(left - right) > 0.01;

/** Marketplace reservations (and any supplied id) need the shared secret. */
const checkMarketplaceCapability = async (
  request: Pick<CreateReservationRequest, "source" | "reservationId" | "marketplaceSecret">,
): Promise<ReservationFailure | null> => {
  const usesCapability = request.source === "marketplace" || request.reservationId !== undefined;
  if (
    usesCapability &&
    (request.source !== "marketplace" ||
      !env.MARKETPLACE_CATALOG_SECRET ||
      !request.marketplaceSecret ||
      !(await timingSafeEqualStrings(env.MARKETPLACE_CATALOG_SECRET, request.marketplaceSecret)))
  ) {
    return failReservation("errors.invalidData");
  }
  if (request.reservationId !== undefined && !NANOID_21_REGEX.test(request.reservationId)) {
    return failReservation("errors.invalidData");
  }
  return null;
};

/**
 * Advisor gate: when the store REQUIRES advisor validation and the advisor is
 * reachable, the referenced conversation must have validated this exact cart.
 * Inert when the advisor is inactive: a checkout is never blocked by an
 * absent advisor.
 */
const resolveAdvisorConversation = async ({
  store,
  conversationId,
  lines,
  window,
}: {
  store: StoreRow;
  conversationId: string | undefined;
  lines: Array<{ productId: string; quantity: number }>;
  window: RentalWindow;
}): Promise<{ ok: true; conversation: AdvisorConversation | null } | ReservationFailure> => {
  if (conversationId !== undefined && !NANOID_21_REGEX.test(conversationId)) {
    return failReservation("errors.invalidData");
  }

  const conversation = conversationId
    ? ((await db.query.aiAdvisorConversations.findFirst({
        where: and(
          eq(aiAdvisorConversations.id, conversationId),
          eq(aiAdvisorConversations.storeId, store.id),
        ),
        columns: { id: true, validatedAt: true, validatedCart: true, reservationId: true },
      })) ?? null)
    : null;

  if (store.aiAdvisorSettings?.mode === "required" && (await isAdvisorReachableForStore(store))) {
    const isValidated =
      conversation?.validatedAt != null &&
      advisorValidationCovers(conversation.validatedCart, {
        items: lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
        startDate: window.start.toISOString(),
        endDate: window.end.toISOString(),
      });
    if (!isValidated) {
      return failReservation("errors.advisorValidationRequired");
    }
  }

  return {
    ok: true,
    conversation: conversation
      ? { id: conversation.id, reservationId: conversation.reservationId }
      : null,
  };
};

/** Mismatches between client estimates and server prices are monitored, never trusted. */
const logClientAmountMismatches = ({
  source,
  storeId,
  cart,
  lines,
  clientAmounts,
  deliveryFee,
}: {
  source: ReservationSource;
  storeId: string;
  cart: PricedCart;
  lines: Array<{ productId: string; quantity: number; unitPrice: number }>;
  clientAmounts: { subtotal: number; deposit: number; total: number };
  deliveryFee: number;
}): void => {
  // The phone receptionist passes flat base prices it cannot pre-compute:
  // a mismatch there is expected, not a fraud signal.
  if (source === "phone") return;

  if (source === "online") {
    cart.lines.forEach((priced, index) => {
      const line = lines[index];
      const clientSubtotal =
        line.unitPrice * line.quantity * (priced.pricingKind === "fixed" ? 1 : priced.duration);
      if (differs(clientSubtotal, priced.subtotal)) {
        log.warn({
          security: {
            event: "price_mismatch",
            storeId,
            productId: line.productId,
            clientSubtotal,
            serverSubtotal: priced.subtotal,
          },
        });
      }
    });
  }

  // Client `total` excludes the deposit and includes the delivery fee.
  const serverComparableTotal = cart.subtotal + deliveryFee;
  if (
    differs(clientAmounts.subtotal, cart.subtotal) ||
    differs(clientAmounts.deposit, cart.totalDeposit) ||
    differs(clientAmounts.total, serverComparableTotal)
  ) {
    log.warn({
      security: {
        event: "amount_mismatch",
        storeId,
        clientSubtotal: clientAmounts.subtotal,
        serverSubtotal: cart.subtotal,
        clientDeposit: clientAmounts.deposit,
        serverDeposit: cart.totalDeposit,
        clientTotal: clientAmounts.total,
        serverTotal: serverComparableTotal,
        serverDeliveryFee: deliveryFee,
      },
    });
  }
};

/**
 * Everything before the write: validations, catalog pricing, delivery,
 * insurance, promo and totals. Shared by the quote and the creation so a
 * phone caller hears the exact amount that would be booked.
 */
const prepareReservation = async (
  input: PrepareInput,
): Promise<{ ok: true; prepared: PreparedReservation } | ReservationFailure> => {
  const store = await db.query.stores.findFirst({ where: eq(stores.id, input.storeId) });
  if (!store) {
    return failReservation("errors.storeNotFound");
  }
  const settings: StoreSettings | null = store.settings;
  const storeCountry = settings?.country || "FR";

  const customerPhone = input.customer.phone
    ? normalizePhoneNumber(input.customer.phone, settings?.country)
    : null;
  if (input.customer.phone && !customerPhone) {
    return failReservation("errors.invalidData");
  }

  const companyIdentity = resolveCustomerCompanyIdentity(input.customer, storeCountry);
  if (!companyIdentity) {
    return failReservation("errors.invalidData");
  }

  const window = getRentalWindow(input.items);

  const advisor = await resolveAdvisorConversation({
    store,
    conversationId: input.advisorConversationId,
    lines: input.items,
    window,
  });
  if (!advisor.ok) return advisor;

  const windowCheck = validateRentalWindow({ window, settings });
  if (!windowCheck.ok) return windowCheck;

  const productIds = [...new Set(input.items.map((item) => item.productId))];
  const catalog = await loadPricingCatalog(db, { storeId: store.id, productIds });
  if (catalog.size !== productIds.length) {
    return failReservation("errors.productNotFound");
  }

  const requiredAccessories = await db
    .select({
      parentProductId: productAccessories.productId,
      accessoryProductId: productAccessories.accessoryId,
      quantity: productAccessories.quantity,
    })
    .from(productAccessories)
    .innerJoin(products, eq(productAccessories.productId, products.id))
    .where(
      and(
        eq(products.storeId, store.id),
        eq(productAccessories.required, true),
        inArray(productAccessories.productId, productIds),
      ),
    );
  const accessoryCheck = validateRequiredAccessoryLines({
    lines: input.items,
    requiredAccessories,
  });
  if (!accessoryCheck.valid) {
    return failReservation("errors.requiredAccessoriesMissing", undefined, {
      code: "required_accessories_missing",
      missingAccessories: accessoryCheck.missing,
    });
  }

  const hasDurationProduct = [...catalog.values()].some(
    (product) => product.pricingKind === "duration",
  );
  const durationCheck = validateRentalDuration({ window, settings, hasDurationProduct });
  if (!durationCheck.ok) return durationCheck;

  const stockCheck = await preflightStock(db, catalog, input.items);
  if (!stockCheck.ok) return stockCheck;

  const priced = priceCart({ catalog, lines: input.items });
  if (!priced.ok) {
    return failReservation("errors.productNotFound");
  }
  const cart = priced.cart;

  const deliveryResult = await resolveDelivery({
    store,
    settings: settings?.delivery,
    delivery: input.delivery,
    subtotal: cart.subtotal,
  });
  if (!deliveryResult.ok) return deliveryResult;
  const delivery = deliveryResult.delivery;

  if (input.clientAmounts) {
    if (
      input.source === "marketplace" &&
      (differs(input.clientAmounts.subtotal, cart.subtotal) ||
        differs(input.clientAmounts.deposit, cart.totalDeposit) ||
        differs(input.clientAmounts.total, cart.subtotal + delivery.fee))
    ) {
      return failReservation("errors.priceChanged");
    }
    logClientAmountMismatches({
      source: input.source,
      storeId: store.id,
      cart,
      lines: input.items,
      clientAmounts: input.clientAmounts,
      deliveryFee: delivery.fee,
    });
  }

  let insurance: TulipInsuranceResolution;
  try {
    insurance = await resolveTulipInsurance({
      storeId: store.id,
      customer: input.customer,
      items: input.items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
      startDate: window.start,
      endDate: window.end,
      tulipInsuranceOptIn: input.tulipInsuranceOptIn,
      fallbackCountry: storeCountry,
    });
  } catch (error) {
    return failReservation(getErrorKey(error, "errors.tulipQuoteFailed"));
  }

  let promo: AppliedPromoCode | null = null;
  if (input.promoCode) {
    const evaluation = await applyPromoCode(db, {
      storeId: store.id,
      code: input.promoCode,
      subtotal: cart.subtotal,
    });
    if (!evaluation.ok) {
      return failReservation(evaluation.error, evaluation.params);
    }
    promo = evaluation;
  }

  const discountAmount = promo?.discountAmount ?? 0;
  const minimumOrderCheck = validateDeliveryMinimumOrder(
    delivery,
    Math.round((cart.subtotal - discountAmount) * 100) / 100,
  );
  if (!minimumOrderCheck.ok) return minimumOrderCheck;

  const totals = computeReservationTotals({
    lines: cart.lines,
    insuranceAmount: insurance.amount,
    discountAmount,
    deliveryFee: delivery.fee,
    totalDeposit: cart.totalDeposit,
    taxSettings: settings?.tax,
  });

  return {
    ok: true,
    prepared: {
      store,
      storeCountry,
      window,
      catalog,
      cart,
      delivery,
      insurance,
      promo,
      totals,
      customerPhone,
      companyIdentity,
      advisorConversation: advisor.conversation,
    },
  };
};

/**
 * Authoritative amounts for a cart WITHOUT creating anything (phone
 * receptionist). Runs the same validations as a booking.
 */
export const quoteReservation = async (
  request: QuoteReservationRequest,
): Promise<QuoteReservationResult> => {
  try {
    const result = await prepareReservation({
      ...request,
      customer: request.customer ?? EMPTY_CUSTOMER,
      clientAmounts: null,
    });
    if (!result.ok) return result;

    const { totals, store } = result.prepared;
    return {
      ok: true,
      quote: {
        subtotal: totals.subtotal,
        discount: totals.discount,
        deposit: totals.deposit,
        deliveryFee: totals.deliveryFee,
        total: totals.total,
        currency: store.settings?.currency ?? "EUR",
      },
    };
  } catch (error) {
    log.error("reservation", `quote failed: ${describeError(error)}`);
    return failReservation("errors.createReservationError");
  }
};

type WriteResult =
  | {
      ok: true;
      replay: false;
      reservationId: string;
      reservationNumber: string;
      customerId: string;
      customerEmail: string;
    }
  | {
      ok: true;
      replay: true;
      reservationId: string;
      reservationNumber: string;
      customerId: string;
      customerEmail: string;
    }
  | ReservationFailure;

/** Marketplace replay: the same id already written by a previous attempt. */
const findMarketplaceReplay = async (
  tx: Transaction,
  storeId: string,
  reservationId: string,
): Promise<Extract<WriteResult, { replay: true }> | ReservationFailure | null> => {
  const existing = await tx.query.reservations.findFirst({
    where: eq(reservations.id, reservationId),
    columns: { id: true, storeId: true, customerId: true, number: true, source: true },
    with: { customer: { columns: { email: true } } },
  });
  if (!existing) return null;
  if (existing.storeId !== storeId || existing.source !== "marketplace") {
    return failReservation("errors.invalidData");
  }
  return {
    ok: true,
    replay: true,
    reservationId: existing.id,
    reservationNumber: existing.number,
    customerId: existing.customerId,
    customerEmail: existing.customer.email,
  };
};

/**
 * Server-built snapshot, same content the web checkout always stored: the
 * name and the cover image only (no rich-text description in the row).
 */
const buildProductSnapshot = (
  catalog: PricingCatalog,
  item: CreateReservationRequest["items"][number],
  resolved: ResolvedLineCombination | undefined,
): ProductSnapshot => {
  const product = catalog.get(item.productId);
  return {
    name: product?.name ?? "",
    description: null,
    images: product?.images.slice(0, 1) ?? [],
    combinationKey: resolved?.combinationKey || item.resolvedCombinationKey || null,
    selectedAttributes:
      resolved?.selectedAttributes || item.resolvedAttributes || item.selectedAttributes || null,
  };
};

const writeReservation = async (
  request: CreateReservationRequest,
  prepared: PreparedReservation,
): Promise<WriteResult> => {
  const { store, cart, delivery, insurance, promo, totals, window } = prepared;
  const settings: StoreSettings | null = store.settings;
  const blockingStatuses = getBlockingReservationStatuses(
    settings?.pendingBlocksAvailability ?? true,
  );
  const turnoverBufferMinutes = settings?.turnoverBufferMinutes ?? 0;

  return db.transaction(async (tx): Promise<WriteResult> => {
    // Product locks first: a marketplace retry then waits for the attempt it
    // races with, and reads its reservation as a replay instead of colliding.
    const lockedProductsById = await lockReservationProducts(
      tx,
      store.id,
      request.items.map((item) => item.productId),
    );

    if (request.reservationId) {
      const replay = await findMarketplaceReplay(tx, store.id, request.reservationId);
      if (replay) return replay;
    }

    const inventoryResult = await reserveInventory({
      tx,
      storeId: store.id,
      lockedProductsById,
      lines: request.items,
      window,
      turnoverBufferMinutes,
      blockingStatuses,
    });
    if (!inventoryResult.ok) return inventoryResult;
    const { resolvedCombinationByLineKey } = inventoryResult.inventory;

    // Consume the promo under the write: a concurrent checkout that took the
    // last use makes this one fail before anything is written.
    if (promo && !(await consumePromoCode(tx, promo.promoCodeId))) {
      return failReservation("errors.promoCodeExhausted");
    }

    const customer = await upsertCustomer({
      tx,
      storeId: store.id,
      storeCountry: prepared.storeCountry,
      customer: request.customer,
      phone: prepared.customerPhone,
      companyIdentity: prepared.companyIdentity,
    });
    if (!customer) {
      return failReservation("errors.createCustomerError");
    }

    const reservationId = request.reservationId ?? nanoid();
    const reservationNumber = await generateUniqueReservationNumber(store.id);
    const outboundLeg = delivery.outboundLeg;
    const returnLeg = delivery.returnLeg;

    await tx.insert(reservations).values({
      id: reservationId,
      storeId: store.id,
      customerId: customer.id,
      number: reservationNumber,
      status: "pending",
      startDate: window.start,
      endDate: window.end,
      subtotalAmount: totals.subtotal.toFixed(2),
      depositAmount: totals.deposit.toFixed(2),
      totalAmount: totals.total.toFixed(2),
      subtotalExclTax: totals.subtotalExclTax?.toFixed(2) ?? null,
      taxAmount: totals.taxAmount?.toFixed(2) ?? null,
      taxRate: totals.taxRate?.toFixed(2) ?? null,
      customerNotes: request.customerNotes || null,
      source: request.source,
      outboundMethod: outboundLeg?.method || "store",
      returnMethod: returnLeg?.method || "store",
      deliveryOption: delivery.hasAnyDelivery ? "delivery" : "pickup",
      deliveryAddress: delivery.hasOutboundDelivery ? (outboundLeg?.address ?? null) : null,
      deliveryCity: delivery.hasOutboundDelivery ? (outboundLeg?.city ?? null) : null,
      deliveryPostalCode: delivery.hasOutboundDelivery ? (outboundLeg?.postalCode ?? null) : null,
      deliveryCountry: delivery.hasOutboundDelivery ? (outboundLeg?.country ?? null) : null,
      deliveryLatitude: delivery.hasOutboundDelivery
        ? (outboundLeg?.latitude?.toString() ?? null)
        : null,
      deliveryLongitude: delivery.hasOutboundDelivery
        ? (outboundLeg?.longitude?.toString() ?? null)
        : null,
      deliveryDistanceKm: delivery.outboundDistanceKm?.toFixed(2) ?? null,
      deliveryFee: totals.deliveryFee.toFixed(2),
      tulipInsuranceOptIn: insurance.appliedOptIn,
      tulipInsuranceAmount: insurance.amount > 0 ? insurance.amount.toFixed(2) : null,
      promoCodeId: promo?.promoCodeId ?? null,
      discountAmount: totals.discount.toFixed(2),
      promoCodeSnapshot: promo?.snapshot ?? null,
      returnAddress: delivery.hasReturnDelivery ? (returnLeg?.address ?? null) : null,
      returnCity: delivery.hasReturnDelivery ? (returnLeg?.city ?? null) : null,
      returnPostalCode: delivery.hasReturnDelivery ? (returnLeg?.postalCode ?? null) : null,
      returnCountry: delivery.hasReturnDelivery ? (returnLeg?.country ?? null) : null,
      returnLatitude:
        delivery.hasReturnDelivery && returnLeg?.latitude != null
          ? returnLeg.latitude.toString()
          : null,
      returnLongitude:
        delivery.hasReturnDelivery && returnLeg?.longitude != null
          ? returnLeg.longitude.toString()
          : null,
      returnDistanceKm: delivery.returnDistanceKm?.toFixed(2) ?? null,
      pickupLocationId: delivery.pickupLocation?.locationId ?? null,
      returnLocationId: delivery.returnLocation?.locationId ?? null,
      pickupLocationSnapshot: delivery.pickupLocation?.snapshot ?? null,
      returnLocationSnapshot: delivery.returnLocation?.snapshot ?? null,
    });

    for (let index = 0; index < request.items.length; index++) {
      const item = request.items[index];
      const line = cart.lines[index];
      const resolved = resolvedCombinationByLineKey.get(getReservationLineKey(item, index));
      const combinationKey = resolved?.combinationKey || item.resolvedCombinationKey || null;
      const selectedAttributes =
        resolved?.selectedAttributes || item.resolvedAttributes || item.selectedAttributes || null;
      const tax = getReservationItemTaxFields(totals, line, index);

      await tx.insert(reservationItems).values({
        reservationId,
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: line.unitPrice.toFixed(2),
        depositPerUnit: line.depositPerUnit.toFixed(2),
        totalPrice: line.subtotal.toFixed(2),
        productSnapshot: buildProductSnapshot(prepared.catalog, item, resolved),
        combinationKey,
        selectedAttributes,
        taxRate: tax.taxRate?.toFixed(2) ?? null,
        taxAmount: tax.taxAmount?.toFixed(2) ?? null,
        priceExclTax: tax.priceExclTax?.toFixed(2) ?? null,
        totalExclTax: tax.totalExclTax?.toFixed(2) ?? null,
      });
    }

    if (insurance.amount > 0) {
      const insuranceTax = totals.taxEnabled
        ? totals.taxByLineId.get(INSURANCE_TAX_LINE_ID)
        : undefined;
      await tx.insert(reservationItems).values({
        reservationId,
        productId: null,
        isCustomItem: true,
        quantity: 1,
        unitPrice: insurance.amount.toFixed(2),
        depositPerUnit: "0.00",
        totalPrice: insurance.amount.toFixed(2),
        taxRate: insuranceTax?.taxRate?.toFixed(2) ?? null,
        taxAmount: insuranceTax?.taxAmount.toFixed(2) ?? null,
        priceExclTax: insuranceTax?.amountExclTax.toFixed(2) ?? null,
        totalExclTax: insuranceTax?.amountExclTax.toFixed(2) ?? null,
        productSnapshot: {
          name: INSURANCE_ITEM_NAME,
          description: INSURANCE_ITEM_NAME,
          images: [],
        },
      });
    }

    await tx.insert(reservationActivity).values({
      id: nanoid(),
      reservationId,
      activityType: "created",
      description: null,
      metadata: {
        source: request.source,
        status: "pending",
        customerEmail: request.customer.email,
        customerName: `${request.customer.firstName} ${request.customer.lastName}`,
        tulipInsuranceOptIn: insurance.appliedOptIn,
        tulipInsuranceAmount: insurance.amount,
        tulipInsuredProductCount: insurance.insuredProductCount,
        tulipUninsuredProductCount: insurance.uninsuredProductCount,
        ...(insurance.quoteUnavailable &&
          insurance.quoteError && { tulipQuoteFallbackError: insurance.quoteError }),
        ...(prepared.advisorConversation && {
          advisorConversationId: prepared.advisorConversation.id,
        }),
      },
      createdAt: new Date(),
    });

    // Link the advisor conversation to its reservation (conversion). The
    // reservation_id filter keeps the first link authoritative.
    if (prepared.advisorConversation && !prepared.advisorConversation.reservationId) {
      await tx
        .update(aiAdvisorConversations)
        .set({ reservationId, updatedAt: new Date() })
        .where(
          and(
            eq(aiAdvisorConversations.id, prepared.advisorConversation.id),
            isNull(aiAdvisorConversations.reservationId),
          ),
        );
    }

    return {
      ok: true,
      replay: false,
      reservationId,
      reservationNumber,
      customerId: customer.id,
      customerEmail: customer.email,
    };
  });
};

/**
 * Internal reservation pipeline: validate, price from the catalog, write
 * under lock, notify, start the payment. The public server action wraps it
 * with Zod and a fixed `source: "online"`; the marketplace facade and the
 * phone receptionist call it directly with their own source.
 */
export const createReservation = async (
  request: CreateReservationRequest,
): Promise<CreateReservationResult> => {
  try {
    const capabilityFailure = await checkMarketplaceCapability(request);
    if (capabilityFailure) return capabilityFailure;

    const preparation = await prepareReservation({
      ...request,
      clientAmounts: {
        subtotal: request.subtotalAmount,
        deposit: request.depositAmount,
        total: request.totalAmount,
      },
    });
    if (!preparation.ok) return preparation;
    const { prepared } = preparation;
    const { store, totals, insurance, promo, delivery, cart } = prepared;

    const written = await writeReservation(request, prepared);
    if (!written.ok) return written;

    const base = {
      ok: true as const,
      reservationId: written.reservationId,
      reservationNumber: written.reservationNumber,
      customerId: written.customerId,
      customerEmail: written.customerEmail,
      paymentUrl: null,
      instantAccessUrl: null,
    };

    // Marketplace holds are intentionally silent pending reservations. Payment
    // confirmation reuses the normal webhook notification and calendar paths.
    if (written.replay || request.source === "marketplace") {
      return { ...base, idempotentReplay: written.replay };
    }

    // A phone booking is always a pending REQUEST (no card on the call), so it
    // never enters the online-payment flow even in immediate-payment mode.
    const effectiveReservationMode =
      request.source === "phone" ? "request" : getEffectiveReservationMode(store);

    const reservationSummary = {
      id: written.reservationId,
      number: written.reservationNumber,
      startDate: prepared.window.start,
      endDate: prepared.window.end,
      customerNotes: request.customerNotes || null,
    };
    const customerSummary = {
      id: written.customerId,
      email: request.customer.email,
      firstName: request.customer.firstName,
      lastName: request.customer.lastName,
      phone: prepared.customerPhone,
    };

    await runPostCreationEffects({
      store,
      reservation: {
        ...reservationSummary,
        lineCount: request.items.length,
        totalQuantity: request.items.reduce((sum, item) => sum + item.quantity, 0),
      },
      customer: customerSummary,
      totals,
      delivery,
      insurance: { amount: insurance.amount, optIn: insurance.appliedOptIn },
      promoCodeUsed: promo !== null,
    });

    const paymentUrl =
      effectiveReservationMode === "payment"
        ? await startCheckoutPayment({
            store,
            reservation: {
              id: written.reservationId,
              number: written.reservationNumber,
              customerId: written.customerId,
              customerEmail: written.customerEmail,
              customerName: `${request.customer.firstName} ${request.customer.lastName}`,
            },
            lines: cart.lines,
            totals,
            insuranceAmount: insurance.amount,
            locale: request.locale,
          })
        : null;

    // Request-mode notifications. A payment-mode reservation whose Stripe
    // session could not start is a request the owner handles by hand, so it
    // is announced the same way; a live Stripe session is announced by the
    // webhook on payment instead.
    if (effectiveReservationMode === "request" || paymentUrl === null) {
      await notifyRequestReceived({
        store,
        reservation: reservationSummary,
        customer: customerSummary,
        totals,
      });
    }

    // The web customer lands on the reservation page with this token when
    // there is no Stripe step. A payment-mode checkout goes to Stripe instead
    // and the return route mints its own short-lived token (WS-13), so no
    // 30-day token is left behind for it.
    const isWebRequest =
      request.source === "online" &&
      (effectiveReservationMode === "request" || paymentUrl === null);
    const instantAccessUrl = isWebRequest
      ? await createReservationInstantAccessUrl({
          storeId: store.id,
          storeSlug: store.slug,
          customerEmail: written.customerEmail,
          reservationId: written.reservationId,
          redirectPath: `/account/reservations/${written.reservationId}?event=requested`,
        }).catch((error: unknown) => {
          log.error("reservation", `instant access url failed: ${describeError(error)}`);
          return null;
        })
      : null;

    return { ...base, paymentUrl, instantAccessUrl, idempotentReplay: false };
  } catch (error) {
    log.error("reservation", `creation failed: ${describeError(error)}`);
    return failReservation("errors.createReservationError");
  }
};
