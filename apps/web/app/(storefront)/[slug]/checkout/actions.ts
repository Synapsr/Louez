'use server';

import { and, eq, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import {
  computeReservedNetOfExcludedUnits,
  getRouteDistance,
  loadExcludedUnitInfo,
} from '@louez/api/services';
import { db } from '@louez/db';
import {
  buildReservationOverlapPredicate,
  buildUnitRentableDuringPredicate,
  customers,
  getBlockingReservationStatuses,
  payments,
  productSeasonalPricing,
  productSeasonalPricingTiers,
  productUnits,
  products,
  promoCodes,
  reservationActivity,
  reservationItems,
  reservations,
  storeMembers,
  stores,
  users,
} from '@louez/db';
import type {
  BookingAttributeAxis,
  ProductSnapshot,
  PromoCodeSnapshot,
  UnitAttributes,
} from '@louez/types';
import type {
  ProductTaxSettings,
  StoreSettings,
  TaxSettings,
  TulipPublicMode,
} from '@louez/types';
import type { Rate } from '@louez/types';
import {
  calculateTaxFromExclusive,
  extractExclusiveFromInclusive,
  getEffectiveTaxRate,
} from '@louez/utils';
import {
  DEFAULT_COMBINATION_KEY,
  calculateDuration as calcDuration,
  calculateSeasonalAwarePrice,
  getDeterministicCombinationSortValue,
  getProductCombinationAvailabilityKey,
  matchesSelectedAttributes,
} from '@louez/utils';
import type { SeasonalPricingConfig } from '@louez/utils';
import type { PricingMode } from '@louez/utils';

import { notifyNewReservation } from '@/lib/discord/platform-notifications';
import { getLocaleFromCountry } from '@/lib/email/i18n';
import { sendNewRequestLandlordEmail } from '@/lib/email/send';
import { markReservationForCalendarSync } from '@/lib/integrations/calendar/sync';
import {
  getTulipCoverageSummary,
  previewTulipQuoteForCheckout,
} from '@/lib/integrations/tulip/contracts';
import { resolveTulipIntegrationForStore } from '@/lib/integrations/tulip/state';
import { dispatchCustomerNotification } from '@/lib/notifications/customer-dispatcher';
import { dispatchNotification } from '@/lib/notifications/dispatcher';
import {
  buildFeeMetadata,
  getStoreBilling,
  planStripeFees,
} from '@/lib/pay-as-you-go';
import {
  captureProductServerEvent,
  toAnalyticsAmountCents,
} from '@/lib/product-analytics/analytics';
import { productAnalyticsEvents } from '@/lib/product-analytics/analytics-events';
import { resolveReservationLocationSnapshot } from '@/lib/reservations/location-snapshots';
import { normalizePhoneNumber } from '@/lib/sms/phone';
import { createCheckoutSession, toStripeCents } from '@/lib/stripe';
import { validateRentalPeriod } from '@/lib/utils/business-hours';
import { getMinStartDateTime } from '@/lib/utils/duration';
import {
  calculateTotalDeliveryFee,
  isDeliveryOrderAmountEligible,
  validateDelivery,
} from '@/lib/utils/geo';
import {
  formatDurationFromMinutes,
  getMaxRentalMinutes,
  getMinRentalMinutes,
  validateMaxRentalDurationMinutes,
  validateMinRentalDurationMinutes,
} from '@/lib/utils/rental-duration';

import { env } from '@/env';

interface ReservationItem {
  lineId?: string;
  productId: string;
  selectedAttributes?: UnitAttributes;
  resolvedCombinationKey?: string;
  resolvedAttributes?: UnitAttributes;
  quantity: number;
  startDate: string;
  endDate: string;
  unitPrice: number;
  depositPerUnit: number;
  productSnapshot: ProductSnapshot;
}

interface DeliveryLegInput {
  method: 'store' | 'address';
  locationId?: string | null;
  address?: string;
  city?: string;
  postalCode?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
}

interface DeliveryInput {
  outbound: DeliveryLegInput;
  return: DeliveryLegInput;
}

interface CreateReservationInput {
  storeId: string;
  customer: {
    email: string;
    firstName: string;
    lastName: string;
    phone?: string;
    customerType?: 'individual' | 'business';
    companyName?: string;
    address?: string;
    city?: string;
    postalCode?: string;
  };
  items: ReservationItem[];
  customerNotes?: string;
  subtotalAmount: number;
  depositAmount: number;
  totalAmount: number;
  tulipInsuranceOptIn?: boolean;
  locale?: 'fr' | 'en';
  delivery?: DeliveryInput;
  promoCode?: string;
}

function getErrorKey(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.startsWith('errors.')) {
    return error.message;
  }

  return fallback;
}

async function queueReservationCalendarSync(
  storeId: string,
  reservationId: string,
) {
  try {
    await markReservationForCalendarSync(storeId, reservationId);
  } catch (error) {
    console.error('[calendar] Failed to enqueue reservation sync:', {
      storeId,
      reservationId,
      error,
    });
  }
}

async function generateUniqueReservationNumber(
  storeId: string,
  maxRetries = 5,
): Promise<string> {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const prefix = `R${year}${month}-`;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Use crypto for better randomness
    const randomBytes = new Uint32Array(1);
    crypto.getRandomValues(randomBytes);
    const random = (randomBytes[0] % 10000).toString().padStart(4, '0');
    const number = `${prefix}${random}`;

    // Check if this number already exists for this store
    const existing = await db.query.reservations.findFirst({
      where: and(
        eq(reservations.storeId, storeId),
        eq(reservations.number, number),
      ),
    });

    if (!existing) {
      return number;
    }
  }

  // If all retries failed, use timestamp + nanoid for guaranteed uniqueness
  const fallbackRandom = nanoid(6).toUpperCase();
  return `${prefix}${fallbackRandom}`;
}

function getReservationItemResolutionKey(
  item: ReservationItem,
  index: number,
): string {
  return item.lineId || `${item.productId}:${index}`;
}

function toResolvedAttributes(
  selected: UnitAttributes | undefined,
  resolved: UnitAttributes,
): UnitAttributes {
  return {
    ...(selected || {}),
    ...resolved,
  };
}

type CheckoutTulipQuoteInput = {
  storeId: string;
  modeOverride?: TulipPublicMode;
  customer: {
    customerType?: 'individual' | 'business';
    companyName?: string;
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    address?: string;
    city?: string;
    postalCode?: string;
  };
  items: Array<{ productId: string; quantity: number }>;
  startDate: Date;
  endDate: Date;
  tulipInsuranceOptIn?: boolean;
  fallbackCountry: string;
};

type CheckoutTulipQuoteResult = {
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

async function getCheckoutTulipMode(
  storeId: string,
  modeOverride?: TulipPublicMode,
): Promise<{
  mode: TulipPublicMode;
  connected: boolean;
}> {
  const tulipSettings = (await resolveTulipIntegrationForStore(storeId))
    .settings;
  const connected = tulipSettings.enabled;
  return {
    mode: connected ? (modeOverride ?? tulipSettings.publicMode) : 'no_public',
    connected,
  };
}

async function resolveCheckoutTulipQuote(
  input: CheckoutTulipQuoteInput,
): Promise<CheckoutTulipQuoteResult> {
  const modeInfo = await getCheckoutTulipMode(
    input.storeId,
    input.modeOverride,
  );
  const requestedOptIn =
    modeInfo.mode === 'required'
      ? true
      : modeInfo.mode === 'optional'
        ? input.tulipInsuranceOptIn !== false
        : false;

  if (modeInfo.mode === 'no_public') {
    return {
      mode: modeInfo.mode,
      connected: modeInfo.connected,
      inclusionEnabled: false,
      quoteUnavailable: false,
      quoteError: null,
      requestedOptIn,
      appliedOptIn: false,
      amount: 0,
      insuredProductCount: 0,
      uninsuredProductCount: 0,
      insuredProductIds: [],
    };
  }

  try {
    const preview = await previewTulipQuoteForCheckout({
      storeId: input.storeId,
      modeOverride: modeInfo.mode,
      customer: {
        customerType: input.customer.customerType || 'individual',
        companyName: input.customer.companyName || null,
        firstName: input.customer.firstName,
        lastName: input.customer.lastName,
        email: input.customer.email,
        phone: input.customer.phone || '',
        address: input.customer.address || '',
        city: input.customer.city || '',
        postalCode: input.customer.postalCode || '',
        country: input.fallbackCountry,
      },
      items: input.items,
      startDate: input.startDate,
      endDate: input.endDate,
      optIn: requestedOptIn,
    });

    const inclusionEnabled = preview.inclusionEnabled === true;
    const amount =
      !inclusionEnabled &&
      preview.shouldApply &&
      Number.isFinite(preview.amount) &&
      preview.amount > 0
        ? Math.round(preview.amount * 100) / 100
        : 0;
    const appliedOptIn = requestedOptIn && preview.shouldApply;

    console.info('[tulip][checkout-quote] resolved', {
      storeId: input.storeId,
      mode: modeInfo.mode,
      requestedOptIn,
      appliedOptIn,
      amount,
      inclusionEnabled,
      insuredProductCount: preview.insuredProductCount,
      uninsuredProductCount: preview.uninsuredProductCount,
      insuredProductIds: preview.insuredProductIds,
    });

    return {
      mode: modeInfo.mode,
      connected: modeInfo.connected,
      inclusionEnabled,
      quoteUnavailable: false,
      quoteError: null,
      requestedOptIn,
      appliedOptIn,
      amount,
      insuredProductCount: preview.insuredProductCount,
      uninsuredProductCount: preview.uninsuredProductCount,
      insuredProductIds: preview.insuredProductIds,
    };
  } catch (error) {
    const errorKey = getErrorKey(error, 'errors.tulipQuoteFailed');
    if (modeInfo.mode === 'optional') {
      const coverageSummary = await getTulipCoverageSummary(input.items);
      console.warn(
        '[tulip][checkout-quote] optional fallback without insurance',
        {
          storeId: input.storeId,
          mode: modeInfo.mode,
          requestedOptIn,
          error: errorKey,
          insuredProductCount: coverageSummary.insuredProductCount,
          uninsuredProductCount: coverageSummary.uninsuredProductCount,
        },
      );

      return {
        mode: modeInfo.mode,
        connected: modeInfo.connected,
        inclusionEnabled: false,
        quoteUnavailable: true,
        quoteError: errorKey,
        requestedOptIn,
        appliedOptIn: false,
        amount: 0,
        insuredProductCount: coverageSummary.insuredProductCount,
        uninsuredProductCount: coverageSummary.uninsuredProductCount,
        insuredProductIds: coverageSummary.insuredProductIds,
      };
    }

    console.error('[tulip][checkout-quote] required mode failed', {
      storeId: input.storeId,
      mode: modeInfo.mode,
      error: errorKey,
    });
    throw new Error(errorKey);
  }
}

export async function getTulipQuotePreview(input: {
  storeId: string;
  modeOverride?: TulipPublicMode;
  customer: {
    customerType?: 'individual' | 'business';
    companyName?: string;
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    address?: string;
    city?: string;
    postalCode?: string;
  };
  items: Array<{ productId: string; quantity: number }>;
  startDate: string;
  endDate: string;
  tulipInsuranceOptIn?: boolean;
}): Promise<CheckoutTulipQuoteResult & { error: string | null }> {
  console.info('[tulip][dashboard-preview] request', {
    storeId: input.storeId,
    modeOverride: input.modeOverride ?? null,
    itemCount: input.items.length,
    items: input.items,
    startDate: input.startDate,
    endDate: input.endDate,
    tulipInsuranceOptIn: input.tulipInsuranceOptIn ?? null,
    customerEmail: input.customer.email,
  });

  const store = await db.query.stores.findFirst({
    where: eq(stores.id, input.storeId),
    columns: {
      id: true,
      settings: true,
    },
  });

  if (!store) {
    return {
      mode: 'no_public',
      connected: false,
      inclusionEnabled: false,
      quoteUnavailable: true,
      quoteError: 'errors.storeNotFound',
      requestedOptIn: false,
      appliedOptIn: false,
      amount: 0,
      insuredProductCount: 0,
      uninsuredProductCount: 0,
      insuredProductIds: [],
      error: 'errors.storeNotFound',
    };
  }

  try {
    const quote = await resolveCheckoutTulipQuote({
      storeId: store.id,
      modeOverride: input.modeOverride,
      customer: input.customer,
      items: input.items,
      startDate: new Date(input.startDate),
      endDate: new Date(input.endDate),
      tulipInsuranceOptIn: input.tulipInsuranceOptIn,
      fallbackCountry: store.settings?.country || 'FR',
    });

    console.info('[tulip][dashboard-preview] success', {
      storeId: input.storeId,
      mode: quote.mode,
      modeOverride: input.modeOverride ?? null,
      requestedOptIn: quote.requestedOptIn,
      appliedOptIn: quote.appliedOptIn,
      amount: quote.amount,
      insuredProductCount: quote.insuredProductCount,
      uninsuredProductCount: quote.uninsuredProductCount,
      insuredProductIds: quote.insuredProductIds,
      quoteUnavailable: quote.quoteUnavailable,
    });

    return {
      ...quote,
      error: null,
    };
  } catch (error) {
    const modeInfo = await getCheckoutTulipMode(store.id, input.modeOverride);
    const coverageSummary = await getTulipCoverageSummary(input.items);
    const errorKey = getErrorKey(error, 'errors.tulipQuoteFailed');

    const fallbackResult = {
      mode: modeInfo.mode,
      connected: modeInfo.connected,
      inclusionEnabled: false,
      quoteUnavailable: true,
      quoteError: errorKey,
      requestedOptIn:
        modeInfo.mode === 'required'
          ? true
          : modeInfo.mode === 'optional'
            ? input.tulipInsuranceOptIn !== false
            : false,
      appliedOptIn: false,
      amount: 0,
      insuredProductCount: coverageSummary.insuredProductCount,
      uninsuredProductCount: coverageSummary.uninsuredProductCount,
      insuredProductIds: coverageSummary.insuredProductIds,
      error: errorKey,
    };

    console.warn('[tulip][dashboard-preview] fallback', {
      storeId: input.storeId,
      mode: fallbackResult.mode,
      modeOverride: input.modeOverride ?? null,
      requestedOptIn: fallbackResult.requestedOptIn,
      appliedOptIn: fallbackResult.appliedOptIn,
      amount: fallbackResult.amount,
      insuredProductCount: fallbackResult.insuredProductCount,
      uninsuredProductCount: fallbackResult.uninsuredProductCount,
      insuredProductIds: fallbackResult.insuredProductIds,
      error: errorKey,
    });

    return fallbackResult;
  }
}

export async function createReservation(input: CreateReservationInput) {
  try {
    // Get store to validate business hours
    const store = await db.query.stores.findFirst({
      where: eq(stores.id, input.storeId),
    });

    if (!store) {
      return { error: 'errors.storeNotFound' };
    }

    const customerPhone = input.customer.phone
      ? normalizePhoneNumber(input.customer.phone, store.settings?.country)
      : null;
    if (input.customer.phone && !customerPhone) {
      return { error: 'errors.invalidData' };
    }

    // Calculate the overall rental period from items
    const itemStartDates = input.items.map((item) => new Date(item.startDate));
    const itemEndDates = input.items.map((item) => new Date(item.endDate));
    const rentalStartDate = new Date(
      Math.min(...itemStartDates.map((d) => d.getTime())),
    );
    const rentalEndDate = new Date(
      Math.max(...itemEndDates.map((d) => d.getTime())),
    );

    // Validate business hours for the rental period (using store's timezone for proper time comparison)
    const businessHoursValidation = validateRentalPeriod(
      rentalStartDate,
      rentalEndDate,
      store.settings?.businessHours,
      store.settings?.timezone,
    );

    if (!businessHoursValidation.valid) {
      return {
        error: 'errors.businessHoursViolation',
        errorParams: { reasons: businessHoursValidation.errors.join(', ') },
      };
    }

    // Validate advance notice
    const advanceNoticeMinutes = store.settings?.advanceNoticeMinutes || 0;
    if (advanceNoticeMinutes > 0) {
      const minimumStartTime = getMinStartDateTime(advanceNoticeMinutes);
      if (rentalStartDate < minimumStartTime) {
        return {
          error: 'errors.advanceNoticeViolation',
          errorParams: {
            duration: formatDurationFromMinutes(advanceNoticeMinutes),
          },
        };
      }
    }

    // Validate minimum rental duration
    const minRentalMinutes = getMinRentalMinutes(
      store.settings as StoreSettings | null,
    );
    if (minRentalMinutes > 0) {
      const durationCheck = validateMinRentalDurationMinutes(
        rentalStartDate,
        rentalEndDate,
        minRentalMinutes,
      );
      if (!durationCheck.valid) {
        return {
          error: 'errors.minRentalDurationViolation',
          errorParams: {
            duration: formatDurationFromMinutes(minRentalMinutes),
          },
        };
      }
    }

    // Validate maximum rental duration
    const maxRentalMinutes = getMaxRentalMinutes(
      store.settings as StoreSettings | null,
    );
    if (maxRentalMinutes !== null) {
      const maxCheck = validateMaxRentalDurationMinutes(
        rentalStartDate,
        rentalEndDate,
        maxRentalMinutes,
      );
      if (!maxCheck.valid) {
        return {
          error: 'errors.maxRentalDurationViolation',
          errorParams: {
            duration: formatDurationFromMinutes(maxRentalMinutes),
          },
        };
      }
    }

    // ===== SERVER-SIDE PRICE CALCULATION =====
    // Never trust client-provided prices - always recalculate from database

    const storeSettings = store.settings as StoreSettings | null;
    const turnoverBufferMinutes = storeSettings?.turnoverBufferMinutes ?? 0;

    // Structure to hold server-calculated prices
    interface ServerCalculatedItem {
      productId: string;
      quantity: number;
      unitPrice: number; // Server-calculated effective price per unit
      depositPerUnit: number; // Server-calculated deposit
      subtotal: number; // Server-calculated subtotal
      totalDeposit: number; // Server-calculated total deposit
    }
    const serverCalculatedItems: ServerCalculatedItem[] = [];
    const productsForReservation = new Map<
      string,
      {
        id: string;
        name: string;
        quantity: number;
        trackUnits: boolean;
        bookingAttributeAxes: BookingAttributeAxis[] | null;
        taxSettings: unknown;
      }
    >();
    let serverSubtotal = 0;
    let serverTotalDeposit = 0;

    // Validate products exist, check stock, and calculate prices from DB
    for (const item of input.items) {
      const product = await db.query.products.findFirst({
        where: and(
          eq(products.id, item.productId),
          eq(products.storeId, input.storeId),
          eq(products.status, 'active'),
        ),
        with: {
          pricingTiers: true, // Get pricing tiers for this product
        },
      });

      if (!product) {
        return {
          error: 'errors.productUnavailable',
          errorParams: { name: item.productSnapshot.name },
        };
      }

      if (product.trackUnits) {
        const itemRentalStartDate = new Date(item.startDate);
        const itemRentalEndDate = new Date(item.endDate);
        const availableUnits = await db
          .select({ id: productUnits.id })
          .from(productUnits)
          .where(
            and(
              eq(productUnits.productId, product.id),
              buildUnitRentableDuringPredicate(
                db,
                itemRentalStartDate,
                itemRentalEndDate,
              ),
            ),
          );

        if (availableUnits.length < item.quantity) {
          return {
            error: 'errors.insufficientStock',
            errorParams: {
              name: item.productSnapshot.name,
              count: availableUnits.length,
            },
          };
        }
      } else if (product.quantity < item.quantity) {
        return {
          error: 'errors.insufficientStock',
          errorParams: {
            name: item.productSnapshot.name,
            count: product.quantity,
          },
        };
      }

      productsForReservation.set(product.id, {
        id: product.id,
        name: product.name,
        quantity: product.quantity,
        trackUnits: product.trackUnits,
        bookingAttributeAxes:
          (product.bookingAttributeAxes as BookingAttributeAxis[] | null) ||
          null,
        taxSettings: product.taxSettings,
      });

      // Calculate price from database values (NOT from client input)
      const productPricingMode = product.pricingMode as PricingMode;
      const duration = calcDuration(
        item.startDate,
        item.endDate,
        productPricingMode,
      );

      // Fetch seasonal pricings for this product
      const seasonalPricingsRaw = await db
        .select()
        .from(productSeasonalPricing)
        .where(eq(productSeasonalPricing.productId, product.id));

      let seasonalPricingConfigs: SeasonalPricingConfig[] = [];
      if (seasonalPricingsRaw.length > 0) {
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

        seasonalPricingConfigs = seasonalPricingsRaw.map((sp) => {
          const spTiers = spTiersByPricingId.get(sp.id) || [];
          return {
            id: sp.id,
            name: sp.name,
            startDate: sp.startDate,
            endDate: sp.endDate,
            basePrice: Number(sp.price),
            tiers: spTiers
              .filter(
                (t) => t.minDuration !== null && t.discountPercent !== null,
              )
              .map((t) => ({
                id: t.id,
                minDuration: t.minDuration!,
                discountPercent: Number(t.discountPercent!),
                displayOrder: t.displayOrder ?? 0,
              })),
            rates: spTiers
              .filter((t) => t.period !== null && t.price !== null)
              .map((t) => ({
                id: t.id,
                period: t.period!,
                price: Number(t.price!),
                displayOrder: t.displayOrder ?? 0,
              })),
          };
        });
      }

      // Use seasonal-aware pricing (short-circuits to normal pricing when no seasonal configs)
      const baseTiers =
        product.pricingTiers?.map((tier) => ({
          id: tier.id,
          minDuration: tier.minDuration ?? 1,
          discountPercent: Number(tier.discountPercent ?? 0),
          displayOrder: tier.displayOrder || 0,
        })) || [];
      const baseRates: Rate[] =
        product.pricingTiers
          ?.filter(
            (tier): tier is typeof tier & { period: number; price: string } =>
              typeof tier.period === 'number' &&
              tier.period > 0 &&
              typeof tier.price === 'string',
          )
          .map(
            (tier, index): Rate => ({
              id: tier.id,
              period: tier.period,
              price: Number(tier.price),
              displayOrder: tier.displayOrder ?? index,
            }),
          ) || [];

      const seasonalResult = calculateSeasonalAwarePrice(
        {
          basePrice: Number(product.price),
          basePeriodMinutes: product.basePeriodMinutes ?? null,
          deposit: Number(product.deposit || 0),
          pricingMode: productPricingMode,
          enforceStrictTiers: product.enforceStrictTiers ?? false,
          tiers: baseTiers,
          rates: baseRates,
        },
        seasonalPricingConfigs,
        item.startDate,
        item.endDate,
        item.quantity,
      );

      const pricingResult = {
        subtotal: seasonalResult.subtotal,
        originalSubtotal: seasonalResult.originalSubtotal,
        savings: seasonalResult.savings,
        deposit: seasonalResult.deposit,
        effectivePricePerUnit:
          seasonalResult.subtotal / Math.max(1, item.quantity),
      };

      serverCalculatedItems.push({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: pricingResult.effectivePricePerUnit,
        depositPerUnit: Number(product.deposit || 0),
        subtotal: pricingResult.subtotal,
        totalDeposit: pricingResult.deposit,
      });

      serverSubtotal += pricingResult.subtotal;
      serverTotalDeposit += pricingResult.deposit;

      // Log price mismatch for monitoring (potential fraud attempt)
      const clientItemSubtotal = item.unitPrice * item.quantity * duration;
      if (Math.abs(clientItemSubtotal - pricingResult.subtotal) > 0.01) {
        console.warn('[SECURITY] Price mismatch detected', {
          productId: item.productId,
          clientSubtotal: clientItemSubtotal,
          serverSubtotal: pricingResult.subtotal,
          difference: clientItemSubtotal - pricingResult.subtotal,
        });
      }
    }

    // ===== DELIVERY VALIDATION AND FEE CALCULATION =====
    let deliveryFee = 0;
    let deliveryDistanceKm: number | null = null;
    let returnDistanceKm: number | null = null;
    const deliverySettings = storeSettings?.delivery;
    const deliveryMode = deliverySettings?.mode || 'optional';
    const isDeliveryForced =
      deliveryMode === 'required' || deliveryMode === 'included';
    const isDeliveryIncluded = deliveryMode === 'included';
    const isMultiLocationEnabled = Boolean(
      deliverySettings?.multiLocationEnabled,
    );

    const outboundLeg = input.delivery?.outbound;
    const returnLeg = input.delivery?.return;
    const hasOutboundDelivery = outboundLeg?.method === 'address';
    const hasReturnDelivery = returnLeg?.method === 'address';
    const hasAnyDelivery = hasOutboundDelivery || hasReturnDelivery;
    const hasOutboundStore = !outboundLeg || outboundLeg.method === 'store';
    const hasReturnStore = !returnLeg || returnLeg.method === 'store';

    let pickupLocation: Awaited<
      ReturnType<typeof resolveReservationLocationSnapshot>
    > | null = null;
    let returnLocation: Awaited<
      ReturnType<typeof resolveReservationLocationSnapshot>
    > | null = null;

    try {
      pickupLocation = hasOutboundStore
        ? await resolveReservationLocationSnapshot({
            store,
            locationId: isMultiLocationEnabled
              ? (outboundLeg?.locationId ?? null)
              : null,
          })
        : null;
      returnLocation = hasReturnStore
        ? await resolveReservationLocationSnapshot({
            store,
            locationId: isMultiLocationEnabled
              ? (returnLeg?.locationId ?? null)
              : null,
          })
        : null;
    } catch (error) {
      return { error: getErrorKey(error, 'errors.locationInvalid') };
    }

    // Validate that outbound delivery is selected when mode is forced
    if (isDeliveryForced && deliverySettings?.enabled && !hasOutboundDelivery) {
      return { error: 'errors.deliveryRequired' };
    }

    if (hasAnyDelivery) {
      // Validate delivery is enabled for this store
      if (!deliverySettings?.enabled) {
        return { error: 'errors.deliveryNotEnabled' };
      }

      // Validate store has coordinates for distance calculation
      if (!store.latitude || !store.longitude) {
        return { error: 'errors.storeCoordinatesNotConfigured' };
      }

      const storeLatitude = parseFloat(store.latitude);
      const storeLongitude = parseFloat(store.longitude);

      if (
        !isFinite(storeLatitude) ||
        !isFinite(storeLongitude) ||
        storeLatitude < -90 ||
        storeLatitude > 90 ||
        storeLongitude < -180 ||
        storeLongitude > 180
      ) {
        return { error: 'errors.storeCoordinatesInvalid' };
      }

      // --- Outbound leg validation ---
      if (hasOutboundDelivery) {
        if (!outboundLeg.latitude || !outboundLeg.longitude) {
          return { error: 'errors.deliveryAddressRequired' };
        }

        if (
          outboundLeg.latitude < -90 ||
          outboundLeg.latitude > 90 ||
          outboundLeg.longitude < -180 ||
          outboundLeg.longitude > 180
        ) {
          return { error: 'errors.deliveryAddressInvalid' };
        }

        const outboundDistance = await getRouteDistance({
          originLatitude: storeLatitude,
          originLongitude: storeLongitude,
          destinationLatitude: outboundLeg.latitude,
          destinationLongitude: outboundLeg.longitude,
        });
        deliveryDistanceKm = outboundDistance.distanceKm;

        const outboundValidation = validateDelivery(
          deliveryDistanceKm,
          deliverySettings,
        );
        if (!outboundValidation.valid) {
          return {
            error: outboundValidation.errorKey || 'errors.deliveryTooFar',
            errorParams: outboundValidation.errorParams,
          };
        }
      }

      // --- Return leg validation ---
      if (hasReturnDelivery) {
        if (!returnLeg.latitude || !returnLeg.longitude) {
          return { error: 'errors.returnAddressRequired' };
        }

        if (
          returnLeg.latitude < -90 ||
          returnLeg.latitude > 90 ||
          returnLeg.longitude < -180 ||
          returnLeg.longitude > 180
        ) {
          return { error: 'errors.returnAddressInvalid' };
        }

        const inboundDistance = await getRouteDistance({
          originLatitude: storeLatitude,
          originLongitude: storeLongitude,
          destinationLatitude: returnLeg.latitude,
          destinationLongitude: returnLeg.longitude,
        });
        returnDistanceKm = inboundDistance.distanceKm;

        const returnValidation = validateDelivery(
          returnDistanceKm,
          deliverySettings,
        );
        if (!returnValidation.valid) {
          return {
            error: 'errors.returnAddressTooFar',
            errorParams: returnValidation.errorParams,
          };
        }
      }

      // Calculate delivery fee (server-side, never trust client)
      if (isDeliveryIncluded) {
        deliveryFee = 0;
      } else {
        const feeResult = calculateTotalDeliveryFee(
          deliveryDistanceKm,
          returnDistanceKm,
          deliverySettings,
          serverSubtotal,
        );
        deliveryFee = feeResult.totalFee;
      }
    }

    // Client `totalAmount` excludes deposit and includes delivery fee.
    const serverClientComparableTotal = serverSubtotal + deliveryFee;

    if (Math.abs(input.subtotalAmount - serverSubtotal) > 0.01) {
      console.warn('[SECURITY] Subtotal mismatch detected', {
        clientSubtotal: input.subtotalAmount,
        serverSubtotal,
        difference: input.subtotalAmount - serverSubtotal,
      });
    }

    if (Math.abs(input.depositAmount - serverTotalDeposit) > 0.01) {
      console.warn('[SECURITY] Deposit mismatch detected', {
        clientDeposit: input.depositAmount,
        serverDeposit: serverTotalDeposit,
        difference: input.depositAmount - serverTotalDeposit,
      });
    }

    // Log total mismatch for monitoring (client total = subtotal + delivery, without deposit)
    if (Math.abs(input.totalAmount - serverClientComparableTotal) > 0.01) {
      console.warn('[SECURITY] Total amount mismatch detected', {
        clientTotal: input.totalAmount,
        serverTotal: serverClientComparableTotal,
        clientSubtotal: input.subtotalAmount,
        serverSubtotal,
        clientDeposit: input.depositAmount,
        serverDeposit: serverTotalDeposit,
        serverDeliveryFee: deliveryFee,
      });
    }

    // ===== TULIP INSURANCE PREVIEW =====
    let tulipInsuranceAmount = 0;
    let tulipInsuranceOptIn = false;
    let tulipInsuredProductCount = 0;
    let tulipUninsuredProductCount = 0;
    let tulipQuoteFallbackError: string | null = null;

    try {
      const quote = await resolveCheckoutTulipQuote({
        storeId: store.id,
        customer: input.customer,
        items: input.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        })),
        startDate: rentalStartDate,
        endDate: rentalEndDate,
        tulipInsuranceOptIn: input.tulipInsuranceOptIn,
        fallbackCountry: store.settings?.country || 'FR',
      });

      tulipInsuranceAmount = quote.amount;
      tulipInsuranceOptIn = quote.appliedOptIn;
      tulipInsuredProductCount = quote.insuredProductCount;
      tulipUninsuredProductCount = quote.uninsuredProductCount;
      tulipQuoteFallbackError = quote.quoteUnavailable
        ? quote.quoteError
        : null;
    } catch (error) {
      return { error: getErrorKey(error, 'errors.tulipQuoteFailed') };
    }

    // ========== Promo code validation ==========
    let serverDiscountAmount = 0;
    let validatedPromoCodeId: string | null = null;
    let promoCodeSnapshotData: PromoCodeSnapshot | null = null;

    if (input.promoCode) {
      const [promoRow] = await db
        .select()
        .from(promoCodes)
        .where(
          and(
            eq(promoCodes.storeId, input.storeId),
            sql`UPPER(${promoCodes.code}) = UPPER(${input.promoCode})`,
            eq(promoCodes.isActive, true),
          ),
        )
        .for('update');

      if (!promoRow) {
        return { error: 'errors.promoCodeInvalid' };
      }

      const now = new Date();
      if (promoRow.startsAt && promoRow.startsAt > now) {
        return { error: 'errors.promoCodeNotStarted' };
      }
      if (promoRow.expiresAt && promoRow.expiresAt < now) {
        return { error: 'errors.promoCodeExpired' };
      }
      if (
        promoRow.maxUsageCount !== null &&
        promoRow.currentUsageCount >= promoRow.maxUsageCount
      ) {
        return { error: 'errors.promoCodeExhausted' };
      }

      const minAmount = promoRow.minimumAmount
        ? parseFloat(promoRow.minimumAmount)
        : 0;
      if (minAmount > 0 && serverSubtotal < minAmount) {
        return {
          error: 'errors.promoCodeMinimumNotMet',
          errorParams: {
            amount: minAmount.toFixed(2),
          },
        };
      }

      const promoValue = parseFloat(promoRow.value);
      if (promoRow.type === 'percentage') {
        serverDiscountAmount = Math.min(
          (serverSubtotal * promoValue) / 100,
          serverSubtotal,
        );
      } else {
        serverDiscountAmount = Math.min(promoValue, serverSubtotal);
      }
      serverDiscountAmount = Math.round(serverDiscountAmount * 100) / 100;

      await db
        .update(promoCodes)
        .set({
          currentUsageCount: sql`${promoCodes.currentUsageCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(promoCodes.id, promoRow.id));

      validatedPromoCodeId = promoRow.id;
      promoCodeSnapshotData = {
        code: promoRow.code,
        type: promoRow.type,
        value: promoValue,
      };
    }

    const deliveryEligibilitySubtotal =
      Math.round((serverSubtotal - serverDiscountAmount) * 100) / 100;
    if (
      hasAnyDelivery &&
      deliverySettings &&
      !isDeliveryOrderAmountEligible(
        deliveryEligibilitySubtotal,
        deliverySettings,
      )
    ) {
      return {
        error: 'errors.deliveryMinimumOrderAmountNotMet',
        errorParams: {
          amount: (deliverySettings.minimumOrderAmountForDelivery ?? 0).toFixed(
            2,
          ),
        },
      };
    }

    // Use server-calculated values for all monetary operations
    const finalSubtotal = serverSubtotal + tulipInsuranceAmount;
    const finalDiscount = serverDiscountAmount;
    const finalDeposit = serverTotalDeposit;
    const finalDeliveryFee = deliveryFee;
    // totalAmount excludes deposit — deposit is tracked separately in depositAmount
    const finalTotal = finalSubtotal - finalDiscount + finalDeliveryFee;

    const startDates = input.items.map((item) => new Date(item.startDate));
    const endDates = input.items.map((item) => new Date(item.endDate));
    const startDate = new Date(Math.min(...startDates.map((d) => d.getTime())));
    const endDate = new Date(Math.max(...endDates.map((d) => d.getTime())));

    // Get tax settings from store
    const storeTaxSettings = store.settings?.tax as TaxSettings | undefined;
    const taxEnabled = storeTaxSettings?.enabled ?? false;
    const storeTaxRate = storeTaxSettings?.defaultRate ?? 0;
    const displayMode = storeTaxSettings?.displayMode ?? 'inclusive';

    const blockingStatuses = getBlockingReservationStatuses(
      (store.settings?.pendingBlocksAvailability) ?? true,
    );

    const reservationWriteResult = await db.transaction(async (tx) => {
      const requestedProductIds = [
        ...new Set(input.items.map((item) => item.productId)),
      ];

      // Serialize competing checkout writes for the same products.
      if (requestedProductIds.length > 0) {
        const requestedProductIdSql = sql.join(
          requestedProductIds.map((productId) => sql`${productId}`),
          sql`, `,
        );
        await tx.execute(
          sql`SELECT id FROM ${products} WHERE id IN (${requestedProductIdSql}) FOR UPDATE`,
        );
      }

      const lockedProducts =
        requestedProductIds.length > 0
          ? await tx.query.products.findMany({
              where: and(
                eq(products.storeId, input.storeId),
                inArray(products.id, requestedProductIds),
              ),
            })
          : [];
      const lockedProductsById = new Map(
        lockedProducts.map((product) => [product.id, product]),
      );

      // Recompute overlap and availability inside the transaction after row locks are acquired.
      const overlappingReservations = await tx.query.reservations.findMany({
        where: and(
          eq(reservations.storeId, input.storeId),
          inArray(reservations.status, blockingStatuses),
          buildReservationOverlapPredicate({
            start: rentalStartDate,
            end: rentalEndDate,
            turnoverBufferMinutes,
          }),
        ),
        with: {
          items: {
            with: {
              assignedUnits: true,
            },
          },
        },
      });

      const trackedProductIds = [...lockedProductsById.values()]
        .filter((product) => product.trackUnits)
        .map((product) => product.id);

      const trackedUnits =
        trackedProductIds.length > 0
          ? await tx
              .select({
                id: productUnits.id,
              })
              .from(productUnits)
              .where(inArray(productUnits.productId, trackedProductIds))
          : [];
      const availableUnits =
        trackedProductIds.length > 0
              ? await tx
                  .select({
                    id: productUnits.id,
                    productId: productUnits.productId,
                    combinationKey: productUnits.combinationKey,
                    attributes: productUnits.attributes,
              })
              .from(productUnits)
              .where(
                and(
                  inArray(productUnits.productId, trackedProductIds),
                  buildUnitRentableDuringPredicate(
                    tx,
                    rentalStartDate,
                    rentalEndDate,
                  ),
                ),
              )
          : [];
      const availableUnitIds = new Set(availableUnits.map((unit) => unit.id));
      const excludedProductUnitIds = new Set(
        trackedUnits
          .filter((unit) => !availableUnitIds.has(unit.id))
          .map((unit) => unit.id),
      );
      const excludedUnitInfo = await loadExcludedUnitInfo(
        tx,
        excludedProductUnitIds,
      );

      const { reservedByProduct, reservedByProductCombination } =
        computeReservedNetOfExcludedUnits({
          reservations: overlappingReservations,
          startDate: rentalStartDate,
          endDate: rentalEndDate,
          turnoverBufferMinutes,
          excludedProductUnitIds,
          excludedUnitInfo,
        });

      const combinationsByProduct = new Map<
        string,
        Map<
          string,
          { totalQuantity: number; selectedAttributes: UnitAttributes }
        >
      >();

      for (const unit of availableUnits) {
        const productCombinations =
          combinationsByProduct.get(unit.productId) || new Map();
        const combinationKey = unit.combinationKey || DEFAULT_COMBINATION_KEY;
        const current = productCombinations.get(combinationKey);

        if (!current) {
          productCombinations.set(combinationKey, {
            totalQuantity: 1,
            selectedAttributes:
              (unit.attributes as UnitAttributes | null) || {},
          });
        } else {
          current.totalQuantity += 1;
          if (
            Object.keys(current.selectedAttributes).length === 0 &&
            unit.attributes
          ) {
            current.selectedAttributes = unit.attributes as UnitAttributes;
          }
          productCombinations.set(combinationKey, current);
        }

        combinationsByProduct.set(unit.productId, productCombinations);
      }

      const resolvedCombinationByItemKey = new Map<
        string,
        { combinationKey: string; selectedAttributes: UnitAttributes }
      >();

      for (let i = 0; i < input.items.length; i++) {
        const item = input.items[i];
        const product = lockedProductsById.get(item.productId);
        if (!product) continue;

        if (!product.trackUnits) {
          const reserved = reservedByProduct.get(item.productId) || 0;
          const available = Math.max(0, product.quantity - reserved);

          if (item.quantity > available) {
            return {
              ok: false as const,
              error: 'errors.productNoLongerAvailable' as const,
              productName: item.productSnapshot.name,
            };
          }

          reservedByProduct.set(item.productId, reserved + item.quantity);
          continue;
        }

        const axes = product.bookingAttributeAxes || [];
        const productCombinations =
          combinationsByProduct.get(product.id) || new Map();
        const selectedAttributes = item.selectedAttributes || {};

        const candidates = [...productCombinations.entries()]
          .map(([combinationKey, combinationData]) => ({
            combinationKey,
            ...combinationData,
          }))
          .filter((combination) =>
            matchesSelectedAttributes(
              selectedAttributes,
              combination.selectedAttributes,
            ),
          )
          .sort((a, b) => {
            const sortA = getDeterministicCombinationSortValue(
              axes,
              a.selectedAttributes,
            );
            const sortB = getDeterministicCombinationSortValue(
              axes,
              b.selectedAttributes,
            );
            return sortA.localeCompare(sortB, 'en');
          });

        const resolvedCombination = candidates.find((candidate) => {
          const key = getProductCombinationAvailabilityKey(
            product.id,
            candidate.combinationKey,
          );
          const reserved = reservedByProductCombination.get(key) || 0;
          const available = Math.max(0, candidate.totalQuantity - reserved);
          return available >= item.quantity;
        });

        if (!resolvedCombination) {
          return {
            ok: false as const,
            error: 'errors.productNoLongerAvailable' as const,
            productName: item.productSnapshot.name,
          };
        }

        const key = getProductCombinationAvailabilityKey(
          product.id,
          resolvedCombination.combinationKey,
        );
        const reserved = reservedByProductCombination.get(key) || 0;
        reservedByProductCombination.set(key, reserved + item.quantity);
        reservedByProduct.set(
          item.productId,
          (reservedByProduct.get(item.productId) || 0) + item.quantity,
        );

        resolvedCombinationByItemKey.set(
          getReservationItemResolutionKey(item, i),
          {
            combinationKey: resolvedCombination.combinationKey,
            selectedAttributes: toResolvedAttributes(
              selectedAttributes,
              resolvedCombination.selectedAttributes,
            ),
          },
        );
      }

      let customer = await tx.query.customers.findFirst({
        where: and(
          eq(customers.storeId, input.storeId),
          eq(customers.email, input.customer.email),
        ),
      });

      if (!customer) {
        const [newCustomer] = await tx
          .insert(customers)
          .values({
            storeId: input.storeId,
            email: input.customer.email,
            firstName: input.customer.firstName,
            lastName: input.customer.lastName,
            customerType: input.customer.customerType || 'individual',
            companyName: input.customer.companyName || null,
            phone: customerPhone,
            address: input.customer.address || null,
            city: input.customer.city || null,
            postalCode: input.customer.postalCode || null,
            country: store.settings?.country || 'FR',
          })
          .$returningId();

        customer = await tx.query.customers.findFirst({
          where: eq(customers.id, newCustomer.id),
        });
      } else {
        await tx
          .update(customers)
          .set({
            firstName: input.customer.firstName,
            lastName: input.customer.lastName,
            customerType: input.customer.customerType || customer.customerType,
            companyName: input.customer.companyName ?? customer.companyName,
            phone: customerPhone || customer.phone,
            address: input.customer.address || customer.address,
            city: input.customer.city || customer.city,
            postalCode: input.customer.postalCode || customer.postalCode,
            updatedAt: new Date(),
          })
          .where(eq(customers.id, customer.id));
      }

      if (!customer) {
        return {
          ok: false as const,
          error: 'errors.createCustomerError' as const,
        };
      }

      let subtotalExclTax: number | null = null;
      let taxAmount: number | null = null;
      let taxRate: number | null = null;

      if (taxEnabled && storeTaxRate > 0) {
        taxRate = storeTaxRate;
        if (displayMode === 'inclusive') {
          subtotalExclTax = extractExclusiveFromInclusive(
            finalSubtotal,
            storeTaxRate,
          );
          taxAmount = finalSubtotal - subtotalExclTax;
        } else {
          subtotalExclTax = finalSubtotal;
          taxAmount = calculateTaxFromExclusive(finalSubtotal, storeTaxRate);
        }
      }

      const reservationId = nanoid();
      const reservationNumber = await generateUniqueReservationNumber(
        input.storeId,
      );

      await tx.insert(reservations).values({
        id: reservationId,
        storeId: input.storeId,
        customerId: customer.id,
        number: reservationNumber,
        status: 'pending',
        startDate,
        endDate,
        subtotalAmount: finalSubtotal.toFixed(2),
        depositAmount: finalDeposit.toFixed(2),
        totalAmount: finalTotal.toFixed(2),
        subtotalExclTax: subtotalExclTax?.toFixed(2) ?? null,
        taxAmount: taxAmount?.toFixed(2) ?? null,
        taxRate: taxRate?.toFixed(2) ?? null,
        customerNotes: input.customerNotes || null,
        source: 'online',
        outboundMethod: outboundLeg?.method || 'store',
        returnMethod: returnLeg?.method || 'store',
        deliveryOption: hasAnyDelivery ? 'delivery' : 'pickup',
        deliveryAddress: hasOutboundDelivery ? outboundLeg.address : null,
        deliveryCity: hasOutboundDelivery ? outboundLeg.city : null,
        deliveryPostalCode: hasOutboundDelivery ? outboundLeg.postalCode : null,
        deliveryCountry: hasOutboundDelivery ? outboundLeg.country : null,
        deliveryLatitude: hasOutboundDelivery
          ? outboundLeg.latitude?.toString()
          : null,
        deliveryLongitude: hasOutboundDelivery
          ? outboundLeg.longitude?.toString()
          : null,
        deliveryDistanceKm: deliveryDistanceKm?.toFixed(2) ?? null,
        deliveryFee: finalDeliveryFee.toFixed(2),
        tulipInsuranceOptIn,
        tulipInsuranceAmount:
          tulipInsuranceAmount > 0 ? tulipInsuranceAmount.toFixed(2) : null,
        promoCodeId: validatedPromoCodeId,
        discountAmount: finalDiscount.toFixed(2),
        promoCodeSnapshot: promoCodeSnapshotData,
        returnAddress: hasReturnDelivery ? (returnLeg.address ?? null) : null,
        returnCity: hasReturnDelivery ? (returnLeg.city ?? null) : null,
        returnPostalCode: hasReturnDelivery
          ? (returnLeg.postalCode ?? null)
          : null,
        returnCountry: hasReturnDelivery ? (returnLeg.country ?? null) : null,
        returnLatitude:
          hasReturnDelivery && returnLeg.latitude != null
            ? returnLeg.latitude.toString()
            : null,
        returnLongitude:
          hasReturnDelivery && returnLeg.longitude != null
            ? returnLeg.longitude.toString()
            : null,
        returnDistanceKm: returnDistanceKm?.toFixed(2) ?? null,
        pickupLocationId: pickupLocation?.locationId ?? null,
        returnLocationId: returnLocation?.locationId ?? null,
        pickupLocationSnapshot: pickupLocation?.snapshot ?? null,
        returnLocationSnapshot: returnLocation?.snapshot ?? null,
      });

      for (let i = 0; i < input.items.length; i++) {
        const item = input.items[i];
        const serverItem = serverCalculatedItems[i];
        const totalPrice = serverItem.subtotal;

        const productInfo = productsForReservation.get(item.productId);
        const productTaxSettings = productInfo?.taxSettings as
          | ProductTaxSettings
          | undefined;
        const resolvedCombination = resolvedCombinationByItemKey.get(
          getReservationItemResolutionKey(item, i),
        );
        const combinationKey =
          resolvedCombination?.combinationKey ||
          item.resolvedCombinationKey ||
          null;
        const selectedAttributes =
          resolvedCombination?.selectedAttributes ||
          item.resolvedAttributes ||
          item.selectedAttributes ||
          null;
        const snapshot: ProductSnapshot = {
          ...item.productSnapshot,
          combinationKey:
            combinationKey || item.productSnapshot.combinationKey || null,
          selectedAttributes:
            selectedAttributes ||
            item.productSnapshot.selectedAttributes ||
            null,
        };

        let itemTaxRate: number | null = null;
        let itemTaxAmount: number | null = null;
        let itemPriceExclTax: number | null = null;
        let itemTotalExclTax: number | null = null;

        if (taxEnabled) {
          const effectiveRate = getEffectiveTaxRate(
            { enabled: true, rate: storeTaxRate, displayMode },
            productTaxSettings,
          );

          if (effectiveRate !== null && effectiveRate > 0) {
            itemTaxRate = effectiveRate;
            if (displayMode === 'inclusive') {
              itemPriceExclTax = extractExclusiveFromInclusive(
                serverItem.unitPrice,
                effectiveRate,
              );
              itemTotalExclTax = extractExclusiveFromInclusive(
                totalPrice,
                effectiveRate,
              );
              itemTaxAmount = totalPrice - itemTotalExclTax;
            } else {
              itemPriceExclTax = serverItem.unitPrice;
              itemTotalExclTax = totalPrice;
              itemTaxAmount = calculateTaxFromExclusive(
                totalPrice,
                effectiveRate,
              );
            }
          }
        }

        await tx.insert(reservationItems).values({
          reservationId,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: serverItem.unitPrice.toFixed(2),
          depositPerUnit: serverItem.depositPerUnit.toFixed(2),
          totalPrice: totalPrice.toFixed(2),
          productSnapshot: snapshot,
          combinationKey,
          selectedAttributes,
          taxRate: itemTaxRate?.toFixed(2) ?? null,
          taxAmount: itemTaxAmount?.toFixed(2) ?? null,
          priceExclTax: itemPriceExclTax?.toFixed(2) ?? null,
          totalExclTax: itemTotalExclTax?.toFixed(2) ?? null,
        });
      }

      if (tulipInsuranceAmount > 0) {
        await tx.insert(reservationItems).values({
          reservationId,
          productId: null,
          isCustomItem: true,
          quantity: 1,
          unitPrice: tulipInsuranceAmount.toFixed(2),
          depositPerUnit: '0.00',
          totalPrice: tulipInsuranceAmount.toFixed(2),
          productSnapshot: {
            name: 'Garantie casse/vol',
            description: 'Garantie casse/vol',
            images: [],
          },
        });
      }

      await tx.insert(reservationActivity).values({
        id: nanoid(),
        reservationId,
        activityType: 'created',
        description: null,
        metadata: {
          source: 'online',
          status: 'pending',
          customerEmail: input.customer.email,
          customerName: `${input.customer.firstName} ${input.customer.lastName}`,
          tulipInsuranceOptIn,
          tulipInsuranceAmount,
          tulipInsuredProductCount,
          tulipUninsuredProductCount,
          ...(tulipQuoteFallbackError && {
            tulipQuoteFallbackError,
          }),
        },
        createdAt: new Date(),
      });

      return {
        ok: true as const,
        reservationId,
        reservationNumber,
        customerId: customer.id,
        customerEmail: customer.email,
        taxRate,
        subtotalExclTax,
        taxAmount,
      };
    });

    if (!reservationWriteResult.ok) {
      if (reservationWriteResult.error === 'errors.productNoLongerAvailable') {
        return {
          error: reservationWriteResult.error,
          errorParams: { name: reservationWriteResult.productName || '' },
        };
      }

      return { error: reservationWriteResult.error };
    }

    const {
      reservationId,
      reservationNumber,
      customerId,
      customerEmail,
      taxRate,
      subtotalExclTax,
      taxAmount,
    } = reservationWriteResult;

    const checkoutCurrency = store.settings?.currency || 'EUR';
    const checkoutTotalQuantity = input.items.reduce(
      (total, item) => total + item.quantity,
      0,
    );

    await captureProductServerEvent({
      distinctId: customerId,
      event: productAnalyticsEvents.checkoutReservationCreated,
      properties: {
        feature: 'checkout',
        surface: 'storefront',
        store_id: input.storeId,
        reservation_id: reservationId,
        customer_id: customerId,
        source: 'storefront_checkout',
        reservation_status: 'pending',
        reservation_mode: store.settings?.reservationMode ?? null,
        catalog_line_count: input.items.length,
        total_quantity: checkoutTotalQuantity,
        has_delivery: hasAnyDelivery,
        has_outbound_delivery: hasOutboundDelivery,
        has_return_delivery: hasReturnDelivery,
        has_tulip_insurance: tulipInsuranceAmount > 0,
        tulip_insurance_opt_in: tulipInsuranceOptIn,
        promo_code_used: Boolean(validatedPromoCodeId),
        payment_ready: Boolean(
          store.stripeAccountId && store.stripeChargesEnabled,
        ),
        subtotal_amount_cents: toAnalyticsAmountCents(finalSubtotal),
        discount_amount_cents: toAnalyticsAmountCents(finalDiscount),
        delivery_fee_cents: toAnalyticsAmountCents(finalDeliveryFee),
        deposit_amount_cents: toAnalyticsAmountCents(finalDeposit),
        total_amount_cents: toAnalyticsAmountCents(finalTotal),
        currency: checkoutCurrency,
      },
    });

    await queueReservationCalendarSync(input.storeId, reservationId);

    // Get store owner for fallback email
    const ownerMember = await db
      .select({ email: users.email })
      .from(storeMembers)
      .innerJoin(users, eq(storeMembers.userId, users.id))
      .where(
        and(
          eq(storeMembers.storeId, input.storeId),
          eq(storeMembers.role, 'owner'),
        ),
      )
      .limit(1)
      .then((res) => res[0]);

    // Send confirmation emails (non-blocking)
    if (store) {
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
      };

      const customerData = {
        firstName: input.customer.firstName,
        lastName: input.customer.lastName,
        email: input.customer.email,
        customerType: input.customer.customerType || 'individual',
        companyName: input.customer.companyName || null,
      };

      // Use SERVER-CALCULATED amounts for all notifications
      const reservationData = {
        id: reservationId,
        number: reservationNumber,
        startDate,
        endDate,
        totalAmount: finalTotal,
        // Tax info for emails
        taxEnabled,
        taxRate,
        subtotalExclTax,
        taxAmount,
      };

      // Dispatch customer notification (email/SMS based on store preferences)
      dispatchCustomerNotification('customer_request_received', {
        store: {
          id: store.id,
          name: store.name,
          email: store.email,
          logoUrl: store.logoUrl,
          darkLogoUrl: store.darkLogoUrl,
          address: store.address,
          phone: store.phone,
          theme: store.theme,
          settings: store.settings,
          emailSettings: store.emailSettings,
          customerNotificationSettings: store.customerNotificationSettings,
        },
        customer: {
          id: customerId,
          firstName: input.customer.firstName,
          lastName: input.customer.lastName,
          email: input.customer.email,
          phone: customerPhone,
        },
        reservation: {
          id: reservationId,
          number: reservationNumber,
          startDate,
          endDate,
          totalAmount: finalTotal,
          subtotalAmount: finalSubtotal,
          depositAmount: finalDeposit,
          taxEnabled,
          taxRate,
          subtotalExclTax,
          taxAmount,
        },
      }).catch((error: unknown) => {
        console.error(
          'Failed to dispatch customer request received notification:',
          error,
        );
      });

      // Send email to landlord (new request notification) - always in French for landlord
      const landlordEmail = store.email || ownerMember?.email;
      if (landlordEmail) {
        const dashboardUrl = `${env.NEXT_PUBLIC_APP_URL}/dashboard/reservations/${reservationId}`;
        sendNewRequestLandlordEmail({
          to: landlordEmail,
          store: storeData,
          customer: customerData,
          reservation: reservationData,
          dashboardUrl,
          locale: getLocaleFromCountry(store.settings?.country),
        }).catch((error) => {
          console.error('Failed to send new request landlord email:', error);
        });
      }

      // Dispatch admin notifications (SMS, Discord) for new reservation
      dispatchNotification('reservation_new', {
        store: {
          id: store.id,
          name: store.name,
          email: store.email,
          discordWebhookUrl: store.discordWebhookUrl,
          ownerPhone: store.ownerPhone,
          notificationSettings: store.notificationSettings,
          settings: store.settings,
        },
        reservation: {
          id: reservationId,
          number: reservationNumber,
          startDate,
          endDate,
          totalAmount: finalTotal,
        },
        customer: {
          firstName: input.customer.firstName,
          lastName: input.customer.lastName,
          email: input.customer.email,
          phone: customerPhone,
        },
      }).catch((error) => {
        console.error(
          'Failed to dispatch new reservation notification:',
          error,
        );
      });

      // Platform admin notification
      notifyNewReservation(
        { id: store.id, name: store.name, slug: store.slug },
        {
          number: reservationNumber,
          customerName: `${input.customer.firstName} ${input.customer.lastName}`,
          totalAmount: finalTotal,
          currency: store.settings?.currency,
        },
      ).catch(() => {});
    }

    // Check if we should process payment via Stripe
    const shouldProcessPayment =
      store.settings?.reservationMode === 'payment' &&
      store.stripeAccountId &&
      store.stripeChargesEnabled;

    let paymentUrl: string | null = null;

    if (shouldProcessPayment) {
      try {
        const currency = store.settings?.currency || 'EUR';
        const domain = env.NEXT_PUBLIC_APP_DOMAIN;
        const protocol = domain.includes('localhost') ? 'http' : 'https';
        const baseUrl = `${protocol}://${store.slug}.${domain}`;

        // Get deposit percentage (default 100% = full payment)
        const depositPercentage =
          store.settings?.onlinePaymentDepositPercentage ?? 100;
        const isPartialPayment = depositPercentage < 100;

        // Calculate the amount to charge now (after promo discount, including delivery)
        // Round to 2 decimal places to avoid floating point issues
        const chargeableTotal =
          finalSubtotal - finalDiscount + finalDeliveryFee;
        const amountToCharge = isPartialPayment
          ? Math.round(chargeableTotal * depositPercentage) / 100
          : chargeableTotal;

        // Ensure minimum Stripe amount (50 cents for most currencies)
        const MINIMUM_STRIPE_AMOUNT = 0.5;
        const effectiveChargeAmount = Math.max(
          amountToCharge,
          MINIMUM_STRIPE_AMOUNT,
        );
        // Don't exceed the full amount (after discount)
        const finalChargeAmount = Math.min(
          effectiveChargeAmount,
          chargeableTotal,
        );

        // Build line items for Stripe
        // For partial payments, create a single line item for the deposit
        // For full payments, itemize each product
        const lineItems = isPartialPayment
          ? [
              {
                name: `Acompte (${depositPercentage}%)`,
                description: `Acompte pour la réservation ${reservationNumber}`,
                quantity: 1,
                unitAmount: toStripeCents(finalChargeAmount, currency),
              },
            ]
          : [
              ...input.items.map((item, idx) => {
                const serverItem = serverCalculatedItems[idx];
                return {
                  name: item.productSnapshot.name,
                  quantity: item.quantity,
                  unitAmount: toStripeCents(
                    serverItem.subtotal / item.quantity,
                    currency,
                  ),
                };
              }),
              ...(tulipInsuranceAmount > 0
                ? [
                    {
                      name: 'Garantie casse/vol',
                      description: `Garantie casse/vol - réservation ${reservationNumber}`,
                      quantity: 1,
                      unitAmount: toStripeCents(tulipInsuranceAmount, currency),
                    },
                  ]
                : []),
              ...(finalDeliveryFee > 0
                ? [
                    {
                      name: 'Livraison',
                      quantity: 1,
                      unitAmount: toStripeCents(finalDeliveryFee, currency),
                    },
                  ]
                : []),
            ];

        // Skim the platform fee directly from the online payment via a Stripe
        // application fee: the pay-as-you-go reservation commission. Capped below
        // the charge amount; the exact amount is recorded on confirmation
        // (webhook) from metadata.
        const billing = await getStoreBilling(store.id);
        const feePlan = await planStripeFees({
          storeId: store.id,
          reservationId,
          chargeCents: toStripeCents(finalChargeAmount, currency),
          billing,
        });

        // Create checkout session
        const { url, sessionId } = await createCheckoutSession({
          stripeAccountId: store.stripeAccountId!,
          reservationId,
          reservationNumber,
          customerEmail,
          customerName: `${input.customer.firstName} ${input.customer.lastName}`,
          lineItems,
          depositAmount: toStripeCents(finalDeposit, currency),
          currency,
          successUrl: `${baseUrl}/checkout/success?reservation=${reservationId}`,
          cancelUrl: `${baseUrl}/checkout?cancelled=true`,
          locale: input.locale,
          applicationFeeAmount: feePlan.applicationFeeCents,
          feeMetadata: buildFeeMetadata(feePlan),
        });

        paymentUrl = url;

        // Create a pending payment record with the amount being charged
        await db.insert(payments).values({
          id: nanoid(),
          reservationId,
          amount: finalChargeAmount.toFixed(2),
          type: 'rental',
          method: 'stripe',
          status: 'pending',
          stripeCheckoutSessionId: sessionId,
          currency,
          notes: isPartialPayment ? `Acompte ${depositPercentage}%` : null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // Log payment initiated activity
        await db.insert(reservationActivity).values({
          id: nanoid(),
          reservationId,
          activityType: 'payment_initiated',
          description: null,
          metadata: {
            checkoutSessionId: sessionId,
            amount: finalChargeAmount,
            fullAmount: finalSubtotal,
            depositPercentage,
            isPartialPayment,
            currency,
            method: 'stripe',
          },
          createdAt: new Date(),
        });

        await captureProductServerEvent({
          distinctId: customerId,
          event: productAnalyticsEvents.checkoutPaymentStarted,
          properties: {
            feature: 'checkout',
            surface: 'storefront',
            store_id: input.storeId,
            reservation_id: reservationId,
            customer_id: customerId,
            source: 'storefront_checkout',
            payment_provider: 'stripe',
            payment_mode: isPartialPayment ? 'partial' : 'full',
            deposit_percentage: depositPercentage,
            amount_cents: toAnalyticsAmountCents(finalChargeAmount),
            total_amount_cents: toAnalyticsAmountCents(finalTotal),
            application_fee_cents: feePlan.applicationFeeCents,
            reservation_fee_cents: feePlan.reservationFeeCents,
            currency,
          },
        });
      } catch (error) {
        console.error('Failed to create Stripe checkout session:', error);
        // Don't fail the reservation, store owner can send payment link manually
      }
    }

    return {
      success: true,
      reservationId,
      reservationNumber,
      paymentUrl,
    };
  } catch (error) {
    console.error('Error creating reservation:', error);
    return { error: 'errors.createReservationError' };
  }
}
