import { and, eq } from "drizzle-orm";

import type {
  MarketplaceCancellationAdapter,
  MarketplaceCheckoutAdapter,
  MarketplaceHoldAdapter,
} from "@louez/api/services";
import { db, payments } from "@louez/db";

import { createReservation } from "@/app/(storefront)/[slug]/checkout/actions";
import { env } from "@/env";
import { cancelTulipContractForReservation } from "@/lib/integrations/tulip/contracts";
import { voidReservationFee } from "@/lib/pay-as-you-go";
import { createReservationPaymentSessionForCustomer } from "@/lib/reservations/payment-session";
import { getCheckoutSession } from "@/lib/stripe";
import { getStripe } from "@/lib/stripe/client";

import { useLogger } from "./evlog";

export const marketplaceHoldAdapter: MarketplaceHoldAdapter = {
  createReservation: async (input) => {
    const result = await createReservation({
      reservationId: input.reservationId,
      storeId: input.storeId,
      customer: {
        email: input.customer.email,
        firstName: input.customer.firstName,
        lastName: input.customer.lastName,
        ...(input.customer.phone ? { phone: input.customer.phone } : {}),
      },
      items: input.items.map((item, index) => ({
        lineId: index.toString(),
        productId: item.productId,
        selectedAttributes: item.attributes,
        quantity: item.quantity,
        startDate: input.startAt,
        endDate: input.endAt,
        unitPrice: item.unitPrice,
        depositPerUnit: item.depositPerUnit,
        productSnapshot: {
          name: item.name,
          description: null,
          images: item.imageUrl ? [item.imageUrl] : [],
        },
      })),
      subtotalAmount: input.subtotal,
      depositAmount: input.deposit,
      totalAmount: input.total,
      locale: input.locale,
      source: "marketplace",
      marketplaceSecret: env.MARKETPLACE_CATALOG_SECRET,
    });

    if (!result.success) {
      return {
        success: false,
        error: result.error ?? "errors.createReservationError",
      };
    }

    return {
      success: true,
      reservationId: result.reservationId,
      customerId: result.customerId,
    };
  },
  auditIdentityConflict: (conflict) => {
    useLogger().set({
      marketplaceIdentityConflict: conflict,
    });
  },
};

export const marketplaceCheckoutAdapter: MarketplaceCheckoutAdapter = {
  createCheckout: async (input) => {
    const result = await createReservationPaymentSessionForCustomer(
      input.storeSlug,
      input.reservationId,
      input.customerId,
      "marketplace",
      {
        allowPendingReservation: true,
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
        marketplaceSecret: env.MARKETPLACE_CATALOG_SECRET,
      },
    );

    if (!result.success || !result.paymentUrl || !result.sessionId || !result.expiresAt) {
      return {
        success: false,
        error: result.error ?? "errors.paymentSessionError",
      };
    }

    return {
      success: true,
      checkoutUrl: result.paymentUrl,
      sessionId: result.sessionId,
      expiresAt: result.expiresAt,
    };
  },
  getCheckout: async (stripeAccountId, sessionId) => {
    const session = await getCheckoutSession(stripeAccountId, sessionId);
    return {
      status: session.status,
      paymentStatus: session.paymentStatus,
      url: session.url,
      expiresAt: session.expiresAt,
    };
  },
};

export const marketplaceCancellationAdapter: MarketplaceCancellationAdapter = {
  releasePendingPayments: async ({ reservationId, stripeAccountId }) => {
    const pendingPayments = await db.query.payments.findMany({
      where: and(
        eq(payments.reservationId, reservationId),
        eq(payments.type, "rental"),
        eq(payments.method, "stripe"),
        eq(payments.status, "pending"),
      ),
      columns: { id: true, stripeCheckoutSessionId: true },
    });

    for (const payment of pendingPayments) {
      if (stripeAccountId && payment.stripeCheckoutSessionId) {
        try {
          await getStripe().checkout.sessions.expire(payment.stripeCheckoutSessionId, {
            stripeAccount: stripeAccountId,
          });
        } catch {
          // The session may already be complete or expired; the local state is
          // still cancelled below.
        }
      }
      await db
        .update(payments)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(payments.id, payment.id));
    }
  },
  runCancellationSideEffects: async (reservationId) => {
    const logger = useLogger();
    try {
      await voidReservationFee(reservationId);
    } catch (error) {
      logger.error(
        error instanceof Error ? error : new Error("Marketplace cancellation fee release failed"),
      );
    }
    try {
      await cancelTulipContractForReservation({ reservationId });
    } catch (error) {
      logger.error(
        error instanceof Error
          ? error
          : new Error("Marketplace cancellation insurance release failed"),
      );
    }
  },
};
