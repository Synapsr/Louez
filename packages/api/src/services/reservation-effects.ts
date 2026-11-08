import type { stores } from "@louez/db";

import type { Transport } from "../platform/actor";
import type { ApiEffect, ApiEffectPayloads, EffectStore } from "../platform/effects";

/**
 * The outbox rows of a reservation status change: what the customer's
 * messages, the store's and the platform's notifications and the analytics
 * event say, and to whom. Built from the snapshot the change read once under
 * its locks, the same one its preview and its confirmation show, so what an
 * agent confirmed is what goes out.
 *
 * Ordering keys: `reservation:<id>:customer:<channel>`, `…:store:<channel>`
 * and `…:platform:<channel>`; rows of one key go out in order. A new status
 * change supersedes the customer messages of an earlier one still unsent
 * (they speak of a status that is no longer true); store and platform
 * notifications are records of each change, and all go out, in order.
 */

type Status = ApiEffectPayloads["reservation.statusAnalytics"]["to"];
type StoreRow = typeof stores.$inferSelect;

/** What a status change read once, under its locks. */
export interface StatusChangeSnapshot {
  reservation: {
    id: string;
    number: string;
    startDate: Date;
    endDate: Date;
    totalAmount: string;
    subtotalAmount: string;
    depositAmount: string;
    taxRate: string | null;
    subtotalExclTax: string | null;
    taxAmount: string | null;
    locale: string | null;
  };
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
  } | null;
  store: EffectStore & { userId: string; settings: StoreRow["settings"] };
  items: Array<{ name: string; quantity: number; unitPrice: string; totalPrice: string }>;
}

/** The ordering key prefix of a reservation's customer messages. */
export const customerMessageKeyPrefix = (reservationId: string) =>
  `reservation:${reservationId}:customer:`;

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

/** The store's channels of its own notifications; the email one is sent by other code. */
const STORE_CHANNELS = ["sms", "push", "discord"] as const;
const PLATFORM_CHANNELS = ["discord", "fromhello"] as const;

export function buildStatusChangeEffects(
  snapshot: StatusChangeSnapshot,
  params: {
    from: Status;
    to: Status;
    transport: Transport;
    rejectionReason: string | null;
    warningCount: number;
    /** The customer messages the preview announced, one per channel. */
    messages: ReadonlyArray<{
      message: "request_accepted" | "request_rejected";
      channel: "email" | "sms";
    }>;
  },
): ApiEffect[] {
  const { reservation, customer, store } = snapshot;
  const { from, to } = params;
  const reservationId = reservation.id;
  const dates = {
    startDate: reservation.startDate.toISOString(),
    endDate: reservation.endDate.toISOString(),
  };
  const effects: ApiEffect[] = [];

  if (customer) {
    for (const { message, channel } of params.messages) {
      effects.push({
        type: "reservation.customerMessage",
        orderingKey: `${customerMessageKeyPrefix(reservationId)}${channel}`,
        reservationId,
        customerId: customer.id,
        payload: {
          channel,
          notification:
            message === "request_accepted"
              ? "customer_request_accepted"
              : "customer_request_rejected",
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
            hasTerms: store.hasTerms,
          },
          customer,
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
          items: snapshot.items,
          rejectionReason: to === "rejected" ? params.rejectionReason : null,
        },
      });
    }
  }

  const event = STORE_EVENT[to];
  if (event && customer) {
    for (const channel of STORE_CHANNELS) {
      effects.push({
        type: "reservation.storeNotification",
        orderingKey: `reservation:${reservationId}:store:${channel}`,
        reservationId,
        customerId: customer.id,
        payload: {
          channel,
          event,
          storeId: store.id,
          reservation: {
            id: reservationId,
            number: reservation.number,
            ...dates,
            totalAmount: reservation.totalAmount,
          },
          customer: {
            firstName: customer.firstName,
            lastName: customer.lastName,
            email: customer.email,
            phone: customer.phone,
          },
        },
      });
    }
  }

  const kind = PLATFORM_KIND[to];
  if (kind) {
    for (const channel of PLATFORM_CHANNELS) {
      effects.push({
        type: "reservation.platformNotification",
        orderingKey: `reservation:${reservationId}:platform:${channel}`,
        reservationId,
        payload: {
          channel,
          kind,
          store: { id: store.id, name: store.name, slug: store.slug },
          number: reservation.number,
          totalAmount: reservation.totalAmount,
          currency: store.settings?.currency ?? null,
        },
      });
    }
  }

  effects.push({
    type: "reservation.statusAnalytics",
    reservationId,
    payload: {
      ownerUserId: store.userId,
      storeId: store.id,
      reservationId,
      from,
      to,
      transport: params.transport,
      warningCount: params.warningCount,
    },
  });
  return effects;
}
