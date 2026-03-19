'use server';

import { revalidatePath } from 'next/cache';

import { and, eq, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { db } from '@louez/db';
import {
  customers,
  paymentRequests,
  payments,
  productSeasonalPricing,
  productSeasonalPricingTiers,
  productUnits,
  products,
  reservationActivity,
  reservationItemUnits,
  reservationItems,
  reservations,
  verificationCodes,
} from '@louez/db';
import type { NotificationEventType } from '@louez/types';
import type { Rate } from '@louez/types';
import type {
  BookingAttributeAxis,
  PricingBreakdown,
  PricingMode,
  StoreSettings,
  TulipPublicMode,
  UnitAttributes,
} from '@louez/types';
import {
  DEFAULT_COMBINATION_KEY,
  buildCombinationKey,
  canonicalizeAttributes,
  getCurrencySymbol,
  hasCompleteAttributes,
} from '@louez/utils';
import {
  type PricingTier,
  type SeasonalPricingConfig,
  calculateDuration,
  calculateDurationMinutes,
  calculateRateBasedPrice,
  calculateRentalPrice,
  calculateSeasonalAwarePrice,
  generatePricingBreakdown,
  isRateBasedProduct,
} from '@louez/utils';
import type { ReservationStatus } from '@louez/validations';

import { auth } from '@/lib/auth';
import {
  notifyEquipmentPickedUp,
  notifyNewReservation,
  notifyPaymentReceived,
  notifyReservationCancelled,
  notifyReservationCompleted,
  notifyReservationConfirmed,
  notifyReservationRejected,
} from '@/lib/discord/platform-notifications';
import { sendEmail } from '@/lib/email/client';
import { getLocaleFromCountry } from '@/lib/email/i18n';
import {
  sendDepositAuthorizationRequestEmail,
  sendInstantAccessEmail,
  sendPaymentRequestEmail,
  sendReminderPickupEmail,
  sendReminderReturnEmail,
  sendReservationConfirmationEmail,
} from '@/lib/email/send';
import {
  cancelTulipContractForReservation,
  createTulipContractForReservation,
  previewTulipQuoteForCheckout,
  syncTulipContractForReservation,
} from '@/lib/integrations/tulip/contracts';
import {
  getReservationInsuranceSelection,
  isLegacyTulipInsuranceItem,
} from '@/lib/integrations/tulip/contracts-insurance';
import { getTulipSettings } from '@/lib/integrations/tulip/settings';
import { dispatchCustomerNotification } from '@/lib/notifications/customer-dispatcher';
import { dispatchNotification } from '@/lib/notifications/dispatcher';
import {
  isSmsConfigured,
  sendAccessLinkSms,
  sendDepositAuthorizationRequestSms,
  sendPaymentRequestSms,
} from '@/lib/sms';
import { getCurrentStore } from '@/lib/store-context';
// ============================================================================
// Deposit Authorization Hold (Empreinte Bancaire)
// ============================================================================

import {
  captureDeposit,
  createDepositAuthorization,
  createRefund,
  getChargeRefundableAmount,
  getPaymentMethodDetails,
  releaseDeposit,
  toStripeCents,
} from '@/lib/stripe';
import { getContrastColorHex } from '@/lib/utils/colors';
import {
  calculateTotalDeliveryFee,
  calculateHaversineDistance,
  validateDelivery,
} from '@/lib/utils/geo';
import { evaluateReservationRules } from '@/lib/utils/reservation-rules';

import { env } from '@/env';

async function getStoreForUser() {
  return getCurrentStore();
}

function toPricingMode(value: unknown): PricingMode {
  if (value === 'hour' || value === 'day' || value === 'week') {
    return value;
  }
  return 'day';
}

async function fetchSeasonalPricingConfigs(
  productId: string,
): Promise<SeasonalPricingConfig[]> {
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
  | 'created'
  | 'confirmed'
  | 'rejected'
  | 'cancelled'
  | 'picked_up'
  | 'returned'
  | 'note_updated'
  | 'payment_added'
  | 'payment_updated'
  | 'access_link_sent'
  | 'modified'
  | 'inspection_departure_started'
  | 'inspection_departure_completed'
  | 'inspection_return_started'
  | 'inspection_return_completed'
  | 'inspection_damage_detected'
  | 'inspection_signed'
  | 'quote_accepted'
  | 'quote_declined';

function getErrorKey(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.startsWith('errors.')) {
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
  if (params.mode === 'required') {
    return true;
  }

  if (params.mode === 'no_public') {
    return false;
  }

  if (typeof params.requested === 'boolean') {
    return params.requested;
  }

  if (typeof params.current === 'boolean') {
    return params.current;
  }

  return params.defaultOptional ?? true;
}

function getDashboardTulipInsuranceMode(
  settings: StoreSettings | null | undefined,
): TulipPublicMode {
  const tulipSettings = getTulipSettings(settings || null);
  if (!tulipSettings.enabled) {
    return 'no_public';
  }

  if (tulipSettings.publicMode === 'required') {
    return 'required';
  }

  return 'optional';
}

async function logReservationActivity(
  reservationId: string,
  activityType: ActivityType,
  metadata?: Record<string, unknown>,
) {
  const session = await auth();
  const userId = session?.user?.id || null;

  await db.insert(reservationActivity).values({
    id: nanoid(),
    reservationId,
    userId,
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
    .where(
      and(
        eq(reservations.storeId, storeId),
        sql`YEAR(${reservations.createdAt}) = ${year}`,
      ),
    );

  const count = result[0]?.count || 0;
  const nextNumber = count + 1;

  return `${year}-${String(nextNumber).padStart(4, '0')}`;
}

export async function updateReservationStatus(
  reservationId: string,
  status: ReservationStatus,
  rejectionReason?: string,
) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: 'errors.unauthorized' };
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, store.id),
    ),
    with: {
      customer: true,
      items: true,
    },
  });

  if (!reservation) {
    return { error: 'errors.reservationNotFound' };
  }

  const validationWarnings =
    status === 'confirmed'
      ? evaluateReservationRules({
          startDate: reservation.startDate,
          endDate: reservation.endDate,
          storeSettings: store.settings,
        })
      : [];

  const previousStatus = reservation.status;
  const updateData: Record<string, unknown> = {
    status,
    updatedAt: new Date(),
  };

  // Set timestamps based on status transition
  if (status === 'ongoing') {
    updateData.pickedUpAt = new Date();
  } else if (status === 'completed') {
    updateData.returnedAt = new Date();
  }

  await db
    .update(reservations)
    .set(updateData)
    .where(eq(reservations.id, reservationId));

  // Log activity based on status transition
  const activityMap: Record<string, ActivityType> = {
    confirmed: 'confirmed',
    rejected: 'rejected',
    ongoing: 'picked_up',
    completed: 'returned',
  };

  if (activityMap[status]) {
    await logReservationActivity(
      reservationId,
      activityMap[status],
      {
        previousStatus,
        newStatus: status,
        ...(status === 'rejected' && rejectionReason && { rejectionReason }),
        ...(validationWarnings.length > 0 && {
          validationWarnings,
          validationWarningsCount: validationWarnings.length,
        }),
      },
    );
  }

  let tulipWarning: {
    key: string;
    params?: Record<string, string | number>;
  } | null = null;
  if (status === 'confirmed') {
    try {
      await createTulipContractForReservation({
        reservationId,
        source: 'dashboard_reservation_confirmation',
      });
    } catch (error) {
      console.error(
        '[tulip] Failed to create contract from dashboard confirmation:',
        {
          reservationId,
          error,
        },
      );

      tulipWarning = {
        key: getErrorKey(error, 'errors.tulipContractCreationFailed'),
      };
    }
  }

  // Send emails based on status change
  const domain = env.NEXT_PUBLIC_APP_DOMAIN;
  const reservationUrl = `https://${store.slug}.${domain}/account/reservations/${reservationId}`;

  // Build customer notification context
  const customerNotificationCtx = {
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
      id: reservation.customer.id,
      firstName: reservation.customer.firstName,
      lastName: reservation.customer.lastName,
      email: reservation.customer.email,
      phone: reservation.customer.phone,
    },
    reservation: {
      id: reservationId,
      number: reservation.number,
      startDate: reservation.startDate,
      endDate: reservation.endDate,
      totalAmount: parseFloat(reservation.totalAmount),
      subtotalAmount: parseFloat(reservation.subtotalAmount),
      depositAmount: parseFloat(reservation.depositAmount),
      taxEnabled: !!reservation.taxRate,
      taxRate: reservation.taxRate ? parseFloat(reservation.taxRate) : null,
      subtotalExclTax: reservation.subtotalExclTax
        ? parseFloat(reservation.subtotalExclTax)
        : null,
      taxAmount: reservation.taxAmount
        ? parseFloat(reservation.taxAmount)
        : null,
    },
    reservationUrl,
  };

  // Dispatch customer notification based on status change
  if ((previousStatus === 'pending' || previousStatus === 'quote') && status === 'confirmed') {
    // Request/quote accepted - build items for email
    const emailItems = reservation.items.map((item) => ({
      name: item.productSnapshot?.name || 'Product',
      quantity: item.quantity,
      unitPrice: parseFloat(item.unitPrice),
      totalPrice: parseFloat(item.totalPrice),
    }));

    dispatchCustomerNotification('customer_request_accepted', {
      ...customerNotificationCtx,
      items: emailItems,
      paymentUrl: null,
    }).catch((error: unknown) => {
      console.error(
        'Failed to dispatch customer request accepted notification:',
        error,
      );
    });
  } else if (status === 'rejected') {
    // Request rejected
    dispatchCustomerNotification('customer_request_rejected', {
      ...customerNotificationCtx,
      reason: rejectionReason,
    }).catch((error: unknown) => {
      console.error(
        'Failed to dispatch customer request rejected notification:',
        error,
      );
    });
  }

  // Dispatch admin notifications (SMS, Discord) based on preferences
  const notificationEventMap: Record<string, NotificationEventType> = {
    confirmed: 'reservation_confirmed',
    rejected: 'reservation_rejected',
    ongoing: 'reservation_picked_up',
    completed: 'reservation_completed',
  };

  const eventType = notificationEventMap[status];
  if (eventType) {
    dispatchNotification(eventType, {
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
        number: reservation.number,
        startDate: reservation.startDate,
        endDate: reservation.endDate,
        totalAmount: parseFloat(reservation.totalAmount),
      },
      customer: {
        firstName: reservation.customer.firstName,
        lastName: reservation.customer.lastName,
        email: reservation.customer.email,
        phone: reservation.customer.phone,
      },
    }).catch((error) => {
      console.error('Failed to dispatch admin notification:', error);
    });
  }

  // Platform admin notification
  const storeInfo = { id: store.id, name: store.name, slug: store.slug };
  const currency = store.settings?.currency;
  if (status === 'confirmed') {
    notifyReservationConfirmed(storeInfo, reservation.number).catch(() => {});
  } else if (status === 'rejected') {
    notifyReservationRejected(storeInfo, reservation.number).catch(() => {});
  } else if (status === 'ongoing') {
    notifyEquipmentPickedUp(storeInfo, reservation.number).catch(() => {});
  } else if (status === 'completed') {
    notifyReservationCompleted(
      storeInfo,
      reservation.number,
      parseFloat(reservation.totalAmount),
      currency,
    ).catch(() => {});
  }

  revalidatePath('/dashboard/reservations');
  revalidatePath(`/dashboard/reservations/${reservationId}`);
  const responseWarnings = [
    ...validationWarnings.map((warning) => ({
      key: warning.key,
      params: warning.params,
    })),
    ...(tulipWarning ? [tulipWarning] : []),
  ];

  return {
    success: true,
    ...(responseWarnings.length > 0 && { warnings: responseWarnings }),
  };
}

export async function cancelReservation(reservationId: string) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: 'errors.unauthorized' };
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, store.id),
    ),
    with: {
      customer: true,
    },
  });

  if (!reservation) {
    return { error: 'errors.reservationNotFound' };
  }

  if (
    ['cancelled', 'completed', 'rejected', 'declined'].includes(reservation.status || '')
  ) {
    return { error: 'errors.cannotCancelReservation' };
  }

  await db
    .update(reservations)
    .set({
      status: 'cancelled',
      updatedAt: new Date(),
    })
    .where(eq(reservations.id, reservationId));

  // Log activity
  await logReservationActivity(reservationId, 'cancelled', {
    previousStatus: reservation.status,
  });

  if (reservation.tulipContractId) {
    try {
      await cancelTulipContractForReservation({ reservationId });
    } catch (error) {
      console.error(
        '[tulip] Failed to cancel contract from dashboard cancellation:',
        {
          reservationId,
          contractId: reservation.tulipContractId,
          error,
        },
      );
    }
  }

  // Dispatch admin notifications (SMS, Discord) based on preferences
  dispatchNotification('reservation_cancelled', {
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
      number: reservation.number,
      startDate: reservation.startDate,
      endDate: reservation.endDate,
      totalAmount: parseFloat(reservation.totalAmount),
    },
    customer: {
      firstName: reservation.customer.firstName,
      lastName: reservation.customer.lastName,
      email: reservation.customer.email,
      phone: reservation.customer.phone,
    },
  }).catch((error) => {
    console.error('Failed to dispatch cancellation notification:', error);
  });

  // Platform admin notification
  notifyReservationCancelled(
    { id: store.id, name: store.name, slug: store.slug },
    reservation.number,
  ).catch(() => {});

  revalidatePath('/dashboard/reservations');
  revalidatePath(`/dashboard/reservations/${reservationId}`);
  return { success: true };
}

export async function updateReservationNotes(
  reservationId: string,
  internalNotes: string,
) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: 'errors.unauthorized' };
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, store.id),
    ),
  });

  if (!reservation) {
    return { error: 'errors.reservationNotFound' };
  }

  await db
    .update(reservations)
    .set({
      internalNotes,
      updatedAt: new Date(),
    })
    .where(eq(reservations.id, reservationId));

  revalidatePath(`/dashboard/reservations/${reservationId}`);
  return { success: true };
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
      method: 'store' | 'address';
      address?: string;
      city?: string;
      postalCode?: string;
      country?: string;
      latitude?: number;
      longitude?: number;
    };
    return: {
      method: 'store' | 'address';
      address?: string;
      city?: string;
      postalCode?: string;
      country?: string;
      latitude?: number;
      longitude?: number;
    };
  };
  internalNotes?: string;
  tulipInsuranceOptIn?: boolean;
  sendConfirmationEmail?: boolean;
  sendAsQuote?: boolean;
}

export async function createManualReservation(data: CreateReservationData) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: 'errors.unauthorized' };
  }

  let customerId = data.customerId;

  // Create new customer if needed
  if (!customerId && data.newCustomer) {
    // Check if customer exists
    const existingCustomer = await db.query.customers.findFirst({
      where: and(
        eq(customers.storeId, store.id),
        eq(customers.email, data.newCustomer.email),
      ),
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
      });
      customerId = newCustomerId;
    }
  }

  if (!customerId) {
    return { error: 'errors.customerRequired' };
  }

  const tulipMode = getDashboardTulipInsuranceMode(
    store.settings as StoreSettings | null,
  );
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
        where: and(
          eq(products.id, item.productId),
          eq(products.storeId, store.id),
        ),
        with: {
          pricingTiers: true,
        },
      });

      if (!product) {
        throw new Error(`errors.productNotFound`);
      }

      const bookingAttributeAxes = (product.bookingAttributeAxes ||
        []) as BookingAttributeAxis[];
      const normalizedSelectedAttributes = canonicalizeAttributes(
        bookingAttributeAxes,
        item.selectedAttributes,
      );
      const hasSelectedAttributes =
        Object.keys(normalizedSelectedAttributes).length > 0;
      const hasCompleteSelection = hasCompleteAttributes(
        bookingAttributeAxes,
        normalizedSelectedAttributes,
      );
      const combinationKey =
        bookingAttributeAxes.length > 0
          ? hasCompleteSelection
            ? buildCombinationKey(
                bookingAttributeAxes,
                normalizedSelectedAttributes,
              )
            : null
          : product.trackUnits
            ? DEFAULT_COMBINATION_KEY
            : null;

      // Get effective pricing mode for this product
      const effectivePricingMode = toPricingMode(product.pricingMode);
      const duration = calculateDuration(
        data.startDate,
        data.endDate,
        effectivePricingMode,
      );
      const durationMinutes = calculateDurationMinutes(
        data.startDate,
        data.endDate,
      );

      // Convert pricing tiers to the expected format
      const tiers: PricingTier[] = (product.pricingTiers || []).map((tier) => ({
        id: tier.id,
        minDuration: tier.minDuration ?? 1,
        discountPercent: parseFloat(tier.discountPercent ?? '0'),
        displayOrder: tier.displayOrder || 0,
      }));
      const rates: Rate[] = (product.pricingTiers || [])
        .filter(
          (tier): tier is typeof tier & { period: number; price: string } =>
            typeof tier.period === 'number' &&
            tier.period > 0 &&
            typeof tier.price === 'string',
        )
        .map((tier, index) => ({
          id: tier.id,
          period: tier.period,
          price: parseFloat(tier.price),
          displayOrder: tier.displayOrder ?? index,
        }));

      // Fetch seasonal pricings for this product
      const seasonalPricingConfigs = await fetchSeasonalPricingConfigs(
        product.id,
      );

      const seasonalResult = calculateSeasonalAwarePrice(
        {
          basePrice: parseFloat(product.price),
          basePeriodMinutes: product.basePeriodMinutes ?? null,
          deposit: parseFloat(product.deposit || '0'),
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

      let pricingBreakdown: PricingBreakdown = {
        basePrice: parseFloat(product.price),
        effectivePrice: seasonalResult.subtotal / Math.max(1, item.quantity),
        duration: durationMinutes,
        pricingMode: effectivePricingMode,
        discountPercent:
          seasonalResult.savings > 0 && seasonalResult.originalSubtotal > 0
            ? Math.round(
                (seasonalResult.savings / seasonalResult.originalSubtotal) *
                  100,
              )
            : null,
        discountAmount: seasonalResult.savings,
        tierApplied: null,
        durationMinutes,
        appliedPeriods: undefined,
        optimizerVersion: 'v2',
        taxRate: null,
        taxAmount: null,
        subtotalExclTax: null,
        subtotalInclTax: null,
        ...(seasonalResult.isSeasonal
          ? {
              seasonalSegments: seasonalResult.segments.map((seg) => ({
                seasonalPricingId: seg.seasonalPricingId,
                seasonalPricingName: seg.seasonalPricingName,
                startDate: seg.startDate.toISOString(),
                endDate: seg.endDate.toISOString(),
                subtotal: seg.subtotal,
              })),
            }
          : {}),
      };

      // Check for price override
      const hasPriceOverride = !!item.priceOverride;
      let effectiveUnitPrice =
        priceResult.subtotal / Math.max(1, item.quantity);
      let effectiveSubtotal = priceResult.subtotal;

      if (hasPriceOverride) {
        effectiveUnitPrice = item.priceOverride!.unitPrice;
        effectiveSubtotal = effectiveUnitPrice * duration * item.quantity;

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
        depositPerUnit: product.deposit || '0',
        totalPrice: effectiveSubtotal.toFixed(2),
        pricingBreakdown,
        combinationKey,
        selectedAttributes: hasSelectedAttributes
          ? normalizedSelectedAttributes
          : null,
        isCustomItem: false,
      };
    }),
  );

  // Process custom items (no tiered pricing for custom items)
  const customItemDetails = (data.customItems || []).map((item) => {
    const duration = calculateDuration(
      data.startDate,
      data.endDate,
      item.pricingMode,
    );
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

  // Delivery validation and fee calculation
  let deliveryFeeAmount = 0;
  let deliveryDistanceKm: number | null = null;
  let returnDistanceKm: number | null = null;
  const storeDeliverySettings = store.settings?.delivery;

  const outboundLeg = data.delivery?.outbound;
  const returnLeg = data.delivery?.return;
  const hasOutboundDelivery = outboundLeg?.method === 'address';
  const hasReturnDelivery = returnLeg?.method === 'address';
  const hasAnyDelivery = hasOutboundDelivery || hasReturnDelivery;

  if (hasAnyDelivery) {
    if (!storeDeliverySettings?.enabled) {
      return { error: 'errors.deliveryNotEnabled' };
    }

    if (!store.latitude || !store.longitude) {
      return { error: 'errors.storeCoordinatesNotConfigured' };
    }

    const sLat = parseFloat(store.latitude);
    const sLon = parseFloat(store.longitude);

    // Validate outbound leg
    if (hasOutboundDelivery) {
      if (!outboundLeg.latitude || !outboundLeg.longitude) {
        return { error: 'errors.deliveryAddressRequired' };
      }

      deliveryDistanceKm = calculateHaversineDistance(
        sLat, sLon,
        outboundLeg.latitude, outboundLeg.longitude,
      );

      const validation = validateDelivery(deliveryDistanceKm, storeDeliverySettings);
      if (!validation.valid) {
        return { error: validation.errorKey || 'errors.deliveryTooFar' };
      }
    }

    // Validate return leg
    if (hasReturnDelivery) {
      if (!returnLeg.latitude || !returnLeg.longitude) {
        return { error: 'errors.returnAddressRequired' };
      }

      returnDistanceKm = calculateHaversineDistance(
        sLat, sLon,
        returnLeg.latitude, returnLeg.longitude,
      );

      const returnValidation = validateDelivery(returnDistanceKm, storeDeliverySettings);
      if (!returnValidation.valid) {
        return { error: 'errors.returnAddressTooFar' };
      }
    }

    // Calculate delivery fee server-side
    const isIncluded = storeDeliverySettings.mode === 'included';
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

  // Create reservation
  const reservationId = nanoid();
  await db.insert(reservations).values({
    id: reservationId,
    storeId: store.id,
    customerId,
    number: reservationNumber,
    status: data.sendAsQuote ? 'quote' : 'confirmed',
    startDate: data.startDate,
    endDate: data.endDate,
    subtotalAmount: subtotalAmount.toFixed(2),
    depositAmount: depositAmount.toFixed(2),
    totalAmount: (subtotalAmount + deliveryFeeAmount).toFixed(2),
    internalNotes: data.internalNotes || null,
    source: 'manual',
    tulipInsuranceOptIn,
    tulipInsuranceAmount: null,
    // Delivery fields — leg-based model
    outboundMethod: outboundLeg?.method || 'store',
    returnMethod: returnLeg?.method || 'store',
    deliveryOption: hasAnyDelivery ? 'delivery' : 'pickup',
    deliveryAddress: hasOutboundDelivery ? (outboundLeg.address ?? null) : null,
    deliveryCity: hasOutboundDelivery ? (outboundLeg.city ?? null) : null,
    deliveryPostalCode: hasOutboundDelivery ? (outboundLeg.postalCode ?? null) : null,
    deliveryCountry: hasOutboundDelivery ? (outboundLeg.country ?? null) : null,
    deliveryLatitude: hasOutboundDelivery && outboundLeg.latitude ? outboundLeg.latitude.toString() : null,
    deliveryLongitude: hasOutboundDelivery && outboundLeg.longitude ? outboundLeg.longitude.toString() : null,
    deliveryDistanceKm: deliveryDistanceKm?.toFixed(2) ?? null,
    deliveryFee: deliveryFeeAmount.toFixed(2),
    returnAddress: hasReturnDelivery ? (returnLeg.address ?? null) : null,
    returnCity: hasReturnDelivery ? (returnLeg.city ?? null) : null,
    returnPostalCode: hasReturnDelivery ? (returnLeg.postalCode ?? null) : null,
    returnCountry: hasReturnDelivery ? (returnLeg.country ?? null) : null,
    returnLatitude: hasReturnDelivery && returnLeg.latitude != null ? returnLeg.latitude.toString() : null,
    returnLongitude: hasReturnDelivery && returnLeg.longitude != null ? returnLeg.longitude.toString() : null,
    returnDistanceKm: returnDistanceKm?.toFixed(2) ?? null,
  });

  // Create reservation items for catalog products
  for (const detail of productDetails) {
    await db.insert(reservationItems).values({
      reservationId,
      productId: detail.product.id,
      isCustomItem: false,
      quantity: detail.quantity,
      unitPrice: detail.unitPrice,
      depositPerUnit: detail.depositPerUnit,
      totalPrice: detail.totalPrice,
      pricingBreakdown: detail.pricingBreakdown,
      combinationKey: detail.combinationKey,
      selectedAttributes: detail.selectedAttributes,
      productSnapshot: {
        name: detail.product.name,
        description: detail.product.description,
        images: detail.product.images || [],
        combinationKey: detail.combinationKey,
        selectedAttributes: detail.selectedAttributes,
      },
    });
  }

  // Create reservation items for custom items
  for (const customItem of customItemDetails) {
    await db.insert(reservationItems).values({
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

  // Log activity for manual reservation creation
  await logReservationActivity(
    reservationId,
    'created',
    { source: 'manual', status: data.sendAsQuote ? 'quote' : 'confirmed' },
  );

  try {
    await createTulipContractForReservation({
      reservationId,
      source: 'dashboard_manual_reservation_creation',
    });
  } catch (error) {
    console.error('[tulip] Failed to create contract for manual reservation:', {
      reservationId,
      error,
    });
  }

  // Get customer info for email
  const customer = await db.query.customers.findFirst({
    where: eq(customers.id, customerId),
  });

  // Send email for manual reservations (if enabled)
  const shouldSendEmail = data.sendConfirmationEmail !== false;
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
    ];

    const domain = env.NEXT_PUBLIC_APP_DOMAIN;
    const protocol = domain.includes('localhost') ? 'http' : 'https';

    if (data.sendAsQuote) {
      // Generate authenticated access token for the quote URL
      const token = nanoid(64);
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
      await db.insert(verificationCodes).values({
        id: nanoid(),
        email: customer.email,
        storeId: store.id,
        code: '',
        type: 'instant_access',
        token,
        reservationId,
        expiresAt,
        createdAt: new Date(),
      });
      const quoteAccessUrl = `${protocol}://${store.slug}.${domain}/r/${reservationId}?token=${token}`;

      // Send quote email via dispatcher
      dispatchCustomerNotification('customer_quote_sent', {
        store: storeData,
        customer: customerData,
        reservation: {
          id: reservationId,
          number: reservationNumber,
          startDate: data.startDate,
          endDate: data.endDate,
          totalAmount: subtotalAmount,
          subtotalAmount,
          depositAmount,
        },
        items: emailItems,
        reservationUrl: quoteAccessUrl,
      }).catch((error) => {
        console.error('Failed to send quote email:', error);
      });
    } else {
      // Send confirmation email
      const reservationUrl = `${protocol}://${store.slug}.${domain}/account/reservations/${reservationId}`;
      sendReservationConfirmationEmail({
        to: customer.email,
        store: storeData,
        customer: customerData,
        reservation: {
          id: reservationId,
          number: reservationNumber,
          startDate: data.startDate,
          endDate: data.endDate,
          subtotalAmount,
          depositAmount,
          totalAmount: subtotalAmount,
        },
        items: emailItems,
        reservationUrl,
        locale: getLocaleFromCountry(store.settings?.country),
      }).catch((error) => {
        console.error('Failed to send reservation confirmation email:', error);
      });
    }
  }

  // Platform admin notification
  const customerName = customer
    ? `${customer.firstName} ${customer.lastName}`
    : data.newCustomer
      ? `${data.newCustomer.firstName} ${data.newCustomer.lastName}`
      : 'Unknown';
  notifyNewReservation(
    { id: store.id, name: store.name, slug: store.slug },
    {
      number: reservationNumber,
      customerName,
      totalAmount: subtotalAmount,
      currency: store.settings?.currency,
    },
  ).catch(() => {});

  revalidatePath('/dashboard/reservations');
  revalidatePath('/dashboard');
  return { success: true, reservationId };
}

export async function getReservation(reservationId: string) {
  const store = await getStoreForUser();
  if (!store) {
    return null;
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, store.id),
    ),
    with: {
      customer: true,
      items: {
        with: {
          product: true,
        },
      },
      payments: true,
      documents: true,
    },
  });

  return reservation;
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

  return db.query.products.findMany({
    where: and(eq(products.storeId, store.id), eq(products.status, 'active')),
    orderBy: (products, { asc }) => [asc(products.name)],
  });
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

interface UpdateReservationData {
  startDate?: Date;
  endDate?: Date;
  tulipInsuranceOptIn?: boolean;
  items?: UpdateReservationItem[];
}

export async function updateReservation(
  reservationId: string,
  data: UpdateReservationData,
) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: 'errors.unauthorized' };
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, store.id),
    ),
    with: {
      items: true,
      customer: true,
    },
  });

  if (!reservation) {
    return { error: 'errors.reservationNotFound' };
  }

  // Cannot edit completed reservations
  if (reservation.status === 'completed') {
    return { error: 'errors.cannotEditCompletedReservation' };
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
  const previousPeriodMs =
    reservation.endDate.getTime() - reservation.startDate.getTime();
  const nextPeriodMs = newEndDate.getTime() - newStartDate.getTime();
  const isPeriodReduced = nextPeriodMs < previousPeriodMs;
  const tulipMode = getDashboardTulipInsuranceMode(
    store.settings as StoreSettings | null,
  );
  const nextTulipInsuranceOptIn = resolveTulipInsuranceOptIn({
    mode: tulipMode,
    requested: data.tulipInsuranceOptIn,
    current: reservation.tulipInsuranceOptIn,
    defaultOptional: true,
  });

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

  const INSURANCE_ITEM_NAME = 'Garantie casse/vol';

  // Process items
  if (data.items && data.items.length > 0) {
    const reservationItemsWithoutLegacyInsurance = data.items.filter(
      (item) =>
        !isLegacyTulipInsuranceItem({
          isCustomItem: !item.productId,
          productSnapshot: item.productSnapshot,
        }),
    );

    // Delete existing items
    await db
      .delete(reservationItems)
      .where(eq(reservationItems.reservationId, reservationId));

    // Insert new items
    for (const item of reservationItemsWithoutLegacyInsurance) {
      let pricingBreakdown: PricingBreakdown | null = null;
      let finalUnitPrice = item.unitPrice;
      let itemPricingMode: PricingMode = toPricingMode(item.pricingMode);
      let duration = calculateDuration(
        newStartDate,
        newEndDate,
        itemPricingMode,
      );
      let totalPrice = item.unitPrice * duration * item.quantity;

      // If not manual price and has a productId, calculate with tiers
      if (!item.isManualPrice && item.productId) {
        const product = await db.query.products.findFirst({
          where: eq(products.id, item.productId),
          with: { pricingTiers: true },
        });

        if (product) {
          const effectivePricingMode = toPricingMode(product.pricingMode);
          itemPricingMode = effectivePricingMode;
          duration = calculateDuration(
            newStartDate,
            newEndDate,
            itemPricingMode,
          );
          const durationMinutes = calculateDurationMinutes(
            newStartDate,
            newEndDate,
          );
          const tiers: PricingTier[] = (product.pricingTiers || []).map(
            (tier) => ({
              id: tier.id,
              minDuration: tier.minDuration ?? 1,
              discountPercent: parseFloat(tier.discountPercent ?? '0'),
              displayOrder: tier.displayOrder || 0,
            }),
          );
          const rates: Rate[] = (product.pricingTiers || [])
            .filter(
              (tier): tier is typeof tier & { period: number; price: string } =>
                typeof tier.period === 'number' &&
                tier.period > 0 &&
                typeof tier.price === 'string',
            )
            .map((tier, index) => ({
              id: tier.id,
              period: tier.period,
              price: parseFloat(tier.price),
              displayOrder: tier.displayOrder ?? index,
            }));

          // Fetch seasonal pricings for this product
          const seasonalPricingConfigsForItem =
            await fetchSeasonalPricingConfigs(product.id);

          const seasonalResultForItem = calculateSeasonalAwarePrice(
            {
              basePrice: parseFloat(product.price),
              basePeriodMinutes: product.basePeriodMinutes ?? null,
              deposit: parseFloat(product.deposit || '0'),
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

          pricingBreakdown = {
            basePrice: parseFloat(product.price),
            effectivePrice:
              seasonalResultForItem.subtotal / Math.max(1, item.quantity),
            duration: durationMinutes,
            pricingMode: itemPricingMode,
            discountPercent:
              seasonalResultForItem.savings > 0 &&
              seasonalResultForItem.originalSubtotal > 0
                ? Math.round(
                    (seasonalResultForItem.savings /
                      seasonalResultForItem.originalSubtotal) *
                      100,
                  )
                : null,
            discountAmount: seasonalResultForItem.savings,
            tierApplied: null,
            durationMinutes,
            appliedPeriods: undefined,
            optimizerVersion: 'v2',
            taxRate: null,
            taxAmount: null,
            subtotalExclTax: null,
            subtotalInclTax: null,
            ...(seasonalResultForItem.isSeasonal
              ? {
                  seasonalSegments: seasonalResultForItem.segments.map(
                    (seg) => ({
                      seasonalPricingId: seg.seasonalPricingId,
                      seasonalPricingName: seg.seasonalPricingName,
                      startDate: seg.startDate.toISOString(),
                      endDate: seg.endDate.toISOString(),
                      subtotal: seg.subtotal,
                    }),
                  ),
                }
              : {}),
          };
          finalUnitPrice = priceResult.subtotal / Math.max(1, item.quantity);
          totalPrice = priceResult.subtotal;
        }
      } else if (item.isManualPrice) {
        pricingBreakdown = {
          basePrice: item.unitPrice,
          effectivePrice: item.unitPrice,
          duration,
          pricingMode: itemPricingMode,
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

      await db.insert(reservationItems).values({
        id: nanoid(),
        reservationId,
        productId: item.productId || null,
        isCustomItem: !item.productId,
        quantity: item.quantity,
        unitPrice: finalUnitPrice.toFixed(2),
        depositPerUnit: item.depositPerUnit.toFixed(2),
        totalPrice: totalPrice.toFixed(2),
        pricingBreakdown,
        productSnapshot: {
          name: item.productSnapshot.name,
          description: item.productSnapshot.description || null,
          images: item.productSnapshot.images || [],
        },
      });
    }
  } else {
    // Just recalculate existing items with new duration
    const existingItemsWithoutLegacyInsurance = reservation.items.filter(
      (item) =>
        !isLegacyTulipInsuranceItem({
          isCustomItem: item.isCustomItem,
          productSnapshot: item.productSnapshot,
        }),
    );

    for (const item of existingItemsWithoutLegacyInsurance) {
      const pricingBreakdown = item.pricingBreakdown as Record<
        string,
        unknown
      > | null;
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
          const itemDuration = calculateDuration(
            newStartDate,
            newEndDate,
            effectivePricingMode,
          );
          const itemDurationMinutes = calculateDurationMinutes(
            newStartDate,
            newEndDate,
          );
          const tiers: PricingTier[] = (product.pricingTiers || []).map(
            (tier) => ({
              id: tier.id,
              minDuration: tier.minDuration ?? 1,
              discountPercent: parseFloat(tier.discountPercent ?? '0'),
              displayOrder: tier.displayOrder || 0,
            }),
          );
          const rates: Rate[] = (product.pricingTiers || [])
            .filter(
              (tier): tier is typeof tier & { period: number; price: string } =>
                typeof tier.period === 'number' &&
                tier.period > 0 &&
                typeof tier.price === 'string',
            )
            .map((tier, index) => ({
              id: tier.id,
              period: tier.period,
              price: parseFloat(tier.price),
              displayOrder: tier.displayOrder ?? index,
            }));

          // Fetch seasonal pricings for this product
          const seasonalPricingConfigsForDate =
            await fetchSeasonalPricingConfigs(product.id);

          const seasonalResultForDate = calculateSeasonalAwarePrice(
            {
              basePrice: parseFloat(product.price),
              basePeriodMinutes: product.basePeriodMinutes ?? null,
              deposit: parseFloat(product.deposit || '0'),
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

          const newBreakdown: PricingBreakdown = {
            basePrice: parseFloat(product.price),
            effectivePrice:
              seasonalResultForDate.subtotal / Math.max(1, item.quantity),
            duration: itemDurationMinutes,
            pricingMode: effectivePricingMode,
            discountPercent:
              seasonalResultForDate.savings > 0 &&
              seasonalResultForDate.originalSubtotal > 0
                ? Math.round(
                    (seasonalResultForDate.savings /
                      seasonalResultForDate.originalSubtotal) *
                      100,
                  )
                : null,
            discountAmount: seasonalResultForDate.savings,
            tierApplied: null,
            durationMinutes: itemDurationMinutes,
            appliedPeriods: undefined,
            optimizerVersion: 'v2',
            taxRate: null,
            taxAmount: null,
            subtotalExclTax: null,
            subtotalInclTax: null,
            ...(seasonalResultForDate.isSeasonal
              ? {
                  seasonalSegments: seasonalResultForDate.segments.map(
                    (seg) => ({
                      seasonalPricingId: seg.seasonalPricingId,
                      seasonalPricingName: seg.seasonalPricingName,
                      startDate: seg.startDate.toISOString(),
                      endDate: seg.endDate.toISOString(),
                      subtotal: seg.subtotal,
                    }),
                  ),
                }
              : {}),
          };
          finalUnitPrice =
            seasonalResultForDate.subtotal / Math.max(1, item.quantity);
          totalPrice = seasonalResultForDate.subtotal;

          await db
            .update(reservationItems)
            .set({
              unitPrice: finalUnitPrice.toFixed(2),
              totalPrice: totalPrice.toFixed(2),
              pricingBreakdown: newBreakdown,
            })
            .where(eq(reservationItems.id, item.id));
        } else {
          const fallbackPricingMode = toPricingMode(
            pricingBreakdown?.pricingMode,
          );
          const itemDuration = calculateDuration(
            newStartDate,
            newEndDate,
            fallbackPricingMode,
          );
          totalPrice = finalUnitPrice * itemDuration * item.quantity;
          await db
            .update(reservationItems)
            .set({ totalPrice: totalPrice.toFixed(2) })
            .where(eq(reservationItems.id, item.id));
        }
      } else {
        // Manual price - just multiply by new duration
        const fallbackPricingMode = toPricingMode(
          pricingBreakdown?.pricingMode,
        );
        const itemDuration = calculateDuration(
          newStartDate,
          newEndDate,
          fallbackPricingMode,
        );
        totalPrice = finalUnitPrice * itemDuration * item.quantity;
        await db
          .update(reservationItems)
          .set({
            totalPrice: totalPrice.toFixed(2),
            pricingBreakdown: pricingBreakdown
              ? ({
                  ...pricingBreakdown,
                  duration: itemDuration,
                  pricingMode: fallbackPricingMode,
                } as PricingBreakdown)
              : null,
          })
          .where(eq(reservationItems.id, item.id));
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
      tulipWarnings.push({ key: 'errors.customerNotFound' });
      if (previousTulipInsuranceAmount) {
        nextTulipInsuranceAmount = previousTulipInsuranceAmount;
      }
    } else {
      try {
        const quote = await previewTulipQuoteForCheckout({
          storeId: store.id,
          storeSettings: store.settings as StoreSettings | null,
          customer: {
            customerType: reservation.customer.customerType,
            companyName: reservation.customer.companyName,
            firstName: reservation.customer.firstName,
            lastName: reservation.customer.lastName,
            email: reservation.customer.email,
            phone: reservation.customer.phone || '',
            address: reservation.customer.address || '',
            city: reservation.customer.city || '',
            postalCode: reservation.customer.postalCode || '',
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
        console.error('[tulip] Failed to recalculate insurance quote after reservation edit:', {
          reservationId,
          error,
        });
        tulipWarnings.push({ key: getErrorKey(error, 'errors.tulipQuoteFailed') });
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
    (!nextTulipInsuranceAmount ||
      nextTulipInsuranceAmount < previousTulipInsuranceAmount)
  ) {
    nextTulipInsuranceAmount = previousTulipInsuranceAmount;
  }

  if (nextTulipInsuranceAmount && nextTulipInsuranceAmount > 0) {
    newSubtotalAmount += nextTulipInsuranceAmount;
  }

  if (data.items && data.items.length > 0) {
    if (nextTulipInsuranceAmount && nextTulipInsuranceAmount > 0) {
      await db.insert(reservationItems).values({
        id: nanoid(),
        reservationId,
        productId: null,
        isCustomItem: true,
        quantity: 1,
        unitPrice: nextTulipInsuranceAmount.toFixed(2),
        depositPerUnit: '0.00',
        totalPrice: nextTulipInsuranceAmount.toFixed(2),
        pricingBreakdown: null,
        productSnapshot: {
          name: INSURANCE_ITEM_NAME,
          description: INSURANCE_ITEM_NAME,
          images: [],
        },
      });
    }
  } else if (nextTulipInsuranceAmount && nextTulipInsuranceAmount > 0) {
    const [existingInsuranceItemId, ...extraInsuranceItemIds] =
      legacyInsuranceItemIds;

    if (existingInsuranceItemId) {
      await db
        .update(reservationItems)
        .set({
          quantity: 1,
          unitPrice: nextTulipInsuranceAmount.toFixed(2),
          depositPerUnit: '0.00',
          totalPrice: nextTulipInsuranceAmount.toFixed(2),
          pricingBreakdown: null,
          productSnapshot: {
            name: INSURANCE_ITEM_NAME,
            description: INSURANCE_ITEM_NAME,
            images: [],
          },
        })
        .where(eq(reservationItems.id, existingInsuranceItemId));
    } else {
      await db.insert(reservationItems).values({
        id: nanoid(),
        reservationId,
        productId: null,
        isCustomItem: true,
        quantity: 1,
        unitPrice: nextTulipInsuranceAmount.toFixed(2),
        depositPerUnit: '0.00',
        totalPrice: nextTulipInsuranceAmount.toFixed(2),
        pricingBreakdown: null,
        productSnapshot: {
          name: INSURANCE_ITEM_NAME,
          description: INSURANCE_ITEM_NAME,
          images: [],
        },
      });
    }

    if (extraInsuranceItemIds.length > 0) {
      await db
        .delete(reservationItems)
        .where(inArray(reservationItems.id, extraInsuranceItemIds));
    }
  } else if (legacyInsuranceItemIds.length > 0) {
    await db
      .delete(reservationItems)
      .where(inArray(reservationItems.id, legacyInsuranceItemIds));
  }

  // Update reservation
  await db
    .update(reservations)
    .set({
      startDate: newStartDate,
      endDate: newEndDate,
      subtotalAmount: newSubtotalAmount.toFixed(2),
      depositAmount: newDepositAmount.toFixed(2),
      totalAmount: newSubtotalAmount.toFixed(2),
      tulipInsuranceOptIn: nextTulipInsuranceOptIn,
      tulipInsuranceAmount:
        nextTulipInsuranceAmount && nextTulipInsuranceAmount > 0
          ? nextTulipInsuranceAmount.toFixed(2)
          : null,
      updatedAt: new Date(),
    })
    .where(eq(reservations.id, reservationId));
  if (reservation.status === 'confirmed' || reservation.status === 'ongoing') {
    try {
      await syncTulipContractForReservation({ reservationId });
    } catch (error) {
      console.error('[tulip] Failed to sync contract after reservation edit:', {
        reservationId,
        error,
      });

      const tulipErrorKey = getErrorKey(error, 'errors.tulipContractUpdateFailed');
      if (nextTulipInsuranceOptIn) {
        try {
          await db.transaction(async (tx) => {
            await tx
              .update(reservations)
              .set({
                startDate: reservation.startDate,
                endDate: reservation.endDate,
                subtotalAmount: reservation.subtotalAmount,
                depositAmount: reservation.depositAmount,
                totalAmount: reservation.totalAmount,
                tulipInsuranceOptIn: reservation.tulipInsuranceOptIn,
                tulipInsuranceAmount: reservation.tulipInsuranceAmount,
                updatedAt: reservation.updatedAt,
              })
              .where(eq(reservations.id, reservationId));

            await tx
              .delete(reservationItems)
              .where(eq(reservationItems.reservationId, reservationId));

            if (reservation.items.length > 0) {
              await tx.insert(reservationItems).values(
                reservation.items.map((item) => ({
                  id: item.id,
                  reservationId: item.reservationId,
                  productId: item.productId,
                  isCustomItem: item.isCustomItem,
                  quantity: item.quantity,
                  unitPrice: item.unitPrice,
                  depositPerUnit: item.depositPerUnit,
                  totalPrice: item.totalPrice,
                  taxRate: item.taxRate,
                  taxAmount: item.taxAmount,
                  priceExclTax: item.priceExclTax,
                  totalExclTax: item.totalExclTax,
                  pricingBreakdown: item.pricingBreakdown,
                  productSnapshot: item.productSnapshot,
                  combinationKey: item.combinationKey,
                  selectedAttributes: item.selectedAttributes,
                  createdAt: item.createdAt,
                })),
              );
            }
          });
        } catch (rollbackError) {
          console.error('[tulip] Failed to rollback reservation after contract sync failure:', {
            reservationId,
            rollbackError,
          });
          return { error: 'errors.generic' };
        }

        return { error: tulipErrorKey };
      }

      tulipWarnings.push({
        key: tulipErrorKey,
      });
    }
  }

  // Calculate difference for activity log
  const difference = newSubtotalAmount - previousState.subtotalAmount;

  // Log activity
  await logReservationActivity(
    reservationId,
    'modified',
    {
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
      ...(validationWarnings.length > 0 && {
        validationWarnings,
        validationWarningsCount: validationWarnings.length,
      }),
    },
  );

  revalidatePath('/dashboard/reservations');
  revalidatePath(`/dashboard/reservations/${reservationId}`);

  const responseWarnings = [
    ...validationWarnings.map((warning) => ({
      code: warning.code,
      key: warning.key,
      params: warning.params,
    })),
    ...tulipWarnings,
  ];

  return {
    success: true,
    difference,
    newTotal: newSubtotalAmount,
    previousTotal: previousState.subtotalAmount,
    ...(responseWarnings.length > 0 && { warnings: responseWarnings }),
  };
}

// ============================================================================
// Payment Actions
// ============================================================================

export type PaymentType =
  | 'rental'
  | 'deposit'
  | 'deposit_return'
  | 'damage'
  | 'adjustment';
export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'check' | 'other';

interface RecordPaymentData {
  type: PaymentType;
  amount: number;
  method: PaymentMethod;
  paidAt?: Date;
  notes?: string;
}

export async function recordPayment(
  reservationId: string,
  data: RecordPaymentData,
) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: 'errors.unauthorized' };
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, store.id),
    ),
  });

  if (!reservation) {
    return { error: 'errors.reservationNotFound' };
  }

  if (data.amount === 0) {
    return { error: 'errors.invalidAmount' };
  }

  // Only adjustment type can have negative amounts
  if (data.amount < 0 && data.type !== 'adjustment') {
    return { error: 'errors.negativeAmountOnlyForAdjustment' };
  }

  const paymentId = nanoid();
  await db.insert(payments).values({
    id: paymentId,
    reservationId,
    amount: data.amount.toFixed(2),
    type: data.type,
    method: data.method,
    status: 'completed',
    paidAt: data.paidAt || new Date(),
    notes: data.notes || null,
  });

  // Log activity
  await logReservationActivity(
    reservationId,
    'payment_added',
    { paymentId, type: data.type, amount: data.amount, method: data.method },
  );

  // Platform admin notification
  notifyPaymentReceived(
    { id: store.id, name: store.name, slug: store.slug },
    reservation.number,
    data.amount,
    store.settings?.currency,
  ).catch(() => {});

  revalidatePath('/dashboard/reservations');
  revalidatePath(`/dashboard/reservations/${reservationId}`);
  return { success: true, paymentId };
}

export async function deletePayment(paymentId: string) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: 'errors.unauthorized' };
  }

  // Get payment with reservation to verify ownership
  const payment = await db.query.payments.findFirst({
    where: eq(payments.id, paymentId),
    with: {
      reservation: true,
    },
  });

  if (!payment || payment.reservation.storeId !== store.id) {
    return { error: 'errors.paymentNotFound' };
  }

  // Cannot delete Stripe payments
  if (payment.method === 'stripe') {
    return { error: 'errors.cannotDeleteStripePayment' };
  }

  await db.delete(payments).where(eq(payments.id, paymentId));

  // Log activity
  await logReservationActivity(
    payment.reservationId,
    'payment_updated',
    {
      paymentId,
      type: payment.type,
      amount: payment.amount,
      action: 'deleted',
    },
  );

  revalidatePath('/dashboard/reservations');
  revalidatePath(`/dashboard/reservations/${payment.reservationId}`);
  return { success: true };
}

interface ReturnDepositData {
  amount: number;
  method: PaymentMethod;
  notes?: string;
}

export async function returnDeposit(
  reservationId: string,
  data: ReturnDepositData,
) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: 'errors.unauthorized' };
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, store.id),
    ),
    with: {
      payments: true,
    },
  });

  if (!reservation) {
    return { error: 'errors.reservationNotFound' };
  }

  if (data.amount <= 0) {
    return { error: 'errors.invalidAmount' };
  }

  // Calculate how much deposit was collected
  const depositCollected = reservation.payments
    .filter((p) => p.type === 'deposit' && p.status === 'completed')
    .reduce((sum, p) => sum + parseFloat(p.amount), 0);

  // Calculate how much was already returned
  const depositReturned = reservation.payments
    .filter((p) => p.type === 'deposit_return' && p.status === 'completed')
    .reduce((sum, p) => sum + parseFloat(p.amount), 0);

  const maxReturnable = depositCollected - depositReturned;

  if (data.amount > maxReturnable) {
    return { error: 'errors.amountExceedsDeposit' };
  }

  const paymentId = nanoid();
  await db.insert(payments).values({
    id: paymentId,
    reservationId,
    amount: data.amount.toFixed(2),
    type: 'deposit_return',
    method: data.method,
    status: 'completed',
    paidAt: new Date(),
    notes: data.notes || null,
  });

  // Log activity
  await logReservationActivity(
    reservationId,
    'payment_added',
    {
      paymentId,
      type: 'deposit_return',
      amount: data.amount,
      method: data.method,
    },
  );

  revalidatePath('/dashboard/reservations');
  revalidatePath(`/dashboard/reservations/${reservationId}`);
  return { success: true, paymentId };
}

export async function recordDamage(
  reservationId: string,
  data: { amount: number; method: PaymentMethod; notes: string },
) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: 'errors.unauthorized' };
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, store.id),
    ),
  });

  if (!reservation) {
    return { error: 'errors.reservationNotFound' };
  }

  if (data.amount <= 0) {
    return { error: 'errors.invalidAmount' };
  }

  const paymentId = nanoid();
  await db.insert(payments).values({
    id: paymentId,
    reservationId,
    amount: data.amount.toFixed(2),
    type: 'damage',
    method: data.method,
    status: 'completed',
    paidAt: new Date(),
    notes: data.notes,
  });

  // Log activity
  await logReservationActivity(
    reservationId,
    'payment_added',
    { paymentId, type: 'damage', amount: data.amount, method: data.method, notes: data.notes },
  );

  revalidatePath('/dashboard/reservations');
  revalidatePath(`/dashboard/reservations/${reservationId}`);
  return { success: true, paymentId };
}

type DepositActivityType =
  | 'deposit_authorized'
  | 'deposit_captured'
  | 'deposit_released'
  | 'deposit_failed';

async function logDepositActivity(
  reservationId: string,
  activityType: DepositActivityType,
  description?: string,
  metadata?: Record<string, unknown>,
) {
  const session = await auth();
  const userId = session?.user?.id || null;

  await db.insert(reservationActivity).values({
    id: nanoid(),
    reservationId,
    userId,
    activityType,
    description,
    metadata,
  });
}

/**
 * Create a deposit authorization hold (empreinte bancaire)
 */
export async function createDepositHold(reservationId: string) {
  const store = await getStoreForUser();
  if (!store || !store.stripeAccountId) {
    return { error: 'errors.noStripeAccount' };
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, store.id),
    ),
  });

  if (!reservation) {
    return { error: 'errors.reservationNotFound' };
  }

  // Check prerequisites
  if (!reservation.stripeCustomerId || !reservation.stripePaymentMethodId) {
    return { error: 'errors.stripe.noSavedCard' };
  }

  if (reservation.depositStatus !== 'card_saved') {
    return { error: 'errors.stripe.invalidDepositStatus' };
  }

  const depositAmount = parseFloat(reservation.depositAmount);
  if (depositAmount <= 0) {
    return { error: 'errors.stripe.noDepositRequired' };
  }

  const currency = store.settings?.currency || 'EUR';

  try {
    const result = await createDepositAuthorization({
      stripeAccountId: store.stripeAccountId,
      customerId: reservation.stripeCustomerId,
      paymentMethodId: reservation.stripePaymentMethodId,
      amount: toStripeCents(depositAmount, currency),
      currency,
      reservationId,
      reservationNumber: reservation.number,
    });

    // Update reservation
    await db
      .update(reservations)
      .set({
        depositStatus: 'authorized',
        depositPaymentIntentId: result.paymentIntentId,
        depositAuthorizationExpiresAt: result.expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(reservations.id, reservationId));

    // Create payment record
    await db.insert(payments).values({
      id: nanoid(),
      reservationId,
      amount: depositAmount.toFixed(2),
      type: 'deposit_hold',
      method: 'stripe',
      status: 'authorized',
      stripePaymentIntentId: result.paymentIntentId,
      stripePaymentMethodId: reservation.stripePaymentMethodId,
      authorizationExpiresAt: result.expiresAt,
      currency,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Log activity
    const currencySymbol = getCurrencySymbol(currency);
    await logDepositActivity(
      reservationId,
      'deposit_authorized',
      `Empreinte de ${depositAmount.toFixed(2)}${currencySymbol} créée`,
      {
        paymentIntentId: result.paymentIntentId,
        amount: depositAmount,
        expiresAt: result.expiresAt.toISOString(),
      },
    );

    revalidatePath('/dashboard/reservations');
    revalidatePath(`/dashboard/reservations/${reservationId}`);
    return { success: true, paymentIntentId: result.paymentIntentId };
  } catch (error) {
    console.error('Failed to create deposit hold:', error);

    // Update status to failed
    await db
      .update(reservations)
      .set({
        depositStatus: 'failed',
        updatedAt: new Date(),
      })
      .where(eq(reservations.id, reservationId));

    await logDepositActivity(
      reservationId,
      'deposit_failed',
      `Échec de l'empreinte: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { error: error instanceof Error ? error.message : 'Unknown error' },
    );

    return { error: 'errors.stripe.authorizationFailed' };
  }
}

/**
 * Capture deposit from authorization hold (for damage/loss)
 */
export async function captureDepositHold(
  reservationId: string,
  data: { amount: number; reason: string },
) {
  const store = await getStoreForUser();
  if (!store || !store.stripeAccountId) {
    return { error: 'errors.noStripeAccount' };
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, store.id),
    ),
  });

  if (!reservation) {
    return { error: 'errors.reservationNotFound' };
  }

  if (
    reservation.depositStatus !== 'authorized' ||
    !reservation.depositPaymentIntentId
  ) {
    return { error: 'errors.stripe.noActiveAuthorization' };
  }

  const depositAmount = parseFloat(reservation.depositAmount);
  if (data.amount <= 0 || data.amount > depositAmount) {
    return { error: 'errors.invalidAmount' };
  }

  if (!data.reason.trim()) {
    return { error: 'errors.reasonRequired' };
  }

  const currency = store.settings?.currency || 'EUR';

  try {
    const result = await captureDeposit({
      stripeAccountId: store.stripeAccountId,
      paymentIntentId: reservation.depositPaymentIntentId,
      amountToCapture: toStripeCents(data.amount, currency),
    });

    // Update reservation
    await db
      .update(reservations)
      .set({
        depositStatus: 'captured',
        updatedAt: new Date(),
      })
      .where(eq(reservations.id, reservationId));

    // Update the deposit_hold payment
    const depositPayment = await db.query.payments.findFirst({
      where: and(
        eq(payments.reservationId, reservationId),
        eq(payments.type, 'deposit_hold'),
        eq(payments.status, 'authorized'),
      ),
    });

    if (depositPayment) {
      await db
        .update(payments)
        .set({
          status: 'completed',
          capturedAmount: data.amount.toFixed(2),
          notes: data.reason,
          paidAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(payments.id, depositPayment.id));
    }

    // Create deposit_capture payment record
    await db.insert(payments).values({
      id: nanoid(),
      reservationId,
      amount: data.amount.toFixed(2),
      type: 'deposit_capture',
      method: 'stripe',
      status: 'completed',
      stripePaymentIntentId: reservation.depositPaymentIntentId,
      currency,
      notes: data.reason,
      paidAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Log activity
    const currencySymbol = getCurrencySymbol(currency);
    await logDepositActivity(
      reservationId,
      'deposit_captured',
      `Caution capturée: ${data.amount.toFixed(2)}${currencySymbol} - ${data.reason}`,
      {
        paymentIntentId: reservation.depositPaymentIntentId,
        amount: data.amount,
        reason: data.reason,
      },
    );

    revalidatePath('/dashboard/reservations');
    revalidatePath(`/dashboard/reservations/${reservationId}`);
    return { success: true, amountCaptured: result.amountCaptured };
  } catch (error) {
    console.error('Failed to capture deposit:', error);
    return { error: 'errors.stripe.captureFailed' };
  }
}

/**
 * Release deposit authorization (no damage)
 */
export async function releaseDepositHold(reservationId: string) {
  const store = await getStoreForUser();
  if (!store || !store.stripeAccountId) {
    return { error: 'errors.noStripeAccount' };
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, store.id),
    ),
  });

  if (!reservation) {
    return { error: 'errors.reservationNotFound' };
  }

  if (
    reservation.depositStatus !== 'authorized' ||
    !reservation.depositPaymentIntentId
  ) {
    return { error: 'errors.stripe.noActiveAuthorization' };
  }

  try {
    await releaseDeposit({
      stripeAccountId: store.stripeAccountId,
      paymentIntentId: reservation.depositPaymentIntentId,
    });

    // Update reservation
    await db
      .update(reservations)
      .set({
        depositStatus: 'released',
        updatedAt: new Date(),
      })
      .where(eq(reservations.id, reservationId));

    // Update the deposit_hold payment
    const depositPayment = await db.query.payments.findFirst({
      where: and(
        eq(payments.reservationId, reservationId),
        eq(payments.type, 'deposit_hold'),
        eq(payments.status, 'authorized'),
      ),
    });

    if (depositPayment) {
      await db
        .update(payments)
        .set({
          status: 'cancelled',
          updatedAt: new Date(),
        })
        .where(eq(payments.id, depositPayment.id));
    }

    // Log activity
    const currency = store.settings?.currency || 'EUR';
    const currencySymbol = getCurrencySymbol(currency);
    const depositAmount = parseFloat(reservation.depositAmount);
    await logDepositActivity(
      reservationId,
      'deposit_released',
      `Caution de ${depositAmount.toFixed(2)}${currencySymbol} libérée`,
      {
        paymentIntentId: reservation.depositPaymentIntentId,
        amount: depositAmount,
      },
    );

    revalidatePath('/dashboard/reservations');
    revalidatePath(`/dashboard/reservations/${reservationId}`);
    return { success: true };
  } catch (error) {
    console.error('Failed to release deposit:', error);
    return { error: 'errors.stripe.releaseFailed' };
  }
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
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, store.id),
    ),
  });

  if (!reservation?.stripePaymentMethodId) {
    return null;
  }

  try {
    return await getPaymentMethodDetails(
      store.stripeAccountId,
      reservation.stripePaymentMethodId,
    );
  } catch (error) {
    console.error('Failed to get payment method details:', error);
    return null;
  }
}

// ============================================================================
// Stripe Refunds
// ============================================================================

interface ProcessStripeRefundData {
  type: 'deposit_return' | 'rental_refund';
  amount: number;
  notes?: string;
}

export async function processStripeRefund(
  reservationId: string,
  data: ProcessStripeRefundData,
) {
  const store = await getStoreForUser();
  if (!store || !store.stripeAccountId) {
    return { error: 'errors.noStripeAccount' };
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, store.id),
    ),
    with: {
      payments: true,
    },
  });

  if (!reservation) {
    return { error: 'errors.reservationNotFound' };
  }

  // Find the original Stripe payment with a charge
  const stripePayment = reservation.payments.find(
    (p) =>
      p.method === 'stripe' && p.status === 'completed' && p.stripeChargeId,
  );

  if (!stripePayment || !stripePayment.stripeChargeId) {
    return { error: 'errors.stripe.noChargeToRefund' };
  }

  const currency = store.settings?.currency || 'EUR';

  try {
    // Check refundable amount
    const { refundable, amount: maxRefundable } =
      await getChargeRefundableAmount(
        store.stripeAccountId,
        stripePayment.stripeChargeId,
      );

    if (!refundable) {
      return { error: 'errors.stripe.alreadyRefunded' };
    }

    const refundAmountCents = toStripeCents(data.amount, currency);

    if (refundAmountCents > maxRefundable) {
      return { error: 'errors.stripe.refundExceedsCharge' };
    }

    // Process refund
    const refund = await createRefund({
      stripeAccountId: store.stripeAccountId,
      chargeId: stripePayment.stripeChargeId,
      amount: refundAmountCents,
    });

    // Create payment record for the refund (negative amount for display)
    const paymentId = nanoid();
    await db.insert(payments).values({
      id: paymentId,
      reservationId,
      amount: data.amount.toFixed(2),
      type: data.type === 'deposit_return' ? 'deposit_return' : 'rental',
      method: 'stripe',
      status: 'completed',
      stripeRefundId: refund.refundId,
      stripeChargeId: stripePayment.stripeChargeId,
      currency: refund.currency,
      notes: data.notes,
      paidAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Log activity
    await logReservationActivity(
      reservationId,
      'payment_updated',
      {
        paymentId,
        refundId: refund.refundId,
        amount: data.amount,
        type: data.type,
      },
    );

    revalidatePath('/dashboard/reservations');
    revalidatePath(`/dashboard/reservations/${reservationId}`);
    return { success: true, refundId: refund.refundId };
  } catch (error) {
    console.error('Stripe refund error:', error);
    return { error: 'errors.stripe.refundFailed' };
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

export async function sendReservationEmail(
  reservationId: string,
  data: SendReservationEmailData,
) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: 'errors.unauthorized' };
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, store.id),
    ),
    with: {
      customer: true,
      items: {
        with: {
          product: true,
        },
      },
    },
  });

  if (!reservation) {
    return { error: 'errors.reservationNotFound' };
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
    emailSettings: store.emailSettings,
  };

  const customerData = {
    firstName: reservation.customer.firstName,
    lastName: reservation.customer.lastName,
    email: reservation.customer.email,
  };

  const domain = env.NEXT_PUBLIC_APP_DOMAIN;
  const reservationUrl = `https://${store.slug}.${domain}/account/reservations/${reservationId}`;

  try {
    // Get button colors based on primary color contrast
    const primaryColor = store.theme?.primaryColor || '#0066FF';
    const buttonTextColor = getContrastColorHex(primaryColor);

    switch (data.templateId) {
      case 'contract': {
        // Send contract email with PDF attachment link
        const contractUrl = `${env.NEXT_PUBLIC_APP_URL}/api/reservations/${reservationId}/contract`;
        const subject =
          data.customSubject ||
          `Contrat de location #${reservation.number} - ${store.name}`;
        const html = `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Bonjour ${customerData.firstName},</h2>
            <p>Veuillez trouver ci-joint le contrat de location pour votre réservation #${reservation.number}.</p>
            ${data.customMessage ? `<p>${data.customMessage}</p>` : ''}
            <p><a href="${contractUrl}" style="display: inline-block; background: ${primaryColor}; color: ${buttonTextColor}; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Télécharger le contrat</a></p>
            <p>À bientôt,<br/>${store.name}</p>
          </div>
        `;
        await sendEmail({ to: customerData.email, subject, html });
        break;
      }

      case 'payment_request': {
        // Send payment request email
        const amountDue =
          parseFloat(reservation.totalAmount) +
          parseFloat(reservation.depositAmount);
        const currencySymbol = getCurrencySymbol(
          store.settings?.currency || 'EUR',
        );
        const subject =
          data.customSubject ||
          `Demande de paiement - Réservation #${reservation.number}`;
        const html = `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Bonjour ${customerData.firstName},</h2>
            <p>Nous vous contactons concernant le paiement de votre réservation #${reservation.number}.</p>
            ${data.customMessage ? `<p>${data.customMessage}</p>` : ''}
            <p><strong>Montant total : ${amountDue.toFixed(2)}${currencySymbol}</strong></p>
            <p>Merci de procéder au règlement dans les meilleurs délais.</p>
            <p><a href="${reservationUrl}" style="display: inline-block; background: ${primaryColor}; color: ${buttonTextColor}; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Voir ma réservation</a></p>
            <p>À bientôt,<br/>${store.name}</p>
          </div>
        `;
        await sendEmail({ to: customerData.email, subject, html });
        break;
      }

      case 'reminder_pickup': {
        // TODO: Use customer's stored locale preference when available
        await sendReminderPickupEmail({
          to: customerData.email,
          store: storeData,
          customer: customerData,
          reservation: {
            id: reservationId,
            number: reservation.number,
            startDate: reservation.startDate,
          },
          reservationUrl,
          locale: getLocaleFromCountry(store.settings?.country),
        });
        break;
      }

      case 'reminder_return': {
        // TODO: Use customer's stored locale preference when available
        await sendReminderReturnEmail({
          to: customerData.email,
          store: storeData,
          customer: customerData,
          reservation: {
            id: reservationId,
            number: reservation.number,
            endDate: reservation.endDate,
          },
          locale: getLocaleFromCountry(store.settings?.country),
        });
        break;
      }

      case 'custom': {
        if (!data.customMessage) {
          return { error: 'errors.messageRequired' };
        }
        const subject =
          data.customSubject ||
          `À propos de votre réservation #${reservation.number} - ${store.name}`;
        const html = `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Bonjour ${customerData.firstName},</h2>
            <p>${data.customMessage.replace(/\n/g, '<br/>')}</p>
            <p><a href="${reservationUrl}" style="display: inline-block; background: ${primaryColor}; color: ${buttonTextColor}; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Voir ma réservation</a></p>
            <p>À bientôt,<br/>${store.name}</p>
          </div>
        `;
        await sendEmail({ to: customerData.email, subject, html });
        break;
      }

      default:
        return { error: 'errors.invalidEmailTemplate' };
    }

    // Log activity
    await logReservationActivity(
      reservationId,
      'note_updated',
      { templateId: data.templateId, to: customerData.email },
    );

    revalidatePath(`/dashboard/reservations/${reservationId}`);
    return { success: true };
  } catch (error) {
    console.error('Failed to send reservation email:', error);
    return { error: 'errors.emailSendFailed' };
  }
}

// ============================================================================
// Access Link Actions
// ============================================================================

export async function generateAccessUrl(reservationId: string) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: 'errors.unauthorized' as const };
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, store.id),
    ),
    columns: { id: true },
    with: { customer: { columns: { email: true } } },
  });

  if (!reservation) {
    return { error: 'errors.reservationNotFound' as const };
  }

  const token = nanoid(64);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await db.insert(verificationCodes).values({
    id: nanoid(),
    email: reservation.customer.email,
    storeId: store.id,
    code: '',
    type: 'instant_access',
    token,
    reservationId,
    expiresAt,
    createdAt: new Date(),
  });

  const domain = env.NEXT_PUBLIC_APP_DOMAIN;
  const protocol = domain.includes('localhost') ? 'http' : 'https';
  const url = `${protocol}://${store.slug}.${domain}/r/${reservationId}?token=${token}`;

  return { url };
}

export async function sendAccessLink(reservationId: string) {
  const store = await getStoreForUser();
  if (!store) {
    return { error: 'errors.unauthorized' };
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, store.id),
    ),
    with: {
      customer: true,
      items: true,
      payments: true,
    },
  });

  if (!reservation) {
    return { error: 'errors.reservationNotFound' };
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
      code: '', // Not used for instant_access
      type: 'instant_access',
      token,
      reservationId,
      expiresAt,
      createdAt: new Date(),
    });

    // Build access URL
    const domain = env.NEXT_PUBLIC_APP_DOMAIN;
    const protocol = domain.includes('localhost') ? 'http' : 'https';
    const accessUrl = `${protocol}://${store.slug}.${domain}/r/${reservationId}?token=${token}`;

    // Calculate payment status
    const isPaid = reservation.payments.some(
      (p) => p.type === 'rental' && p.status === 'completed',
    );
    const isStripeEnabled = store.stripeAccountId && store.stripeChargesEnabled;

    // Build store and customer data
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
      firstName: reservation.customer.firstName,
      lastName: reservation.customer.lastName,
      email: reservation.customer.email,
    };

    // Build items data
    const items = reservation.items.map((item) => ({
      name: item.productSnapshot.name,
      quantity: item.quantity,
      totalPrice: parseFloat(item.totalPrice),
    }));

    // Send email
    await sendInstantAccessEmail({
      to: reservation.customer.email,
      store: storeData,
      customer: customerData,
      reservation: {
        id: reservationId,
        number: reservation.number,
        startDate: reservation.startDate,
        endDate: reservation.endDate,
        totalAmount: parseFloat(reservation.totalAmount),
      },
      items,
      accessUrl,
      showPaymentCta: !isPaid && !!isStripeEnabled,
      locale: getLocaleFromCountry(store.settings?.country),
    });

    // Log activity
    await logReservationActivity(
      reservationId,
      'access_link_sent',
      {
        token: token.substring(0, 8) + '...',
        expiresAt: expiresAt.toISOString(),
        method: 'email',
      },
    );

    revalidatePath(`/dashboard/reservations/${reservationId}`);
    return { success: true };
  } catch (error) {
    console.error('Failed to send access link:', error);
    return { error: 'errors.accessLinkSendFailed' };
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
    return { error: 'errors.unauthorized' };
  }

  if (!isSmsConfigured()) {
    return { error: 'errors.smsNotConfigured' };
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, store.id),
    ),
    with: {
      customer: true,
    },
  });

  if (!reservation) {
    return { error: 'errors.reservationNotFound' };
  }

  if (!reservation.customer.phone) {
    return { error: 'errors.customerNoPhone' };
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
      code: '', // Not used for instant_access
      type: 'instant_access',
      token,
      reservationId,
      expiresAt,
      createdAt: new Date(),
    });

    // Build access URL
    const domain = env.NEXT_PUBLIC_APP_DOMAIN;
    const protocol = domain.includes('localhost') ? 'http' : 'https';
    const accessUrl = `${protocol}://${store.slug}.${domain}/r/${reservationId}?token=${token}`;

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
          error: 'errors.smsLimitReached',
          limitReached: true,
          limitInfo: result.limitInfo,
        };
      }
      return { error: result.error || 'errors.smsSendFailed' };
    }

    // Log activity
    await logReservationActivity(
      reservationId,
      'access_link_sent',
      {
        token: token.substring(0, 8) + '...',
        expiresAt: expiresAt.toISOString(),
        method: 'sms',
      },
    );

    revalidatePath(`/dashboard/reservations/${reservationId}`);
    return { success: true };
  } catch (error) {
    console.error('Failed to send access link via SMS:', error);
    return { error: 'errors.smsSendFailed' };
  }
}

// ============================================================================
// Payment Request Functions
// ============================================================================

export interface RequestPaymentInput {
  type: 'rental' | 'deposit' | 'custom';
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
      return { error: 'errors.unauthorized' };
    }

    // Check Stripe is configured
    if (!store.stripeAccountId) {
      return { error: 'errors.stripeNotConfigured' };
    }

    // Get reservation with customer and payments
    const reservation = await db.query.reservations.findFirst({
      where: and(
        eq(reservations.id, reservationId),
        eq(reservations.storeId, store.id),
      ),
      with: {
        customer: true,
        payments: true,
      },
    });

    if (!reservation) {
      return { error: 'errors.reservationNotFound' };
    }

    // Validate at least one channel is selected
    if (!data.channels.email && !data.channels.sms) {
      return { error: 'errors.noChannelSelected' };
    }

    // Validate SMS - customer must have phone number
    if (data.channels.sms && !reservation.customer.phone) {
      return { error: 'errors.customerNoPhone' };
    }

    const currency = store.settings?.currency || 'EUR';
    const locale = getLocaleFromCountry(store.settings?.country);

    // Calculate amount based on type
    let amount: number;
    let description: string;

    if (data.type === 'custom') {
      if (!data.amount || data.amount < 0.5) {
        return { error: 'errors.invalidAmount' };
      }
      amount = data.amount;
      description = 'Payment';
    } else if (data.type === 'rental') {
      // Calculate remaining amount for rental from payments
      const subtotalAmount = parseFloat(reservation.subtotalAmount || '0');
      const paidAmount = reservation.payments
        .filter((p) => p.type === 'rental' && p.status === 'completed')
        .reduce((sum, p) => sum + parseFloat(p.amount), 0);
      amount = subtotalAmount - paidAmount;

      if (amount < 0.5) {
        return { error: 'errors.noAmountDue' };
      }
      description = 'Rental';
    } else {
      // deposit type
      amount = parseFloat(reservation.depositAmount || '0');
      if (amount < 0.5) {
        return { error: 'errors.noDepositRequired' };
      }
      description = 'Deposit';
    }

    // Build URLs
    const domain = env.NEXT_PUBLIC_APP_DOMAIN;
    const protocol = domain.includes('localhost') ? 'http' : 'https';
    const baseUrl = `${protocol}://${store.slug}.${domain}`;

    let paymentUrl: string;

    if (data.type === 'deposit') {
      // For deposit, create URL to authorize-deposit page with access token
      const token = nanoid(64);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      // Store token in verificationCodes table
      await db.insert(verificationCodes).values({
        id: nanoid(),
        email: reservation.customer.email,
        storeId: store.id,
        code: '', // Not used for instant_access
        type: 'instant_access',
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
        type: data.type as 'rental' | 'custom',
        status: 'pending',
        expiresAt,
        createdAt: new Date(),
      });

      paymentUrl = `${baseUrl}/pay/${reservationId}?token=${token}`;
    }

    // Send notifications
    const notificationResults: { email?: boolean; sms?: boolean } = {};

    if (data.channels.email) {
      try {
        if (data.type === 'deposit') {
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
        console.error('Failed to send payment request email:', error);
        notificationResults.email = false;
      }
    }

    if (data.channels.sms && reservation.customer.phone) {
      try {
        if (data.type === 'deposit') {
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
            },
            depositAmount: amount,
            authorizationUrl: paymentUrl,
            currency,
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
            },
            amount,
            paymentUrl,
            currency,
          });
        }
        notificationResults.sms = true;
      } catch (error) {
        console.error('Failed to send payment request SMS:', error);
        notificationResults.sms = false;
      }
    }

    // Log activity
    await logReservationActivity(
      reservationId,
      'payment_added',
      {
        type: data.type,
        amount,
        currency,
        channels: data.channels,
        notificationResults,
        paymentUrl,
        isPaymentRequest: true,
      },
    );

    revalidatePath(`/dashboard/reservations/${reservationId}`);

    return {
      success: true,
      paymentUrl,
    };
  } catch (error) {
    console.error('Failed to request payment:', error);
    return { error: 'errors.requestPaymentFailed' };
  }
}

// ============================================================================
// Unit Assignment Actions
// ============================================================================

/**
 * Assign units to a reservation item.
 * This replaces any existing assignments for the item.
 */
export async function assignUnitsToReservationItem(
  reservationItemId: string,
  unitIds: string[],
): Promise<{ success?: boolean; error?: string }> {
  const store = await getStoreForUser();
  if (!store) {
    return { error: 'errors.unauthorized' };
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
      })
      .from(reservationItems)
      .innerJoin(
        reservations,
        eq(reservationItems.reservationId, reservations.id),
      )
      .where(
        and(
          eq(reservationItems.id, reservationItemId),
          eq(reservations.storeId, store.id),
        ),
      );

    if (!item) {
      return { error: 'errors.notFound' };
    }

    // 2. Validate that we're not assigning more units than quantity
    if (unitIds.length > item.quantity) {
      return { error: 'errors.tooManyUnitsAssigned' };
    }

    // 3. Verify all units belong to the correct product
    if (unitIds.length > 0) {
      const units = await db
        .select({
          id: productUnits.id,
          productId: productUnits.productId,
          combinationKey: productUnits.combinationKey,
          identifier: productUnits.identifier,
        })
        .from(productUnits)
        .where(inArray(productUnits.id, unitIds));

      // Check all units exist and belong to the right product
      if (units.length !== unitIds.length) {
        return { error: 'errors.invalidUnits' };
      }

      for (const unit of units) {
        if (unit.productId !== item.productId) {
          return { error: 'errors.unitProductMismatch' };
        }
        if (
          item.combinationKey &&
          (unit.combinationKey || DEFAULT_COMBINATION_KEY) !==
            item.combinationKey
        ) {
          return { error: 'errors.unitCombinationMismatch' };
        }
      }

      // 4. Delete existing assignments for this item
      await db
        .delete(reservationItemUnits)
        .where(eq(reservationItemUnits.reservationItemId, reservationItemId));

      // 5. Insert new assignments with identifier snapshots
      const unitMap = new Map(units.map((u) => [u.id, u.identifier]));
      const assignmentsToInsert = unitIds.map((unitId) => ({
        id: nanoid(),
        reservationItemId,
        productUnitId: unitId,
        identifierSnapshot: unitMap.get(unitId) || '',
      }));

      await db.insert(reservationItemUnits).values(assignmentsToInsert);

      // 6. Log activity
      await logReservationActivity(item.reservationId, 'modified', {
        action: 'units_assigned',
        reservationItemId,
        unitIdentifiers: units.map((u) => u.identifier),
      });
    } else {
      // Clear assignments if no units provided
      await db
        .delete(reservationItemUnits)
        .where(eq(reservationItemUnits.reservationItemId, reservationItemId));

      await logReservationActivity(item.reservationId, 'modified', {
        action: 'units_unassigned',
        reservationItemId,
      });
    }

    revalidatePath(`/dashboard/reservations/${item.reservationId}`);

    return { success: true };
  } catch (error) {
    console.error('Failed to assign units:', error);
    return { error: 'errors.assignUnitsFailed' };
  }
}

/**
 * Get available units for assignment to a reservation item.
 */
export async function getAvailableUnitsForReservationItem(
  reservationItemId: string,
): Promise<{
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
    return { error: 'errors.unauthorized' };
  }

  try {
    // 1. Get reservation item details and verify access
    const [item] = await db
      .select({
        id: reservationItems.id,
        productId: reservationItems.productId,
        combinationKey: reservationItems.combinationKey,
        reservationId: reservationItems.reservationId,
        startDate: reservations.startDate,
        endDate: reservations.endDate,
      })
      .from(reservationItems)
      .innerJoin(
        reservations,
        eq(reservationItems.reservationId, reservations.id),
      )
      .where(
        and(
          eq(reservationItems.id, reservationItemId),
          eq(reservations.storeId, store.id),
        ),
      );

    if (!item) {
      return { error: 'errors.notFound' };
    }

    // Items without a productId (custom items) cannot have units
    if (!item.productId) {
      return { units: [], assigned: [] };
    }

    // 2. Get available units using the utility
    const { getAvailableUnitsForProduct } =
      await import('@/lib/utils/unit-availability');
    const availableUnits = await getAvailableUnitsForProduct(
      item.productId,
      item.startDate,
      item.endDate,
      item.reservationId, // Exclude current reservation to allow re-assignment
      item.combinationKey || undefined,
    );

    // 3. Get currently assigned units for this item
    const assignedUnits = await db
      .select({
        productUnitId: reservationItemUnits.productUnitId,
      })
      .from(reservationItemUnits)
      .where(eq(reservationItemUnits.reservationItemId, reservationItemId));

    // Include currently assigned units in the available list (they're already reserved for this item)
    const assignedUnitIds = assignedUnits.map((a) => a.productUnitId);
    const currentlyAssignedUnits = await db
      .select({
        id: productUnits.id,
        identifier: productUnits.identifier,
        notes: productUnits.notes,
      })
      .from(productUnits)
      .where(
        and(
          inArray(
            productUnits.id,
            assignedUnitIds.length > 0 ? assignedUnitIds : ['__none__'],
          ),
          eq(productUnits.status, 'available'),
        ),
      );

    // Merge available units with currently assigned (avoiding duplicates)
    const availableUnitIds = new Set(availableUnits.map((u) => u.id));
    const allUnits = [
      ...availableUnits,
      ...currentlyAssignedUnits.filter((u) => !availableUnitIds.has(u.id)),
    ].sort((a, b) => a.identifier.localeCompare(b.identifier, 'en'));

    return {
      units: allUnits.map((u) => ({
        id: u.id,
        identifier: u.identifier,
        notes: u.notes,
      })),
      assigned: assignedUnitIds,
    };
  } catch (error) {
    console.error('Failed to get available units:', error);
    return { error: 'errors.getAvailableUnitsFailed' };
  }
}
