"use server";

import {
  capacityVerdictMetadata,
  nextCapacityVerdictDate,
} from "@louez/api/services/capacity-verdict";
import {
  type CapacityShortfall,
  lockReservationProducts,
  reserveInventory,
} from "@louez/api/services/reservation-inventory";

import { validateReservationContract } from "@louez/api/services";

import { resolveDateChangeRequests } from "@louez/api/services/date-change-requests";
import { revalidatePath } from "next/cache";

import { and, eq, gte, inArray, not, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getRouteDistance, getStorefrontAvailability } from "@louez/api/services";
import {
  ConsumableStockError,
  consumeReservationStock,
  db,
  getEffectiveProductQuantities,
  insertReservation,
  isStoreNotAcceptingReservationsError,
  isStripeRefundPaymentSql,
  markReservation,
  reconcileReservationStock,
  reservationStatusConsumesStock,
  retryOnceOnDeadlock,
  retryTransactionOnDeadlock,
} from "@louez/db";
import { isEmailConfigured } from "@louez/email";
import {
  buildUnitRentableDuringPredicate,
  customers,
  findBusyUnitIds,
  getBlockingReservationStatuses,
  invoicePayments,
  paymentRequests,
  payments,
  productSeasonalPricing,
  productSeasonalPricingTiers,
  productUnitEvents,
  productUnits,
  products,
  type Transaction,
  reservationActivity,
  reservationItemDetails,
  reservationItemUnits,
  reservationItems,
  reservations,
  stores,
  verificationCodes,
} from "@louez/db";
import { STORE_NOT_ACCEPTING_RESERVATIONS_ERROR, type Rate } from "@louez/types";
import type {
  BookingAttributeAxis,
  DeliverySettings,
  PricingBreakdown,
  PricingKind,
  PricingMode,
  TulipPublicMode,
  UnitAttributes,
} from "@louez/types";
import {
  DEFAULT_COMBINATION_KEY,
  buildCombinationKey,
  billingFromCustomer,
  canonicalizeAttributes,
  hasCompleteAttributes,
  matchesSelectedAttributes,
  resolveReservationBilling,
} from "@louez/utils";
import {
  type PricingTier,
  type SeasonalPricingConfig,
  type SeasonalPriceResult,
  calculateDuration,
  calculateDurationMinutes,
  calculateFixedPrice,
  calculateSeasonalAwarePrice,
} from "@louez/utils";
import {
  type StorefrontAvailabilityInput,
  dashboardReservationAssignUnitsInputSchema,
  storefrontAvailabilityInputSchema,
} from "@louez/validations";

import { auth } from "@/lib/auth";
import { runReservationEffects } from "@/lib/billing/reservation-effects";
import { checkReservationGate, logReservationGateRefusal } from "@/lib/billing/reservation-gate";
import { notifyNewReservation, notifyPaymentReceived } from "@/lib/discord/platform-notifications";
import { sendEmail } from "@/lib/email/client";
import { getLocaleFromCountry, resolveReservationEmailLocale } from "@/lib/email/i18n";
import {
  buildManualReservationEmail,
  toManualEmailRenderContext,
} from "@/lib/email/manual-reservation-email";
import type { ManualEmailRenderContext } from "@/lib/email/manual-reservation-email-core";
import {
  logEmail,
  sendDepositAuthorizationRequestEmail,
  sendPaymentRequestEmail,
  sendReservationConfirmationEmail,
  sendReservationModifiedEmail,
} from "@/lib/email/send";
import {
  createTulipContractForReservation,
  getTulipCoverageSummary,
  previewTulipQuoteForCheckout,
  syncTulipContractForReservation,
} from "@/lib/integrations/tulip/contracts";
import {
  getReservationInsuranceSelection,
  isLegacyTulipInsuranceItem,
} from "@/lib/integrations/tulip/contracts-insurance";
import { getDashboardTulipInsuranceModeFromSettings } from "@/lib/integrations/tulip/settings";
import { resolveTulipIntegrationForStore } from "@/lib/integrations/tulip/state";
import { dispatchCustomerNotification } from "@/lib/notifications/customer-dispatcher";
import {
  captureProductServerEvent,
  captureReservationActionSucceeded,
  toAnalyticsAmountCents,
} from "@/lib/product-analytics/analytics";
import {
  productAnalyticsEvents,
  reservationAnalyticsActions,
} from "@/lib/product-analytics/analytics-events";
import {
  deleteRecordedPayment,
  insertManualRefund,
  insertRecordedPayment,
} from "@/lib/reservations/dashboard-payment-writes";
import {
  authorizeDepositHold,
  captureDepositHold as captureReferencedDepositHold,
  releaseDepositHold as releaseReferencedDepositHold,
} from "@/lib/reservations/deposit-hold";
import { depositHoldDeps } from "@/lib/reservations/deposit-hold-live";
import { resolveReservationLocationSnapshot } from "@/lib/reservations/location-snapshots";
import { reservationCurrency } from "@/lib/reservations/payment-billing-facts";
import {
  getReservationRentalAmount,
  paymentRequestTerms,
} from "@/lib/reservations/util.payment-request";
import {
  compareReservationDemand,
  fingerprintReservationEdit,
} from "@/lib/reservations/util.reservation-edit";
import { getRentalPaid } from "@/lib/reservations/util.payment-status";
import {
  isSmsConfigured,
  sendAccessLinkSms,
  sendDepositAuthorizationRequestSms,
  sendPaymentRequestSms,
} from "@/lib/sms";
import { getCurrentStore } from "@/lib/store-context";
import { createReservationInstantAccessUrl } from "@/lib/reservations/instant-access";
import { getStorefrontUrl } from "@/lib/storefront-url";
import {
  tryEnsureRefundPaymentRecord,
  tryGenerateCreditNoteForRefund,
  tryGenerateInvoiceForPayment,
} from "@/lib/invoicing/service";
import { trySendInitialInvoicePaymentConfirmation } from "@/lib/invoicing/delivery";
// ============================================================================
// Deposit Authorization Hold (Empreinte Bancaire)
// ============================================================================

import {
  createRefund,
  fromStripeCents,
  getChargeRefundableAmount,
  getPaymentMethodDetails,
  toStripeCents,
} from "@/lib/stripe";
import { calculateTotalDeliveryFee, validateDelivery } from "@/lib/utils/geo";
import { evaluateReservationRules } from "@louez/utils";
import { buildUnitEvent } from "@louez/api/services/unit-mutations";
import {
  resolveUnitAssignmentScope,
  unitMatchesAssignmentScope,
} from "@louez/api/services/unit-availability";

function getActionErrorKey(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.startsWith("errors.")) {
    return error.message;
  }

  return fallback;
}

async function getStoreForUser() {
  return getCurrentStore();
}

export async function getManualReservationAvailability(input: StorefrontAvailabilityInput) {
  const store = await getCurrentStore();
  if (!store) {
    return { error: "errors.unauthorized" };
  }

  const validated = storefrontAvailabilityInputSchema.safeParse(input);
  if (!validated.success) {
    return { error: "errors.invalidData" };
  }

  try {
    const availability = await getStorefrontAvailability({
      storeSlug: store.slug,
      startDate: validated.data.startDate,
      endDate: validated.data.endDate,
      productIds: validated.data.productIds,
    });

    return { success: true, availability };
  } catch (error) {
    console.error("Error fetching manual reservation availability:", error);
    return { error: "errors.invalidData" };
  }
}

function toPricingMode(value: unknown): PricingMode {
  if (value === "hour" || value === "day" || value === "week") {
    return value;
  }
  return "day";
}

function toPricingKind(value: unknown): PricingKind {
  return value === "fixed" ? "fixed" : "duration";
}

function buildReservationPricingBreakdown(params: {
  pricingKind: PricingKind;
  basePrice: number;
  deposit: number;
  pricingMode: PricingMode;
  quantity: number;
  durationMinutes: number;
  result: SeasonalPriceResult;
}): PricingBreakdown {
  if (params.pricingKind === "fixed") {
    return calculateFixedPrice(
      {
        basePrice: params.basePrice,
        deposit: params.deposit,
        pricingMode: params.pricingMode,
      },
      params.quantity,
    ).breakdown;
  }

  return {
    basePrice: params.basePrice,
    effectivePrice: params.result.subtotal / Math.max(1, params.quantity),
    duration: params.durationMinutes,
    pricingMode: params.pricingMode,
    pricingKind: params.pricingKind,
    discountPercent:
      params.result.savings > 0 && params.result.originalSubtotal > 0
        ? Math.round((params.result.savings / params.result.originalSubtotal) * 100)
        : null,
    discountAmount: params.result.savings,
    tierApplied: null,
    durationMinutes: params.durationMinutes,
    appliedPeriods: undefined,
    optimizerVersion: "v2",
    taxRate: null,
    taxAmount: null,
    subtotalExclTax: null,
    subtotalInclTax: null,
    ...(params.result.isSeasonal
      ? {
          seasonalSegments: params.result.segments.map((segment) => ({
            seasonalPricingId: segment.seasonalPricingId,
            seasonalPricingName: segment.seasonalPricingName,
            startDate: segment.startDate.toISOString(),
            endDate: segment.endDate.toISOString(),
            subtotal: segment.subtotal,
          })),
        }
      : {}),
  };
}

async function fetchSeasonalPricingConfigs(productId: string): Promise<SeasonalPricingConfig[]> {
  const seasonalPricingsRaw = await db
    .select()
    .from(productSeasonalPricing)
    .where(eq(productSeasonalPricing.productId, productId));

  if (seasonalPricingsRaw.length === 0) return [];

  const spIds = seasonalPricingsRaw.map((sp) => sp.id);
  const spTiersRaw = await db
    .select()
    .from(productSeasonalPricingTiers)
    .where(inArray(productSeasonalPricingTiers.seasonalPricingId, spIds));

  const spTiersByPricingId = new Map<string, typeof spTiersRaw>();
  for (const tier of spTiersRaw) {
    const tiers = spTiersByPricingId.get(tier.seasonalPricingId) || [];
    tiers.push(tier);
    spTiersByPricingId.set(tier.seasonalPricingId, tiers);
  }

  return seasonalPricingsRaw.map((sp) => {
    const spTiers = spTiersByPricingId.get(sp.id) || [];
    return {
      id: sp.id,
      name: sp.name,
      startDate: sp.startDate,
      endDate: sp.endDate,
      basePrice: parseFloat(sp.price),
      tiers: spTiers
        .filter((t) => t.minDuration !== null && t.discountPercent !== null)
        .map((t) => ({
          id: t.id,
          minDuration: t.minDuration!,
          discountPercent: parseFloat(t.discountPercent!),
          displayOrder: t.displayOrder ?? 0,
        })),
      rates: spTiers
        .filter((t) => t.period !== null && t.price !== null)
        .map((t) => ({
          id: t.id,
          period: t.period!,
          price: parseFloat(t.price!),
          displayOrder: t.displayOrder ?? 0,
        })),
    };
  });
}

type ActivityType =
  | "created"
  | "confirmed"
  | "rejected"
  | "cancelled"
  | "picked_up"
  | "returned"
  | "note_updated"
  | "payment_added"
  | "payment_updated"
  | "access_link_sent"
  | "modified"
  | "inspection_departure_started"
  | "inspection_departure_completed"
  | "inspection_return_started"
  | "inspection_return_completed"
  | "inspection_damage_detected"
  | "inspection_signed"
  | "quote_accepted"
  | "quote_declined";

function getErrorKey(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.startsWith("errors.")) {
    return error.message;
  }

  return fallback;
}

function resolveTulipInsuranceOptIn(params: {
  mode: TulipPublicMode;
  requested?: boolean;
  current?: boolean | null;
  defaultOptional?: boolean;
}): boolean {
  if (params.mode === "required") {
    return true;
  }

  if (params.mode === "no_public") {
    return false;
  }

  if (typeof params.requested === "boolean") {
    return params.requested;
  }

  if (typeof params.current === "boolean") {
    return params.current;
  }

  return params.defaultOptional ?? true;
}

async function getDashboardTulipInsuranceMode(storeId: string): Promise<TulipPublicMode> {
  const tulipSettings = (await resolveTulipIntegrationForStore(storeId)).settings;
  return getDashboardTulipInsuranceModeFromSettings(tulipSettings);
}

/** The signed-in user, for the activity rows they cause. */
async function getActorUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id || null;
}

async function logReservationActivity(
  reservationId: string,
  activityType: ActivityType,
  metadata?: Record<string, unknown>,
) {
  await db.insert(reservationActivity).values({
    id: nanoid(),
    reservationId,
    userId: await getActorUserId(),
    activityType,
    metadata,
  });
}

async function generateReservationNumber(storeId: string): Promise<string> {
  const year = new Date().getFullYear();

  // Get count of reservations this year
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(reservations)
    .where(and(eq(reservations.storeId, storeId), sql`YEAR(${reservations.createdAt}) = ${year}`));

  const count = result[0]?.count || 0;
  const nextNumber = count + 1;

  return `${year}-${String(nextNumber).padStart(4, "0")}`;
}

/**
 * The answer to a booking its transaction refused: consumable stock that no
 * override takes below zero, or the card gate.
 */
function refuseCreation(error: unknown) {
  if (error instanceof ConsumableStockError) {
    return { ok: false as const, error: error.message, shortfalls: [] };
  }
  if (!isStoreNotAcceptingReservationsError(error)) throw error;
  logReservationGateRefusal(error, "dashboard");
  return { ok: false as const, error: STORE_NOT_ACCEPTING_RESERVATIONS_ERROR, shortfalls: [] };
}

interface CreateReservationData {
  customerId?: string;
  newCustomer?: {
    email: string;
    firstName: string;
    lastName: string;
    phone?: string;
  };
  startDate: Date;
  endDate: Date;
  items: Array<{
    productId: string;
    quantity: number;
    selectedAttributes?: UnitAttributes;
    priceOverride?: {
      unitPrice: number;
    };
  }>;
  customItems?: Array<{
    name: string;
    description: string;
    unitPrice: number;
    deposit: number;
    quantity: number;
    pricingMode: PricingMode;
  }>;
  delivery?: {
    outbound: {
      method: "store" | "address";
      locationId?: string | null;
      address?: string;
      city?: string;
      postalCode?: string;
      country?: string;
      latitude?: number;
      longitude?: number;
    };
    return: {
      method: "store" | "address";
      locationId?: string | null;
      address?: string;
      city?: string;
      postalCode?: string;
      country?: string;
      latitude?: number;
      longitude?: number;
    };
  };
  internalNotes?: string;
  /** Flat commercial discount in currency units; clamped to the subtotal. */
  discountAmount?: number;
  /** Replaces the computed deposit total when provided. */
  depositOverride?: number;
  tulipInsuranceOptIn?: boolean;
  sendConfirmationEmail?: boolean;
  sendAsQuote?: boolean;
  allowOverbooking?: boolean;
}

/**
 * What a line typed in the dashboard chose, read against the product as it is
 * under its lock: its exact combination when every axis has a value, none when
 * it left a choice open (any unit that matches what it did choose serves it).
 */
function resolveManualLineChoice(
  product: { trackUnits: boolean; bookingAttributeAxes: BookingAttributeAxis[] | null },
  requestedAttributes: UnitAttributes | undefined,
): { combinationKey: string | null; selectedAttributes: UnitAttributes | null } {
  const axes = product.bookingAttributeAxes ?? [];
  const chosen = canonicalizeAttributes(axes, requestedAttributes);
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

export async function createManualReservation(data: CreateReservationData) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: "errors.unauthorized" };
  }

  // A booking created as confirmed asks the card gate (README §8.4) before it writes a
  // new customer or calls the routing API. insertReservation asks again under the
  // transaction, and that answer is the one that counts.
  if (!data.sendAsQuote && !(await checkReservationGate(store.id, "dashboard")).accepts) {
    return { error: STORE_NOT_ACCEPTING_RESERVATIONS_ERROR };
  }

  let customerId = data.customerId;

  // Create new customer if needed
  if (!customerId && data.newCustomer) {
    // Check if customer exists
    const existingCustomer = await db.query.customers.findFirst({
      where: and(eq(customers.storeId, store.id), eq(customers.email, data.newCustomer.email)),
    });

    if (existingCustomer) {
      customerId = existingCustomer.id;
    } else {
      const newCustomerId = nanoid();
      await db.insert(customers).values({
        id: newCustomerId,
        storeId: store.id,
        email: data.newCustomer.email,
        firstName: data.newCustomer.firstName,
        lastName: data.newCustomer.lastName,
        phone: data.newCustomer.phone || null,
        createdVia: "dashboard",
      });
      customerId = newCustomerId;
    }
  }

  if (!customerId) {
    return { error: "errors.customerRequired" };
  }

  const customer = await db.query.customers.findFirst({
    where: and(eq(customers.id, customerId), eq(customers.storeId, store.id)),
  });

  if (!customer) {
    return { error: "errors.customerNotFound" };
  }

  const tulipMode = await getDashboardTulipInsuranceMode(store.id);
  const tulipInsuranceOptIn = resolveTulipInsuranceOptIn({
    mode: tulipMode,
    requested: data.tulipInsuranceOptIn,
    defaultOptional: true,
  });

  // Calculate totals
  let subtotalAmount = 0;
  let depositAmount = 0;

  // Process catalog products with pricing tiers
  const productDetails = await Promise.all(
    data.items.map(async (item) => {
      const product = await db.query.products.findFirst({
        where: and(eq(products.id, item.productId), eq(products.storeId, store.id)),
        with: {
          pricingTiers: true,
        },
      });

      if (!product) {
        throw new Error(`errors.productNotFound`);
      }

      // Get effective pricing mode for this product
      const effectivePricingMode = toPricingMode(product.pricingMode);
      const duration = calculateDuration(data.startDate, data.endDate, effectivePricingMode);
      const durationMinutes = calculateDurationMinutes(data.startDate, data.endDate);

      // Convert pricing tiers to the expected format
      const tiers: PricingTier[] = (product.pricingTiers || []).map((tier) => ({
        id: tier.id,
        minDuration: tier.minDuration ?? 1,
        discountPercent: parseFloat(tier.discountPercent ?? "0"),
        displayOrder: tier.displayOrder || 0,
      }));
      const rates: Rate[] = (product.pricingTiers || [])
        .filter(
          (tier): tier is typeof tier & { period: number; price: string } =>
            typeof tier.period === "number" && tier.period > 0 && typeof tier.price === "string",
        )
        .map((tier, index) => ({
          id: tier.id,
          period: tier.period,
          price: parseFloat(tier.price),
          displayOrder: tier.displayOrder ?? index,
        }));

      // Fetch seasonal pricings for this product
      const seasonalPricingConfigs = await fetchSeasonalPricingConfigs(product.id);

      const seasonalResult = calculateSeasonalAwarePrice(
        {
          timezone: store.settings?.timezone,
          basePrice: parseFloat(product.price),
          basePeriodMinutes: product.basePeriodMinutes ?? null,
          deposit: parseFloat(product.deposit || "0"),
          pricingKind: product.pricingKind,
          pricingMode: effectivePricingMode,
          enforceStrictTiers: product.enforceStrictTiers ?? false,
          tiers,
          rates,
        },
        seasonalPricingConfigs,
        data.startDate,
        data.endDate,
        item.quantity,
      );

      // Build a compatible result for existing code paths
      const priceResult = {
        subtotal: seasonalResult.subtotal,
        originalSubtotal: seasonalResult.originalSubtotal,
        savings: seasonalResult.savings,
        deposit: seasonalResult.deposit,
        total: seasonalResult.total,
      };

      let pricingBreakdown = buildReservationPricingBreakdown({
        pricingKind: product.pricingKind,
        basePrice: parseFloat(product.price),
        deposit: parseFloat(product.deposit || "0"),
        pricingMode: effectivePricingMode,
        quantity: item.quantity,
        durationMinutes,
        result: seasonalResult,
      });

      // Check for price override
      const hasPriceOverride = !!item.priceOverride;
      let effectiveUnitPrice = priceResult.subtotal / Math.max(1, item.quantity);
      let effectiveSubtotal = priceResult.subtotal;

      if (hasPriceOverride) {
        effectiveUnitPrice = item.priceOverride!.unitPrice;
        effectiveSubtotal =
          effectiveUnitPrice * (product.pricingKind === "fixed" ? 1 : duration) * item.quantity;

        // Update pricing breakdown to reflect the override
        pricingBreakdown = {
          ...pricingBreakdown,
          effectivePrice: effectiveUnitPrice,
          isManualOverride: true,
          originalPrice: priceResult.subtotal / Math.max(1, item.quantity),
        };
      }

      subtotalAmount += effectiveSubtotal;
      depositAmount += priceResult.deposit;

      return {
        product,
        quantity: item.quantity,
        unitPrice: effectiveUnitPrice.toFixed(2),
        depositPerUnit: product.deposit || "0",
        totalPrice: effectiveSubtotal.toFixed(2),
        pricingBreakdown,
        // What the line chose, as submitted: read against the product under its lock.
        requestedAttributes: item.selectedAttributes,
        isCustomItem: false,
      };
    }),
  );

  // Process custom items (no tiered pricing for custom items)
  const customItemDetails = (data.customItems || []).map((item) => {
    const duration = calculateDuration(data.startDate, data.endDate, item.pricingMode);
    const totalPrice = item.unitPrice * duration * item.quantity;
    const totalDeposit = item.deposit * item.quantity;

    subtotalAmount += totalPrice;
    depositAmount += totalDeposit;

    return {
      name: item.name,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice.toFixed(2),
      depositPerUnit: item.deposit.toFixed(2),
      totalPrice: totalPrice.toFixed(2),
      pricingBreakdown: {
        basePrice: item.unitPrice,
        effectivePrice: item.unitPrice,
        duration,
        pricingMode: item.pricingMode,
        discountPercent: null,
        discountAmount: 0,
        tierApplied: null,
        taxRate: null,
        taxAmount: null,
        subtotalExclTax: null,
        subtotalInclTax: null,
        isManualOverride: true,
      } satisfies PricingBreakdown,
      isCustomItem: true,
    };
  });

  const tulipQuoteItems = productDetails.map((detail) => ({
    productId: detail.product.id,
    quantity: detail.quantity,
  }));
  let appliedTulipInsuranceOptIn = tulipInsuranceOptIn;
  let tulipInsuranceAmount = 0;
  let tulipQuoteError: string | null = null;

  if (tulipInsuranceOptIn && tulipQuoteItems.length > 0) {
    const quote = await resolveReservationTulipQuotePreview({
      storeId: store.id,
      mode: tulipMode,
      fallbackCountry: store.settings?.country || "FR",
      customer,
      data: {
        startDate: data.startDate,
        endDate: data.endDate,
        tulipInsuranceOptIn: true,
        items: tulipQuoteItems,
      },
      logMessage: "[tulip] Failed to preview manual reservation quote before creation:",
    });

    tulipQuoteError = quote.quoteUnavailable ? quote.quoteError : null;
    appliedTulipInsuranceOptIn =
      quote.quoteUnavailable && tulipMode === "required" ? tulipInsuranceOptIn : quote.appliedOptIn;
    tulipInsuranceAmount = quote.amount;
  } else if (!tulipInsuranceOptIn) {
    appliedTulipInsuranceOptIn = false;
  }

  if (tulipInsuranceAmount > 0) {
    subtotalAmount += tulipInsuranceAmount;
  }

  // Delivery validation and fee calculation
  let deliveryFeeAmount = 0;
  let deliveryDistanceKm: number | null = null;
  let returnDistanceKm: number | null = null;
  const storeDeliverySettings = store.settings?.delivery;

  const outboundLeg = data.delivery?.outbound;
  const returnLeg = data.delivery?.return;
  const hasOutboundDelivery = outboundLeg?.method === "address";
  const hasReturnDelivery = returnLeg?.method === "address";
  const hasAnyDelivery = hasOutboundDelivery || hasReturnDelivery;
  const hasOutboundStore = !outboundLeg || outboundLeg.method === "store";
  const hasReturnStore = !returnLeg || returnLeg.method === "store";
  const isMultiLocationEnabled = Boolean(storeDeliverySettings?.multiLocationEnabled);
  let pickupLocation: Awaited<ReturnType<typeof resolveReservationLocationSnapshot>> | null = null;
  let returnLocation: Awaited<ReturnType<typeof resolveReservationLocationSnapshot>> | null = null;

  try {
    pickupLocation = hasOutboundStore
      ? await resolveReservationLocationSnapshot({
          store,
          locationId: isMultiLocationEnabled ? (outboundLeg?.locationId ?? null) : null,
        })
      : null;
    returnLocation = hasReturnStore
      ? await resolveReservationLocationSnapshot({
          store,
          locationId: isMultiLocationEnabled ? (returnLeg?.locationId ?? null) : null,
        })
      : null;
  } catch (error) {
    return { error: getActionErrorKey(error, "errors.locationInvalid") };
  }

  if (hasAnyDelivery) {
    if (!storeDeliverySettings?.enabled) {
      return { error: "errors.deliveryNotEnabled" };
    }

    if (!store.latitude || !store.longitude) {
      return { error: "errors.storeCoordinatesNotConfigured" };
    }

    const sLat = parseFloat(store.latitude);
    const sLon = parseFloat(store.longitude);

    // Validate outbound leg
    if (hasOutboundDelivery) {
      if (!outboundLeg.latitude || !outboundLeg.longitude) {
        return { error: "errors.deliveryAddressRequired" };
      }

      const outboundDistance = await getRouteDistance({
        originLatitude: sLat,
        originLongitude: sLon,
        destinationLatitude: outboundLeg.latitude,
        destinationLongitude: outboundLeg.longitude,
      });
      deliveryDistanceKm = outboundDistance.distanceKm;

      const validation = validateDelivery(deliveryDistanceKm, storeDeliverySettings);
      if (!validation.valid) {
        return { error: validation.errorKey || "errors.deliveryTooFar" };
      }
    }

    // Validate return leg
    if (hasReturnDelivery) {
      if (!returnLeg.latitude || !returnLeg.longitude) {
        return { error: "errors.returnAddressRequired" };
      }

      const inboundDistance = await getRouteDistance({
        originLatitude: sLat,
        originLongitude: sLon,
        destinationLatitude: returnLeg.latitude,
        destinationLongitude: returnLeg.longitude,
      });
      returnDistanceKm = inboundDistance.distanceKm;

      const returnValidation = validateDelivery(returnDistanceKm, storeDeliverySettings);
      if (!returnValidation.valid) {
        return { error: "errors.returnAddressTooFar" };
      }
    }

    // Calculate delivery fee server-side
    const isIncluded = storeDeliverySettings.mode === "included";
    if (isIncluded) {
      deliveryFeeAmount = 0;
    } else {
      const feeResult = calculateTotalDeliveryFee(
        deliveryDistanceKm,
        returnDistanceKm,
        storeDeliverySettings,
        subtotalAmount,
      );
      deliveryFeeAmount = feeResult.totalFee;
    }
  }

  // Generate reservation number
  const reservationNumber = await generateReservationNumber(store.id);

  const manualDiscountAmount = Math.min(Math.max(data.discountAmount ?? 0, 0), subtotalAmount);
  if (
    data.depositOverride != null &&
    Number.isFinite(data.depositOverride) &&
    data.depositOverride >= 0
  ) {
    depositAmount = data.depositOverride;
  }
  const totalAmount = subtotalAmount - manualDiscountAmount + deliveryFeeAmount;

  // Create reservation. Created as confirmed, insertReservation asks the card gate.
  const reservationId = nanoid();
  const reservationStatus = data.sendAsQuote ? "quote" : "confirmed";
  const actorUserId = await getActorUserId();
  const reservationWriteResult = await db.transaction(async (tx) => {
    // The product locks first. Everything the stock decision reads comes
    // after them: the products, the store's availability rules, the other
    // bookings, and which combination each line chose.
    const lockedProductsById = await lockReservationProducts(
      tx,
      store.id,
      productDetails.map((detail) => detail.product.id),
    );
    const [availabilityRules] = await tx
      .select({ settings: stores.settings })
      .from(stores)
      .where(eq(stores.id, store.id));

    const lines: Array<{
      detail: (typeof productDetails)[number];
      choice: ReturnType<typeof resolveManualLineChoice>;
    }> = [];
    for (const detail of productDetails) {
      const product = lockedProductsById.get(detail.product.id);
      if (!product) {
        return { ok: false as const, error: "errors.productNotFound", shortfalls: [] };
      }
      lines.push({
        detail,
        choice: resolveManualLineChoice(product, detail.requestedAttributes),
      });
    }

    // The stock rule every booking is checked against. Each shortfall is
    // listed, for the store to book over on purpose. Consumables are checked
    // here against what other bookings hold, and again when they are taken.
    const inventory = await reserveInventory({
      tx,
      storeId: store.id,
      lockedProductsById,
      lines: lines.map(({ detail, choice }) => ({
        productId: detail.product.id,
        quantity: detail.quantity,
        selectedAttributes: choice.selectedAttributes ?? undefined,
        combinationKey: choice.combinationKey,
        // A line with no exact combination is served by any unit that
        // matches what it chose (resolveUnitAssignmentScope).
        pooled: choice.combinationKey === null,
      })),
      window: { start: data.startDate, end: data.endDate },
      blockingStatuses: getBlockingReservationStatuses(
        availabilityRules?.settings?.pendingBlocksAvailability ?? true,
      ),
      turnoverBufferMinutes: availabilityRules?.settings?.turnoverBufferMinutes ?? 0,
      // A booking the team types does not ask for the required accessories.
      skipRequiredAccessoryCheck: true,
      onShortfall: "collect",
    });
    if (!inventory.ok) {
      return { ok: false as const, error: inventory.error, shortfalls: [] };
    }
    if (inventory.shortfalls.length > 0 && !data.allowOverbooking) {
      return {
        ok: false as const,
        error: "errors.insufficientCapacity",
        shortfalls: inventory.shortfalls,
      };
    }

    const { effects, lock } = await insertReservation(tx, {
      id: reservationId,
      storeId: store.id,
      customerId,
      number: reservationNumber,
      status: reservationStatus,
      // Frozen at creation: the store can change its currency later (billing contract Q4).
      currency: reservationCurrency(null, store.settings),
      startDate: data.startDate,
      endDate: data.endDate,
      subtotalAmount: subtotalAmount.toFixed(2),
      depositAmount: depositAmount.toFixed(2),
      totalAmount: totalAmount.toFixed(2),
      discountAmount: manualDiscountAmount.toFixed(2),
      internalNotes: data.internalNotes || null,
      source: "manual",
      // Staff books on the customer's behalf: the profile's default identity
      // is the one this reservation is billed under.
      billingSnapshot: billingFromCustomer(customer),
      tulipInsuranceOptIn: appliedTulipInsuranceOptIn,
      tulipInsuranceAmount: tulipInsuranceAmount > 0 ? tulipInsuranceAmount.toFixed(2) : null,
      // Delivery fields — leg-based model
      outboundMethod: outboundLeg?.method || "store",
      returnMethod: returnLeg?.method || "store",
      deliveryOption: hasAnyDelivery ? "delivery" : "pickup",
      deliveryAddress: hasOutboundDelivery ? (outboundLeg.address ?? null) : null,
      deliveryCity: hasOutboundDelivery ? (outboundLeg.city ?? null) : null,
      deliveryPostalCode: hasOutboundDelivery ? (outboundLeg.postalCode ?? null) : null,
      deliveryCountry: hasOutboundDelivery ? (outboundLeg.country ?? null) : null,
      deliveryLatitude:
        hasOutboundDelivery && outboundLeg.latitude ? outboundLeg.latitude.toString() : null,
      deliveryLongitude:
        hasOutboundDelivery && outboundLeg.longitude ? outboundLeg.longitude.toString() : null,
      deliveryDistanceKm: deliveryDistanceKm?.toFixed(2) ?? null,
      deliveryFee: deliveryFeeAmount.toFixed(2),
      returnAddress: hasReturnDelivery ? (returnLeg.address ?? null) : null,
      returnCity: hasReturnDelivery ? (returnLeg.city ?? null) : null,
      returnPostalCode: hasReturnDelivery ? (returnLeg.postalCode ?? null) : null,
      returnCountry: hasReturnDelivery ? (returnLeg.country ?? null) : null,
      returnLatitude:
        hasReturnDelivery && returnLeg.latitude != null ? returnLeg.latitude.toString() : null,
      returnLongitude:
        hasReturnDelivery && returnLeg.longitude != null ? returnLeg.longitude.toString() : null,
      returnDistanceKm: returnDistanceKm?.toFixed(2) ?? null,
      pickupLocationId: pickupLocation?.locationId ?? null,
      returnLocationId: returnLocation?.locationId ?? null,
      pickupLocationSnapshot: pickupLocation?.snapshot ?? null,
      returnLocationSnapshot: returnLocation?.snapshot ?? null,
    });

    // Create reservation items for catalog products. A line keeps the
    // combination it chose, also when it was booked over the stock.
    for (const { detail, choice } of lines) {
      await tx.insert(reservationItems).values({
        reservationId,
        productId: detail.product.id,
        isCustomItem: false,
        quantity: detail.quantity,
        unitPrice: detail.unitPrice,
        depositPerUnit: detail.depositPerUnit,
        totalPrice: detail.totalPrice,
        pricingBreakdown: detail.pricingBreakdown,
        combinationKey: choice.combinationKey,
        selectedAttributes: choice.selectedAttributes,
        productSnapshot: {
          name: detail.product.name,
          description: detail.product.description,
          images: detail.product.images || [],
          combinationKey: choice.combinationKey,
          selectedAttributes: choice.selectedAttributes,
        },
      });
    }

    // Create reservation items for custom items
    for (const customItem of customItemDetails) {
      await tx.insert(reservationItems).values({
        reservationId,
        productId: null,
        isCustomItem: true,
        quantity: customItem.quantity,
        unitPrice: customItem.unitPrice,
        depositPerUnit: customItem.depositPerUnit,
        totalPrice: customItem.totalPrice,
        pricingBreakdown: customItem.pricingBreakdown,
        productSnapshot: {
          name: customItem.name,
          description: customItem.description,
          images: [],
        },
      });
    }

    if (tulipInsuranceAmount > 0) {
      await tx.insert(reservationItems).values({
        reservationId,
        productId: null,
        isCustomItem: true,
        quantity: 1,
        unitPrice: tulipInsuranceAmount.toFixed(2),
        depositPerUnit: "0.00",
        totalPrice: tulipInsuranceAmount.toFixed(2),
        productSnapshot: {
          name: "Garantie casse/vol",
          description: "Garantie casse/vol",
          images: [],
        },
      });
    }

    // Written with the booking: its history, and its capacity verdict for the inbox.
    await tx.insert(reservationActivity).values({
      id: nanoid(),
      reservationId,
      userId: actorUserId,
      activityType: "created",
      metadata: {
        source: "manual",
        status: reservationStatus,
        tulipInsuranceOptIn: appliedTulipInsuranceOptIn,
        tulipInsuranceAmount,
        ...capacityVerdictMetadata(inventory.shortfalls),
        ...(tulipQuoteError && { tulipQuoteError }),
      },
    });

    if (!data.sendAsQuote) {
      // Consumable stock is physical: the override never takes it below zero.
      await consumeReservationStock(tx, lock);
      await validateReservationContract(tx, reservationId, store.id, "confirmation");
    }

    return { ok: true as const, effects };
  }).catch(refuseCreation);

  if (!reservationWriteResult.ok) {
    return {
      error: reservationWriteResult.error,
      shortfalls: reservationWriteResult.shortfalls,
    };
  }

  // Right after commit: a reservation created as confirmed records its
  // pay-as-you-go fee. A quote records it when it is accepted.
  await runReservationEffects(reservationWriteResult.effects);

  const catalogQuantity = productDetails.reduce((total, detail) => total + detail.quantity, 0);
  const customQuantity = customItemDetails.reduce((total, detail) => total + detail.quantity, 0);
  const shouldSendEmail = data.sendConfirmationEmail !== false;

  await captureProductServerEvent({
    distinctId: store.userId,
    event: productAnalyticsEvents.dashboardReservationCreated,
    properties: {
      feature: "reservation_management",
      surface: "dashboard",
      store_id: store.id,
      reservation_id: reservationId,
      customer_id: customerId,
      source: "dashboard_manual",
      reservation_status: reservationStatus,
      catalog_line_count: productDetails.length,
      custom_line_count: customItemDetails.length,
      total_line_count:
        productDetails.length + customItemDetails.length + (tulipInsuranceAmount > 0 ? 1 : 0),
      total_quantity: catalogQuantity + customQuantity,
      has_delivery: hasAnyDelivery,
      has_outbound_delivery: hasOutboundDelivery,
      has_return_delivery: hasReturnDelivery,
      has_tulip_insurance: tulipInsuranceAmount > 0,
      tulip_insurance_opt_in: appliedTulipInsuranceOptIn,
      sent_as_quote: Boolean(data.sendAsQuote),
      send_confirmation_email: shouldSendEmail,
      subtotal_amount_cents: toAnalyticsAmountCents(subtotalAmount),
      discount_amount_cents: toAnalyticsAmountCents(manualDiscountAmount),
      delivery_fee_cents: toAnalyticsAmountCents(deliveryFeeAmount),
      deposit_amount_cents: toAnalyticsAmountCents(depositAmount),
      total_amount_cents: toAnalyticsAmountCents(totalAmount),
      currency: store.settings?.currency ?? "EUR",
    },
  });

  try {
    await createTulipContractForReservation({
      reservationId,
      source: "dashboard_manual_reservation_creation",
    });
  } catch (error) {
    console.error("[tulip] Failed to create contract for manual reservation:", {
      reservationId,
      error,
    });
  }

  // Send email for manual reservations (if enabled)
  if (customer && shouldSendEmail) {
    const storeData = {
      id: store.id,
      name: store.name,
      logoUrl: store.logoUrl,
      darkLogoUrl: store.darkLogoUrl,
      email: store.email,
      phone: store.phone,
      address: store.address,
      theme: store.theme,
      settings: store.settings,
      emailSettings: store.emailSettings,
      customerNotificationSettings: store.customerNotificationSettings,
    };

    const customerData = {
      id: customer.id,
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email,
      phone: customer.phone,
    };

    // Combine catalog products and custom items for email
    const emailItems = [
      ...productDetails.map((detail) => ({
        name: detail.product.name,
        quantity: detail.quantity,
        unitPrice: parseFloat(detail.unitPrice),
        totalPrice: parseFloat(detail.totalPrice),
      })),
      ...customItemDetails.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        unitPrice: parseFloat(item.unitPrice),
        totalPrice: parseFloat(item.totalPrice),
      })),
      ...(tulipInsuranceAmount > 0
        ? [
            {
              name: "Garantie casse/vol",
              quantity: 1,
              unitPrice: tulipInsuranceAmount,
              totalPrice: tulipInsuranceAmount,
            },
          ]
        : []),
    ];

    if (data.sendAsQuote) {
      // Generate authenticated access token for the quote URL
      const token = nanoid(64);
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
      await db.insert(verificationCodes).values({
        id: nanoid(),
        email: customer.email,
        storeId: store.id,
        code: "",
        type: "instant_access",
        token,
        reservationId,
        expiresAt,
        createdAt: new Date(),
      });
      const quoteAccessUrl = getStorefrontUrl(store.slug, `/r/${reservationId}?token=${token}`);

      // Send quote email via dispatcher
      dispatchCustomerNotification("customer_quote_sent", {
        store: storeData,
        customer: customerData,
        reservation: {
          id: reservationId,
          number: reservationNumber,
          startDate: data.startDate,
          endDate: data.endDate,
          totalAmount,
          subtotalAmount,
          depositAmount,
        },
        items: emailItems,
        reservationUrl: quoteAccessUrl,
      }).catch((error) => {
        console.error("Failed to send quote email:", error);
      });
    } else {
      // Send confirmation email. A reservation made in the dashboard is never signed yet,
      // so the email carries a link that signs the customer in to sign it.
      const reservationUrl = getStorefrontUrl(store.slug, `/account/reservations/${reservationId}`);
      const customerEmail = customer.email;
      createReservationInstantAccessUrl({
        storeId: store.id,
        storeSlug: store.slug,
        customerEmail,
        reservationId,
      })
        .then((contractSignatureUrl) =>
          sendReservationConfirmationEmail({
            to: customerEmail,
            store: storeData,
            customer: customerData,
            reservation: {
              id: reservationId,
              number: reservationNumber,
              startDate: data.startDate,
              endDate: data.endDate,
              subtotalAmount,
              depositAmount,
              totalAmount,
            },
            items: emailItems,
            reservationUrl,
            contractSignatureUrl,
            locale: getLocaleFromCountry(store.settings?.country),
          }),
        )
        .catch((error) => {
          console.error("Failed to send reservation confirmation email:", error);
        });
    }
  }

  // Platform admin notification
  const customerName = customer
    ? `${customer.firstName} ${customer.lastName}`
    : data.newCustomer
      ? `${data.newCustomer.firstName} ${data.newCustomer.lastName}`
      : "Unknown";
  notifyNewReservation(
    { id: store.id, name: store.name, slug: store.slug },
    {
      number: reservationNumber,
      customerName,
      totalAmount,
      currency: store.settings?.currency,
    },
  ).catch(() => {});

  revalidatePath("/dashboard/reservations");
  revalidatePath("/dashboard");
  return { success: true, reservationId };
}

export async function getStoreCustomers() {
  const store = await getStoreForUser();
  if (!store) {
    return [];
  }

  return db.query.customers.findMany({
    where: eq(customers.storeId, store.id),
    orderBy: (customers, { desc }) => [desc(customers.createdAt)],
  });
}

export async function getStoreProducts() {
  const store = await getStoreForUser();
  if (!store) {
    return [];
  }

  const storeProducts = await db.query.products.findMany({
    where: and(eq(products.storeId, store.id), eq(products.status, "active")),
    orderBy: (products, { asc }) => [asc(products.name)],
  });
  const effectiveQuantities = await getEffectiveProductQuantities(
    db,
    storeProducts.map((product) => product.id),
  );

  return storeProducts.map((product) => ({
    ...product,
    quantity: product.trackUnits ? (effectiveQuantities.get(product.id) ?? 0) : product.quantity,
  }));
}

// ============================================================================
// Reservation Edit Actions
// ============================================================================

interface UpdateReservationItem {
  id?: string; // Existing item ID (for update) or undefined (for new)
  productId?: string | null; // null for custom items
  quantity: number;
  unitPrice: number;
  depositPerUnit: number;
  isManualPrice?: boolean;
  pricingMode?: PricingMode;
  productSnapshot: {
    name: string;
    description?: string | null;
    images?: string[];
  };
}

interface UpdateDeliveryLeg {
  method: "store" | "address";
  locationId?: string | null;
  address?: string;
  city?: string;
  postalCode?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
}

interface UpdateReservationData {
  startDate?: Date;
  endDate?: Date;
  notifyCustomerByEmail?: boolean;
  tulipInsuranceOptIn?: boolean;
  overrideTurnoverBuffer?: boolean;
  /** Write the edit although it asks more stock than is free; the history keeps the shortfalls. */
  allowOverbooking?: boolean;
  delivery?: {
    outbound: UpdateDeliveryLeg;
    return: UpdateDeliveryLeg;
  };
  items?: UpdateReservationItem[];
}

type UpdateReservationConflict = {
  reservationItemId: string;
  unitId: string;
  identifier: string;
};

type UpdateReservationResult = {
  success?: boolean;
  error?: string;
  bufferConflict?: boolean;
  failedUnitIds?: string[];
  conflicts?: UpdateReservationConflict[];
  /** With `errors.insufficientCapacity`: every line the stock would not cover after the edit. */
  shortfalls?: CapacityShortfall[];
  reservationItemId?: string;
  assignedCount?: number;
  warnings?: Array<{
    key: string;
    params?: Record<string, string | number>;
  }>;
  emailNotification?:
    | { status: "sent"; to: string }
    | { status: "failed"; error: string; to: string };
} & Record<string, unknown>;

type ReservationItemInsertValues = typeof reservationItems.$inferInsert;
type ReservationItemUpdateValues = Pick<
  ReservationItemInsertValues,
  | "productId"
  | "isCustomItem"
  | "quantity"
  | "unitPrice"
  | "depositPerUnit"
  | "totalPrice"
  | "pricingBreakdown"
>;

type ReservationItemWrite =
  | { type: "insert"; values: ReservationItemInsertValues }
  | { type: "update"; id: string; values: ReservationItemUpdateValues };

// Delivery columns only: the reservation update spreads these, and a status
// written there would skip changeReservationStatus (DL-12).
type ReservationDeliveryUpdateValues = Partial<
  Pick<
    typeof reservations.$inferInsert,
    | "outboundMethod"
    | "pickupLocationId"
    | "pickupLocationSnapshot"
    | "deliveryAddress"
    | "deliveryCity"
    | "deliveryPostalCode"
    | "deliveryCountry"
    | "deliveryLatitude"
    | "deliveryLongitude"
    | "deliveryDistanceKm"
    | "returnMethod"
    | "returnLocationId"
    | "returnLocationSnapshot"
    | "returnAddress"
    | "returnCity"
    | "returnPostalCode"
    | "returnCountry"
    | "returnLatitude"
    | "returnLongitude"
    | "returnDistanceKm"
    | "deliveryFee"
    | "deliveryOption"
  >
>;

function normalizeMoney(value: string | number) {
  const parsed = typeof value === "number" ? value : parseFloat(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
}

function hasReservationItemChanges(
  current: {
    productId: string | null;
    isCustomItem: boolean;
    quantity: number;
    unitPrice: string;
    depositPerUnit: string;
    totalPrice: string;
    pricingBreakdown: PricingBreakdown | null;
  },
  next: ReservationItemUpdateValues,
) {
  return (
    current.productId !== next.productId ||
    current.isCustomItem !== next.isCustomItem ||
    current.quantity !== next.quantity ||
    normalizeMoney(current.unitPrice) !== normalizeMoney(next.unitPrice) ||
    normalizeMoney(current.depositPerUnit) !== normalizeMoney(next.depositPerUnit) ||
    normalizeMoney(current.totalPrice) !== normalizeMoney(next.totalPrice) ||
    JSON.stringify(current.pricingBreakdown) !== JSON.stringify(next.pricingBreakdown)
  );
}

interface PreviewReservationTulipQuoteData {
  startDate: Date | string;
  endDate: Date | string;
  tulipInsuranceOptIn?: boolean;
  items: Array<{
    productId?: string | null;
    quantity: number;
  }>;
}

type ReservationTulipQuotePreview = {
  mode: TulipPublicMode;
  connected: boolean;
  inclusionEnabled: boolean;
  quoteUnavailable: boolean;
  quoteError: string | null;
  requestedOptIn: boolean;
  appliedOptIn: boolean;
  amount: number;
  insuredProductCount: number;
  uninsuredProductCount: number;
  insuredProductIds: string[];
};

function createEmptyReservationTulipQuotePreview(
  mode: TulipPublicMode,
  overrides: Partial<ReservationTulipQuotePreview> = {},
): ReservationTulipQuotePreview {
  return {
    mode,
    connected: mode !== "no_public",
    inclusionEnabled: false,
    quoteUnavailable: false,
    quoteError: null,
    requestedOptIn: false,
    appliedOptIn: false,
    amount: 0,
    insuredProductCount: 0,
    uninsuredProductCount: 0,
    insuredProductIds: [],
    ...overrides,
  };
}

type ReservationTulipQuotePreviewCustomer = {
  customerType?: "individual" | "business" | null;
  companyName?: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  postalCode?: string | null;
  country?: string | null;
};

interface PreviewManualReservationTulipQuoteData extends PreviewReservationTulipQuoteData {
  customerId?: string;
  newCustomer?: {
    email: string;
    firstName: string;
    lastName: string;
    phone?: string;
  };
}

function normalizeReservationTulipQuoteItems(items: PreviewReservationTulipQuoteData["items"]) {
  return items
    .filter(
      (item): item is { productId: string; quantity: number } =>
        typeof item.productId === "string" && item.productId.length > 0 && item.quantity > 0,
    )
    .map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
    }));
}

async function resolveReservationTulipQuotePreview(params: {
  storeId: string;
  mode: TulipPublicMode;
  fallbackCountry: string;
  customer: ReservationTulipQuotePreviewCustomer;
  data: PreviewReservationTulipQuoteData;
  logMessage: string;
  logContext?: Record<string, unknown>;
}): Promise<ReservationTulipQuotePreview> {
  const requestedOptIn = resolveTulipInsuranceOptIn({
    mode: params.mode,
    requested: params.data.tulipInsuranceOptIn,
    defaultOptional: true,
  });

  if (params.mode === "no_public" || !requestedOptIn) {
    return createEmptyReservationTulipQuotePreview(params.mode, {
      requestedOptIn,
    });
  }

  const startDate =
    params.data.startDate instanceof Date ? params.data.startDate : new Date(params.data.startDate);
  const endDate =
    params.data.endDate instanceof Date ? params.data.endDate : new Date(params.data.endDate);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate < startDate) {
    return createEmptyReservationTulipQuotePreview(params.mode, {
      requestedOptIn,
      quoteUnavailable: true,
      quoteError: "errors.invalidData",
    });
  }

  if (startDate.getTime() < Date.now()) {
    return createEmptyReservationTulipQuotePreview(params.mode, {
      requestedOptIn,
      quoteUnavailable: true,
      quoteError: "errors.tulipContractPastDate",
    });
  }

  const quoteItems = normalizeReservationTulipQuoteItems(params.data.items);

  if (quoteItems.length === 0) {
    return createEmptyReservationTulipQuotePreview(params.mode, {
      requestedOptIn,
    });
  }

  const customer = {
    customerType: params.customer.customerType,
    companyName: params.customer.companyName,
    firstName: params.customer.firstName,
    lastName: params.customer.lastName,
    email: params.customer.email,
    phone: params.customer.phone || "",
    address: params.customer.address || "",
    city: params.customer.city || "",
    postalCode: params.customer.postalCode || "",
    country: params.customer.country || params.fallbackCountry,
  };

  try {
    const quote = await previewTulipQuoteForCheckout({
      storeId: params.storeId,
      modeOverride: params.mode,
      customer,
      items: quoteItems,
      startDate,
      endDate,
      optIn: true,
    });

    const inclusionEnabled = quote.inclusionEnabled === true;
    const amount =
      !inclusionEnabled && quote.shouldApply && Number.isFinite(quote.amount) && quote.amount > 0
        ? Math.round(quote.amount * 100) / 100
        : 0;

    return {
      mode: params.mode,
      connected: true,
      inclusionEnabled,
      quoteUnavailable: false,
      quoteError: null,
      requestedOptIn,
      appliedOptIn: requestedOptIn && quote.shouldApply,
      amount,
      insuredProductCount: quote.insuredProductCount,
      uninsuredProductCount: quote.uninsuredProductCount,
      insuredProductIds: quote.insuredProductIds,
    };
  } catch (error) {
    const coverageSummary = await getTulipCoverageSummary(quoteItems);
    const errorKey = getErrorKey(error, "errors.tulipQuoteFailed");

    console.warn(params.logMessage, {
      ...params.logContext,
      error,
    });

    return createEmptyReservationTulipQuotePreview(params.mode, {
      requestedOptIn,
      quoteUnavailable: true,
      quoteError: errorKey,
      insuredProductCount: coverageSummary.insuredProductCount,
      uninsuredProductCount: coverageSummary.uninsuredProductCount,
      insuredProductIds: coverageSummary.insuredProductIds,
    });
  }
}

export async function previewManualReservationTulipQuote(
  data: PreviewManualReservationTulipQuoteData,
): Promise<ReservationTulipQuotePreview> {
  const store = await getStoreForUser();
  if (!store) {
    return createEmptyReservationTulipQuotePreview("no_public", {
      connected: false,
      quoteUnavailable: true,
      quoteError: "errors.unauthorized",
    });
  }

  const mode = await getDashboardTulipInsuranceMode(store.id);
  const requestedOptIn = resolveTulipInsuranceOptIn({
    mode,
    requested: data.tulipInsuranceOptIn,
    defaultOptional: true,
  });

  let customer: ReservationTulipQuotePreviewCustomer | null = null;

  if (data.customerId) {
    customer =
      (await db.query.customers.findFirst({
        where: and(eq(customers.id, data.customerId), eq(customers.storeId, store.id)),
      })) ?? null;
  } else if (data.newCustomer) {
    customer = {
      customerType: "individual",
      companyName: null,
      firstName: data.newCustomer.firstName,
      lastName: data.newCustomer.lastName,
      email: data.newCustomer.email,
      phone: data.newCustomer.phone || "",
      address: "",
      city: "",
      postalCode: "",
      country: store.settings?.country || "FR",
    };
  }

  if (!customer) {
    return createEmptyReservationTulipQuotePreview(mode, {
      requestedOptIn,
      quoteUnavailable: true,
      quoteError: "errors.customerRequired",
    });
  }

  return resolveReservationTulipQuotePreview({
    storeId: store.id,
    mode,
    fallbackCountry: store.settings?.country || "FR",
    customer,
    data,
    logMessage: "[tulip] Failed to preview manual reservation quote:",
  });
}

export async function previewReservationTulipQuote(
  reservationId: string,
  data: PreviewReservationTulipQuoteData,
): Promise<ReservationTulipQuotePreview> {
  const store = await getStoreForUser();
  if (!store) {
    return createEmptyReservationTulipQuotePreview("no_public", {
      connected: false,
      quoteUnavailable: true,
      quoteError: "errors.unauthorized",
    });
  }

  const mode = await getDashboardTulipInsuranceMode(store.id);
  const requestedOptIn = resolveTulipInsuranceOptIn({
    mode,
    requested: data.tulipInsuranceOptIn,
    defaultOptional: true,
  });

  const reservation = await db.query.reservations.findFirst({
    where: and(eq(reservations.id, reservationId), eq(reservations.storeId, store.id)),
    with: {
      customer: true,
    },
  });

  if (!reservation) {
    return createEmptyReservationTulipQuotePreview(mode, {
      requestedOptIn,
      quoteUnavailable: true,
      quoteError: "errors.reservationNotFound",
    });
  }

  if (!reservation.customer) {
    return createEmptyReservationTulipQuotePreview(mode, {
      requestedOptIn,
      quoteUnavailable: true,
      quoteError: "errors.customerNotFound",
    });
  }

  return resolveReservationTulipQuotePreview({
    storeId: store.id,
    mode,
    fallbackCountry: store.settings?.country || "FR",
    customer: {
      ...reservation.customer,
      ...resolveReservationBilling(reservation, reservation.customer),
    },
    data,
    logMessage: "[tulip] Failed to preview reservation edit quote:",
    logContext: {
      reservationId,
    },
  });
}

export async function updateReservation(
  reservationId: string,
  data: UpdateReservationData,
): Promise<UpdateReservationResult> {
  const store = await getStoreForUser();
  if (!store) {
    return { error: "errors.unauthorized" };
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(eq(reservations.id, reservationId), eq(reservations.storeId, store.id)),
    with: {
      items: {
        with: {
          assignedUnits: true,
        },
      },
      customer: true,
    },
  });

  if (!reservation) {
    return { error: "errors.reservationNotFound" };
  }

  // Cannot edit completed reservations
  if (reservation.status === "completed") {
    return { error: "errors.cannotEditCompletedReservation" };
  }

  // Store previous state for activity log
  const previousState = {
    startDate: reservation.startDate,
    endDate: reservation.endDate,
    subtotalAmount: parseFloat(reservation.subtotalAmount),
    depositAmount: parseFloat(reservation.depositAmount),
    totalAmount: parseFloat(reservation.totalAmount),
    items: reservation.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: parseFloat(item.unitPrice),
      totalPrice: parseFloat(item.totalPrice),
      productSnapshot: item.productSnapshot,
    })),
  };

  // Determine new dates
  const newStartDate = data.startDate || reservation.startDate;
  const newEndDate = data.endDate || reservation.endDate;
  if (newEndDate < newStartDate) {
    return { error: "errors.endDateBeforeStart" };
  }

  const previousPeriodMs = reservation.endDate.getTime() - reservation.startDate.getTime();
  const nextPeriodMs = newEndDate.getTime() - newStartDate.getTime();
  const isPeriodReduced = nextPeriodMs < previousPeriodMs;
  const tulipMode = await getDashboardTulipInsuranceMode(store.id);
  const requestedTulipInsuranceOptIn = resolveTulipInsuranceOptIn({
    mode: tulipMode,
    requested: data.tulipInsuranceOptIn,
    current: reservation.tulipInsuranceOptIn,
    defaultOptional: true,
  });
  const isTulipInsurancePastDateBlocked = newStartDate.getTime() < Date.now();
  const nextTulipInsuranceOptIn = isTulipInsurancePastDateBlocked
    ? false
    : requestedTulipInsuranceOptIn;

  const validationWarnings = evaluateReservationRules({
    startDate: newStartDate,
    endDate: newEndDate,
    storeSettings: store.settings,
  });

  // Calculate new totals
  let newSubtotalAmount = 0;
  let newDepositAmount = 0;
  let nextTulipInsuranceAmount: number | null = null;
  const tulipWarnings: Array<{
    key: string;
    params?: Record<string, string | number>;
  }> = [];
  if (isTulipInsurancePastDateBlocked && requestedTulipInsuranceOptIn) {
    tulipWarnings.push({ key: "errors.tulipInsuranceDisabledPastDate" });
  }
  const insuranceQuoteItems: Array<{ productId: string; quantity: number }> = [];
  const legacyInsuranceItemIds = reservation.items
    .filter((item) =>
      isLegacyTulipInsuranceItem({
        isCustomItem: item.isCustomItem,
        productSnapshot: item.productSnapshot,
      }),
    )
    .map((item) => item.id);
  const previousInsuranceSelection = getReservationInsuranceSelection({
    tulipInsuranceOptIn: reservation.tulipInsuranceOptIn,
    tulipInsuranceAmount: reservation.tulipInsuranceAmount,
    items: reservation.items,
  });
  const previousTulipInsuranceAmount =
    previousInsuranceSelection.amount > 0 ? previousInsuranceSelection.amount : null;

  const INSURANCE_ITEM_NAME = "Garantie casse/vol";
  const existingItemsById = new Map(reservation.items.map((item) => [item.id, item]));
  const existingNonInsuranceItems = reservation.items.filter(
    (item) =>
      !isLegacyTulipInsuranceItem({
        isCustomItem: item.isCustomItem,
        productSnapshot: item.productSnapshot,
      }),
  );
  const itemWrites: ReservationItemWrite[] = [];
  let removedReservationItemIds: string[] = [];
  const insuranceItemWrites: ReservationItemWrite[] = [];
  let extraInsuranceItemIdsToDelete: string[] = [];

  // Process items
  if (data.items && data.items.length > 0) {
    const reservationItemsWithoutLegacyInsurance = data.items.filter(
      (item) =>
        !isLegacyTulipInsuranceItem({
          isCustomItem: !item.productId,
          productSnapshot: item.productSnapshot,
        }),
    );
    const submittedExistingItemIds = new Set(
      reservationItemsWithoutLegacyInsurance
        .map((item) => item.id)
        .filter((itemId): itemId is string => Boolean(itemId)),
    );
    for (const submittedItemId of submittedExistingItemIds) {
      if (!existingItemsById.has(submittedItemId)) {
        return { error: "errors.invalidData" };
      }
    }
    removedReservationItemIds = existingNonInsuranceItems
      .filter((item) => !submittedExistingItemIds.has(item.id))
      .map((item) => item.id);

    // Insert new items
    for (const item of reservationItemsWithoutLegacyInsurance) {
      let pricingBreakdown: PricingBreakdown | null = null;
      let finalUnitPrice = item.unitPrice;
      let itemPricingMode: PricingMode = toPricingMode(item.pricingMode);
      let duration = calculateDuration(newStartDate, newEndDate, itemPricingMode);
      let totalPrice = item.unitPrice * duration * item.quantity;
      let manualPricingKind: PricingKind = "duration";

      if (item.isManualPrice && item.productId) {
        const manualPriceProduct = await db.query.products.findFirst({
          where: and(eq(products.id, item.productId), eq(products.storeId, store.id)),
          columns: { pricingKind: true },
        });
        // The product may have been deleted since the reservation was created;
        // the stored breakdown keeps the kind so the manual price stays editable.
        const existingBreakdown = item.id
          ? existingItemsById.get(item.id)?.pricingBreakdown
          : undefined;
        manualPricingKind =
          manualPriceProduct?.pricingKind ?? toPricingKind(existingBreakdown?.pricingKind);
        duration = manualPricingKind === "fixed" ? 1 : duration;
        totalPrice = item.unitPrice * duration * item.quantity;
      }

      // If not manual price and has a productId, calculate with tiers
      if (!item.isManualPrice && item.productId) {
        const product = await db.query.products.findFirst({
          where: and(eq(products.id, item.productId), eq(products.storeId, store.id)),
          with: { pricingTiers: true },
        });

        if (product) {
          const effectivePricingMode = toPricingMode(product.pricingMode);
          itemPricingMode = effectivePricingMode;
          duration = calculateDuration(newStartDate, newEndDate, itemPricingMode);
          const durationMinutes = calculateDurationMinutes(newStartDate, newEndDate);
          const tiers: PricingTier[] = (product.pricingTiers || []).map((tier) => ({
            id: tier.id,
            minDuration: tier.minDuration ?? 1,
            discountPercent: parseFloat(tier.discountPercent ?? "0"),
            displayOrder: tier.displayOrder || 0,
          }));
          const rates: Rate[] = (product.pricingTiers || [])
            .filter(
              (tier): tier is typeof tier & { period: number; price: string } =>
                typeof tier.period === "number" &&
                tier.period > 0 &&
                typeof tier.price === "string",
            )
            .map((tier, index) => ({
              id: tier.id,
              period: tier.period,
              price: parseFloat(tier.price),
              displayOrder: tier.displayOrder ?? index,
            }));

          // Fetch seasonal pricings for this product
          const seasonalPricingConfigsForItem = await fetchSeasonalPricingConfigs(product.id);

          const seasonalResultForItem = calculateSeasonalAwarePrice(
            {
              timezone: store.settings?.timezone,
              basePrice: parseFloat(product.price),
              basePeriodMinutes: product.basePeriodMinutes ?? null,
              deposit: parseFloat(product.deposit || "0"),
              pricingKind: product.pricingKind,
              pricingMode: itemPricingMode,
              enforceStrictTiers: product.enforceStrictTiers ?? false,
              tiers,
              rates,
            },
            seasonalPricingConfigsForItem,
            newStartDate,
            newEndDate,
            item.quantity,
          );

          const priceResult = {
            subtotal: seasonalResultForItem.subtotal,
            originalSubtotal: seasonalResultForItem.originalSubtotal,
            savings: seasonalResultForItem.savings,
            deposit: seasonalResultForItem.deposit,
          };

          pricingBreakdown = buildReservationPricingBreakdown({
            pricingKind: product.pricingKind,
            basePrice: parseFloat(product.price),
            deposit: parseFloat(product.deposit || "0"),
            pricingMode: itemPricingMode,
            quantity: item.quantity,
            durationMinutes,
            result: seasonalResultForItem,
          });
          finalUnitPrice = priceResult.subtotal / Math.max(1, item.quantity);
          totalPrice = priceResult.subtotal;
        }
      } else if (item.isManualPrice) {
        pricingBreakdown = {
          basePrice: item.unitPrice,
          effectivePrice: item.unitPrice,
          duration,
          pricingMode: itemPricingMode,
          pricingKind: manualPricingKind,
          discountPercent: null,
          discountAmount: 0,
          tierApplied: null,
          taxRate: null,
          taxAmount: null,
          subtotalExclTax: null,
          subtotalInclTax: null,
          isManualOverride: true,
        };
      }

      const itemDeposit = item.depositPerUnit * item.quantity;
      newSubtotalAmount += totalPrice;
      newDepositAmount += itemDeposit;
      if (item.productId) {
        insuranceQuoteItems.push({
          productId: item.productId,
          quantity: item.quantity,
        });
      }
      const itemValues = {
        productId: item.productId || null,
        isCustomItem: !item.productId,
        quantity: item.quantity,
        unitPrice: finalUnitPrice.toFixed(2),
        depositPerUnit: item.depositPerUnit.toFixed(2),
        totalPrice: totalPrice.toFixed(2),
        pricingBreakdown,
      } satisfies ReservationItemUpdateValues;
      const productSnapshot = {
        name: item.productSnapshot.name,
        description: item.productSnapshot.description || null,
        images: item.productSnapshot.images || [],
      };

      if (item.id) {
        const existingItem = existingItemsById.get(item.id);
        if (!existingItem) {
          return { error: "errors.invalidData" };
        }
        if (existingItem.productId !== itemValues.productId) {
          return { error: "errors.invalidData" };
        }
        if (hasReservationItemChanges(existingItem, itemValues)) {
          itemWrites.push({
            type: "update",
            id: item.id,
            values: itemValues,
          });
        }
      } else {
        itemWrites.push({
          type: "insert",
          values: {
            id: nanoid(),
            reservationId,
            ...itemValues,
            productSnapshot,
          },
        });
      }
    }
  } else {
    // Just recalculate existing items with new duration
    for (const item of existingNonInsuranceItems) {
      const pricingBreakdown = item.pricingBreakdown as Record<string, unknown> | null;
      const isManualPrice = pricingBreakdown?.isManualOverride === true;

      let totalPrice: number;
      let finalUnitPrice = parseFloat(item.unitPrice);

      if (!isManualPrice && item.productId) {
        // Recalculate with tiers
        const product = await db.query.products.findFirst({
          where: eq(products.id, item.productId),
          with: { pricingTiers: true },
        });

        if (product) {
          const effectivePricingMode = toPricingMode(product.pricingMode);
          const itemDurationMinutes = calculateDurationMinutes(newStartDate, newEndDate);
          const tiers: PricingTier[] = (product.pricingTiers || []).map((tier) => ({
            id: tier.id,
            minDuration: tier.minDuration ?? 1,
            discountPercent: parseFloat(tier.discountPercent ?? "0"),
            displayOrder: tier.displayOrder || 0,
          }));
          const rates: Rate[] = (product.pricingTiers || [])
            .filter(
              (tier): tier is typeof tier & { period: number; price: string } =>
                typeof tier.period === "number" &&
                tier.period > 0 &&
                typeof tier.price === "string",
            )
            .map((tier, index) => ({
              id: tier.id,
              period: tier.period,
              price: parseFloat(tier.price),
              displayOrder: tier.displayOrder ?? index,
            }));

          // Fetch seasonal pricings for this product
          const seasonalPricingConfigsForDate = await fetchSeasonalPricingConfigs(product.id);

          const seasonalResultForDate = calculateSeasonalAwarePrice(
            {
              timezone: store.settings?.timezone,
              basePrice: parseFloat(product.price),
              basePeriodMinutes: product.basePeriodMinutes ?? null,
              deposit: parseFloat(product.deposit || "0"),
              pricingKind: product.pricingKind,
              pricingMode: effectivePricingMode,
              enforceStrictTiers: product.enforceStrictTiers ?? false,
              tiers,
              rates,
            },
            seasonalPricingConfigsForDate,
            newStartDate,
            newEndDate,
            item.quantity,
          );

          const newBreakdown = buildReservationPricingBreakdown({
            pricingKind: product.pricingKind,
            basePrice: parseFloat(product.price),
            deposit: parseFloat(product.deposit || "0"),
            pricingMode: effectivePricingMode,
            quantity: item.quantity,
            durationMinutes: itemDurationMinutes,
            result: seasonalResultForDate,
          });
          finalUnitPrice = seasonalResultForDate.subtotal / Math.max(1, item.quantity);
          totalPrice = seasonalResultForDate.subtotal;

          const itemValues = {
            productId: item.productId,
            isCustomItem: item.isCustomItem,
            quantity: item.quantity,
            unitPrice: finalUnitPrice.toFixed(2),
            depositPerUnit: item.depositPerUnit,
            totalPrice: totalPrice.toFixed(2),
            pricingBreakdown: newBreakdown,
          } satisfies ReservationItemUpdateValues;
          if (hasReservationItemChanges(item, itemValues)) {
            itemWrites.push({
              type: "update",
              id: item.id,
              values: itemValues,
            });
          }
        } else {
          const fallbackPricingMode = toPricingMode(pricingBreakdown?.pricingMode);
          const fallbackPricingKind = toPricingKind(pricingBreakdown?.pricingKind);
          const itemDuration =
            fallbackPricingKind === "fixed"
              ? 1
              : calculateDuration(newStartDate, newEndDate, fallbackPricingMode);
          totalPrice = finalUnitPrice * itemDuration * item.quantity;
          const itemValues = {
            productId: item.productId,
            isCustomItem: item.isCustomItem,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            depositPerUnit: item.depositPerUnit,
            totalPrice: totalPrice.toFixed(2),
            pricingBreakdown: item.pricingBreakdown,
          } satisfies ReservationItemUpdateValues;
          if (hasReservationItemChanges(item, itemValues)) {
            itemWrites.push({
              type: "update",
              id: item.id,
              values: itemValues,
            });
          }
        }
      } else {
        // Manual overrides on fixed products stay independent of rental dates.
        const fallbackPricingMode = toPricingMode(pricingBreakdown?.pricingMode);
        let manualPricingKind = toPricingKind(pricingBreakdown?.pricingKind);
        if (item.productId) {
          const manualPriceProduct = await db.query.products.findFirst({
            where: and(eq(products.id, item.productId), eq(products.storeId, store.id)),
            columns: { pricingKind: true },
          });
          manualPricingKind = manualPriceProduct?.pricingKind ?? manualPricingKind;
        }
        const itemDuration =
          manualPricingKind === "fixed"
            ? 1
            : calculateDuration(newStartDate, newEndDate, fallbackPricingMode);
        totalPrice = finalUnitPrice * itemDuration * item.quantity;
        const nextPricingBreakdown = item.pricingBreakdown
          ? {
              ...item.pricingBreakdown,
              duration: itemDuration,
              pricingMode: fallbackPricingMode,
              pricingKind: manualPricingKind,
            }
          : null;
        const itemValues = {
          productId: item.productId,
          isCustomItem: item.isCustomItem,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          depositPerUnit: item.depositPerUnit,
          totalPrice: totalPrice.toFixed(2),
          pricingBreakdown: nextPricingBreakdown,
        } satisfies ReservationItemUpdateValues;
        if (hasReservationItemChanges(item, itemValues)) {
          itemWrites.push({
            type: "update",
            id: item.id,
            values: itemValues,
          });
        }
      }

      newSubtotalAmount += totalPrice;
      newDepositAmount += parseFloat(item.depositPerUnit) * item.quantity;
      if (item.productId) {
        insuranceQuoteItems.push({
          productId: item.productId,
          quantity: item.quantity,
        });
      }
    }
  }

  if (nextTulipInsuranceOptIn && insuranceQuoteItems.length > 0) {
    if (!reservation.customer) {
      tulipWarnings.push({ key: "errors.customerNotFound" });
      if (previousTulipInsuranceAmount) {
        nextTulipInsuranceAmount = previousTulipInsuranceAmount;
      }
    } else {
      try {
        const quote = await previewTulipQuoteForCheckout({
          storeId: store.id,
          customer: {
            ...resolveReservationBilling(reservation, reservation.customer),
            firstName: reservation.customer.firstName,
            lastName: reservation.customer.lastName,
            email: reservation.customer.email,
            phone: reservation.customer.phone || "",
            address: reservation.customer.address || "",
            city: reservation.customer.city || "",
            postalCode: reservation.customer.postalCode || "",
            country: reservation.customer.country,
          },
          items: insuranceQuoteItems,
          startDate: newStartDate,
          endDate: newEndDate,
          optIn: true,
        });

        if (
          quote.shouldApply &&
          quote.inclusionEnabled !== true &&
          Number.isFinite(quote.amount) &&
          quote.amount > 0
        ) {
          nextTulipInsuranceAmount = Math.round(quote.amount * 100) / 100;
        }
      } catch (error) {
        console.warn("[tulip] Failed to recalculate insurance quote after reservation edit:", {
          reservationId,
          error,
        });
        tulipWarnings.push({
          key: getErrorKey(error, "errors.tulipQuoteFailed"),
        });
        if (previousTulipInsuranceAmount) {
          nextTulipInsuranceAmount = previousTulipInsuranceAmount;
        }
      }
    }
  }

  if (
    nextTulipInsuranceOptIn &&
    isPeriodReduced &&
    previousTulipInsuranceAmount &&
    (!nextTulipInsuranceAmount || nextTulipInsuranceAmount < previousTulipInsuranceAmount)
  ) {
    nextTulipInsuranceAmount = previousTulipInsuranceAmount;
  }

  if (nextTulipInsuranceAmount && nextTulipInsuranceAmount > 0) {
    newSubtotalAmount += nextTulipInsuranceAmount;
  }

  if (data.items && data.items.length > 0) {
    if (nextTulipInsuranceAmount && nextTulipInsuranceAmount > 0) {
      insuranceItemWrites.push({
        type: "insert",
        values: {
          id: nanoid(),
          reservationId,
          productId: null,
          isCustomItem: true,
          quantity: 1,
          unitPrice: nextTulipInsuranceAmount.toFixed(2),
          depositPerUnit: "0.00",
          totalPrice: nextTulipInsuranceAmount.toFixed(2),
          pricingBreakdown: null,
          productSnapshot: {
            name: INSURANCE_ITEM_NAME,
            description: INSURANCE_ITEM_NAME,
            images: [],
          },
        },
      });
    }
  } else if (nextTulipInsuranceAmount && nextTulipInsuranceAmount > 0) {
    const [existingInsuranceItemId, ...extraInsuranceItemIds] = legacyInsuranceItemIds;

    if (existingInsuranceItemId) {
      insuranceItemWrites.push({
        type: "update",
        id: existingInsuranceItemId,
        values: {
          productId: null,
          isCustomItem: true,
          quantity: 1,
          unitPrice: nextTulipInsuranceAmount.toFixed(2),
          depositPerUnit: "0.00",
          totalPrice: nextTulipInsuranceAmount.toFixed(2),
          pricingBreakdown: null,
        },
      });
    } else {
      insuranceItemWrites.push({
        type: "insert",
        values: {
          id: nanoid(),
          reservationId,
          productId: null,
          isCustomItem: true,
          quantity: 1,
          unitPrice: nextTulipInsuranceAmount.toFixed(2),
          depositPerUnit: "0.00",
          totalPrice: nextTulipInsuranceAmount.toFixed(2),
          pricingBreakdown: null,
          productSnapshot: {
            name: INSURANCE_ITEM_NAME,
            description: INSURANCE_ITEM_NAME,
            images: [],
          },
        },
      });
    }

    if (extraInsuranceItemIds.length > 0) {
      extraInsuranceItemIdsToDelete = extraInsuranceItemIds;
    }
  } else if (legacyInsuranceItemIds.length > 0) {
    extraInsuranceItemIdsToDelete = legacyInsuranceItemIds;
  }

  // Process delivery changes
  let deliveryFee = parseFloat(reservation.deliveryFee || "0");
  const deliveryUpdateFields: ReservationDeliveryUpdateValues = {};

  if (data.delivery) {
    const deliverySettings = (store.settings as Record<string, unknown> | null)?.delivery as
      | DeliverySettings
      | undefined;
    const isMultiLocationEnabled = Boolean(deliverySettings?.multiLocationEnabled);

    const storeLat = store.latitude ? parseFloat(store.latitude) : null;
    const storeLon = store.longitude ? parseFloat(store.longitude) : null;
    let pickupLocation: Awaited<ReturnType<typeof resolveReservationLocationSnapshot>> | null =
      null;
    let returnLocation: Awaited<ReturnType<typeof resolveReservationLocationSnapshot>> | null =
      null;

    // Outbound leg
    deliveryUpdateFields.outboundMethod = data.delivery.outbound.method;
    if (data.delivery.outbound.method === "address") {
      deliveryUpdateFields.pickupLocationId = null;
      deliveryUpdateFields.pickupLocationSnapshot = null;
      deliveryUpdateFields.deliveryAddress = data.delivery.outbound.address ?? null;
      deliveryUpdateFields.deliveryCity = data.delivery.outbound.city ?? null;
      deliveryUpdateFields.deliveryPostalCode = data.delivery.outbound.postalCode ?? null;
      deliveryUpdateFields.deliveryCountry = data.delivery.outbound.country ?? null;
      deliveryUpdateFields.deliveryLatitude = data.delivery.outbound.latitude?.toFixed(7) ?? null;
      deliveryUpdateFields.deliveryLongitude = data.delivery.outbound.longitude?.toFixed(7) ?? null;

      if (
        storeLat &&
        storeLon &&
        data.delivery.outbound.latitude &&
        data.delivery.outbound.longitude
      ) {
        const outboundDistance = await getRouteDistance({
          originLatitude: storeLat,
          originLongitude: storeLon,
          destinationLatitude: data.delivery.outbound.latitude,
          destinationLongitude: data.delivery.outbound.longitude,
        });
        deliveryUpdateFields.deliveryDistanceKm = outboundDistance.distanceKm.toFixed(2);
      } else {
        deliveryUpdateFields.deliveryDistanceKm = null;
      }
    } else {
      try {
        pickupLocation = await resolveReservationLocationSnapshot({
          store,
          locationId: isMultiLocationEnabled ? (data.delivery.outbound.locationId ?? null) : null,
        });
      } catch (error) {
        return { error: getActionErrorKey(error, "errors.locationInvalid") };
      }
      deliveryUpdateFields.pickupLocationId = pickupLocation.locationId;
      deliveryUpdateFields.pickupLocationSnapshot = pickupLocation.snapshot;
      deliveryUpdateFields.deliveryAddress = null;
      deliveryUpdateFields.deliveryCity = null;
      deliveryUpdateFields.deliveryPostalCode = null;
      deliveryUpdateFields.deliveryCountry = null;
      deliveryUpdateFields.deliveryLatitude = null;
      deliveryUpdateFields.deliveryLongitude = null;
      deliveryUpdateFields.deliveryDistanceKm = null;
    }

    // Return leg
    deliveryUpdateFields.returnMethod = data.delivery.return.method;
    if (data.delivery.return.method === "address") {
      deliveryUpdateFields.returnLocationId = null;
      deliveryUpdateFields.returnLocationSnapshot = null;
      deliveryUpdateFields.returnAddress = data.delivery.return.address ?? null;
      deliveryUpdateFields.returnCity = data.delivery.return.city ?? null;
      deliveryUpdateFields.returnPostalCode = data.delivery.return.postalCode ?? null;
      deliveryUpdateFields.returnCountry = data.delivery.return.country ?? null;
      deliveryUpdateFields.returnLatitude = data.delivery.return.latitude?.toFixed(7) ?? null;
      deliveryUpdateFields.returnLongitude = data.delivery.return.longitude?.toFixed(7) ?? null;

      if (storeLat && storeLon && data.delivery.return.latitude && data.delivery.return.longitude) {
        const inboundDistance = await getRouteDistance({
          originLatitude: storeLat,
          originLongitude: storeLon,
          destinationLatitude: data.delivery.return.latitude,
          destinationLongitude: data.delivery.return.longitude,
        });
        deliveryUpdateFields.returnDistanceKm = inboundDistance.distanceKm.toFixed(2);
      } else {
        deliveryUpdateFields.returnDistanceKm = null;
      }
    } else {
      try {
        returnLocation = await resolveReservationLocationSnapshot({
          store,
          locationId: isMultiLocationEnabled ? (data.delivery.return.locationId ?? null) : null,
        });
      } catch (error) {
        return { error: getActionErrorKey(error, "errors.locationInvalid") };
      }
      deliveryUpdateFields.returnLocationId = returnLocation.locationId;
      deliveryUpdateFields.returnLocationSnapshot = returnLocation.snapshot;
      deliveryUpdateFields.returnAddress = null;
      deliveryUpdateFields.returnCity = null;
      deliveryUpdateFields.returnPostalCode = null;
      deliveryUpdateFields.returnCountry = null;
      deliveryUpdateFields.returnLatitude = null;
      deliveryUpdateFields.returnLongitude = null;
      deliveryUpdateFields.returnDistanceKm = null;
    }

    // Calculate delivery fee
    if (deliverySettings?.enabled) {
      const outDist = deliveryUpdateFields.deliveryDistanceKm
        ? parseFloat(deliveryUpdateFields.deliveryDistanceKm)
        : null;
      const retDist = deliveryUpdateFields.returnDistanceKm
        ? parseFloat(deliveryUpdateFields.returnDistanceKm)
        : null;

      if (deliverySettings.mode === "included") {
        deliveryFee = 0;
      } else {
        const feeResult = calculateTotalDeliveryFee(
          outDist,
          retDist,
          deliverySettings as Parameters<typeof calculateTotalDeliveryFee>[2],
          newSubtotalAmount,
        );
        deliveryFee = feeResult.totalFee;
      }
    } else {
      deliveryFee = 0;
    }

    deliveryUpdateFields.deliveryFee = deliveryFee.toFixed(2);

    // Update legacy field for backward compatibility
    const hasAddressLeg =
      data.delivery.outbound.method === "address" || data.delivery.return.method === "address";
    deliveryUpdateFields.deliveryOption = hasAddressLeg ? "delivery" : "pickup";
  }

  // Calculate total: subtotal + delivery fee - discount
  const existingDiscount = parseFloat(reservation.discountAmount || "0");
  const newTotalAmount = newSubtotalAmount + deliveryFee - existingDiscount;
  const difference = newTotalAmount - previousState.totalAmount;
  const dateChanged =
    newStartDate.getTime() !== reservation.startDate.getTime() ||
    newEndDate.getTime() !== reservation.endDate.getTime();
  const blockingStatuses = getBlockingReservationStatuses(
    store.settings?.pendingBlocksAvailability ?? true,
  );
  const turnoverBufferMinutes = store.settings?.turnoverBufferMinutes ?? 0;
  const overrideTurnoverBuffer = data.overrideTurnoverBuffer ?? false;
  const session = await auth();
  const actorUserId = session?.user?.id ?? null;
  // What every figure above was computed from, compared again under the locks.
  const editBasis = fingerprintReservationEdit(reservation, reservation.items);
  // The products of the existing and submitted lines, locked before the reservation.
  const editedProductIds = [
    ...new Set(
      [...reservation.items, ...(data.items ?? [])].flatMap((item) =>
        item.productId ? [item.productId] : [],
      ),
    ),
  ];

  // The transaction holds no outside effect, so a lost deadlock runs it again.
  const transactionResult = await retryTransactionOnDeadlock(() =>
    db.transaction(
      async (tx) => {
        // Lock order (DL-12): the products, the reservation, then its units.
        const lockedProductsById = await lockReservationProducts(tx, store.id, editedProductIds);

        const [lockedReservation] = await tx
          .select({
            id: reservations.id,
            status: reservations.status,
            startDate: reservations.startDate,
            endDate: reservations.endDate,
            subtotalAmount: reservations.subtotalAmount,
            depositAmount: reservations.depositAmount,
            totalAmount: reservations.totalAmount,
            deliveryFee: reservations.deliveryFee,
            discountAmount: reservations.discountAmount,
            tulipInsuranceOptIn: reservations.tulipInsuranceOptIn,
            tulipInsuranceAmount: reservations.tulipInsuranceAmount,
          })
          .from(reservations)
          .where(and(eq(reservations.id, reservationId), eq(reservations.storeId, store.id)))
          .for("update");

        if (!lockedReservation) {
          return { error: "errors.reservationNotFound" };
        }

        const lockedItems = await tx
          .select({
            id: reservationItems.id,
            productId: reservationItems.productId,
            quantity: reservationItems.quantity,
            unitPrice: reservationItems.unitPrice,
            totalPrice: reservationItems.totalPrice,
            depositPerUnit: reservationItems.depositPerUnit,
            pricingBreakdown: reservationItems.pricingBreakdown,
            combinationKey: reservationItems.combinationKey,
            selectedAttributes: reservationItems.selectedAttributes,
          })
          .from(reservationItems)
          .where(eq(reservationItems.reservationId, reservationId));

        // Another write landed between the read and the locks: the totals and
        // the item writes computed above no longer describe this reservation.
        // A line added meanwhile is caught here too, before its product would
        // have to be locked after the reservation.
        if (fingerprintReservationEdit(lockedReservation, lockedItems) !== editBasis) {
          return { error: "errors.reservationChangedMeanwhile" };
        }

        for (const itemWrite of itemWrites) {
          if (
            itemWrite.type === "insert" &&
            itemWrite.values.productId &&
            !lockedProductsById.has(itemWrite.values.productId)
          ) {
            return { error: "errors.productNotFound" };
          }
        }

        await tx
          .select({ id: productUnits.id })
          .from(productUnits)
          .innerJoin(reservationItemUnits, eq(productUnits.id, reservationItemUnits.productUnitId))
          .innerJoin(
            reservationItems,
            eq(reservationItemUnits.reservationItemId, reservationItems.id),
          )
          .where(eq(reservationItems.reservationId, reservationId))
          .orderBy(productUnits.id)
          .for("update");

        const currentAssignments = await tx
          .select({
            reservationItemId: reservationItemUnits.reservationItemId,
            productUnitId: reservationItemUnits.productUnitId,
            identifierSnapshot: reservationItemUnits.identifierSnapshot,
            unitId: productUnits.id,
            identifier: productUnits.identifier,
          })
          .from(reservationItemUnits)
          .innerJoin(
            reservationItems,
            eq(reservationItemUnits.reservationItemId, reservationItems.id),
          )
          .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
          .leftJoin(productUnits, eq(reservationItemUnits.productUnitId, productUnits.id))
          .where(
            and(
              eq(reservationItems.reservationId, reservationId),
              eq(reservations.storeId, store.id),
            ),
          );

        const assignedCountByItemId = new Map<string, number>();
        for (const assignment of currentAssignments) {
          assignedCountByItemId.set(
            assignment.reservationItemId,
            (assignedCountByItemId.get(assignment.reservationItemId) ?? 0) + 1,
          );
        }

        if (data.items && data.items.length > 0) {
          for (const item of data.items) {
            if (!item.id) continue;

            const assignedCount = assignedCountByItemId.get(item.id) ?? 0;
            if (item.quantity < assignedCount) {
              return {
                error: "errors.tooManyAssignedUnits",
                reservationItemId: item.id,
                assignedCount,
              };
            }
          }
        }

        const itemIdsToDelete = [...removedReservationItemIds, ...extraInsuranceItemIdsToDelete];
        const itemIdsToDeleteSet = new Set(itemIdsToDelete);
        const assignmentsToRemove = currentAssignments.filter((assignment) =>
          itemIdsToDeleteSet.has(assignment.reservationItemId),
        );
        const assignmentsToKeep = currentAssignments.filter(
          (assignment) => !itemIdsToDeleteSet.has(assignment.reservationItemId),
        );

        if (dateChanged && assignmentsToKeep.some((assignment) => assignment.productUnitId)) {
          const assignedUnitIds = [
            ...new Set(
              assignmentsToKeep.flatMap((assignment) =>
                assignment.productUnitId ? [assignment.productUnitId] : [],
              ),
            ),
          ].sort((a, b) => a.localeCompare(b, "en"));

          const lockedUnits = await tx
            .select({
              id: productUnits.id,
              identifier: productUnits.identifier,
            })
            .from(productUnits)
            .where(inArray(productUnits.id, assignedUnitIds))
            .orderBy(productUnits.id)
            .for("update");
          const unitIdentifierById = new Map(lockedUnits.map((unit) => [unit.id, unit.identifier]));
          for (const assignment of assignmentsToKeep) {
            if (!assignment.productUnitId) {
              continue;
            }

            if (!unitIdentifierById.has(assignment.productUnitId)) {
              unitIdentifierById.set(assignment.productUnitId, assignment.identifierSnapshot);
            }
          }

          const rentableUnits = await tx
            .select({ id: productUnits.id })
            .from(productUnits)
            .where(
              and(
                inArray(productUnits.id, assignedUnitIds),
                buildUnitRentableDuringPredicate(tx, newStartDate, newEndDate),
              ),
            );
          const rentableUnitIds = new Set(rentableUnits.map((unit) => unit.id));
          const hardConflictKeys = new Set<string>();
          const hardConflicts: UpdateReservationConflict[] = [];
          const pushHardConflict = (assignment: (typeof assignmentsToKeep)[number]) => {
            if (!assignment.productUnitId) {
              return;
            }

            const key = `${assignment.reservationItemId}:${assignment.productUnitId}`;
            if (hardConflictKeys.has(key)) return;
            hardConflictKeys.add(key);
            hardConflicts.push({
              reservationItemId: assignment.reservationItemId,
              unitId: assignment.productUnitId,
              identifier:
                unitIdentifierById.get(assignment.productUnitId) ||
                assignment.identifierSnapshot ||
                assignment.productUnitId,
            });
          };

          for (const assignment of assignmentsToKeep) {
            if (!assignment.productUnitId) {
              continue;
            }

            if (!rentableUnitIds.has(assignment.productUnitId)) {
              pushHardConflict(assignment);
            }
          }

          const assignmentsByItemId = new Map<string, typeof assignmentsToKeep>();
          for (const assignment of assignmentsToKeep) {
            assignmentsByItemId.set(assignment.reservationItemId, [
              ...(assignmentsByItemId.get(assignment.reservationItemId) ?? []),
              assignment,
            ]);
          }

          const bufferUnitIds = new Set<string>();
          for (const [reservationItemId, itemAssignments] of assignmentsByItemId) {
            const busyUnitIds = await findBusyUnitIds(tx, {
              unitIds: itemAssignments.flatMap((assignment) =>
                assignment.productUnitId ? [assignment.productUnitId] : [],
              ),
              start: newStartDate,
              end: newEndDate,
              blockingStatuses,
              turnoverBufferMinutes,
              excludeReservationItemId: reservationItemId,
            });

            for (const assignment of itemAssignments) {
              if (!assignment.productUnitId) {
                continue;
              }

              const reason = busyUnitIds.get(assignment.productUnitId);
              if (reason === "overlap") {
                pushHardConflict(assignment);
              } else if (reason === "buffer") {
                bufferUnitIds.add(assignment.productUnitId);
              }
            }
          }

          if (hardConflicts.length > 0) {
            return {
              error: "errors.assignedUnitsConflict",
              conflicts: hardConflicts,
            };
          }

          if (!overrideTurnoverBuffer && bufferUnitIds.size > 0) {
            return {
              error: "errors.turnoverBufferConflict",
              bufferConflict: true,
              failedUnitIds: [...bufferUnitIds],
            };
          }
        }

        // The lines as the edit leaves them, with the units they keep.
        const assignedUnitIdsByItemId = new Map<string, string[]>();
        for (const assignment of assignmentsToKeep) {
          if (!assignment.productUnitId) continue;
          assignedUnitIdsByItemId.set(assignment.reservationItemId, [
            ...(assignedUnitIdsByItemId.get(assignment.reservationItemId) ?? []),
            assignment.productUnitId,
          ]);
        }
        const quantityByUpdatedItemId = new Map<string, number>();
        for (const itemWrite of itemWrites) {
          if (itemWrite.type === "update") {
            quantityByUpdatedItemId.set(itemWrite.id, itemWrite.values.quantity);
          }
        }
        const finalLines = [
          ...lockedItems.flatMap((item) =>
            item.productId && !itemIdsToDeleteSet.has(item.id)
              ? [
                  {
                    productId: item.productId,
                    quantity: quantityByUpdatedItemId.get(item.id) ?? item.quantity,
                    selectedAttributes: item.selectedAttributes ?? undefined,
                    combinationKey: item.combinationKey,
                    assignedUnitIds: assignedUnitIdsByItemId.get(item.id) ?? [],
                    // A booked line with no exact combination is served by any
                    // unit that matches what it chose (resolveUnitAssignmentScope):
                    // the units it holds count on their own combinations.
                    pooled: item.combinationKey === null,
                  },
                ]
              : [],
          ),
          // A line the edit adds chooses no combination: any unit serves it.
          ...itemWrites.flatMap((itemWrite) =>
            itemWrite.type === "insert" && itemWrite.values.productId
              ? [
                  {
                    productId: itemWrite.values.productId,
                    quantity: itemWrite.values.quantity,
                    pooled: true,
                  },
                ]
              : [],
          ),
        ];

        // A reservation that holds stock is checked whenever the edit moves
        // what it asks for, before anything is written. Stock short on a
        // product the edit asks more of refuses the edit, unless the caller
        // books over it; either way the activity row keeps the verdict.
        const demand = compareReservationDemand(
          {
            start: lockedReservation.startDate,
            end: lockedReservation.endDate,
            lines: lockedItems,
          },
          { start: newStartDate, end: newEndDate, lines: finalLines },
          (productId) => lockedProductsById.get(productId)?.bookingAttributeAxes,
        );
        const holdsStock = blockingStatuses.some((status) => status === lockedReservation.status);
        let capacityVerdict: ReturnType<typeof capacityVerdictMetadata> | null = null;
        if (holdsStock && demand.changed) {
          const inventory = await reserveInventory({
            tx,
            storeId: store.id,
            lockedProductsById,
            // A line whose product was deleted since has no stock to check.
            lines: finalLines.filter((line) => lockedProductsById.has(line.productId)),
            window: { start: newStartDate, end: newEndDate },
            blockingStatuses,
            turnoverBufferMinutes: overrideTurnoverBuffer ? 0 : turnoverBufferMinutes,
            excludeReservationId: reservationId,
            // Consumable stock is reconciled below; like a booking the team
            // creates, an edit does not ask for the required accessories.
            skipConsumableCheck: true,
            skipRequiredAccessoryCheck: true,
            onShortfall: "collect",
          });
          if (!inventory.ok) {
            return { error: inventory.error };
          }
          if (
            !data.allowOverbooking &&
            inventory.shortfalls.some((shortfall) =>
              demand.raisedProductIds.has(shortfall.productId),
            )
          ) {
            return { error: "errors.insufficientCapacity", shortfalls: inventory.shortfalls };
          }
          capacityVerdict = capacityVerdictMetadata(inventory.shortfalls);
        }

        const unitEvents: Array<typeof productUnitEvents.$inferInsert> = assignmentsToRemove.map(
          (assignment) => ({
            id: nanoid(),
            productUnitId: assignment.productUnitId,
            identifierSnapshot: assignment.identifier || assignment.identifierSnapshot,
            storeId: store.id,
            type: "unassigned",
            actorUserId,
            payload: {
              reservationId,
              reservationItemId: assignment.reservationItemId,
              reason: "reservation_item_removed",
            },
          }),
        );

        if (assignmentsToRemove.length > 0) {
          await tx
            .delete(reservationItemUnits)
            .where(
              inArray(reservationItemUnits.reservationItemId, [
                ...new Set(assignmentsToRemove.map((item) => item.reservationItemId)),
              ]),
            );
        }

        if (unitEvents.length > 0) {
          await tx.insert(productUnitEvents).values(unitEvents);
        }

        for (const itemWrite of itemWrites) {
          if (itemWrite.type === "insert") {
            await tx.insert(reservationItems).values(itemWrite.values);
          } else {
            await tx
              .update(reservationItems)
              .set(itemWrite.values)
              .where(eq(reservationItems.id, itemWrite.id));
            // Fewer units leave fewer people to equip: their details go too, or
            // raising the quantity again would bring them back.
            await tx
              .delete(reservationItemDetails)
              .where(
                and(
                  eq(reservationItemDetails.reservationItemId, itemWrite.id),
                  gte(reservationItemDetails.unitIndex, itemWrite.values.quantity),
                ),
              );
          }
        }

        for (const insuranceItemWrite of insuranceItemWrites) {
          if (insuranceItemWrite.type === "insert") {
            await tx.insert(reservationItems).values(insuranceItemWrite.values);
          } else {
            await tx
              .update(reservationItems)
              .set(insuranceItemWrite.values)
              .where(eq(reservationItems.id, insuranceItemWrite.id));
          }
        }

        if (itemIdsToDelete.length > 0) {
          await tx
            .update(reservationItems)
            .set({ quantity: 0 })
            .where(
              and(
                eq(reservationItems.reservationId, reservationId),
                inArray(reservationItems.id, itemIdsToDelete),
              ),
            );
        }

        if (reservationStatusConsumesStock(lockedReservation.status)) {
          await reconcileReservationStock(tx, reservationId, store.id);
        }

        if (itemIdsToDelete.length > 0) {
          await tx
            .delete(reservationItems)
            .where(
              and(
                eq(reservationItems.reservationId, reservationId),
                inArray(reservationItems.id, itemIdsToDelete),
              ),
            );
        }

        await tx
          .update(reservations)
          .set({
            startDate: newStartDate,
            endDate: newEndDate,
            subtotalAmount: newSubtotalAmount.toFixed(2),
            depositAmount: newDepositAmount.toFixed(2),
            totalAmount: newTotalAmount.toFixed(2),
            tulipInsuranceOptIn: nextTulipInsuranceOptIn,
            tulipInsuranceAmount:
              nextTulipInsuranceAmount && nextTulipInsuranceAmount > 0
                ? nextTulipInsuranceAmount.toFixed(2)
                : null,
            ...deliveryUpdateFields,
            updatedAt: new Date(),
            // The inbox dates a late pickup or return from its last schedule change.
            scheduleChangedAt: dateChanged ? new Date() : undefined,
          })
          .where(and(eq(reservations.id, reservationId), eq(reservations.storeId, store.id)));
        // Dates, totals, items, insurance and delivery are in the billing snapshot.
        await markReservation(tx, { id: reservationId, storeId: store.id });

        await validateReservationContract(tx, reservationId, store.id, "confirmation");
        await resolveDateChangeRequests(
          tx,
          reservationId,
          newStartDate,
          newEndDate,
          lockedReservation.status,
        );

        // Written with the edit: its history, and its capacity verdict for the inbox.
        await tx.insert(reservationActivity).values({
          id: nanoid(),
          reservationId,
          userId: actorUserId,
          activityType: "modified",
          metadata: {
            previous: {
              startDate: previousState.startDate,
              endDate: previousState.endDate,
              subtotalAmount: previousState.subtotalAmount,
              depositAmount: previousState.depositAmount,
            },
            updated: {
              startDate: newStartDate,
              endDate: newEndDate,
              subtotalAmount: newSubtotalAmount,
              depositAmount: newDepositAmount,
            },
            difference,
            ...capacityVerdict,
            ...(validationWarnings.length > 0 && {
              validationWarnings,
              validationWarningsCount: validationWarnings.length,
            }),
          },
          createdAt: capacityVerdict ? await nextCapacityVerdictDate(tx, reservationId) : undefined,
        });
        return { success: true, reservationStatus: lockedReservation.status };
      },
      { isolationLevel: "read committed" },
    ),
  ).catch((error: unknown) => {
    if (error instanceof ConsumableStockError) {
      return { error: error.message };
    }
    throw error;
  });

  if ("error" in transactionResult) {
    return transactionResult;
  }

  const currentReservationStatus = transactionResult.reservationStatus;

  if (reservationStatusConsumesStock(currentReservationStatus)) {
    try {
      await syncTulipContractForReservation({ reservationId });
    } catch (error) {
      console.warn("[tulip] Failed to sync contract after reservation edit:", {
        reservationId,
        error,
      });

      const tulipErrorKey = getErrorKey(error, "errors.tulipContractUpdateFailed");
      tulipWarnings.push({
        key: tulipErrorKey,
      });
    }
  }

  revalidatePath(`/${store.slug}/account`);
  revalidatePath("/dashboard/reservations");
  revalidatePath(`/dashboard/reservations/${reservationId}`);

  const responseWarnings = [
    ...validationWarnings.map((warning) => ({
      code: warning.code,
      key: warning.key,
      params: warning.params,
    })),
    ...tulipWarnings,
  ];

  let emailNotification:
    | { status: "sent"; to: string }
    | { status: "failed"; error: string; to: string }
    | undefined;

  if (data.notifyCustomerByEmail) {
    const emailResult = await sendReservationModificationEmail(reservationId, {
      previousPeriod: {
        startDate: reservation.startDate,
        endDate: reservation.endDate,
      },
    });

    if (emailResult.error) {
      emailNotification = {
        status: "failed",
        error: emailResult.error,
        to: reservation.customer.email,
      };
    } else {
      emailNotification = {
        status: "sent",
        to: reservation.customer.email,
      };
    }
  }

  await captureReservationActionSucceeded({
    distinctId: store.userId,
    storeId: store.id,
    reservationId,
    action: reservationAnalyticsActions.editReservation,
    properties: {
      reservation_status: currentReservationStatus,
      item_count: data.items?.length ?? reservation.items.length,
      warning_count: responseWarnings.length,
      notify_customer: Boolean(data.notifyCustomerByEmail),
      email_sent: emailNotification?.status === "sent" ? true : null,
    },
  });

  return {
    success: true,
    difference,
    newTotal: newTotalAmount,
    previousTotal: previousState.totalAmount,
    ...(responseWarnings.length > 0 && { warnings: responseWarnings }),
    ...(emailNotification && { emailNotification }),
  };
}

// ============================================================================
// Payment Actions
// ============================================================================

export type PaymentType = "rental" | "deposit" | "deposit_return" | "damage" | "adjustment";
export type PaymentMethod = "cash" | "card" | "transfer" | "check" | "other";

interface RecordPaymentData {
  type: PaymentType;
  amount: number;
  method: PaymentMethod;
  paidAt?: Date;
  notes?: string;
}

interface RefundManualPaymentData {
  paymentId: string;
  amount: number;
  method: PaymentMethod;
  notes?: string;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export async function recordPayment(reservationId: string, data: RecordPaymentData) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: "errors.unauthorized" };
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(eq(reservations.id, reservationId), eq(reservations.storeId, store.id)),
    with: {
      payments: true,
    },
  });

  if (!reservation) {
    return { error: "errors.reservationNotFound" };
  }

  if (data.amount === 0) {
    return { error: "errors.invalidAmount" };
  }

  // Only adjustment type can have negative amounts
  if (data.amount < 0 && data.type !== "adjustment") {
    return { error: "errors.negativeAmountOnlyForAdjustment" };
  }

  if (data.amount > 0 && data.type === "rental") {
    const rentalPaid = getRentalPaid(reservation.payments);
    const rentalRemaining = roundMoney(getReservationRentalAmount(reservation) - rentalPaid);

    if (data.amount > rentalRemaining) {
      return { error: "errors.invalidAmount" };
    }
  }

  if (data.amount > 0 && data.type === "deposit") {
    const depositCollected = reservation.payments
      .filter((p) => p.type === "deposit" && p.status === "completed")
      .reduce((sum, p) => sum + parseFloat(p.amount), 0);
    const depositRemaining = roundMoney(
      parseFloat(reservation.depositAmount || "0") - depositCollected,
    );

    if (data.amount > depositRemaining) {
      return { error: "errors.invalidAmount" };
    }
  }

  const paymentId = nanoid();
  await db.transaction(async (tx) => {
    await insertRecordedPayment(tx, {
      id: paymentId,
      reservationId,
      storeId: store.id,
      storeSettings: store.settings,
      amount: data.amount.toFixed(2),
      type: data.type,
      method: data.method,
      origin: "manual",
      paidAt: data.paidAt || new Date(),
      notes: data.notes || null,
    });
    if (data.type === "rental" && data.amount > 0) {
      await validateReservationContract(tx, reservationId, store.id, "payment");
    }
  });

  let invoiceNumber: string | undefined;
  if (["rental", "damage", "adjustment"].includes(data.type) && data.amount > 0) {
    const invoiceGeneration = await tryGenerateInvoiceForPayment(
      paymentId,
      "dashboard_record_payment",
    );
    if (invoiceGeneration.status === "generated") {
      invoiceNumber = invoiceGeneration.number;
      if (invoiceGeneration.kind === "initial") {
        await trySendInitialInvoicePaymentConfirmation(paymentId);
      }
    }
  }

  // Log activity
  await logReservationActivity(reservationId, "payment_added", {
    paymentId,
    type: data.type,
    amount: data.amount,
    method: data.method,
  });

  // Platform admin notification
  notifyPaymentReceived(
    { id: store.id, name: store.name, slug: store.slug },
    reservation.number,
    data.amount,
    reservationCurrency(reservation.currency, store.settings),
  ).catch(() => {});

  revalidatePath("/dashboard/reservations");
  revalidatePath(`/dashboard/reservations/${reservationId}`);
  await captureReservationActionSucceeded({
    distinctId: store.userId,
    storeId: store.id,
    reservationId,
    action: reservationAnalyticsActions.recordPayment,
    properties: {
      payment_type: data.type,
      payment_method: data.method,
      amount_cents: toAnalyticsAmountCents(data.amount),
    },
  });
  return { success: true, paymentId, invoiceNumber };
}

export async function refundManualPayment(reservationId: string, data: RefundManualPaymentData) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: "errors.unauthorized" };
  }

  if (!Number.isFinite(data.amount) || data.amount <= 0) {
    return { error: "errors.invalidAmount" };
  }

  let refundPaymentId: string;
  try {
    refundPaymentId = await db.transaction(async (tx) => {
      const [originalPayment] = await tx
        .select({
          id: payments.id,
          amount: payments.amount,
          type: payments.type,
          method: payments.method,
          status: payments.status,
          currency: payments.currency,
          refundOfPaymentId: payments.refundOfPaymentId,
          reservationCurrency: reservations.currency,
        })
        .from(payments)
        .innerJoin(reservations, eq(reservations.id, payments.reservationId))
        .where(
          and(
            eq(payments.id, data.paymentId),
            eq(payments.reservationId, reservationId),
            eq(reservations.storeId, store.id),
          ),
        )
        .for("update");

      if (!originalPayment) {
        throw new Error("errors.paymentNotFound");
      }

      if (
        originalPayment.status !== "completed" ||
        !["rental", "damage", "adjustment", "deposit_capture"].includes(originalPayment.type) ||
        originalPayment.refundOfPaymentId !== null ||
        Number(originalPayment.amount) <= 0
      ) {
        throw new Error("errors.invalidAmount");
      }

      const [refundTotal] = await tx
        .select({
          amount: sql<string>`coalesce(sum(${payments.amount}), 0)`,
        })
        .from(payments)
        .where(
          and(
            eq(payments.refundOfPaymentId, originalPayment.id),
            eq(payments.status, "completed"),
            // A Stripe refund linked to its charge already came off that
            // charge's amount: counting it here would subtract it twice.
            not(isStripeRefundPaymentSql()),
          ),
        );

      const remainingAmount = roundMoney(
        Number(originalPayment.amount) - Number(refundTotal?.amount ?? 0),
      );
      if (data.amount > remainingAmount) {
        throw new Error("errors.invalidAmount");
      }

      const paymentId = nanoid();
      await insertManualRefund(tx, {
        id: paymentId,
        reservationId,
        storeId: store.id,
        storeSettings: store.settings,
        reservationCurrency: originalPayment.reservationCurrency,
        original: originalPayment,
        amount: data.amount.toFixed(2),
        type: originalPayment.type === "deposit_capture" ? "deposit_return" : "rental",
        method: data.method,
        notes: data.notes?.trim() || null,
        paidAt: new Date(),
      });

      return paymentId;
    });
  } catch (error) {
    return { error: getActionErrorKey(error, "errors.invalidAmount") };
  }

  const creditNoteGeneration = await tryGenerateCreditNoteForRefund(
    { originalPaymentId: data.paymentId, refundPaymentId },
    data.amount,
    "dashboard_refund_manual_payment",
  );
  const creditNoteNumber =
    creditNoteGeneration.status === "generated" ? creditNoteGeneration.number : undefined;

  await logReservationActivity(reservationId, "payment_updated", {
    paymentId: data.paymentId,
    refundPaymentId,
    amount: data.amount,
    method: data.method,
    action: "refunded",
  });

  revalidatePath("/dashboard/reservations");
  revalidatePath(`/dashboard/reservations/${reservationId}`);

  return { success: true, refundPaymentId, creditNoteNumber };
}

export async function deletePayment(paymentId: string) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: "errors.unauthorized" };
  }

  // Get payment with reservation to verify ownership
  const payment = await db.query.payments.findFirst({
    where: eq(payments.id, paymentId),
    with: {
      reservation: true,
    },
  });

  if (!payment || payment.reservation.storeId !== store.id) {
    return { error: "errors.paymentNotFound" };
  }

  const [invoiceLink] = await db
    .select({ id: invoicePayments.id })
    .from(invoicePayments)
    .where(eq(invoicePayments.paymentId, paymentId))
    .limit(1);
  if (invoiceLink) {
    return { error: "errors.paymentInvoiced" };
  }

  // Cannot delete Stripe payments
  if (payment.method === "stripe") {
    return { error: "errors.cannotDeleteStripePayment" };
  }

  await deleteRecordedPayment(db, {
    paymentId,
    reservationId: payment.reservationId,
    storeId: store.id,
  });

  // Log activity
  await logReservationActivity(payment.reservationId, "payment_updated", {
    paymentId,
    type: payment.type,
    amount: payment.amount,
    action: "deleted",
  });

  revalidatePath("/dashboard/reservations");
  revalidatePath(`/dashboard/reservations/${payment.reservationId}`);
  await captureReservationActionSucceeded({
    distinctId: store.userId,
    storeId: store.id,
    reservationId: payment.reservationId,
    action: reservationAnalyticsActions.deletePayment,
    properties: {
      payment_type: payment.type,
      payment_method: payment.method,
    },
  });
  return { success: true };
}

interface ReturnDepositData {
  amount: number;
  method: PaymentMethod;
  notes?: string;
}

export async function returnDeposit(reservationId: string, data: ReturnDepositData) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: "errors.unauthorized" };
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(eq(reservations.id, reservationId), eq(reservations.storeId, store.id)),
    with: {
      payments: true,
    },
  });

  if (!reservation) {
    return { error: "errors.reservationNotFound" };
  }

  if (data.amount <= 0) {
    return { error: "errors.invalidAmount" };
  }

  // Calculate how much deposit was collected
  const depositCollected = reservation.payments
    .filter((p) => p.type === "deposit" && p.status === "completed")
    .reduce((sum, p) => sum + parseFloat(p.amount), 0);

  // Calculate how much was already returned
  const depositReturned = reservation.payments
    .filter((p) => p.type === "deposit_return" && p.status === "completed")
    .reduce((sum, p) => sum + parseFloat(p.amount), 0);

  const maxReturnable = depositCollected - depositReturned;

  if (data.amount > maxReturnable) {
    return { error: "errors.amountExceedsDeposit" };
  }

  const paymentId = nanoid();
  await db.transaction((tx) =>
    insertRecordedPayment(tx, {
      id: paymentId,
      reservationId,
      storeId: store.id,
      storeSettings: store.settings,
      amount: data.amount.toFixed(2),
      type: "deposit_return",
      method: data.method,
      origin: "deposit",
      paidAt: new Date(),
      notes: data.notes || null,
    }),
  );

  // Log activity
  await logReservationActivity(reservationId, "payment_added", {
    paymentId,
    type: "deposit_return",
    amount: data.amount,
    method: data.method,
  });

  revalidatePath("/dashboard/reservations");
  revalidatePath(`/dashboard/reservations/${reservationId}`);
  await captureReservationActionSucceeded({
    distinctId: store.userId,
    storeId: store.id,
    reservationId,
    action: reservationAnalyticsActions.returnDeposit,
    properties: {
      payment_method: data.method,
      amount_cents: toAnalyticsAmountCents(data.amount),
    },
  });
  return { success: true, paymentId };
}

export async function recordDamage(
  reservationId: string,
  data: { amount: number; method: PaymentMethod; notes: string },
) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: "errors.unauthorized" };
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(eq(reservations.id, reservationId), eq(reservations.storeId, store.id)),
  });

  if (!reservation) {
    return { error: "errors.reservationNotFound" };
  }

  if (data.amount <= 0) {
    return { error: "errors.invalidAmount" };
  }

  const paymentId = nanoid();
  await db.transaction((tx) =>
    insertRecordedPayment(tx, {
      id: paymentId,
      reservationId,
      storeId: store.id,
      storeSettings: store.settings,
      amount: data.amount.toFixed(2),
      type: "damage",
      method: data.method,
      origin: "manual",
      paidAt: new Date(),
      notes: data.notes,
    }),
  );

  await tryGenerateInvoiceForPayment(paymentId, "dashboard_record_damage");

  // Log activity
  await logReservationActivity(reservationId, "payment_added", {
    paymentId,
    type: "damage",
    amount: data.amount,
    method: data.method,
    notes: data.notes,
  });

  revalidatePath("/dashboard/reservations");
  revalidatePath(`/dashboard/reservations/${reservationId}`);
  await captureReservationActionSucceeded({
    distinctId: store.userId,
    storeId: store.id,
    reservationId,
    action: reservationAnalyticsActions.recordDamage,
    properties: {
      payment_method: data.method,
      amount_cents: toAnalyticsAmountCents(data.amount),
    },
  });
  return { success: true, paymentId };
}

/**
 * Create a deposit authorization hold (empreinte bancaire). At most one
 * authorization per attempt, whoever asks at the same time: see
 * lib/reservations/deposit-hold.ts.
 */
export async function createDepositHold(reservationId: string) {
  const store = await getStoreForUser();
  if (!store || !store.stripeAccountId) {
    return { error: "errors.noStripeAccount" };
  }

  const result = await authorizeDepositHold(
    {
      reservationId,
      storeId: store.id,
      stripeAccountId: store.stripeAccountId,
      storeSettings: store.settings,
      actorUserId: await getActorUserId(),
    },
    depositHoldDeps,
  );

  revalidatePath("/dashboard/reservations");
  revalidatePath(`/dashboard/reservations/${reservationId}`);
  if (!result.ok) {
    return { error: result.error };
  }

  await captureReservationActionSucceeded({
    distinctId: store.userId,
    storeId: store.id,
    reservationId,
    action: reservationAnalyticsActions.createDepositHold,
    properties: { amount_cents: toAnalyticsAmountCents(result.amount) },
  });
  return { success: true, paymentIntentId: result.paymentIntentId };
}

/**
 * Capture deposit from authorization hold (for damage/loss). The capture is asked and
 * recorded on the hold the reservation references, on the connected account that holds
 * it: see lib/reservations/deposit-hold.ts.
 */
export async function captureDepositHold(
  reservationId: string,
  data: { amount: number; reason: string },
) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: "errors.noStripeAccount" };
  }

  const result = await captureReferencedDepositHold(
    {
      reservationId,
      storeId: store.id,
      fallbackAccountId: store.stripeAccountId,
      storeSettings: store.settings,
      actorUserId: await getActorUserId(),
      amount: data.amount,
      reason: data.reason,
    },
    depositHoldDeps,
  );
  if (!result.ok) {
    return { error: result.error };
  }

  if (result.capturePaymentId) {
    await tryGenerateInvoiceForPayment(result.capturePaymentId, "dashboard_capture_deposit_hold");
  }

  revalidatePath("/dashboard/reservations");
  revalidatePath(`/dashboard/reservations/${reservationId}`);
  await captureReservationActionSucceeded({
    distinctId: store.userId,
    storeId: store.id,
    reservationId,
    action: reservationAnalyticsActions.captureDepositHold,
    properties: { amount_cents: toAnalyticsAmountCents(data.amount) },
  });
  return { success: true, amountCaptured: result.amountCapturedMinor };
}

/**
 * Release deposit authorization (no damage). Recorded on the hold that was cancelled:
 * see lib/reservations/deposit-hold.ts.
 */
export async function releaseDepositHold(reservationId: string) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: "errors.noStripeAccount" };
  }

  const result = await releaseReferencedDepositHold(
    {
      reservationId,
      storeId: store.id,
      fallbackAccountId: store.stripeAccountId,
      storeSettings: store.settings,
      actorUserId: await getActorUserId(),
    },
    depositHoldDeps,
  );
  if (!result.ok) {
    return { error: result.error };
  }

  revalidatePath("/dashboard/reservations");
  revalidatePath(`/dashboard/reservations/${reservationId}`);
  await captureReservationActionSucceeded({
    distinctId: store.userId,
    storeId: store.id,
    reservationId,
    action: reservationAnalyticsActions.releaseDepositHold,
    properties: { amount_cents: toAnalyticsAmountCents(result.amount) },
  });
  return { success: true };
}

/**
 * Get saved payment method details for a reservation
 */
export async function getReservationPaymentMethod(reservationId: string) {
  const store = await getStoreForUser();
  if (!store || !store.stripeAccountId) {
    return null;
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(eq(reservations.id, reservationId), eq(reservations.storeId, store.id)),
  });

  if (!reservation?.stripePaymentMethodId) {
    return null;
  }

  try {
    return await getPaymentMethodDetails(store.stripeAccountId, reservation.stripePaymentMethodId);
  } catch (error) {
    console.error("Failed to get payment method details:", error);
    return null;
  }
}

// ============================================================================
// Stripe Refunds
// ============================================================================

interface ProcessStripeRefundData {
  type: "deposit_return" | "rental_refund";
  amount: number;
  notes?: string;
}

export async function processStripeRefund(reservationId: string, data: ProcessStripeRefundData) {
  const store = await getStoreForUser();
  if (!store || !store.stripeAccountId) {
    return { error: "errors.noStripeAccount" };
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(eq(reservations.id, reservationId), eq(reservations.storeId, store.id)),
    with: {
      payments: true,
    },
  });

  if (!reservation) {
    return { error: "errors.reservationNotFound" };
  }

  // Find the original Stripe payment with a charge
  const stripePayment = reservation.payments.find(
    (p) => p.method === "stripe" && p.status === "completed" && p.stripeChargeId,
  );

  if (!stripePayment || !stripePayment.stripeChargeId) {
    return { error: "errors.stripe.noChargeToRefund" };
  }

  try {
    // Check refundable amount. A refund is counted in its charge's own currency:
    // the payment row may hold the column's default, never the store's of today.
    const {
      refundable,
      amount: maxRefundable,
      currency,
    } = await getChargeRefundableAmount(store.stripeAccountId, stripePayment.stripeChargeId);

    if (!refundable) {
      return { error: "errors.stripe.alreadyRefunded" };
    }

    const refundAmountCents = toStripeCents(data.amount, currency);

    if (refundAmountCents > maxRefundable) {
      return { error: "errors.stripe.refundExceedsCharge" };
    }

    // Process refund
    const refund = await createRefund({
      stripeAccountId: store.stripeAccountId,
      chargeId: stripePayment.stripeChargeId,
      amount: refundAmountCents,
    });

    // What is recorded, credited and logged is what Stripe refunded: an amount
    // typed with more decimals than the currency has was rounded on its way.
    const refundedAmount = fromStripeCents(refund.amount, refund.currency);
    const refundPaidAt = new Date();
    const paymentId = await tryEnsureRefundPaymentRecord(
      {
        originalPaymentId: stripePayment.id,
        stripeRefundId: refund.refundId,
        amount: refundedAmount,
        grossMinor: refund.amount,
        type: data.type === "deposit_return" ? "deposit_return" : "rental",
        currency: refund.currency,
        notes: data.notes,
        paidAt: refundPaidAt,
      },
      "dashboard_process_stripe_refund",
    );

    if (data.type === "rental_refund" && paymentId) {
      await tryGenerateCreditNoteForRefund(
        { originalPaymentId: stripePayment.id, refundPaymentId: paymentId },
        refundedAmount,
        "dashboard_process_stripe_refund",
      );
    }

    // Log activity
    await logReservationActivity(reservationId, "payment_updated", {
      paymentId,
      refundId: refund.refundId,
      amount: refundedAmount,
      type: data.type,
    });

    revalidatePath("/dashboard/reservations");
    revalidatePath(`/dashboard/reservations/${reservationId}`);
    return { success: true, refundId: refund.refundId };
  } catch (error) {
    console.error("Stripe refund error:", error);
    return { error: "errors.stripe.refundFailed" };
  }
}

// ============================================================================
// Email Actions
// ============================================================================

interface SendReservationEmailData {
  templateId: string;
  customSubject?: string;
  customMessage?: string;
}

export async function sendReservationModificationEmail(
  reservationId: string,
  data?: {
    previousPeriod?: {
      startDate: Date;
      endDate: Date;
    };
  },
) {
  // sendEmail degrades to a logged no-op without a transport; a manual send
  // must not pretend it delivered anything.
  if (!isEmailConfigured()) {
    return { error: "errors.emailSendFailed" };
  }

  const store = await getStoreForUser();
  if (!store) {
    return { error: "errors.unauthorized" };
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(eq(reservations.id, reservationId), eq(reservations.storeId, store.id)),
    with: {
      customer: true,
    },
  });

  if (!reservation) {
    return { error: "errors.reservationNotFound" };
  }

  const storeData = {
    id: store.id,
    name: store.name,
    logoUrl: store.logoUrl,
    darkLogoUrl: store.darkLogoUrl,
    email: store.email,
    phone: store.phone,
    address: store.address,
    theme: store.theme,
    settings: store.settings,
    emailSettings: store.emailSettings,
  };

  const customerData = {
    firstName: reservation.customer.firstName,
    lastName: reservation.customer.lastName,
    email: reservation.customer.email,
  };

  const reservationUrl = getStorefrontUrl(store.slug, `/account/reservations/${reservationId}`);

  try {
    await sendReservationModifiedEmail({
      to: customerData.email,
      store: storeData,
      customer: customerData,
      reservation: {
        id: reservation.id,
        number: reservation.number,
        startDate: reservation.startDate,
        endDate: reservation.endDate,
      },
      previousPeriod: data?.previousPeriod,
      reservationUrl,
      locale: getLocaleFromCountry(store.settings?.country),
    });

    await logReservationActivity(reservationId, "note_updated", {
      templateId: "reservation_modified",
      to: customerData.email,
      customerEmailNotification: "sent",
    });

    revalidatePath(`/dashboard/reservations/${reservationId}`);
    await captureReservationActionSucceeded({
      distinctId: store.userId,
      storeId: store.id,
      reservationId,
      action: reservationAnalyticsActions.sendEmail,
      properties: { template_id: "reservation_modified", channel: "email" },
    });
    return { success: true };
  } catch (error) {
    console.error("Failed to send reservation modification email:", error);
    await logReservationActivity(reservationId, "note_updated", {
      templateId: "reservation_modified",
      to: customerData.email,
      customerEmailNotification: "failed",
    });
    revalidatePath(`/dashboard/reservations/${reservationId}`);
    return { error: "errors.emailSendFailed" };
  }
}

/**
 * Fetches everything the manual reservation emails need, in the shape the
 * shared builder expects. Used by both the send action and its preview.
 */
async function getManualEmailContext(reservationId: string) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: "errors.unauthorized" as const };
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(eq(reservations.id, reservationId), eq(reservations.storeId, store.id)),
    with: {
      customer: true,
      items: { with: { product: true } },
      payments: true,
    },
  });

  if (!reservation) {
    return { error: "errors.reservationNotFound" as const };
  }

  return { store, reservation };
}

export async function sendReservationEmail(reservationId: string, data: SendReservationEmailData) {
  if (!isEmailConfigured()) {
    return { error: "errors.emailSendFailed" };
  }

  const context = await getManualEmailContext(reservationId);
  if ("error" in context) {
    return { error: context.error };
  }
  const { store, reservation } = context;

  try {
    const email = await buildManualReservationEmail({
      store,
      reservation,
      payload: data,
      mode: "send",
    });

    if ("error" in email) {
      return { error: email.error };
    }

    try {
      const result = await sendEmail({
        to: email.to,
        subject: email.subject,
        html: email.html,
        attachments: email.attachments,
        fromName: store.name,
      });

      if (email.logTemplateType) {
        await logEmail({
          storeId: store.id,
          reservationId,
          to: email.to,
          subject: email.subject,
          templateType: email.logTemplateType,
          status: "sent",
          messageId: result.messageId,
        });
      }
    } catch (sendError) {
      if (email.logTemplateType) {
        await logEmail({
          storeId: store.id,
          reservationId,
          to: email.to,
          subject: email.subject,
          templateType: email.logTemplateType,
          status: "failed",
          error: String(sendError),
        });
      }
      throw sendError;
    }

    // Log activity
    await logReservationActivity(reservationId, "note_updated", {
      templateId: data.templateId,
      to: email.to,
    });

    revalidatePath(`/dashboard/reservations/${reservationId}`);
    await captureReservationActionSucceeded({
      distinctId: store.userId,
      storeId: store.id,
      reservationId,
      action: reservationAnalyticsActions.sendEmail,
      properties: { template_id: data.templateId, channel: "email" },
    });
    return { success: true };
  } catch (error) {
    console.error("Failed to send reservation email:", error);
    return { error: "errors.emailSendFailed" };
  }
}

/**
 * Serializes everything the manual reservation emails need so the dashboard
 * can render its live preview in the browser — with the very builder the send
 * action uses, minus the minted links a real send earns.
 */
export async function getManualEmailRenderContext(
  reservationId: string,
): Promise<ManualEmailRenderContext | { error: string }> {
  const context = await getManualEmailContext(reservationId);
  if ("error" in context) {
    return { error: context.error ?? "errors.reservationNotFound" };
  }

  try {
    return await toManualEmailRenderContext(context.store, context.reservation);
  } catch (error) {
    console.error("Failed to build the email render context:", error);
    return { error: "errors.emailPreviewFailed" };
  }
}

// ============================================================================
// Access Link Actions
// ============================================================================

export async function generateAccessUrl(reservationId: string) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: "errors.unauthorized" as const };
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(eq(reservations.id, reservationId), eq(reservations.storeId, store.id)),
    columns: { id: true },
    with: { customer: { columns: { email: true } } },
  });

  if (!reservation) {
    return { error: "errors.reservationNotFound" as const };
  }

  const token = nanoid(64);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await db.insert(verificationCodes).values({
    id: nanoid(),
    email: reservation.customer.email,
    storeId: store.id,
    code: "",
    type: "instant_access",
    token,
    reservationId,
    expiresAt,
    createdAt: new Date(),
  });

  const url = getStorefrontUrl(store.slug, `/r/${reservationId}?token=${token}`);

  return { url };
}

export async function sendAccessLink(reservationId: string, data?: { customMessage?: string }) {
  if (!isEmailConfigured()) {
    return { error: "errors.accessLinkSendFailed" };
  }

  const store = await getStoreForUser();
  if (!store) {
    return { error: "errors.unauthorized" };
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(eq(reservations.id, reservationId), eq(reservations.storeId, store.id)),
    with: {
      customer: true,
      items: true,
      payments: true,
    },
  });

  if (!reservation) {
    return { error: "errors.reservationNotFound" };
  }

  try {
    // Generate secure 64-char token
    const token = nanoid(64);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    // Store token in verificationCodes table
    await db.insert(verificationCodes).values({
      id: nanoid(),
      email: reservation.customer.email,
      storeId: store.id,
      code: "", // Not used for instant_access
      type: "instant_access",
      token,
      reservationId,
      expiresAt,
      createdAt: new Date(),
    });

    // Build access URL
    const accessUrl = getStorefrontUrl(store.slug, `/r/${reservationId}?token=${token}`);

    // Rendered by the shared builder so the dashboard preview and this send
    // never drift apart; the token above stays here, with its activity log.
    const email = await buildManualReservationEmail({
      store,
      reservation,
      payload: { templateId: "access_link", customMessage: data?.customMessage },
      mode: "send",
      accessUrl,
    });

    if ("error" in email) {
      return { error: email.error };
    }

    try {
      const result = await sendEmail({
        to: email.to,
        subject: email.subject,
        html: email.html,
        attachments: email.attachments,
        fromName: store.name,
      });

      await logEmail({
        storeId: store.id,
        reservationId,
        to: email.to,
        subject: email.subject,
        templateType: email.logTemplateType ?? "instant_access",
        status: "sent",
        messageId: result.messageId,
      });
    } catch (sendError) {
      await logEmail({
        storeId: store.id,
        reservationId,
        to: email.to,
        subject: email.subject,
        templateType: email.logTemplateType ?? "instant_access",
        status: "failed",
        error: String(sendError),
      });
      throw sendError;
    }

    // Log activity
    await logReservationActivity(reservationId, "access_link_sent", {
      token: token.substring(0, 8) + "...",
      expiresAt: expiresAt.toISOString(),
      method: "email",
    });

    revalidatePath(`/dashboard/reservations/${reservationId}`);
    await captureReservationActionSucceeded({
      distinctId: store.userId,
      storeId: store.id,
      reservationId,
      action: reservationAnalyticsActions.sendEmail,
      properties: { template_id: "access_link", channel: "email" },
    });
    return { success: true };
  } catch (error) {
    console.error("Failed to send access link:", error);
    return { error: "errors.accessLinkSendFailed" };
  }
}

// ============================================================================
// SMS Actions
// ============================================================================

/**
 * Check if SMS is configured for the system
 */
export async function checkSmsConfigured(): Promise<boolean> {
  return isSmsConfigured();
}

/**
 * Send access link via SMS to customer
 */
export async function sendAccessLinkBySms(reservationId: string) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: "errors.unauthorized" };
  }

  if (!isSmsConfigured()) {
    return { error: "errors.smsNotConfigured" };
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(eq(reservations.id, reservationId), eq(reservations.storeId, store.id)),
    with: {
      customer: true,
    },
  });

  if (!reservation) {
    return { error: "errors.reservationNotFound" };
  }

  if (!reservation.customer.phone) {
    return { error: "errors.customerNoPhone" };
  }

  try {
    // Generate secure 64-char token
    const token = nanoid(64);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    // Store token in verificationCodes table
    await db.insert(verificationCodes).values({
      id: nanoid(),
      email: reservation.customer.email,
      storeId: store.id,
      code: "", // Not used for instant_access
      type: "instant_access",
      token,
      reservationId,
      expiresAt,
      createdAt: new Date(),
    });

    // Build access URL
    const accessUrl = getStorefrontUrl(store.slug, `/r/${reservationId}?token=${token}`);

    // Send SMS
    const result = await sendAccessLinkSms({
      store: {
        id: store.id,
        name: store.name,
      },
      customer: {
        id: reservation.customer.id,
        firstName: reservation.customer.firstName,
        lastName: reservation.customer.lastName,
        phone: reservation.customer.phone,
      },
      reservation: {
        id: reservationId,
        number: reservation.number,
      },
      accessUrl,
    });

    if (!result.success) {
      // Return limit info if SMS limit was reached
      if (result.limitReached && result.limitInfo) {
        return {
          error: "errors.smsLimitReached",
          limitReached: true,
          limitInfo: result.limitInfo,
        };
      }
      return { error: result.error || "errors.smsSendFailed" };
    }

    // Log activity
    await logReservationActivity(reservationId, "access_link_sent", {
      token: token.substring(0, 8) + "...",
      expiresAt: expiresAt.toISOString(),
      method: "sms",
    });

    revalidatePath(`/dashboard/reservations/${reservationId}`);
    return { success: true };
  } catch (error) {
    console.error("Failed to send access link via SMS:", error);
    return { error: "errors.smsSendFailed" };
  }
}

// ============================================================================
// Payment Request Functions
// ============================================================================

export interface RequestPaymentInput {
  type: "rental" | "deposit" | "custom";
  amount?: number; // Required for custom type
  channels: { email: boolean; sms: boolean };
  customMessage?: string;
}

export async function requestPayment(
  reservationId: string,
  data: RequestPaymentInput,
): Promise<{
  success?: boolean;
  error?: string;
  paymentUrl?: string;
}> {
  try {
    const store = await getStoreForUser();
    if (!store) {
      return { error: "errors.unauthorized" };
    }

    // Check Stripe is configured and able to take payments
    if (!store.stripeAccountId || !store.stripeChargesEnabled) {
      return { error: "errors.stripeNotConfigured" };
    }

    // Get reservation with customer and payments
    const reservation = await db.query.reservations.findFirst({
      where: and(eq(reservations.id, reservationId), eq(reservations.storeId, store.id)),
      with: {
        customer: true,
        payments: true,
      },
    });

    if (!reservation) {
      return { error: "errors.reservationNotFound" };
    }

    // Validate at least one channel is selected
    if (!data.channels.email && !data.channels.sms) {
      return { error: "errors.noChannelSelected" };
    }

    // Validate SMS - customer must have phone number
    if (data.channels.sms && !reservation.customer.phone) {
      return { error: "errors.customerNoPhone" };
    }

    // The reservation's language, as the other messages about it.
    const locale = resolveReservationEmailLocale(reservation.locale, store.settings?.country);

    // The amount, in the reservation's currency, whatever the store's is now.
    const terms = paymentRequestTerms({
      type: data.type,
      customAmount: data.amount,
      reservation,
      storeSettings: store.settings,
    });
    if (!terms.ok) {
      return { error: terms.error };
    }
    const { amount, description, currency } = terms;

    // Build URLs
    const baseUrl = getStorefrontUrl(store.slug);

    let paymentUrl: string;

    if (data.type === "deposit") {
      // For deposit, create URL to authorize-deposit page with access token
      const token = nanoid(64);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      // Store token in verificationCodes table
      await db.insert(verificationCodes).values({
        id: nanoid(),
        email: reservation.customer.email,
        storeId: store.id,
        code: "", // Not used for instant_access
        type: "instant_access",
        token,
        reservationId,
        expiresAt,
        createdAt: new Date(),
      });

      paymentUrl = `${baseUrl}/authorize-deposit/${reservationId}?token=${token}`;
    } else {
      // For rental/custom, create a persistent payment request.
      // The customer receives a link to /pay/ which creates a fresh
      // Stripe Checkout Session on demand (no 24h expiry issue).
      const token = nanoid(64);
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

      await db.insert(paymentRequests).values({
        id: nanoid(),
        storeId: store.id,
        reservationId,
        token,
        amount: amount.toFixed(2),
        currency,
        description,
        type: data.type as "rental" | "custom",
        status: "pending",
        expiresAt,
        createdAt: new Date(),
      });

      paymentUrl = `${baseUrl}/pay/${reservationId}?token=${token}`;
    }

    // Send notifications
    const notificationResults: { email?: boolean; sms?: boolean } = {};

    if (data.channels.email) {
      try {
        if (data.type === "deposit") {
          await sendDepositAuthorizationRequestEmail({
            to: reservation.customer.email,
            store: {
              id: store.id,
              name: store.name,
              logoUrl: store.logoUrl,
              email: store.email,
              phone: store.phone,
              address: store.address,
              theme: store.theme,
              settings: store.settings,
            },
            customer: {
              firstName: reservation.customer.firstName,
              lastName: reservation.customer.lastName,
              email: reservation.customer.email,
            },
            reservation: {
              id: reservationId,
              number: reservation.number,
              currency,
            },
            depositAmount: amount,
            authorizationUrl: paymentUrl,
            customMessage: data.customMessage,
            locale,
          });
        } else {
          await sendPaymentRequestEmail({
            to: reservation.customer.email,
            store: {
              id: store.id,
              name: store.name,
              logoUrl: store.logoUrl,
              email: store.email,
              phone: store.phone,
              address: store.address,
              theme: store.theme,
              settings: store.settings,
            },
            customer: {
              firstName: reservation.customer.firstName,
              lastName: reservation.customer.lastName,
              email: reservation.customer.email,
            },
            reservation: {
              id: reservationId,
              number: reservation.number,
              currency,
            },
            amount,
            description,
            paymentUrl,
            customMessage: data.customMessage,
            locale,
          });
        }
        notificationResults.email = true;
      } catch (error) {
        console.error("Failed to send payment request email:", error);
        notificationResults.email = false;
      }
    }

    if (data.channels.sms && reservation.customer.phone) {
      try {
        if (data.type === "deposit") {
          await sendDepositAuthorizationRequestSms({
            store: {
              id: store.id,
              name: store.name,
              settings: store.settings,
            },
            customer: {
              id: reservation.customer.id,
              firstName: reservation.customer.firstName,
              lastName: reservation.customer.lastName,
              phone: reservation.customer.phone,
            },
            reservation: {
              id: reservationId,
              number: reservation.number,
              startDate: reservation.startDate,
              endDate: reservation.endDate,
            },
            depositAmount: amount,
            authorizationUrl: paymentUrl,
            currency,
            locale,
            // The store's own text for this message, as its notification settings hold it.
            customMessage:
              store.customerNotificationSettings?.templates?.customer_deposit_authorization_requested
                ?.smsMessage,
          });
        } else {
          await sendPaymentRequestSms({
            store: {
              id: store.id,
              name: store.name,
              settings: store.settings,
            },
            customer: {
              id: reservation.customer.id,
              firstName: reservation.customer.firstName,
              lastName: reservation.customer.lastName,
              phone: reservation.customer.phone,
            },
            reservation: {
              id: reservationId,
              number: reservation.number,
              startDate: reservation.startDate,
              endDate: reservation.endDate,
            },
            amount,
            paymentUrl,
            currency,
            locale,
            customMessage:
              store.customerNotificationSettings?.templates?.customer_payment_requested?.smsMessage,
          });
        }
        notificationResults.sms = true;
      } catch (error) {
        console.error("Failed to send payment request SMS:", error);
        notificationResults.sms = false;
      }
    }

    // Log activity
    await logReservationActivity(reservationId, "payment_added", {
      type: data.type,
      amount,
      currency,
      channels: data.channels,
      notificationResults,
      paymentUrl,
      isPaymentRequest: true,
    });

    revalidatePath(`/dashboard/reservations/${reservationId}`);

    await captureReservationActionSucceeded({
      distinctId: store.userId,
      storeId: store.id,
      reservationId,
      action: reservationAnalyticsActions.requestPayment,
      properties: {
        payment_type: data.type,
        channel_email: data.channels.email,
        channel_sms: data.channels.sms,
        email_sent: notificationResults.email ?? null,
        sms_sent: notificationResults.sms ?? null,
      },
    });

    return {
      success: true,
      paymentUrl,
    };
  } catch (error) {
    console.error("Failed to request payment:", error);
    return { error: "errors.requestPaymentFailed" };
  }
}

// ============================================================================
// Unit Assignment Actions
// ============================================================================

type AssignUnitsToReservationItemResult = {
  success?: boolean;
  error?: string;
  bufferConflict?: boolean;
  failedUnitIds?: string[];
  warnings?: Array<{
    key: string;
    params?: Record<string, string | number>;
    details?: string;
  }>;
};

/**
 * Assign units to a reservation item.
 * This replaces any existing assignments for the item.
 */
export async function assignUnitsToReservationItem(
  reservationItemId: string,
  unitIds: string[],
  options?: { overrideTurnoverBuffer?: boolean },
): Promise<AssignUnitsToReservationItemResult> {
  const store = await getStoreForUser();
  if (!store) {
    return { error: "errors.unauthorized" };
  }

  const validated = dashboardReservationAssignUnitsInputSchema.safeParse({
    reservationItemId,
    unitIds,
    overrideTurnoverBuffer: options?.overrideTurnoverBuffer,
  });
  if (!validated.success) {
    return { error: "errors.invalidData" };
  }

  try {
    // 1. Get the reservation item and verify store access
    const [item] = await db
      .select({
        id: reservationItems.id,
        productId: reservationItems.productId,
        combinationKey: reservationItems.combinationKey,
        quantity: reservationItems.quantity,
        reservationId: reservationItems.reservationId,
        startDate: reservations.startDate,
        endDate: reservations.endDate,
      })
      .from(reservationItems)
      .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
      .where(and(eq(reservationItems.id, reservationItemId), eq(reservations.storeId, store.id)));

    if (!item) {
      return { error: "errors.notFound" };
    }

    const selectedUnitIds = validated.data.unitIds;
    const overrideTurnoverBuffer = validated.data.overrideTurnoverBuffer ?? false;

    // 2. Validate that we're not assigning more units than quantity
    if (selectedUnitIds.length > item.quantity) {
      return { error: "errors.tooManyUnitsAssigned" };
    }

    const unitEventPayload = {
      reservationId: item.reservationId,
      reservationItemId,
    };

    const session = await auth();
    const actorUserId = session?.user?.id ?? null;
    const blockingStatuses = getBlockingReservationStatuses(
      store.settings?.pendingBlocksAvailability ?? true,
    );
    const turnoverBufferMinutes = store.settings?.turnoverBufferMinutes ?? 0;

    const assignUnits = async (tx: Transaction) => {
      // Locks come first, as locking reads only, in the order of the other
      // reservation writers (reservation, then product, then units). The
      // first consistent read happens after them, so every validation below
      // sees what was committed before the locks were taken.
      const [lockedReservation] = await tx
        .select({ id: reservations.id })
        .from(reservations)
        .where(and(eq(reservations.id, item.reservationId), eq(reservations.storeId, store.id)))
        .for("update");

      if (!lockedReservation) {
        return { error: "errors.notFound" };
      }

      if (item.productId) {
        await tx
          .select({ id: products.id })
          .from(products)
          .where(and(eq(products.id, item.productId), eq(products.storeId, store.id)))
          .for("update");
      }

      const sortedLockUnitIds = [...new Set(selectedUnitIds)].sort((a, b) =>
        a.localeCompare(b, "en"),
      );

      if (sortedLockUnitIds.length > 0) {
        await tx
          .select({ id: productUnits.id })
          .from(productUnits)
          .where(inArray(productUnits.id, sortedLockUnitIds))
          .orderBy(productUnits.id)
          .for("update");
      }

      const lockedProductsById = item.productId
        ? await lockReservationProducts(tx, store.id, [item.productId])
        : new Map();

      const [currentItem] = await tx
        .select({
          id: reservationItems.id,
          productId: reservationItems.productId,
          combinationKey: reservationItems.combinationKey,
          selectedAttributes: reservationItems.selectedAttributes,
          quantity: reservationItems.quantity,
          reservationId: reservationItems.reservationId,
          startDate: reservations.startDate,
          endDate: reservations.endDate,
        })
        .from(reservationItems)
        .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
        .where(and(eq(reservationItems.id, reservationItemId), eq(reservations.storeId, store.id)));

      if (!currentItem) {
        return { error: "errors.notFound" };
      }

      if (selectedUnitIds.length > currentItem.quantity) {
        return { error: "errors.tooManyUnitsAssigned" };
      }

      const existingAssignments = await tx
        .select({
          productUnitId: reservationItemUnits.productUnitId,
          identifierSnapshot: reservationItemUnits.identifierSnapshot,
        })
        .from(reservationItemUnits)
        .where(eq(reservationItemUnits.reservationItemId, reservationItemId));

      const existingUnitIds = new Set(
        existingAssignments.flatMap((assignment) =>
          assignment.productUnitId ? [assignment.productUnitId] : [],
        ),
      );
      const nextUnitIds = new Set(selectedUnitIds);
      const unassignedUnitIds = [...existingUnitIds].filter((unitId) => !nextUnitIds.has(unitId));
      const addedUnitIds = selectedUnitIds.filter((unitId) => !existingUnitIds.has(unitId));

      const units =
        selectedUnitIds.length > 0
          ? await tx
              .select({
                id: productUnits.id,
                productId: productUnits.productId,
                combinationKey: productUnits.combinationKey,
                attributes: productUnits.attributes,
                identifier: productUnits.identifier,
                lifecycleStatus: productUnits.lifecycleStatus,
              })
              .from(productUnits)
              .where(inArray(productUnits.id, selectedUnitIds))
          : [];
      const unitById = new Map(units.map((unit) => [unit.id, unit]));

      const missingAddedUnitIds = addedUnitIds.filter((unitId) => !unitById.has(unitId));
      if (missingAddedUnitIds.length > 0) {
        return {
          error: "errors.invalidUnits",
          failedUnitIds: missingAddedUnitIds,
        };
      }

      const productMismatchUnitIds = addedUnitIds.filter(
        (unitId) => unitById.get(unitId)?.productId !== currentItem.productId,
      );
      if (productMismatchUnitIds.length > 0) {
        return {
          error: "errors.unitProductMismatch",
          failedUnitIds: productMismatchUnitIds,
        };
      }

      const inactiveAddedUnitIds = addedUnitIds.filter(
        (unitId) => unitById.get(unitId)?.lifecycleStatus !== "active",
      );
      if (inactiveAddedUnitIds.length > 0) {
        return {
          error: "errors.invalidUnits",
          failedUnitIds: inactiveAddedUnitIds,
        };
      }

      const assignmentScope = currentItem.productId
        ? await resolveUnitAssignmentScope(tx, {
            productId: currentItem.productId,
            combinationKey: currentItem.combinationKey,
            selectedAttributes: currentItem.selectedAttributes,
          })
        : null;
      const combinationMismatchUnitIds = addedUnitIds.filter((unitId) => {
        const unit = unitById.get(unitId);
        return (
          assignmentScope !== null &&
          unit !== undefined &&
          !unitMatchesAssignmentScope(assignmentScope, {
            combinationKey: unit.combinationKey,
            attributes: unit.attributes,
          })
        );
      });
      if (combinationMismatchUnitIds.length > 0) {
        return {
          error: "errors.unitCombinationMismatch",
          failedUnitIds: combinationMismatchUnitIds,
        };
      }

      // A pooled line may take units of any combination, so the chosen units
      // must leave each combination enough stock for the lines that booked
      // it specifically. Checked under the product lock, like a checkout.
      if (
        addedUnitIds.length > 0 &&
        assignmentScope?.combinationKey === null &&
        currentItem.productId
      ) {
        const productId = currentItem.productId;
        const checkStock = (bufferMinutes: number) =>
          reserveInventory({
            tx,
            storeId: store.id,
            lockedProductsById,
            lines: [
              {
                lineId: currentItem.id,
                productId,
                // Only the units being assigned are checked: a line booked
                // with an explicit overbooking keeps its uncovered remainder.
                quantity: selectedUnitIds.length,
                selectedAttributes: currentItem.selectedAttributes ?? undefined,
                combinationKey: currentItem.combinationKey,
                assignedUnitIds: selectedUnitIds,
                pooled: true,
              },
            ],
            window: { start: currentItem.startDate, end: currentItem.endDate },
            turnoverBufferMinutes: bufferMinutes,
            blockingStatuses,
            excludeReservationItemIds: [currentItem.id],
            skipConsumableCheck: true,
            skipRequiredAccessoryCheck: true,
          });
        const strictStock = await checkStock(0);
        if (!strictStock.ok) {
          // The units are valid; the stock is short: another booking needs them.
          return { error: "errors.insufficientCapacity", failedUnitIds: addedUnitIds };
        }
        if (!overrideTurnoverBuffer && turnoverBufferMinutes > 0) {
          const bufferedStock = await checkStock(turnoverBufferMinutes);
          if (!bufferedStock.ok) {
            return {
              error: "errors.turnoverBufferConflict",
              bufferConflict: true,
              failedUnitIds: addedUnitIds,
            };
          }
        }
      }

      if (addedUnitIds.length > 0) {
        const siblingAssignments = await tx
          .select({ productUnitId: reservationItemUnits.productUnitId })
          .from(reservationItemUnits)
          .innerJoin(
            reservationItems,
            eq(reservationItemUnits.reservationItemId, reservationItems.id),
          )
          .where(
            and(
              eq(reservationItems.reservationId, currentItem.reservationId),
              not(eq(reservationItemUnits.reservationItemId, currentItem.id)),
              inArray(reservationItemUnits.productUnitId, addedUnitIds),
            ),
          );
        const siblingAssignedUnitIds = [
          ...new Set(
            siblingAssignments.flatMap((assignment) =>
              assignment.productUnitId ? [assignment.productUnitId] : [],
            ),
          ),
        ];
        if (siblingAssignedUnitIds.length > 0) {
          return {
            error: "errors.invalidUnits",
            failedUnitIds: siblingAssignedUnitIds,
          };
        }

        const rentableUnits = await tx
          .select({ id: productUnits.id })
          .from(productUnits)
          .where(
            and(
              inArray(productUnits.id, addedUnitIds),
              buildUnitRentableDuringPredicate(tx, currentItem.startDate, currentItem.endDate),
            ),
          );
        const rentableUnitIds = new Set(rentableUnits.map((unit) => unit.id));
        const notRentableUnitIds = addedUnitIds.filter((unitId) => !rentableUnitIds.has(unitId));
        if (notRentableUnitIds.length > 0) {
          return {
            error: "errors.invalidUnits",
            failedUnitIds: notRentableUnitIds,
          };
        }

        const busyUnitIds = await findBusyUnitIds(tx, {
          unitIds: addedUnitIds,
          start: currentItem.startDate,
          end: currentItem.endDate,
          blockingStatuses,
          turnoverBufferMinutes,
          excludeReservationItemId: currentItem.id,
        });
        const overlapUnitIds = [...busyUnitIds.entries()]
          .filter(([, reason]) => reason === "overlap")
          .map(([unitId]) => unitId);
        const bufferUnitIds = [...busyUnitIds.entries()]
          .filter(([, reason]) => reason === "buffer")
          .map(([unitId]) => unitId);

        if (overlapUnitIds.length > 0) {
          return {
            error: "errors.invalidUnits",
            failedUnitIds: overrideTurnoverBuffer
              ? overlapUnitIds
              : [...overlapUnitIds, ...bufferUnitIds],
          };
        }

        if (!overrideTurnoverBuffer && bufferUnitIds.length > 0) {
          return {
            error: "errors.turnoverBufferConflict",
            bufferConflict: true,
            failedUnitIds: bufferUnitIds,
          };
        }
      }

      const existingIdentifierByUnitId = new Map(
        existingAssignments.flatMap((assignment) =>
          assignment.productUnitId
            ? [[assignment.productUnitId, assignment.identifierSnapshot]]
            : [],
        ),
      );
      const unitIdentifierById = new Map(units.map((unit) => [unit.id, unit.identifier]));
      const assignmentsToInsert = selectedUnitIds.map((unitId) => ({
        id: nanoid(),
        reservationItemId,
        productUnitId: unitId,
        identifierSnapshot:
          unitIdentifierById.get(unitId) || existingIdentifierByUnitId.get(unitId) || "",
      }));
      const unitEvents: Array<typeof productUnitEvents.$inferInsert> = [
        ...unassignedUnitIds.map((unitId) =>
          buildUnitEvent({
            productUnitId: unitId,
            event: {
              storeId: store.id,
              type: "unassigned",
              actorUserId,
              identifierSnapshot: existingIdentifierByUnitId.get(unitId) || unitId,
              payload: unitEventPayload,
            },
          }),
        ),
        ...addedUnitIds.map((unitId) =>
          buildUnitEvent({
            productUnitId: unitId,
            event: {
              storeId: store.id,
              type: "assigned",
              actorUserId,
              identifierSnapshot: unitIdentifierById.get(unitId) || unitId,
              payload: unitEventPayload,
            },
          }),
        ),
      ];

      await tx
        .delete(reservationItemUnits)
        .where(eq(reservationItemUnits.reservationItemId, reservationItemId));

      if (assignmentsToInsert.length > 0) {
        await tx.insert(reservationItemUnits).values(assignmentsToInsert);
      }

      if (unitEvents.length > 0) {
        await tx.insert(productUnitEvents).values(unitEvents);
      }

      return {
        success: true,
        unitIdentifiers: selectedUnitIds.map(
          (unitId) =>
            unitIdentifierById.get(unitId) || existingIdentifierByUnitId.get(unitId) || unitId,
        ),
      };
    };
    const assignmentResult = await retryOnceOnDeadlock(() => db.transaction(assignUnits));

    if ("error" in assignmentResult && assignmentResult.error) {
      return assignmentResult;
    }

    await logReservationActivity(item.reservationId, "modified", {
      action: selectedUnitIds.length > 0 ? "units_assigned" : "units_unassigned",
      reservationItemId,
      ...(selectedUnitIds.length > 0 ? { unitIdentifiers: assignmentResult.unitIdentifiers } : {}),
    });

    revalidatePath(`/dashboard/reservations/${item.reservationId}`);
    revalidatePath(`/dashboard/products/${item.productId}`);

    return { success: true };
  } catch (error) {
    console.error("Failed to assign units:", error);
    return { error: "errors.assignUnitsFailed" };
  }
}

/**
 * Get available units for assignment to a reservation item.
 */
export async function getAvailableUnitsForReservationItem(reservationItemId: string): Promise<{
  units?: Array<{
    id: string;
    identifier: string;
    notes: string | null;
  }>;
  assigned?: string[];
  error?: string;
}> {
  const store = await getStoreForUser();
  if (!store) {
    return { error: "errors.unauthorized" };
  }

  try {
    // 1. Get reservation item details and verify access
    const [item] = await db
      .select({
        id: reservationItems.id,
        productId: reservationItems.productId,
        combinationKey: reservationItems.combinationKey,
        selectedAttributes: reservationItems.selectedAttributes,
        reservationId: reservationItems.reservationId,
        startDate: reservations.startDate,
        endDate: reservations.endDate,
      })
      .from(reservationItems)
      .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
      .where(and(eq(reservationItems.id, reservationItemId), eq(reservations.storeId, store.id)));

    if (!item) {
      return { error: "errors.notFound" };
    }

    // Items without a productId (custom items) cannot have units
    if (!item.productId) {
      return { units: [], assigned: [] };
    }

    // 2. Get available units using the utility
    const { getAvailableUnitsForProduct, getBlockingReservationStatuses } =
      await import("@louez/api/services/unit-availability");
    const blockingStatuses = getBlockingReservationStatuses(
      store.settings?.pendingBlocksAvailability ?? true,
    );
    const turnoverBufferMinutes = store.settings?.turnoverBufferMinutes ?? 0;
    const scope = await resolveUnitAssignmentScope(db, {
      productId: item.productId,
      combinationKey: item.combinationKey,
      selectedAttributes: item.selectedAttributes,
    });
    const availableUnits = await getAvailableUnitsForProduct(
      item.productId,
      item.startDate,
      item.endDate,
      {
        blockingStatuses,
        turnoverBufferMinutes,
        excludeReservationItemId: item.id,
        combinationKey: scope.combinationKey,
        selectedAttributes: scope.selectedAttributes,
      },
    );
    const availableUnitIds = new Set(availableUnits.map((unit) => unit.id));
    let bufferOnlyUnits: Array<{
      id: string;
      identifier: string;
      notes: string | null;
    }> = [];

    if (turnoverBufferMinutes > 0) {
      const unitConditions = [
        eq(productUnits.productId, item.productId),
        eq(productUnits.lifecycleStatus, "active" as const),
        buildUnitRentableDuringPredicate(db, item.startDate, item.endDate),
      ];

      if (scope.combinationKey) {
        unitConditions.push(eq(productUnits.combinationKey, scope.combinationKey));
      }

      const candidateUnits = (
        await db
          .select({
            id: productUnits.id,
            identifier: productUnits.identifier,
            notes: productUnits.notes,
            attributes: productUnits.attributes,
          })
          .from(productUnits)
          .where(and(...unitConditions))
      )
        .filter((unit) => matchesSelectedAttributes(scope.selectedAttributes, unit.attributes))
        .map(({ id, identifier, notes }) => ({ id, identifier, notes }));
      const candidateUnitIds = candidateUnits.map((unit) => unit.id);

      if (candidateUnitIds.length > 0) {
        const busyWithoutBuffer = await findBusyUnitIds(db, {
          unitIds: candidateUnitIds,
          start: item.startDate,
          end: item.endDate,
          blockingStatuses,
          turnoverBufferMinutes: 0,
          excludeReservationItemId: item.id,
        });
        const busyWithBuffer = await findBusyUnitIds(db, {
          unitIds: candidateUnitIds,
          start: item.startDate,
          end: item.endDate,
          blockingStatuses,
          turnoverBufferMinutes,
          excludeReservationItemId: item.id,
        });

        bufferOnlyUnits = candidateUnits.filter((unit) => {
          if (availableUnitIds.has(unit.id) || busyWithoutBuffer.has(unit.id)) {
            return false;
          }

          return busyWithBuffer.get(unit.id) === "buffer";
        });
      }
    }

    // 3. Get currently assigned units for this item
    const assignedUnits = await db
      .select({
        productUnitId: reservationItemUnits.productUnitId,
      })
      .from(reservationItemUnits)
      .where(eq(reservationItemUnits.reservationItemId, reservationItemId));

    // Include currently assigned units in the available list (they're already reserved for this item)
    const assignedUnitIds = assignedUnits.flatMap((assignment) =>
      assignment.productUnitId ? [assignment.productUnitId] : [],
    );
    const currentlyAssignedUnits = await db
      .select({
        id: productUnits.id,
        identifier: productUnits.identifier,
        notes: productUnits.notes,
      })
      .from(productUnits)
      .where(inArray(productUnits.id, assignedUnitIds.length > 0 ? assignedUnitIds : ["__none__"]));

    // Merge available units with currently assigned (avoiding duplicates)
    for (const unit of bufferOnlyUnits) {
      availableUnitIds.add(unit.id);
    }
    const allUnits = [
      ...availableUnits,
      ...bufferOnlyUnits,
      ...currentlyAssignedUnits.filter((u) => !availableUnitIds.has(u.id)),
    ].sort((a, b) => a.identifier.localeCompare(b.identifier, "en"));

    return {
      units: allUnits.map((u) => ({
        id: u.id,
        identifier: u.identifier,
        notes: u.notes,
      })),
      assigned: assignedUnitIds,
    };
  } catch (error) {
    console.error("Failed to get available units:", error);
    return { error: "errors.getAvailableUnitsFailed" };
  }
}
