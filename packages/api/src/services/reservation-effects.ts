import { customers, reservationItems, reservations, stores, type Transaction } from "@louez/db";
import { and, asc, eq } from "drizzle-orm";

import type { Transport } from "../platform/actor";
import type { ApiEffect, ApiEffectPayloads } from "../platform/effects";

/**
 * The outbox rows of a reservation status change, built in its transaction
 * under its locks: what the customer's message, the store's notification,
 * the platform's notification and the analytics event say, and to whom. An
 * edit after the commit changes none of them.
 */

type Status = ApiEffectPayloads["reservation.statusAnalytics"]["to"];

const STORE_EVENT: Partial<
  Record<Status, ApiEffectPayloads["reservation.storeNotification"]["event"]>
> = {
  confirmed: "reservation_confirmed",
  rejected: "reservation_rejected",
  ongoing: "reservation_picked_up",
  completed: "reservation_completed",
  cancelled: "reservation_cancelled",
};

const PLATFORM_KIND: Partial<
  Record<Status, ApiEffectPayloads["reservation.platformNotification"]["kind"]>
> = {
  confirmed: "confirmed",
  rejected: "rejected",
  ongoing: "picked_up",
  completed: "completed",
  cancelled: "cancelled",
};

export async function buildStatusChangeEffects(
  tx: Transaction,
  params: {
    storeId: string;
    reservationId: string;
    from: Status;
    to: Status;
    transport: Transport;
    rejectionReason: string | null;
    warningCount: number;
  },
): Promise<ApiEffect[]> {
  const { storeId, reservationId, from, to } = params;
  const [[store], [reservation], items] = await Promise.all([
    tx
      .select({
        id: stores.id,
        userId: stores.userId,
        name: stores.name,
        slug: stores.slug,
        email: stores.email,
        phone: stores.phone,
        address: stores.address,
        logoUrl: stores.logoUrl,
        darkLogoUrl: stores.darkLogoUrl,
        theme: stores.theme,
        settings: stores.settings,
        emailSettings: stores.emailSettings,
        customerNotificationSettings: stores.customerNotificationSettings,
        cgv: stores.cgv,
      })
      .from(stores)
      .where(eq(stores.id, storeId)),
    tx
      .select({
        number: reservations.number,
        startDate: reservations.startDate,
        endDate: reservations.endDate,
        totalAmount: reservations.totalAmount,
        subtotalAmount: reservations.subtotalAmount,
        depositAmount: reservations.depositAmount,
        taxRate: reservations.taxRate,
        subtotalExclTax: reservations.subtotalExclTax,
        taxAmount: reservations.taxAmount,
        locale: reservations.locale,
        customerId: customers.id,
        firstName: customers.firstName,
        lastName: customers.lastName,
        email: customers.email,
        phone: customers.phone,
      })
      .from(reservations)
      .innerJoin(customers, eq(reservations.customerId, customers.id))
      .where(and(eq(reservations.id, reservationId), eq(reservations.storeId, storeId))),
    tx
      .select({
        quantity: reservationItems.quantity,
        unitPrice: reservationItems.unitPrice,
        totalPrice: reservationItems.totalPrice,
        productSnapshot: reservationItems.productSnapshot,
      })
      .from(reservationItems)
      .where(eq(reservationItems.reservationId, reservationId))
      .orderBy(asc(reservationItems.createdAt), asc(reservationItems.id)),
  ]);
  if (!store || !reservation) return [];

  const customer = {
    firstName: reservation.firstName,
    lastName: reservation.lastName,
    email: reservation.email,
    phone: reservation.phone,
  };
  const dates = {
    startDate: reservation.startDate.toISOString(),
    endDate: reservation.endDate.toISOString(),
  };
  const effects: ApiEffect[] = [];

  const accepted = to === "confirmed" && (from === "pending" || from === "quote");
  if (accepted || to === "rejected") {
    effects.push({
      type: "reservation.customerMessage",
      payload: {
        notification: accepted ? "customer_request_accepted" : "customer_request_rejected",
        store: {
          id: store.id,
          name: store.name,
          slug: store.slug,
          email: store.email,
          phone: store.phone,
          address: store.address,
          logoUrl: store.logoUrl,
          darkLogoUrl: store.darkLogoUrl,
          theme: store.theme,
          settings: store.settings,
          emailSettings: store.emailSettings,
          customerNotificationSettings: store.customerNotificationSettings,
          hasTerms: Boolean(store.cgv?.trim()),
        },
        customer: { id: reservation.customerId, ...customer },
        reservation: {
          id: reservationId,
          number: reservation.number,
          ...dates,
          totalAmount: reservation.totalAmount,
          subtotalAmount: reservation.subtotalAmount,
          depositAmount: reservation.depositAmount,
          taxRate: reservation.taxRate,
          subtotalExclTax: reservation.subtotalExclTax,
          taxAmount: reservation.taxAmount,
          locale: reservation.locale,
        },
        items: items.map((item) => ({
          name: item.productSnapshot?.name || "Product",
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
        })),
        rejectionReason: to === "rejected" ? params.rejectionReason : null,
      },
    });
  }

  const event = STORE_EVENT[to];
  if (event) {
    effects.push({
      type: "reservation.storeNotification",
      payload: {
        event,
        storeId,
        reservation: {
          id: reservationId,
          number: reservation.number,
          ...dates,
          totalAmount: reservation.totalAmount,
        },
        customer,
      },
    });
  }

  const kind = PLATFORM_KIND[to];
  if (kind) {
    effects.push({
      type: "reservation.platformNotification",
      payload: {
        kind,
        store: { id: store.id, name: store.name, slug: store.slug },
        number: reservation.number,
        totalAmount: reservation.totalAmount,
        currency: store.settings?.currency ?? null,
      },
    });
  }

  effects.push({
    type: "reservation.statusAnalytics",
    payload: {
      ownerUserId: store.userId,
      storeId,
      reservationId,
      from,
      to,
      transport: params.transport,
      warningCount: params.warningCount,
    },
  });
  return effects;
}
