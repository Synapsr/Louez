import { eq } from "drizzle-orm";

import type { ApiEffectPayloads, ApiEffectSenders } from "@louez/api/platform/effects";
import { db, stores } from "@louez/db";

import {
  notifyEquipmentPickedUp,
  notifyReservationCancelled,
  notifyReservationCompleted,
  notifyReservationConfirmed,
  notifyReservationRejected,
} from "@/lib/discord/platform-notifications";
import { dispatchCustomerNotification } from "@/lib/notifications/customer-dispatcher";
import { dispatchNotification } from "@/lib/notifications/dispatcher";
import { captureReservationActionSucceeded } from "@/lib/product-analytics/analytics";
import { reservationAnalyticsActions } from "@/lib/product-analytics/analytics-events";
import { getReservationStatusAnalyticsAction } from "@/lib/product-analytics/reservation-analytics";
import { createReservationInstantAccessUrl } from "@/lib/reservations/instant-access";
import { getStorefrontUrl } from "@/lib/storefront-url";

// The senders of a reservation's outbox rows (packages/api platform/effects.ts):
// the customer's message, the store's and the platform's notifications and
// the analytics events. Each sends the payload frozen in the write's
// transaction, and throws when nothing went out, so the row is retried.

type Payload<K extends keyof ApiEffectPayloads> = ApiEffectPayloads[K];

type ReservationEffectType =
  | "reservation.customerMessage"
  | "reservation.storeNotification"
  | "reservation.platformNotification"
  | "reservation.statusAnalytics"
  | "reservation.notesAnalytics";

/** What the senders call. A test replaces them, so nothing leaves the machine. */
export interface ReservationEffectDeps {
  loadStoreRouting: typeof loadStoreRouting;
  createReservationInstantAccessUrl: typeof createReservationInstantAccessUrl;
  dispatchCustomerNotification: typeof dispatchCustomerNotification;
  dispatchNotification: typeof dispatchNotification;
  notifyReservationConfirmed: typeof notifyReservationConfirmed;
  notifyReservationRejected: typeof notifyReservationRejected;
  notifyEquipmentPickedUp: typeof notifyEquipmentPickedUp;
  notifyReservationCompleted: typeof notifyReservationCompleted;
  notifyReservationCancelled: typeof notifyReservationCancelled;
  captureReservationActionSucceeded: typeof captureReservationActionSucceeded;
}

/**
 * Where the store wants its own notifications, read when they go out: a
 * webhook or a phone number changed since is the one that counts.
 */
async function loadStoreRouting(storeId: string) {
  return db.query.stores.findFirst({
    where: eq(stores.id, storeId),
    columns: {
      id: true,
      name: true,
      email: true,
      discordWebhookUrl: true,
      ownerPhone: true,
      notificationSettings: true,
      settings: true,
    },
  });
}

const defaultDeps: ReservationEffectDeps = {
  loadStoreRouting,
  createReservationInstantAccessUrl,
  dispatchCustomerNotification,
  dispatchNotification,
  notifyReservationConfirmed,
  notifyReservationRejected,
  notifyEquipmentPickedUp,
  notifyReservationCompleted,
  notifyReservationCancelled,
  captureReservationActionSucceeded,
};

/** Fails the row when every channel that was tried failed; a partial success is sent. */
function requireDelivery(channels: ReadonlyArray<{ sent: boolean; error?: string }>) {
  if (channels.some((channel) => channel.sent)) return;
  const errors = channels.flatMap((channel) => (channel.error ? [channel.error] : []));
  if (errors.length > 0) throw new Error(errors.join("; "));
}

/**
 * The dashboard's events keep their properties. The API and agents set their
 * own surface, so dashboard insights leave them out.
 */
const actorProperties = (transport: "rpc" | "openapi" | "mcp") =>
  transport === "rpc" ? {} : { actor: transport, surface: transport };

export function createReservationEffectSenders(
  overrides: Partial<ReservationEffectDeps> = {},
): Pick<ApiEffectSenders, ReservationEffectType> {
  const deps: ReservationEffectDeps = { ...defaultDeps, ...overrides };

  return {
    "reservation.customerMessage": async (payload: Payload<"reservation.customerMessage">) => {
      const { store, customer, reservation } = payload;
      const reservationUrl = getStorefrontUrl(
        store.slug,
        `/account/reservations/${reservation.id}`,
      );
      const ctx = {
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
        customer,
        reservation: {
          id: reservation.id,
          number: reservation.number,
          startDate: new Date(reservation.startDate),
          endDate: new Date(reservation.endDate),
          totalAmount: parseFloat(reservation.totalAmount),
          subtotalAmount: parseFloat(reservation.subtotalAmount),
          depositAmount: parseFloat(reservation.depositAmount),
          taxEnabled: !!reservation.taxRate,
          taxRate: reservation.taxRate ? parseFloat(reservation.taxRate) : null,
          subtotalExclTax: reservation.subtotalExclTax
            ? parseFloat(reservation.subtotalExclTax)
            : null,
          taxAmount: reservation.taxAmount ? parseFloat(reservation.taxAmount) : null,
          locale: reservation.locale,
        },
        reservationUrl,
      };

      if (payload.notification === "customer_request_rejected") {
        const result = await deps.dispatchCustomerNotification("customer_request_rejected", {
          ...ctx,
          reason: payload.rejectionReason ?? undefined,
        });
        requireDelivery([result.email, result.sms]);
        return;
      }
      const contractUrl = await deps.createReservationInstantAccessUrl({
        storeId: store.id,
        storeSlug: store.slug,
        customerEmail: customer.email,
        reservationId: reservation.id,
        redirectPath: `/account/reservations/${reservation.id}/contract`,
      });
      const result = await deps.dispatchCustomerNotification("customer_request_accepted", {
        ...ctx,
        items: payload.items.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          unitPrice: parseFloat(item.unitPrice),
          totalPrice: parseFloat(item.totalPrice),
        })),
        contractUrl,
        termsUrl: store.hasTerms ? getStorefrontUrl(store.slug, "/terms") : null,
        paymentUrl: null,
      });
      requireDelivery([result.email, result.sms]);
    },

    "reservation.storeNotification": async (payload: Payload<"reservation.storeNotification">) => {
      const store = await deps.loadStoreRouting(payload.storeId);
      if (!store) return;
      const result = await deps.dispatchNotification(payload.event, {
        store,
        reservation: {
          id: payload.reservation.id,
          number: payload.reservation.number,
          startDate: new Date(payload.reservation.startDate),
          endDate: new Date(payload.reservation.endDate),
          totalAmount: parseFloat(payload.reservation.totalAmount),
        },
        customer: payload.customer,
      });
      requireDelivery([result.email, result.sms, result.discord, result.push]);
    },

    "reservation.platformNotification": async (
      payload: Payload<"reservation.platformNotification">,
    ) => {
      const { store, number } = payload;
      switch (payload.kind) {
        case "confirmed":
          return deps.notifyReservationConfirmed(store, number);
        case "rejected":
          return deps.notifyReservationRejected(store, number);
        case "picked_up":
          return deps.notifyEquipmentPickedUp(store, number);
        case "completed":
          return deps.notifyReservationCompleted(
            store,
            number,
            parseFloat(payload.totalAmount),
            payload.currency ?? undefined,
          );
        case "cancelled":
          return deps.notifyReservationCancelled(store, number);
      }
    },

    "reservation.statusAnalytics": async (payload: Payload<"reservation.statusAnalytics">) => {
      const cancelled = payload.to === "cancelled";
      const action = cancelled
        ? reservationAnalyticsActions.cancelReservation
        : getReservationStatusAnalyticsAction(payload.to);
      if (!action) return;
      await deps.captureReservationActionSucceeded({
        distinctId: payload.ownerUserId,
        storeId: payload.storeId,
        reservationId: payload.reservationId,
        action,
        properties: {
          status_before: payload.from,
          status_after: payload.to,
          ...(cancelled ? {} : { warning_count: payload.warningCount }),
          ...actorProperties(payload.transport),
        },
      });
    },

    "reservation.notesAnalytics": async (payload: Payload<"reservation.notesAnalytics">) => {
      await deps.captureReservationActionSucceeded({
        distinctId: payload.ownerUserId,
        storeId: payload.storeId,
        reservationId: payload.reservationId,
        action: reservationAnalyticsActions.updateNotes,
        properties: { has_notes: payload.hasNotes, ...actorProperties(payload.transport) },
      });
    },
  };
}
