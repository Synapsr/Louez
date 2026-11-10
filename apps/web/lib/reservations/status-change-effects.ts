import { eq } from "drizzle-orm";

import type {
  ApiEffectPayloads,
  ApiEffectSenders,
  EffectSendContext,
} from "@louez/api/platform/effects";
import { db, stores } from "@louez/db";

import { sendPlatformReservationStatus } from "@/lib/discord/platform-notifications";
import { sendCustomerNotificationChannel } from "@/lib/notifications/customer-dispatcher";
import { sendStoreNotificationChannel } from "@/lib/notifications/dispatcher";
import { captureReservationActionSucceededOrThrow } from "@/lib/product-analytics/analytics";
import { reservationAnalyticsActions } from "@/lib/product-analytics/analytics-events";
import { getReservationStatusAnalyticsAction } from "@/lib/product-analytics/reservation-analytics";
import { createReservationInstantAccessUrl } from "@/lib/reservations/instant-access";
import { getStorefrontUrl } from "@/lib/storefront-url";
import { withEffectSignal } from "@/lib/api/effect-signal";

// The senders of a reservation's outbox rows (packages/api platform/effects.ts):
// one channel of the customer's message, of the store's notification or of
// the platform's, or an analytics event. Each sends the payload frozen in the
// write's transaction, checks its claim right before each provider call,
// passes its abort signal down to them, throws when nothing went out (the row
// is retried) and answers `skipped` when there is nothing to send.

type Payload<K extends keyof ApiEffectPayloads> = ApiEffectPayloads[K];
type Outcome = Promise<void | { skipped: string }>;

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
  sendCustomerNotificationChannel: typeof sendCustomerNotificationChannel;
  sendStoreNotificationChannel: typeof sendStoreNotificationChannel;
  sendPlatformReservationStatus: typeof sendPlatformReservationStatus;
  captureReservationActionSucceededOrThrow: typeof captureReservationActionSucceededOrThrow;
}

/**
 * Where the store wants its own notifications, read when they go out: a
 * webhook, a phone number or a preference changed since is the one that
 * counts.
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
  sendCustomerNotificationChannel,
  sendStoreNotificationChannel,
  sendPlatformReservationStatus,
  captureReservationActionSucceededOrThrow,
};

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

  // Every provider call under a sender honours its abort (lib/api/effect-signal.ts).
  const guarded =
    <P>(send: (payload: P, context: EffectSendContext) => Outcome) =>
    (payload: P, context: EffectSendContext) =>
      withEffectSignal(context, () => send(payload, context));

  return {
    "reservation.customerMessage": guarded(
      async (
        payload: Payload<"reservation.customerMessage">,
        context: EffectSendContext,
      ): Outcome => {
        const { store, customer, reservation } = payload;
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
          reservationUrl: getStorefrontUrl(store.slug, `/account/reservations/${reservation.id}`),
        };
        const beforeSend = () => context.assertClaim();
        const items = payload.items.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          unitPrice: parseFloat(item.unitPrice),
          totalPrice: parseFloat(item.totalPrice),
        }));

        if (payload.notification === "customer_reservation_cancelled") {
          return deps.sendCustomerNotificationChannel(
            "customer_reservation_cancelled",
            { ...ctx, items, storefrontUrl: getStorefrontUrl(store.slug) },
            payload.channel,
            beforeSend,
            context.effectId,
          );
        }
        if (payload.notification === "customer_request_rejected") {
          return deps.sendCustomerNotificationChannel(
            "customer_request_rejected",
            { ...ctx, reason: payload.rejectionReason ?? undefined },
            payload.channel,
            beforeSend,
            context.effectId,
          );
        }
        // The email links to the contract; an SMS sends the account link only.
        const contractUrl =
          payload.channel === "email"
            ? await deps.createReservationInstantAccessUrl({
                storeId: store.id,
                storeSlug: store.slug,
                customerEmail: customer.email,
                reservationId: reservation.id,
                redirectPath: `/account/reservations/${reservation.id}/contract`,
              })
            : undefined;
        return deps.sendCustomerNotificationChannel(
          "customer_request_accepted",
          {
            ...ctx,
            items,
            contractUrl,
            termsUrl: store.hasTerms ? getStorefrontUrl(store.slug, "/terms") : null,
            paymentUrl: null,
          },
          payload.channel,
          beforeSend,
          context.effectId,
        );
      },
    ),
    "reservation.storeNotification": guarded(
      async (
        payload: Payload<"reservation.storeNotification">,
        context: EffectSendContext,
      ): Outcome => {
        const store = await deps.loadStoreRouting(payload.storeId);
        if (!store) return { skipped: "the store is gone" };
        return deps.sendStoreNotificationChannel(
          payload.event,
          {
            actor: payload.actor,
            store,
            reservation: {
              id: payload.reservation.id,
              number: payload.reservation.number,
              startDate: new Date(payload.reservation.startDate),
              endDate: new Date(payload.reservation.endDate),
              totalAmount: parseFloat(payload.reservation.totalAmount),
              currency: payload.reservation.currency,
            },
            customer: payload.customer,
          },
          payload.channel,
          () => context.assertClaim(),
          context.effectId,
        );
      },
    ),
    "reservation.platformNotification": guarded(
      async (
        payload: Payload<"reservation.platformNotification">,
        context: EffectSendContext,
      ): Outcome =>
        deps.sendPlatformReservationStatus(
          payload.channel,
          payload.kind,
          {
            store: payload.store,
            number: payload.number,
            totalAmount: parseFloat(payload.totalAmount),
            currency: payload.currency ?? undefined,
          },
          () => context.assertClaim(),
        ),
    ),
    "reservation.statusAnalytics": guarded(
      async (
        payload: Payload<"reservation.statusAnalytics">,
        context: EffectSendContext,
      ): Outcome => {
        const cancelled = payload.to === "cancelled";
        const action = cancelled
          ? reservationAnalyticsActions.cancelReservation
          : getReservationStatusAnalyticsAction(payload.to);
        if (!action) return { skipped: "no analytics event for this status" };
        await context.assertClaim();
        return deps.captureReservationActionSucceededOrThrow({
          distinctId: payload.ownerUserId,
          storeId: payload.storeId,
          reservationId: payload.reservationId,
          action,
          identity: { eventUuid: payload.eventUuid, occurredAt: payload.occurredAt },
          properties: {
            status_before: payload.from,
            status_after: payload.to,
            ...(cancelled ? {} : { warning_count: payload.warningCount }),
            ...actorProperties(payload.transport),
          },
        });
      },
    ),
    "reservation.notesAnalytics": guarded(
      async (
        payload: Payload<"reservation.notesAnalytics">,
        context: EffectSendContext,
      ): Outcome => {
        await context.assertClaim();
        return deps.captureReservationActionSucceededOrThrow({
          distinctId: payload.ownerUserId,
          storeId: payload.storeId,
          reservationId: payload.reservationId,
          action: reservationAnalyticsActions.updateNotes,
          identity: { eventUuid: payload.eventUuid, occurredAt: payload.occurredAt },
          properties: { has_notes: payload.hasNotes, ...actorProperties(payload.transport) },
        });
      },
    ),
  };
}
