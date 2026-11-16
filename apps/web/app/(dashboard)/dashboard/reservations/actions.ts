"use server";

import {
  capacityVerdictMetadata,
  nextCapacityVerdictDate,
  turnoverBufferVerdictMetadata,
} from "@louez/api/services/capacity-verdict";
import type { CapacityShortfall } from "@louez/api/contracts/reservations";
import {
  lockReservationProducts,
  reserveInventory,
  splitShortfallsByTurnoverBuffer,
} from "@louez/api/services/reservation-inventory";

import {
  isReservationEditable,
  NOT_RECORDED,
  pricingBasisOf,
  recordedTaxDisplayMode,
  validateReservationContract,
} from "@louez/api/services";
import { loadPricingCatalog, priceRegularCatalogLine } from "@louez/api/services/pricing-catalog";
import {
  priceReservationEdit,
  type EditedLine,
  type EditPricingInput,
} from "@louez/api/services/reservation-edit-pricing";
import {
  computeReservationTotals,
  getReservationItemTaxFields,
  INSURANCE_TAX_LINE_ID,
  type ReservationItemTaxFields,
} from "@louez/api/services/reservation-totals";

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
  lockReservationInTransaction,
  markReservation,
  reconcileReservationStock,
  reservationStatusConsumesStock,
  type ReservationTransaction,
  retryTransactionOnDeadlock,
  runReservationTransaction,
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
import { dispatchApiEffects } from "@/lib/api/effects";
import { paymentRecordsPort } from "@/lib/api/payment-records-port";
import { paymentRefundsPort } from "@/lib/api/payment-refunds-port";
import { paymentErrorKey } from "@/lib/reservations/util.payment-error-key";
import { typedAmount } from "@/lib/reservations/util.typed-amount";
import {
  deleteRecordedPayment,
  insertRecordedPayment,
  insertRecordedPaymentWithFacts,
} from "@/lib/reservations/dashboard-payment-writes";
import {
  authorizeDepositHold,
  captureDepositHold as captureReferencedDepositHold,
  releaseDepositHold as releaseReferencedDepositHold,
} from "@/lib/reservations/deposit-hold";
import { depositHoldDeps } from "@/lib/reservations/deposit-hold-live";
import { resolveReservationLocationSnapshot } from "@louez/api/services/location-snapshots";
import { reservationCurrency } from "@/lib/reservations/payment-billing-facts";
import { paymentRequestTerms } from "@/lib/reservations/util.payment-request";
import { getRentalRemaining } from "@/lib/reservations/util.rental-amount";
import {
  compareReservationDemand,
  fingerprintReservationEdit,
} from "@louez/api/services/util.reservation-edit";
import { getRentalPaid } from "@/lib/reservations/util.payment-status";
import {
  isSmsConfigured,
  sendAccessLinkSms,
  sendDepositAuthorizationRequestSms,
  sendPaymentRequestSms,
} from "@/lib/sms";
import { getCurrentStore } from "@/lib/store-context";
import { createReservationInstantAccessUrl } from "@/lib/reservations/instant-access";
import { sendReservationModificationEmailForStore } from "@/lib/reservations/modification-email";
import { getStorefrontUrl } from "@/lib/storefront-url";
import { tryGenerateInvoiceForPayment } from "@/lib/invoicing/service";
import { trySendInitialInvoicePaymentConfirmation } from "@/lib/invoicing/delivery";
// ============================================================================
// Deposit Authorization Hold (Empreinte Bancaire)
// ============================================================================

import { getPaymentMethodDetails } from "@/lib/stripe";
import { calculateTotalDeliveryFee, validateDelivery } from "@/lib/utils/geo";
import { evaluateReservationRules, minorUnitsPerUnit, roundToMinorUnit } from "@louez/utils";
import {
  paymentAmount,
  recordedPaymentAmount,
  type RecordedAmountVerdict,
} from "@louez/api/services/payment-amount";
import { recordDepositReturn, recordPaymentRefund } from "@louez/api/services/payment-records";
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
  /**
   * The total the form showed. Compared under the locks with the total about
   * to be written; a difference refuses the creation as changed meanwhile.
   */
  expectedTotal?: number;
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

/**
 * The verdicts a creation or an edit records with its write
 * (services/capacity-verdict.ts). Its capacity verdict, which the inbox
 * reads, is built from what the stock itself lacks, counted without the
 * turnover buffer: a line short only with the buffer is never an
 * overbooking. Such lines that a flag of the write let through are recorded
 * apart, with the buffer they were checked with and the session's
 * credential, as the store's confirmation records them.
 */
function stockVerdictMetadata(
  bookedOver: readonly CapacityShortfall[],
  pastBuffer: readonly CapacityShortfall[],
  turnoverBufferMinutes: number,
) {
  return {
    ...capacityVerdictMetadata(bookedOver),
    ...(pastBuffer.length > 0
      ? {
          ...turnoverBufferVerdictMetadata(pastBuffer, turnoverBufferMinutes),
          // The dashboard's writes come with the user's session.
          credential: { kind: "session" as const, id: null },
        }
      : {}),
  };
}

export async function createManualReservation(data: CreateReservationData) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: "errors.unauthorized" };
  }
  // Frozen at creation: the store can change its currency later (billing contract Q4).
  // Every line's amount is rounded in its minor unit, as the form rounds it.
  const currency = reservationCurrency(null, store.settings);

  // A booking created as confirmed asks the card gate (README §8.4) before it writes a
  // new customer or calls the routing API. insertReservation asks again under the
  // transaction, and that answer is the one that counts.
  if (!data.sendAsQuote && !(await checkReservationGate(store.id, "dashboard")).accepts) {
    return { error: STORE_NOT_ACCEPTING_RESERVATIONS_ERROR };
  }

  let customerId = data.customerId;
  // A new customer is written in the creation's transaction, after the
  // product locks (store, products, customer, reservation rows): a refused
  // creation leaves nothing behind. Until then it is the row it will be.
  let pendingCustomer: typeof customers.$inferInsert | null = null;
  let customer: CreationCustomer | undefined;

  if (!customerId && data.newCustomer) {
    const existingCustomer = await db.query.customers.findFirst({
      where: and(eq(customers.storeId, store.id), eq(customers.email, data.newCustomer.email)),
    });

    if (existingCustomer) {
      customerId = existingCustomer.id;
    } else {
      customerId = nanoid();
      pendingCustomer = {
        id: customerId,
        storeId: store.id,
        email: data.newCustomer.email,
        firstName: data.newCustomer.firstName,
        lastName: data.newCustomer.lastName,
        phone: data.newCustomer.phone || null,
        createdVia: "dashboard",
      };
      // The columns' own defaults, as the row will hold them.
      customer = {
        id: customerId,
        email: pendingCustomer.email,
        firstName: pendingCustomer.firstName,
        lastName: pendingCustomer.lastName,
        phone: pendingCustomer.phone ?? null,
        customerType: "individual",
        companyName: null,
        companyNumber: null,
        companyNumberScheme: null,
        vatNumber: null,
        address: null,
        city: null,
        postalCode: null,
        country: "FR",
      };
    }
  }

  if (!customerId) {
    return { error: "errors.customerRequired" };
  }

  customer ??= await db.query.customers.findFirst({
    where: and(eq(customers.id, customerId), eq(customers.storeId, store.id)),
  });

  if (!customer) {
    return { error: "errors.customerNotFound" };
  }
  // The customer booked: a new one's id, or the one with its email written meanwhile.
  let bookedCustomerId: string = customerId;

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
        unitPrice: roundToMinorUnit(effectiveUnitPrice, currency).toFixed(2),
        depositPerUnit: product.deposit || "0",
        totalPrice: roundToMinorUnit(effectiveSubtotal, currency).toFixed(2),
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
      unitPrice: roundToMinorUnit(item.unitPrice, currency).toFixed(2),
      depositPerUnit: item.deposit.toFixed(2),
      totalPrice: roundToMinorUnit(totalPrice, currency).toFixed(2),
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
  }

  // Generate reservation number
  const reservationNumber = await generateReservationNumber(store.id);

  if (
    data.depositOverride != null &&
    Number.isFinite(data.depositOverride) &&
    data.depositOverride >= 0
  ) {
    depositAmount = data.depositOverride;
  }

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

    // Priced under the locks (slice 10): a line priced from its product is
    // priced from the catalogue the locks hold, and that is what is written.
    // A price typed by hand stands as typed.
    const lockedCatalog = await loadPricingCatalog(tx, {
      storeId: store.id,
      productIds: lines.map(({ detail }) => detail.product.id),
      timezone: availabilityRules?.settings?.timezone,
      includeInactive: true,
    });
    const lockedLines: Array<{ unitPrice: string; totalPrice: string }> = [];
    for (const { detail } of lines) {
      if (detail.pricingBreakdown.isManualOverride) {
        lockedLines.push({ unitPrice: detail.unitPrice, totalPrice: detail.totalPrice });
        continue;
      }
      const lockedProduct = lockedCatalog.get(detail.product.id);
      if (!lockedProduct) {
        return { ok: false as const, error: "errors.productNotFound", shortfalls: [] };
      }
      const priced = priceRegularCatalogLine(lockedProduct, {
        productId: lockedProduct.id,
        quantity: detail.quantity,
        startDate: data.startDate.toISOString(),
        endDate: data.endDate.toISOString(),
      });
      lockedLines.push({
        unitPrice: roundToMinorUnit(priced.unitPrice, currency).toFixed(2),
        totalPrice: roundToMinorUnit(priced.subtotal, currency).toFixed(2),
      });
    }
    const lockedSubtotal =
      lockedLines.reduce((sum, line) => sum + Number(line.totalPrice), 0) +
      customItemDetails.reduce((sum, customItem) => sum + Number(customItem.totalPrice), 0) +
      tulipInsuranceAmount;
    const discountUnderLocks = Math.min(Math.max(data.discountAmount ?? 0, 0), lockedSubtotal);
    // The delivery fee, from the routes measured above and the delivery
    // settings the store holds now.
    const lockedDelivery = availabilityRules?.settings?.delivery;
    const deliveryFeeUnderLocks = !hasAnyDelivery
      ? 0
      : !lockedDelivery?.enabled || lockedDelivery.mode === "included"
        ? 0
        : calculateTotalDeliveryFee(
            deliveryDistanceKm,
            returnDistanceKm,
            lockedDelivery,
            lockedSubtotal,
          ).totalFee;

    // The totals: the tax engine over the lines as priced here, the
    // insurance (exempt), the delivery fee and the discount, as the checkout
    // computes them, with the store's tax settings read here (slice 10, M1).
    const taxSettings = availabilityRules?.settings?.tax;
    const taxedLines = [
      ...lines.map(({ detail }, index) => ({
        subtotal: Number(lockedLines[index]!.totalPrice),
        unitPrice: Number(lockedLines[index]!.unitPrice),
        taxSettings: lockedProductsById.get(detail.product.id)?.taxSettings ?? null,
      })),
      ...customItemDetails.map((customItem) => ({
        subtotal: Number(customItem.totalPrice),
        unitPrice: Number(customItem.unitPrice),
        taxSettings: null,
      })),
    ];
    const totals = computeReservationTotals({
      lines: taxedLines,
      insuranceAmount: tulipInsuranceAmount,
      discountAmount: discountUnderLocks,
      deliveryFee: deliveryFeeUnderLocks,
      totalDeposit: depositAmount,
      taxSettings,
      currency,
    });
    // What the person confirmed is what is written: the total the form
    // showed, compared to the minor unit with the total about to be
    // inserted, its delivery fee and insurance included. A difference
    // refuses the creation, and the form reads what it prices from again.
    if (data.expectedTotal !== undefined) {
      const perUnit = minorUnitsPerUnit(currency);
      if (Math.round(totals.total * perUnit) !== Math.round(data.expectedTotal * perUnit)) {
        return { ok: false as const, error: "errors.reservationChangedMeanwhile", shortfalls: [] };
      }
    }

    // The stock rule every booking is checked against. Each shortfall is
    // listed, for the store to book over on purpose. Consumables are checked
    // here against what other bookings hold, and again when they are taken.
    const turnoverBufferMinutes = availabilityRules?.settings?.turnoverBufferMinutes ?? 0;
    const checkStock = (bufferMinutes: number) =>
      reserveInventory({
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
        turnoverBufferMinutes: bufferMinutes,
        // A booking the team types does not ask for the required accessories.
        skipRequiredAccessoryCheck: true,
        onShortfall: "collect",
      });
    const inventory = await checkStock(turnoverBufferMinutes);
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
    // What the override let through, told apart: only what the stock itself
    // lacks is an overbooking; a line short only with the buffer is recorded
    // as passed past it. The check without the buffer runs only when the
    // buffered one was short.
    const split = await splitShortfallsByTurnoverBuffer(checkStock, turnoverBufferMinutes, {
      withBuffer: true,
      check: inventory,
    });
    if (!split.ok) {
      return { ok: false as const, error: split.error, shortfalls: [] };
    }

    const lineTaxValues = (index: number) =>
      reservationItemTaxValues({
        ...getReservationItemTaxFields(totals, taxedLines[index]!, index),
        taxExempt: false,
      });
    const insuranceTax = totals.taxEnabled
      ? totals.taxByLineId.get(INSURANCE_TAX_LINE_ID)
      : undefined;

    // The new customer, once nothing refuses the creation any more, after the
    // products and before the reservation's rows: a refused creation writes
    // nothing. One with this email created meanwhile is the one booked.
    if (pendingCustomer) {
      const [sameEmail] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.storeId, store.id), eq(customers.email, pendingCustomer.email)))
        .for("update");
      if (sameEmail) bookedCustomerId = sameEmail.id;
      else await tx.insert(customers).values(pendingCustomer);
    }

    const { effects, lock } = await insertReservation(tx, {
      id: reservationId,
      storeId: store.id,
      customerId: bookedCustomerId,
      number: reservationNumber,
      status: reservationStatus,
      // Frozen at creation: the store can change its currency later (billing contract Q4).
      currency,
      startDate: data.startDate,
      endDate: data.endDate,
      subtotalAmount: totals.subtotal.toFixed(2),
      depositAmount: depositAmount.toFixed(2),
      totalAmount: totals.total.toFixed(2),
      subtotalExclTax: totals.subtotalExclTax?.toFixed(2) ?? null,
      taxAmount: totals.taxAmount?.toFixed(2) ?? null,
      taxRate: totals.taxRate?.toFixed(2) ?? null,
      discountAmount: discountUnderLocks.toFixed(2),
      // The mode its totals were computed in (slice 9).
      taxDisplayMode: totals.displayMode,
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
      deliveryFee: deliveryFeeUnderLocks.toFixed(2),
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
    for (const [lineIndex, { detail, choice }] of lines.entries()) {
      await tx.insert(reservationItems).values({
        reservationId,
        productId: detail.product.id,
        isCustomItem: false,
        quantity: detail.quantity,
        unitPrice: lockedLines[lineIndex]!.unitPrice,
        depositPerUnit: detail.depositPerUnit,
        totalPrice: lockedLines[lineIndex]!.totalPrice,
        pricingBreakdown: detail.pricingBreakdown,
        ...lineTaxValues(lineIndex),
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
    for (const [customIndex, customItem] of customItemDetails.entries()) {
      await tx.insert(reservationItems).values({
        reservationId,
        productId: null,
        isCustomItem: true,
        quantity: customItem.quantity,
        unitPrice: customItem.unitPrice,
        depositPerUnit: customItem.depositPerUnit,
        totalPrice: customItem.totalPrice,
        pricingBreakdown: customItem.pricingBreakdown,
        ...lineTaxValues(lines.length + customIndex),
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
        // Insurance carries no VAT, whatever the store's settings.
        ...reservationItemTaxValues({
          taxRate: null,
          taxAmount: insuranceTax?.taxAmount ?? null,
          priceExclTax: insuranceTax?.amountExclTax ?? null,
          totalExclTax: insuranceTax?.amountExclTax ?? null,
          taxExempt: true,
        }),
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
        // Every line short only with the buffer was let through by the override.
        ...stockVerdictMetadata(
          split.capacity.map((line) => line.shortfall),
          split.bufferOnly.map((line) => line.shortfall),
          turnoverBufferMinutes,
        ),
        ...(tulipQuoteError && { tulipQuoteError }),
      },
    });

    if (!data.sendAsQuote) {
      // Consumable stock is physical: the override never takes it below zero.
      await consumeReservationStock(tx, lock);
      await validateReservationContract(tx, reservationId, store.id, "confirmation");
    }

    return {
      ok: true as const,
      effects,
      totalAmount: totals.total,
      subtotalAmount: totals.subtotal,
      discountAmount: discountUnderLocks,
      deliveryFee: deliveryFeeUnderLocks,
    };
  }).catch(refuseCreation);

  if (!reservationWriteResult.ok) {
    return {
      error: reservationWriteResult.error,
      shortfalls: reservationWriteResult.shortfalls,
    };
  }
  // The total the tax engine gave, as written.
  const { totalAmount } = reservationWriteResult;

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
      customer_id: bookedCustomerId,
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
      subtotal_amount_cents: toAnalyticsAmountCents(reservationWriteResult.subtotalAmount),
      discount_amount_cents: toAnalyticsAmountCents(reservationWriteResult.discountAmount),
      delivery_fee_cents: toAnalyticsAmountCents(reservationWriteResult.deliveryFee),
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
          subtotalAmount: reservationWriteResult.subtotalAmount,
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
              subtotalAmount: reservationWriteResult.subtotalAmount,
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

type ReservationItemTaxValues = Pick<
  ReservationItemInsertValues,
  "taxRate" | "taxAmount" | "priceExclTax" | "totalExclTax" | "taxExempt"
>;

/** A line's tax figures as its row stores them. */
const reservationItemTaxValues = (
  tax: ReservationItemTaxFields & { taxExempt: boolean },
): ReservationItemTaxValues => ({
  taxRate: tax.taxRate?.toFixed(2) ?? null,
  taxAmount: tax.taxAmount?.toFixed(2) ?? null,
  priceExclTax: tax.priceExclTax?.toFixed(2) ?? null,
  totalExclTax: tax.totalExclTax?.toFixed(2) ?? null,
  taxExempt: tax.taxExempt,
});

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

/** An amount written with its currency's precision: "150" for the yen, "150.00" for the euro. */
const amountInCurrency = (amount: number, currency: string) =>
  amount.toFixed(minorUnitsPerUnit(currency) === 1 ? 0 : 2);

/** An amount in cents, to compare two amounts written differently ("20" and "20.00"). */
const toCents = (value: string | number | null | undefined) =>
  Math.round(Number(value ?? 0) * 100);

/** The delivery legs as a reservation stores them: what an edit compares to know they changed. */
const DELIVERY_LEG_FIELDS = [
  "outboundMethod",
  "returnMethod",
  "pickupLocationId",
  "returnLocationId",
  "deliveryAddress",
  "deliveryCity",
  "deliveryPostalCode",
  "deliveryCountry",
  "deliveryLatitude",
  "deliveryLongitude",
  "returnAddress",
  "returnCity",
  "returnPostalCode",
  "returnCountry",
  "returnLatitude",
  "returnLongitude",
] as const satisfies ReadonlyArray<keyof ReservationDeliveryUpdateValues>;

/** A leg's value, the same however it was written: a coordinate's trailing zeros, an empty text. */
const normalizeLegValue = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") return null;
  const asNumber = typeof value === "string" ? Number(value) : value;
  return typeof asNumber === "number" && Number.isFinite(asNumber)
    ? String(asNumber)
    : String(value);
};

/** The customer a creation books: the row, or the one it is about to write. */
type CreationCustomer = Pick<
  typeof customers.$inferSelect,
  | "id"
  | "email"
  | "firstName"
  | "lastName"
  | "phone"
  | "customerType"
  | "companyName"
  | "companyNumber"
  | "companyNumberScheme"
  | "vatNumber"
  | "address"
  | "city"
  | "postalCode"
  | "country"
>;

/** What the insurer is told of the renter: the reservation's billing identity and the customer's contact. */
function insurerCustomerOf(
  reservation: Parameters<typeof resolveReservationBilling>[0],
  customer: typeof customers.$inferSelect,
) {
  return {
    ...resolveReservationBilling(reservation, customer),
    firstName: customer.firstName,
    lastName: customer.lastName,
    email: customer.email,
    phone: customer.phone || "",
    address: customer.address || "",
    city: customer.city || "",
    postalCode: customer.postalCode || "",
    country: customer.country,
  };
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

  // Only a pending, quote, confirmed or ongoing reservation is edited (T3);
  // read again under the lock. The page opens no other, so a refusal here
  // means the status changed while the form was open: the API's
  // RESERVATION_NOT_EDITABLE says the same.
  if (!isReservationEditable(reservation.status)) {
    return { error: "errors.reservationStatusChanged" };
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
  // A real window (T5): the end after the start, so never of no length. The
  // start of an ongoing reservation may still move here, unlike the API's
  // date change: the store corrects the pickup time it recorded.
  if (newEndDate.getTime() <= newStartDate.getTime()) {
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

  // Every line the edit leaves, but the insurance, as it prices it by today's
  // rules; the tax engine totals them under the locks (slice 10).
  const editedLines: Array<Omit<EditedLine, "taxExempt"> & { id: string }> = [];
  let linesChanged = false;
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
  // What the insurer was told of the renter, and where the routes start from.
  let quotedCustomer: ReturnType<typeof insurerCustomerOf> | null = null;
  let routedFromStore: { latitude: string | null; longitude: string | null } | null = null;
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
    if (removedReservationItemIds.length > 0) linesChanged = true;

    // Insert new items
    for (const item of reservationItemsWithoutLegacyInsurance) {
      let pricingBreakdown: PricingBreakdown | null = null;
      let finalUnitPrice = item.unitPrice;
      let itemPricingMode: PricingMode = toPricingMode(item.pricingMode);
      let duration = calculateDuration(newStartDate, newEndDate, itemPricingMode);
      let totalPrice = item.unitPrice * duration * item.quantity;
      let manualPricingKind: PricingKind = "duration";
      let pricedFromProductId: string | null = null;

      if (item.isManualPrice && item.productId) {
        const manualPriceProduct = await db.query.products.findFirst({
          where: and(eq(products.id, item.productId), eq(products.storeId, store.id)),
          columns: { pricingKind: true },
        });
        // The product may have been deleted since the reservation was created;
        // the stored breakdown keeps the kind so the manual price stays editable.
        const existingBreakdown = item.id
          ? pricingBasisOf(existingItemsById.get(item.id)?.pricingBreakdown)
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
          pricedFromProductId = product.id;
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

      // A line changes what prices the reservation when it is new, or its
      // quantity, deposit or price typed by hand is not the one stored.
      const storedLine = item.id ? existingItemsById.get(item.id) : undefined;
      const typedPrice = Boolean(item.isManualPrice) || !item.productId;
      if (
        !storedLine ||
        storedLine.quantity !== item.quantity ||
        toCents(storedLine.depositPerUnit) !== toCents(item.depositPerUnit) ||
        (pricingBasisOf(storedLine.pricingBreakdown)?.isManualOverride === true) !==
          Boolean(item.isManualPrice) ||
        (typedPrice && toCents(storedLine.totalPrice) !== toCents(totalPrice))
      ) {
        linesChanged = true;
      }
      // A new line's id is drawn now: its tax figures are merged into its insert under the locks.
      const lineId = item.id ?? nanoid();
      editedLines.push({
        id: lineId,
        pricedFromProductId,
        productId: item.productId || null,
        quantity: item.quantity,
        subtotal: Number(totalPrice.toFixed(2)),
        unitPrice: Number(finalUnitPrice.toFixed(2)),
      });
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
            id: lineId,
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
      // A breakdown written only to record facts is read as none, as before (slice 9).
      const pricingBreakdown = pricingBasisOf(item.pricingBreakdown);
      const isManualPrice = pricingBreakdown?.isManualOverride === true;

      let totalPrice: number;
      let finalUnitPrice = parseFloat(item.unitPrice);
      let pricedFromProductId: string | null = null;

      if (!isManualPrice && item.productId) {
        // Recalculate with tiers
        const product = await db.query.products.findFirst({
          where: eq(products.id, item.productId),
          with: { pricingTiers: true },
        });

        if (product) {
          pricedFromProductId = product.id;
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
        const nextPricingBreakdown = pricingBreakdown
          ? {
              ...pricingBreakdown,
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

      editedLines.push({
        id: item.id,
        pricedFromProductId,
        productId: item.productId,
        quantity: item.quantity,
        subtotal: Number(totalPrice.toFixed(2)),
        unitPrice: Number(finalUnitPrice.toFixed(2)),
      });
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
        quotedCustomer = insurerCustomerOf(reservation, reservation.customer);
        const quote = await previewTulipQuoteForCheckout({
          storeId: store.id,
          customer: quotedCustomer,
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

  // Process delivery changes. The fee is the stored one, or the new
  // delivery's, computed under the locks from the routes measured here and
  // the store's settings read there.
  let deliveryFeeUnderLocks: EditPricingInput["deliveryFee"] = parseFloat(
    reservation.deliveryFee || "0",
  );
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

    const outDist = deliveryUpdateFields.deliveryDistanceKm
      ? parseFloat(deliveryUpdateFields.deliveryDistanceKm)
      : null;
    const retDist = deliveryUpdateFields.returnDistanceKm
      ? parseFloat(deliveryUpdateFields.returnDistanceKm)
      : null;
    deliveryFeeUnderLocks = (subtotal, settings) => {
      const lockedDelivery = (settings as Record<string, unknown> | null)?.delivery as
        | DeliverySettings
        | undefined;
      if (!lockedDelivery?.enabled || lockedDelivery.mode === "included") return 0;
      return calculateTotalDeliveryFee(
        outDist,
        retDist,
        lockedDelivery as Parameters<typeof calculateTotalDeliveryFee>[2],
        subtotal,
      ).totalFee;
    };
    // The routes were measured from the store's position: it is read again under the locks.
    if (data.delivery.outbound.method === "address" || data.delivery.return.method === "address") {
      routedFromStore = { latitude: store.latitude ?? null, longitude: store.longitude ?? null };
    }

    // Update legacy field for backward compatibility
    const hasAddressLeg =
      data.delivery.outbound.method === "address" || data.delivery.return.method === "address";
    deliveryUpdateFields.deliveryOption = hasAddressLeg ? "delivery" : "pickup";
  }

  const existingDiscount = parseFloat(reservation.discountAmount || "0");
  const dateChanged =
    newStartDate.getTime() !== reservation.startDate.getTime() ||
    newEndDate.getTime() !== reservation.endDate.getTime();
  // What prices a reservation (slice 10): its window, its lines (a line added
  // or removed, a quantity, a deposit, a price typed by hand), its delivery
  // legs and the insurance the store asks for; its discount the edit does not
  // change. An edit that changes none of it changes no amount: every monetary
  // column stays as stored, and nothing is recorded again.
  const deliveryChanged =
    data.delivery !== undefined &&
    DELIVERY_LEG_FIELDS.some(
      (field) =>
        normalizeLegValue(deliveryUpdateFields[field]) !== normalizeLegValue(reservation[field]),
    );
  const pricingChanged =
    dateChanged ||
    linesChanged ||
    deliveryChanged ||
    // An old row may hold no opt-in at all: none asked.
    requestedTulipInsuranceOptIn !== Boolean(reservation.tulipInsuranceOptIn);
  if (!pricingChanged) {
    itemWrites.length = 0;
    insuranceItemWrites.length = 0;
    extraInsuranceItemIdsToDelete = [];
    for (const field of Object.keys(deliveryUpdateFields)) {
      delete deliveryUpdateFields[field as keyof ReservationDeliveryUpdateValues];
    }
  }
  // What the insurer's quote and the routes were computed from, outside the
  // transaction: compared again under the locks.
  const outsideBasis = JSON.stringify({ quotedCustomer, routedFromStore });
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
            customerId: reservations.customerId,
            billingSnapshot: reservations.billingSnapshot,
            taxDisplayMode: reservations.taxDisplayMode,
            taxAmount: reservations.taxAmount,
          })
          .from(reservations)
          .where(and(eq(reservations.id, reservationId), eq(reservations.storeId, store.id)))
          .for("update");

        if (!lockedReservation) {
          return { error: "errors.reservationNotFound" };
        }
        // A completion or a cancellation that landed since the read: refused
        // as such, before the fingerprint would only say "changed".
        if (!isReservationEditable(lockedReservation.status)) {
          return { error: "errors.reservationStatusChanged" };
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
            taxExempt: reservationItems.taxExempt,
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

        // The insurer's quote and the routes were taken outside: what they were
        // computed from must still hold (the renter, the store's position).
        const [lockedStore] = await tx
          .select({ latitude: stores.latitude, longitude: stores.longitude })
          .from(stores)
          .where(eq(stores.id, store.id));
        const [lockedCustomer] =
          quotedCustomer && lockedReservation.customerId
            ? await tx
                .select()
                .from(customers)
                .where(eq(customers.id, lockedReservation.customerId))
            : [];
        const insideBasis = JSON.stringify({
          quotedCustomer:
            quotedCustomer && lockedCustomer
              ? insurerCustomerOf(lockedReservation, lockedCustomer)
              : null,
          routedFromStore: routedFromStore && {
            latitude: lockedStore?.latitude ?? null,
            longitude: lockedStore?.longitude ?? null,
          },
        });
        if (insideBasis !== outsideBasis) {
          return { error: "errors.reservationChangedMeanwhile" };
        }

        // The totals: the tax engine over the lines, under the locks (M1),
        // when the edit changes what prices the reservation.
        const taxExemptById = new Map(lockedItems.map((item) => [item.id, item.taxExempt]));
        const recordedMode = recordedTaxDisplayMode(lockedReservation);
        const priceEditedReservation = async () => {
          const pricing = await priceReservationEdit(tx, {
            storeId: store.id,
            window: { start: newStartDate, end: newEndDate },
            lines: editedLines.map((line) => ({
              ...line,
              taxExempt: taxExemptById.get(line.id) ?? null,
            })),
            insuranceAmount: nextTulipInsuranceAmount ?? 0,
            discountAmount: existingDiscount,
            totalDeposit: newDepositAmount,
            deliveryFee: deliveryFeeUnderLocks,
            recordedTaxDisplayMode: recordedMode === NOT_RECORDED ? null : recordedMode,
            currency: reservationCurrency(reservation.currency, store.settings),
          });
          // A product's prices changed while the store was editing.
          if (!pricing.ok) return { kind: "changed_meanwhile" } as const;
          // Each line's tax figures go with its write, or alone when the line is not rewritten.
          const writesById = new Map(
            itemWrites.map((write) => [write.type === "insert" ? write.values.id : write.id, write]),
          );
          const taxOnlyWrites: Array<{ id: string; values: ReservationItemTaxValues }> = [];
          for (const [index, line] of editedLines.entries()) {
            const values = reservationItemTaxValues(pricing.lines[index]!);
            const write = writesById.get(line.id);
            if (write) Object.assign(write.values, values);
            else taxOnlyWrites.push({ id: line.id, values });
          }
          for (const insuranceItemWrite of insuranceItemWrites) {
            Object.assign(
              insuranceItemWrite.values,
              reservationItemTaxValues({ ...pricing.insurance, taxExempt: true }),
            );
          }
          if (data.delivery) {
            deliveryUpdateFields.deliveryFee = pricing.deliveryFee.toFixed(2);
          }
          return { kind: "priced", ...pricing, taxOnlyWrites } as const;
        };
        const priced = pricingChanged
          ? await priceEditedReservation()
          : ({ kind: "unchanged" } as const);
        if (priced.kind === "changed_meanwhile") {
          return { error: "errors.reservationChangedMeanwhile" };
        }
        const taxOnlyWrites = priced.kind === "priced" ? priced.taxOnlyWrites : [];
        const newTotalAmount =
          priced.kind === "priced" ? priced.totals.total : previousState.totalAmount;
        const difference = Math.round((newTotalAmount - previousState.totalAmount) * 100) / 100;
        // The tax now comes on top of a total that carried none, when three
        // facts hold at once: the row recorded no display mode (the tax
        // engine never totalled it, whatever its tax columns hold); its
        // stored total carried no tax (it is its subtotal, plus delivery,
        // less the discount, to the minor unit); and the engine added tax on
        // top (its tax above zero in a store that prices before tax).
        const perUnit = minorUnitsPerUnit(reservationCurrency(reservation.currency, store.settings));
        const minor = (value: string | null) => Math.round(Number(value ?? 0) * perUnit);
        const storedTotalCarriedNoTax =
          minor(lockedReservation.totalAmount) ===
          minor(lockedReservation.subtotalAmount) +
            minor(lockedReservation.deliveryFee) -
            minor(lockedReservation.discountAmount);
        const taxAdded =
          priced.kind === "priced" &&
          recordedMode === NOT_RECORDED &&
          storedTotalCarriedNoTax &&
          priced.totals.taxEnabled &&
          priced.totals.displayMode === "exclusive" &&
          (priced.totals.taxAmount ?? 0) > 0;

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
        let capacityVerdict: ReturnType<typeof stockVerdictMetadata> | null = null;
        if (holdsStock && demand.changed) {
          const checkStock = (bufferMinutes: number) =>
            reserveInventory({
              tx,
              storeId: store.id,
              lockedProductsById,
              // A line whose product was deleted since has no stock to check.
              lines: finalLines.filter((line) => lockedProductsById.has(line.productId)),
              window: { start: newStartDate, end: newEndDate },
              blockingStatuses,
              turnoverBufferMinutes: bufferMinutes,
              excludeReservationId: reservationId,
              // Consumable stock is reconciled below; like a booking the team
              // creates, an edit does not ask for the required accessories.
              skipConsumableCheck: true,
              skipRequiredAccessoryCheck: true,
              onShortfall: "collect",
            });
          const inventory = await checkStock(overrideTurnoverBuffer ? 0 : turnoverBufferMinutes);
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
          // The verdict, told apart: only what the stock itself lacks is an
          // overbooking. A line short only with the buffer is recorded when a
          // flag let it through, on a product the edit asks more of; one the
          // edit did not raise needed no flag and records nothing. The other
          // run is made only when the first was short, or, sent with
          // `overrideTurnoverBuffer`, to trace what it passed.
          const split = await splitShortfallsByTurnoverBuffer(
            checkStock,
            turnoverBufferMinutes,
            { withBuffer: !overrideTurnoverBuffer, check: inventory },
            demand.raisedProductIds.size > 0,
          );
          if (!split.ok) {
            return { error: split.error };
          }
          capacityVerdict = stockVerdictMetadata(
            split.capacity.map((line) => line.shortfall),
            split.bufferOnly.flatMap((line) =>
              demand.raisedProductIds.has(line.shortfall.productId) ? [line.shortfall] : [],
            ),
            turnoverBufferMinutes,
          );
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

        for (const taxOnlyWrite of taxOnlyWrites) {
          await tx
            .update(reservationItems)
            .set(taxOnlyWrite.values)
            .where(eq(reservationItems.id, taxOnlyWrite.id));
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

        const repriced = priced.kind === "priced" ? priced : null;
        await tx
          .update(reservations)
          .set({
            startDate: newStartDate,
            endDate: newEndDate,
            // An edit that does not reprice writes no monetary column: each key
            // is undefined then, which Drizzle leaves out. A repriced edit
            // writes null where the engine clears a column.
            subtotalAmount: repriced ? repriced.totals.subtotal.toFixed(2) : undefined,
            depositAmount: repriced ? newDepositAmount.toFixed(2) : undefined,
            totalAmount: repriced ? newTotalAmount.toFixed(2) : undefined,
            subtotalExclTax: repriced
              ? (repriced.totals.subtotalExclTax?.toFixed(2) ?? null)
              : undefined,
            taxAmount: repriced ? (repriced.totals.taxAmount?.toFixed(2) ?? null) : undefined,
            taxRate: repriced ? (repriced.totals.taxRate?.toFixed(2) ?? null) : undefined,
            taxDisplayMode: repriced ? repriced.taxDisplayMode : undefined,
            tulipInsuranceOptIn: repriced ? nextTulipInsuranceOptIn : undefined,
            tulipInsuranceAmount: repriced
              ? nextTulipInsuranceAmount && nextTulipInsuranceAmount > 0
                ? nextTulipInsuranceAmount.toFixed(2)
                : null
              : undefined,
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
              subtotalAmount:
                priced.kind === "priced" ? priced.totals.subtotal : previousState.subtotalAmount,
              depositAmount: priced.kind === "priced" ? newDepositAmount : previousState.depositAmount,
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
        return {
          success: true,
          reservationStatus: lockedReservation.status,
          difference,
          newTotalAmount,
          taxAdded,
        };
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

  const reservationCurrencyCode = reservationCurrency(reservation.currency, store.settings);
  const responseWarnings = [
    ...validationWarnings.map((warning) => ({
      code: warning.code,
      key: warning.key,
      params: warning.params,
    })),
    ...tulipWarnings,
    // Repriced, a total stored without its tax now carries it: the store is told.
    ...(transactionResult.taxAdded
      ? [
          {
            key: "errors.editTaxAdded",
            // In the reservation's currency, with its own precision (¥150, €150.00).
            params: {
              previousTotal: amountInCurrency(previousState.totalAmount, reservationCurrencyCode),
              newTotal: amountInCurrency(transactionResult.newTotalAmount, reservationCurrencyCode),
            },
          },
        ]
      : []),
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
      period: { startDate: newStartDate, endDate: newEndDate },
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
    difference: transactionResult.difference,
    newTotal: transactionResult.newTotalAmount,
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

/** An amount as the form sent it: the text typed, which the writes judge as it is. */
type TypedAmount = string;

interface RecordPaymentData {
  type: PaymentType;
  amount: TypedAmount;
  method: PaymentMethod;
  paidAt?: Date;
  notes?: string;
}

interface RefundManualPaymentData {
  paymentId: string;
  amount: TypedAmount;
  method: PaymentMethod;
  notes?: string;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

/**
 * An amount a payment form sent, as typed, judged as the agents' writes judge it
 * (`recordedPaymentAmount`, packages/api services/payment-amount.ts): its
 * text, its sign for its type, and at most the decimals of the reservation's
 * currency, in a currency the money layer carries. Accepted, it is the text
 * the row holds, as `toFixed(2)` wrote it ("1500.00" in yen, "7.50" in euros).
 */
function formAmount(
  amount: TypedAmount,
  type: PaymentType,
  reservation: { currency: string | null },
  storeSettings: Parameters<typeof reservationCurrency>[1],
): RecordedAmountVerdict {
  return recordedPaymentAmount(
    amount,
    type,
    reservationCurrency(reservation.currency, storeSettings),
  );
}

/** The length of a record id's column (`id()`, `@louez/db` schema): none is longer. */
const RECORD_ID_MAX_LENGTH = 21;

/**
 * Whether a call names a record by a string an id can be. An action called
 * directly with anything else (an array, a number, megabytes of text) is
 * refused as a record not found, before any read: never a database error.
 */
function isRecordId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= RECORD_ID_MAX_LENGTH;
}

/** The dashboard's text for an amount `formAmount` refused. */
function formAmountErrorKey(
  refusal: Exclude<RecordedAmountVerdict, { ok: true }>["refusal"],
): string {
  switch (refusal) {
    case "negative_outside_adjustment":
      return "errors.negativeAmountOnlyForAdjustment";
    case "too_precise":
      return "errors.amountTooPrecise";
    case "currency_unsupported":
      return "errors.currencyNotSupportedForPayments";
    case "amount_invalid":
      return "errors.invalidAmount";
  }
}

export async function recordPayment(reservationId: string, data: RecordPaymentData) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: "errors.unauthorized" };
  }
  if (!isRecordId(reservationId)) return { error: "errors.reservationNotFound" };
  // Text only, normalised as the form does it (`typedAmount`): anything
  // else, a number or an array sent to the action directly, is no amount.
  const typed = typedAmount(data.amount);
  if (typed === null) return { error: "errors.invalidAmount" };

  const reservation = await db.query.reservations.findFirst({
    where: and(eq(reservations.id, reservationId), eq(reservations.storeId, store.id)),
    with: {
      payments: true,
    },
  });

  if (!reservation) {
    return { error: "errors.reservationNotFound" };
  }

  // Only an adjustment can be negative; the decimals are the currency's.
  const verdict = formAmount(typed, data.type, reservation, store.settings);
  if (!verdict.ok) return { error: formAmountErrorKey(verdict.refusal) };
  // The amount the row holds, as a number for the checks and the logs below.
  const amount = Number(verdict.amount);

  if (amount > 0 && data.type === "rental") {
    const rentalPaid = getRentalPaid(
      reservation.payments,
      reservationCurrency(reservation.currency, store.settings),
    );
    const rentalRemaining = getRentalRemaining(reservation, rentalPaid);

    if (amount > rentalRemaining) {
      return { error: "errors.invalidAmount" };
    }
  }

  if (amount > 0 && data.type === "deposit") {
    const depositCollected = reservation.payments
      .filter((p) => p.type === "deposit" && p.status === "completed")
      .reduce((sum, p) => sum + parseFloat(p.amount), 0);
    const depositRemaining = roundMoney(
      parseFloat(reservation.depositAmount || "0") - depositCollected,
    );

    if (amount > depositRemaining) {
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
      amount: verdict.amount,
      type: data.type,
      method: data.method,
      origin: "manual",
      paidAt: data.paidAt || new Date(),
      notes: data.notes || null,
    });
    if (data.type === "rental" && amount > 0) {
      await validateReservationContract(tx, reservationId, store.id, "payment");
    }
  });

  let invoiceNumber: string | undefined;
  if (["rental", "damage", "adjustment"].includes(data.type) && amount > 0) {
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
    amount,
    method: data.method,
  });

  // Platform admin notification
  notifyPaymentReceived(
    { id: store.id, name: store.name, slug: store.slug },
    reservation.number,
    amount,
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
      amount_cents: toAnalyticsAmountCents(amount),
    },
  });
  return { success: true, paymentId, invoiceNumber };
}

export async function refundManualPayment(reservationId: string, data: RefundManualPaymentData) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: "errors.unauthorized" };
  }
  if (!isRecordId(reservationId)) return { error: "errors.reservationNotFound" };
  if (!isRecordId(data.paymentId)) return { error: "errors.paymentNotFound" };
  // Text only, normalised as the form does it (`typedAmount`): anything
  // else, a number or an array sent to the action directly, is no amount.
  const typed = typedAmount(data.amount);
  if (typed === null) return { error: "errors.invalidAmount" };

  // The one writer of a refund given by hand, the agents' too: the person
  // clicked, so nothing is asked.
  let refund: Awaited<ReturnType<typeof recordPaymentRefund>>;
  try {
    refund = await recordPaymentRefund(
      {
        storeId: store.id,
        storeSettings: store.settings ?? null,
        port: paymentRefundsPort,
        confirm: async () => null,
        dispatchEffects: dispatchApiEffects,
      },
      {
        reservationId,
        paymentId: data.paymentId,
        // As typed: 19.999 is judged as 19.999, never rounded to 20.00
        // before the writer sees it.
        amount: typed,
        method: data.method,
        notes: data.notes,
      },
      { source: "dashboard_refund_manual_payment" },
    );
  } catch (error) {
    return { error: paymentErrorKey(error) };
  }

  await logReservationActivity(reservationId, "payment_updated", {
    paymentId: data.paymentId,
    refundPaymentId: refund.refundId,
    amount: Number(refund.amount),
    method: data.method,
    action: "refunded",
  });

  revalidatePath("/dashboard/reservations");
  revalidatePath(`/dashboard/reservations/${reservationId}`);

  return {
    success: true,
    refundPaymentId: refund.refundId,
    creditNoteNumber: refund.creditNote.number ?? undefined,
  };
}

export async function deletePayment(paymentId: string) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: "errors.unauthorized" };
  }
  if (!isRecordId(paymentId)) return { error: "errors.paymentNotFound" };

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
  amount: TypedAmount;
  method: PaymentMethod;
  notes?: string;
}

export async function returnDeposit(reservationId: string, data: ReturnDepositData) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: "errors.unauthorized" };
  }
  if (!isRecordId(reservationId)) return { error: "errors.reservationNotFound" };
  // Text only, normalised as the form does it (`typedAmount`): anything
  // else, a number or an array sent to the action directly, is no amount.
  const typed = typedAmount(data.amount);
  if (typed === null) return { error: "errors.invalidAmount" };

  // The one writer of a deposit return, the agents' too: under the
  // reservation's lock, the balance counted there in hundredths. The person
  // clicked, so nothing is asked.
  const paymentId = nanoid();
  let recorded: Awaited<ReturnType<typeof recordDepositReturn>>;
  try {
    recorded = await recordDepositReturn(
      {
        storeId: store.id,
        storeSettings: store.settings ?? null,
        port: {
          ...paymentRecordsPort,
          insert: (tx, payment) =>
            insertRecordedPaymentWithFacts(tx, { ...payment, id: paymentId }),
        },
        confirm: async () => null,
      },
      {
        reservationId,
        amount: typed,
        method: data.method,
        notes: data.notes || undefined,
      },
    );
  } catch (error) {
    return { error: paymentErrorKey(error) };
  }
  // The amount the row holds, as a number for the log and the analytics.
  const amount = Number(paymentAmount(recorded.amount));

  // Log activity
  await logReservationActivity(reservationId, "payment_added", {
    paymentId,
    type: "deposit_return",
    amount,
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
      amount_cents: toAnalyticsAmountCents(amount),
    },
  });
  return { success: true, paymentId };
}

export async function recordDamage(
  reservationId: string,
  data: { amount: TypedAmount; method: PaymentMethod; notes: string },
) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: "errors.unauthorized" };
  }
  if (!isRecordId(reservationId)) return { error: "errors.reservationNotFound" };
  // Text only, normalised as the form does it (`typedAmount`): anything
  // else, a number or an array sent to the action directly, is no amount.
  const typed = typedAmount(data.amount);
  if (typed === null) return { error: "errors.invalidAmount" };

  const reservation = await db.query.reservations.findFirst({
    where: and(eq(reservations.id, reservationId), eq(reservations.storeId, store.id)),
  });

  if (!reservation) {
    return { error: "errors.reservationNotFound" };
  }

  const verdict = formAmount(typed, "damage", reservation, store.settings);
  if (!verdict.ok) {
    // A damage charge is never negative: its amount is simply not valid.
    return {
      error:
        verdict.refusal === "negative_outside_adjustment"
          ? "errors.invalidAmount"
          : formAmountErrorKey(verdict.refusal),
    };
  }
  // The amount the row holds, as a number for the log and the analytics.
  const amount = Number(verdict.amount);

  const paymentId = nanoid();
  await db.transaction((tx) =>
    insertRecordedPayment(tx, {
      id: paymentId,
      reservationId,
      storeId: store.id,
      storeSettings: store.settings,
      amount: verdict.amount,
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
    amount,
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
      amount_cents: toAnalyticsAmountCents(amount),
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
  if (!isRecordId(reservationId)) return { error: "errors.reservationNotFound" };

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
  data: { amount: TypedAmount; reason: string },
) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: "errors.noStripeAccount" };
  }
  if (!isRecordId(reservationId)) return { error: "errors.reservationNotFound" };
  // Text only, normalised as the form does it (`typedAmount`); judged with the
  // hold's currency before Stripe is asked anything.
  const typed = typedAmount(data.amount);
  if (typed === null) return { error: "errors.invalidAmount" };

  const result = await captureReferencedDepositHold(
    {
      reservationId,
      storeId: store.id,
      fallbackAccountId: store.stripeAccountId,
      storeSettings: store.settings,
      actorUserId: await getActorUserId(),
      amount: typed,
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
    properties: { amount_cents: toAnalyticsAmountCents(Number(typed)) },
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
  if (!isRecordId(reservationId)) return { error: "errors.reservationNotFound" };

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
    /** The dates the change set; by default the reservation's now. */
    period?: { startDate: Date; endDate: Date };
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

  const sent = await sendReservationModificationEmailForStore({
    store,
    reservationId,
    previousPeriod: data?.previousPeriod,
    period: data?.period,
    userId: await getActorUserId(),
  });
  if (sent.status === "not_found") {
    return { error: "errors.reservationNotFound" };
  }

  revalidatePath(`/dashboard/reservations/${reservationId}`);
  if (sent.status === "failed") {
    console.error("Failed to send reservation modification email:", sent.error);
    return { error: "errors.emailSendFailed" };
  }
  await captureReservationActionSucceeded({
    distinctId: store.userId,
    storeId: store.id,
    reservationId,
    action: reservationAnalyticsActions.sendEmail,
    properties: { template_id: "reservation_modified", channel: "email" },
  });
  return { success: true };
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
  /** A custom request's amount, as typed: required for the `custom` type. */
  amount?: TypedAmount;
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
    if (!isRecordId(reservationId)) return { error: "errors.reservationNotFound" };

    // A custom amount is text, normalised as the form does it (`typedAmount`),
    // and judged as typed with the reservation's currency below: anything
    // else is no amount, and nothing is created or sent.
    const typedCustom = data.type === "custom" ? typedAmount(data.amount) : undefined;
    if (typedCustom === null) return { error: "errors.invalidAmount" };

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
      customAmount: typedCustom,
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

    const assignUnits = async (tx: Transaction, owner: ReservationTransaction) => {
      // Locks come first, in the lock order of every reservation writer: the
      // reservation's products by id, then the reservation, then the units by
      // id. The owner entry runs READ COMMITTED, so every validation below,
      // under these locks, reads the latest commit.
      await lockReservationInTransaction(owner, {
        reservationId: item.reservationId,
        storeId: store.id,
      });
      const [lockedReservation] = await tx
        .select({ id: reservations.id })
        .from(reservations)
        .where(and(eq(reservations.id, item.reservationId), eq(reservations.storeId, store.id)));

      if (!lockedReservation) {
        return { error: "errors.notFound" };
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

      // A line of the reservation found under its lock: its product is one the
      // lock above holds already.
      const lockedProductsById = currentItem.productId
        ? await lockReservationProducts(tx, store.id, [currentItem.productId])
        : new Map();

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
    const assignmentResult = await runReservationTransaction(assignUnits, {
      reservationId: item.reservationId,
    });

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
