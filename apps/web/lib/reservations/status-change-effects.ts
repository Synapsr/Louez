import { and, eq } from "drizzle-orm";

import type { ApiEvent } from "@louez/api";
import { db, reservations, stores } from "@louez/db";
import type { ReservationStatus } from "@louez/db";
import type { NotificationEventType } from "@louez/types";

import {
  notifyEquipmentPickedUp,
  notifyReservationCancelled,
  notifyReservationCompleted,
  notifyReservationConfirmed,
  notifyReservationRejected,
} from "@/lib/discord/platform-notifications";
import { log } from "@/lib/evlog";
import { dispatchCustomerNotification } from "@/lib/notifications/customer-dispatcher";
import { dispatchNotification } from "@/lib/notifications/dispatcher";
import { captureReservationActionSucceeded } from "@/lib/product-analytics/analytics";
import { reservationAnalyticsActions } from "@/lib/product-analytics/analytics-events";
import { getReservationStatusAnalyticsAction } from "@/lib/product-analytics/reservation-analytics";
import { createReservationInstantAccessUrl } from "@/lib/reservations/instant-access";
import { getStorefrontUrl } from "@/lib/storefront-url";

// What follows a committed reservation status change in the app, whoever
// asked (dashboard, API, agent): the customer's message, the store's
// notifications, the platform notification and the analytics event. The
// change itself, its fee and its insurance contract are in packages/api
// (services/reservation-status.ts).

type StatusChangedEvent = Extract<ApiEvent, { type: "reservation.statusChanged" }>;

/** A failure after commit, as a log event: the change stands. */
export type StatusChangeFailure = {
  reservation: {
    event: string;
    reservationId: string;
    /** The notification that was not sent. */
    notification?: string;
    error: { name?: string; message: string; stack?: string };
  };
};

/** What the effects call. A test replaces them, so nothing leaves the machine. */
export interface StatusChangeEffectDeps {
  loadStore: typeof loadStore;
  loadReservation: typeof loadReservation;
  createReservationInstantAccessUrl: typeof createReservationInstantAccessUrl;
  dispatchCustomerNotification: typeof dispatchCustomerNotification;
  dispatchNotification: typeof dispatchNotification;
  notifyReservationConfirmed: typeof notifyReservationConfirmed;
  notifyReservationRejected: typeof notifyReservationRejected;
  notifyEquipmentPickedUp: typeof notifyEquipmentPickedUp;
  notifyReservationCompleted: typeof notifyReservationCompleted;
  notifyReservationCancelled: typeof notifyReservationCancelled;
  captureReservationActionSucceeded: typeof captureReservationActionSucceeded;
  log: { error(event: StatusChangeFailure): void };
}

/** The store fields the emails and the notifications read. */
async function loadStore(storeId: string) {
  return db.query.stores.findFirst({
    where: eq(stores.id, storeId),
    columns: {
      id: true,
      userId: true,
      name: true,
      slug: true,
      email: true,
      phone: true,
      address: true,
      logoUrl: true,
      darkLogoUrl: true,
      theme: true,
      settings: true,
      emailSettings: true,
      customerNotificationSettings: true,
      notificationSettings: true,
      discordWebhookUrl: true,
      ownerPhone: true,
      cgv: true,
    },
  });
}

/** The reservation as it is after the change, with its customer and lines. */
async function loadReservation(storeId: string, reservationId: string) {
  return db.query.reservations.findFirst({
    where: and(eq(reservations.id, reservationId), eq(reservations.storeId, storeId)),
    columns: {
      id: true,
      number: true,
      startDate: true,
      endDate: true,
      totalAmount: true,
      subtotalAmount: true,
      depositAmount: true,
      taxRate: true,
      subtotalExclTax: true,
      taxAmount: true,
    },
    with: {
      customer: {
        columns: { id: true, firstName: true, lastName: true, email: true, phone: true },
      },
      items: {
        columns: { quantity: true, unitPrice: true, totalPrice: true, productSnapshot: true },
      },
    },
  });
}

const defaultDeps: StatusChangeEffectDeps = {
  loadStore,
  loadReservation,
  createReservationInstantAccessUrl,
  dispatchCustomerNotification,
  dispatchNotification,
  notifyReservationConfirmed,
  notifyReservationRejected,
  notifyEquipmentPickedUp,
  notifyReservationCompleted,
  notifyReservationCancelled,
  captureReservationActionSucceeded,
  log,
};

const notificationEventByStatus: Partial<Record<ReservationStatus, NotificationEventType>> = {
  confirmed: "reservation_confirmed",
  rejected: "reservation_rejected",
  ongoing: "reservation_picked_up",
  completed: "reservation_completed",
  cancelled: "reservation_cancelled",
};

// JSON drops an Error's fields, so the event carries them, the stack too.
const errorFields = (error: unknown): StatusChangeFailure["reservation"]["error"] =>
  error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { message: String(error) };

/**
 * Dashboard events keep their properties. The API and agents set their own
 * surface, so dashboard insights leave them out.
 */
const actorProperties = (transport: StatusChangedEvent["transport"]) =>
  transport === "rpc" ? {} : { actor: transport, surface: transport };

export function createStatusChangeEffects(overrides: Partial<StatusChangeEffectDeps> = {}) {
  const deps: StatusChangeEffectDeps = { ...defaultDeps, ...overrides };

  const logFailure = (
    event: string,
    error: unknown,
    fields: Omit<StatusChangeFailure["reservation"], "event" | "error">,
  ) => deps.log.error({ reservation: { event, ...fields, error: errorFields(error) } });

  /** Runs every effect of one change; each failure is logged, none is thrown. */
  return async function runStatusChangeEffects(event: StatusChangedEvent): Promise<void> {
    const { reservationId, from, to } = event;
    const [store, reservation] = await Promise.all([
      deps.loadStore(event.store.id),
      deps.loadReservation(event.store.id, reservationId),
    ]);
    if (!store || !reservation) return;

    const customer = {
      id: reservation.customer.id,
      firstName: reservation.customer.firstName,
      lastName: reservation.customer.lastName,
      email: reservation.customer.email,
      phone: reservation.customer.phone,
    };
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
      customer,
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
        taxAmount: reservation.taxAmount ? parseFloat(reservation.taxAmount) : null,
      },
      reservationUrl: getStorefrontUrl(store.slug, `/account/reservations/${reservationId}`),
    };

    const sendCustomer = async (
      notification: "customer_request_accepted" | "customer_request_rejected",
      send: () => Promise<unknown>,
    ) => {
      try {
        await send();
      } catch (error) {
        logFailure("customer_notification_failed", error, { reservationId, notification });
      }
    };

    // The customer hears of an answer to their request or quote.
    if ((from === "pending" || from === "quote") && to === "confirmed") {
      await sendCustomer("customer_request_accepted", async () => {
        const contractUrl = await deps.createReservationInstantAccessUrl({
          storeId: store.id,
          storeSlug: store.slug,
          customerEmail: customer.email,
          reservationId,
          redirectPath: `/account/reservations/${reservationId}/contract`,
        });
        await deps.dispatchCustomerNotification("customer_request_accepted", {
          ...customerNotificationCtx,
          items: reservation.items.map((item) => ({
            name: item.productSnapshot?.name || "Product",
            quantity: item.quantity,
            unitPrice: parseFloat(item.unitPrice),
            totalPrice: parseFloat(item.totalPrice),
          })),
          contractUrl,
          termsUrl: store.cgv?.trim() ? getStorefrontUrl(store.slug, "/terms") : null,
          paymentUrl: null,
        });
      });
    } else if (to === "rejected") {
      await sendCustomer("customer_request_rejected", () =>
        deps.dispatchCustomerNotification("customer_request_rejected", {
          ...customerNotificationCtx,
          reason: event.rejectionReason ?? undefined,
        }),
      );
    }

    // The store's own notifications (SMS, Discord), as its preferences say.
    const eventType = notificationEventByStatus[to];
    if (eventType) {
      try {
        await deps.dispatchNotification(eventType, {
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
            firstName: customer.firstName,
            lastName: customer.lastName,
            email: customer.email,
            phone: customer.phone,
          },
        });
      } catch (error) {
        logFailure("store_notification_failed", error, { reservationId, notification: eventType });
      }
    }

    // The platform's notification.
    const storeInfo = { id: store.id, name: store.name, slug: store.slug };
    const platform =
      to === "confirmed"
        ? () => deps.notifyReservationConfirmed(storeInfo, reservation.number)
        : to === "rejected"
          ? () => deps.notifyReservationRejected(storeInfo, reservation.number)
          : to === "ongoing"
            ? () => deps.notifyEquipmentPickedUp(storeInfo, reservation.number)
            : to === "completed"
              ? () =>
                  deps.notifyReservationCompleted(
                    storeInfo,
                    reservation.number,
                    parseFloat(reservation.totalAmount),
                    store.settings?.currency,
                  )
              : to === "cancelled"
                ? () => deps.notifyReservationCancelled(storeInfo, reservation.number)
                : null;
    await platform?.().catch(() => {});

    const action =
      to === "cancelled"
        ? reservationAnalyticsActions.cancelReservation
        : getReservationStatusAnalyticsAction(to);
    if (action) {
      await deps
        .captureReservationActionSucceeded({
          distinctId: store.userId,
          storeId: store.id,
          reservationId,
          action,
          properties: {
            status_before: from,
            status_after: to,
            ...(to === "cancelled" ? {} : { warning_count: event.warningCount }),
            ...actorProperties(event.transport),
          },
        })
        .catch((error: unknown) => logFailure("analytics_failed", error, { reservationId }));
    }
  };
}

export const runStatusChangeEffects = createStatusChangeEffects();
