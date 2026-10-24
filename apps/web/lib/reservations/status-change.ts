import { revalidatePath } from "next/cache";

import { and, eq } from "drizzle-orm";

import {
  ConsumableStockError,
  db,
  invalidReservationTransitionMessage,
  reservations,
  stores,
} from "@louez/db";
import type {
  ChangeReservationStatusResult,
  ReservationActor,
  ReservationEffectRunner,
  ReservationStatus,
} from "@louez/db";
import type { McpStatusChangeInput, McpStatusChangeResult } from "@louez/mcp";
import type { NotificationEventType } from "@louez/types";

import { runReservationEffects } from "@/lib/billing/reservation-effects";
import {
  notifyEquipmentPickedUp,
  notifyReservationCancelled,
  notifyReservationCompleted,
  notifyReservationConfirmed,
  notifyReservationRejected,
} from "@/lib/discord/platform-notifications";
import { log } from "@/lib/evlog";
import {
  cancelTulipContractForReservation,
  createTulipContractForReservation,
} from "@/lib/integrations/tulip/contracts";
import { dispatchCustomerNotification } from "@/lib/notifications/customer-dispatcher";
import { dispatchNotification } from "@/lib/notifications/dispatcher";
import { captureReservationActionSucceeded } from "@/lib/product-analytics/analytics";
import { reservationAnalyticsActions } from "@/lib/product-analytics/analytics-events";
import { getReservationStatusAnalyticsAction } from "@/lib/product-analytics/reservation-analytics";
import { createReservationInstantAccessUrl } from "@/lib/reservations/instant-access";
import { ReservationInventoryError } from "@/lib/reservations/reserve-inventory";
import { changeStoreReservationStatus } from "@/lib/reservations/store-status-change";
import { getStorefrontUrl } from "@/lib/storefront-url";
import { evaluateReservationRules } from "@/lib/utils/reservation-rules";

// A status change the store asks for, and everything around it: the dashboard's
// status menu and cancel button, the assistant and MCP all go through here. The
// transaction itself is changeStoreReservationStatus.

type StoreRow = typeof stores.$inferSelect;

const statusChangeStoreColumns = {
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
} as const satisfies Partial<Record<keyof StoreRow, true>>;

/** The store fields the change, its emails and its notifications read. */
export type StatusChangeStore = Pick<StoreRow, keyof typeof statusChangeStoreColumns>;

/** Someone on the dashboard, the assistant, or an MCP client. */
export type StoreStatusChangeActor = Extract<ReservationActor, "store_user" | "ai_chat" | "mcp">;

export interface StoreStatusChangeRequest {
  store: StatusChangeStore;
  reservationId: string;
  actor: StoreStatusChangeActor;
  actorUserId: string | null;
}

export interface UpdateStoreReservationStatusInput extends StoreStatusChangeRequest {
  status: ReservationStatus;
  /** Kept only for a rejection: the timeline and the customer's email show it. */
  rejectionReason?: string;
}

export interface StatusChangeWarning {
  key: string;
  params?: Record<string, string | number>;
}

type StatusChangeRefusal = Extract<ChangeReservationStatusResult, { changed: false }>;

export type StoreStatusChangeOutcome =
  | {
      ok: true;
      number: string;
      from: ReservationStatus;
      to: ReservationStatus;
      warnings: StatusChangeWarning[];
    }
  /** The store has no such reservation. */
  | { ok: false; error: "not_found" }
  /** Refused under the lock: gone, already there, changed since the read, or not allowed. */
  | { ok: false; error: "refused"; refusal: StatusChangeRefusal }
  /** The items or the stock are no longer free. `message` is an `errors.*` key. */
  | { ok: false; error: "unavailable"; message: string };

// The MCP server's contract (packages/mcp/src/deps.ts); the assistant uses it too.
export type AgentStatusChangeInput = Omit<McpStatusChangeInput, "actor"> & {
  actor: Extract<StoreStatusChangeActor, "ai_chat" | "mcp">;
};

/** What the assistant and MCP turn into their answer. */
export type AgentStatusChangeResult = McpStatusChangeResult;

/** A failure after commit, as a log event: the change stands. */
export type StatusChangeFailure = {
  reservation: {
    event: string;
    reservationId: string;
    /** The notification that was not sent. */
    notification?: string;
    /** The Tulip contract that was not cancelled. */
    contractId?: string;
    error: { name?: string; message: string; stack?: string };
  };
};

/** What runs after commit. A test replaces it, so nothing leaves the machine. */
export interface StatusChangeDeps {
  runReservationEffects: ReservationEffectRunner;
  createTulipContractForReservation: typeof createTulipContractForReservation;
  cancelTulipContractForReservation: typeof cancelTulipContractForReservation;
  createReservationInstantAccessUrl: typeof createReservationInstantAccessUrl;
  dispatchCustomerNotification: typeof dispatchCustomerNotification;
  dispatchNotification: typeof dispatchNotification;
  notifyReservationConfirmed: typeof notifyReservationConfirmed;
  notifyReservationRejected: typeof notifyReservationRejected;
  notifyEquipmentPickedUp: typeof notifyEquipmentPickedUp;
  notifyReservationCompleted: typeof notifyReservationCompleted;
  notifyReservationCancelled: typeof notifyReservationCancelled;
  revalidatePath: (path: string) => void;
  captureReservationActionSucceeded: typeof captureReservationActionSucceeded;
  log: { error(event: StatusChangeFailure): void };
}

const defaultDeps: StatusChangeDeps = {
  runReservationEffects,
  createTulipContractForReservation,
  cancelTulipContractForReservation,
  createReservationInstantAccessUrl,
  dispatchCustomerNotification,
  dispatchNotification,
  notifyReservationConfirmed,
  notifyReservationRejected,
  notifyEquipmentPickedUp,
  notifyReservationCompleted,
  notifyReservationCancelled,
  revalidatePath,
  captureReservationActionSucceeded,
  log,
};

const notificationEventByStatus: Partial<Record<ReservationStatus, NotificationEventType>> = {
  confirmed: "reservation_confirmed",
  rejected: "reservation_rejected",
  ongoing: "reservation_picked_up",
  completed: "reservation_completed",
};

/** English for the assistant and MCP. The stock error keeps its key, as before. */
const agentUnavailableMessages: Partial<Record<string, string>> = {
  "errors.productNoLongerAvailable":
    "Not confirmed: some items of this reservation are no longer available for its dates.",
};

// JSON drops an Error's fields, so the event carries them, the stack too.
const errorFields = (error: unknown): StatusChangeFailure["reservation"]["error"] =>
  error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { message: String(error) };

function getErrorKey(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.startsWith("errors.")) {
    return error.message;
  }

  return fallback;
}

/** The transaction rolled back because the items or the stock are taken. */
function toUnavailable(error: unknown): StoreStatusChangeOutcome | null {
  if (error instanceof ConsumableStockError || error instanceof ReservationInventoryError) {
    return { ok: false, error: "unavailable", message: error.message };
  }
  return null;
}

/**
 * Dashboard events keep their properties. The assistant and MCP set their own
 * surface, so dashboard insights leave them out, and say who acted.
 */
const actorProperties = (actor: StoreStatusChangeActor) =>
  actor === "store_user" ? {} : { actor, surface: actor === "ai_chat" ? "assistant" : "mcp" };

export function createReservationStatusService(overrides: Partial<StatusChangeDeps> = {}) {
  const deps: StatusChangeDeps = { ...defaultDeps, ...overrides };

  const logFailure = (
    event: string,
    error: unknown,
    fields: Omit<StatusChangeFailure["reservation"], "event" | "error">,
  ) => deps.log.error({ reservation: { event, ...fields, error: errorFields(error) } });

  const revalidateReservation = (reservationId: string) => {
    // A tool call can run after its route has answered, where Next has no
    // request scope to revalidate in.
    try {
      deps.revalidatePath("/dashboard/reservations");
      deps.revalidatePath(`/dashboard/reservations/${reservationId}`);
    } catch (error) {
      logFailure("revalidate_failed", error, { reservationId });
    }
  };

  /** The dashboard's status menu: confirm, reject, pick up, return, and the rest. */
  async function updateStatus({
    store,
    reservationId,
    status,
    rejectionReason,
    actor,
    actorUserId,
  }: UpdateStoreReservationStatusInput): Promise<StoreStatusChangeOutcome> {
    const reservation = await db.query.reservations.findFirst({
      where: and(eq(reservations.id, reservationId), eq(reservations.storeId, store.id)),
      with: {
        customer: true,
        items: true,
      },
    });

    if (!reservation) {
      return { ok: false, error: "not_found" };
    }

    const validationWarnings =
      status === "confirmed"
        ? evaluateReservationRules({
            startDate: reservation.startDate,
            endDate: reservation.endDate,
            storeSettings: store.settings,
          })
        : [];

    let change: ChangeReservationStatusResult;
    try {
      change = await db.transaction(
        (tx) =>
          changeStoreReservationStatus(tx, {
            reservationId,
            storeId: store.id,
            to: status,
            actor,
            actorUserId,
            // Refuses when someone changed the status since the read above.
            expectedFrom: reservation.status,
            dates: { startDate: reservation.startDate, endDate: reservation.endDate },
            activity: {
              metadata: {
                ...(status === "rejected" && rejectionReason && { rejectionReason }),
                ...(validationWarnings.length > 0 && {
                  validationWarnings,
                  validationWarningsCount: validationWarnings.length,
                }),
              },
            },
          }),
        { isolationLevel: "read committed" },
      );
    } catch (error) {
      const unavailable = toUnavailable(error);
      if (unavailable) return unavailable;
      throw error;
    }
    if (!change.changed) {
      return { ok: false, error: "refused", refusal: change };
    }

    // Right after commit: the pay-as-you-go fee is recorded or voided.
    await deps.runReservationEffects(change.effects);
    const previousStatus = change.from;

    let tulipWarning: StatusChangeWarning | null = null;
    if (status === "confirmed") {
      try {
        // The assistant and MCP act for a store user, as the dashboard does.
        await deps.createTulipContractForReservation({
          reservationId,
          source: "dashboard_reservation_confirmation",
        });
      } catch (error) {
        logFailure("tulip_contract_create_failed", error, { reservationId });

        tulipWarning = {
          key: getErrorKey(error, "errors.tulipContractCreationFailed"),
        };
      }
    }

    // Send emails based on status change
    const reservationUrl = getStorefrontUrl(store.slug, `/account/reservations/${reservationId}`);

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
        taxAmount: reservation.taxAmount ? parseFloat(reservation.taxAmount) : null,
      },
      reservationUrl,
    };

    // Dispatch customer notification based on status change
    if ((previousStatus === "pending" || previousStatus === "quote") && status === "confirmed") {
      // Request/quote accepted - build items for email
      const emailItems = reservation.items.map((item) => ({
        name: item.productSnapshot?.name || "Product",
        quantity: item.quantity,
        unitPrice: parseFloat(item.unitPrice),
        totalPrice: parseFloat(item.totalPrice),
      }));

      try {
        const contractUrl = await deps.createReservationInstantAccessUrl({
          storeId: store.id,
          storeSlug: store.slug,
          customerEmail: reservation.customer.email,
          reservationId,
          redirectPath: `/account/reservations/${reservationId}/contract`,
        });
        const termsUrl = store.cgv?.trim() ? getStorefrontUrl(store.slug, "/terms") : null;

        deps
          .dispatchCustomerNotification("customer_request_accepted", {
            ...customerNotificationCtx,
            items: emailItems,
            contractUrl,
            termsUrl,
            paymentUrl: null,
          })
          .catch((error: unknown) => {
            logFailure("customer_notification_failed", error, {
              reservationId,
              notification: "customer_request_accepted",
            });
          });
      } catch (error) {
        logFailure("customer_notification_failed", error, {
          reservationId,
          notification: "customer_request_accepted",
        });
      }
    } else if (status === "rejected") {
      // Request rejected
      deps
        .dispatchCustomerNotification("customer_request_rejected", {
          ...customerNotificationCtx,
          reason: rejectionReason,
        })
        .catch((error: unknown) => {
          logFailure("customer_notification_failed", error, {
            reservationId,
            notification: "customer_request_rejected",
          });
        });
    }

    // Dispatch admin notifications (SMS, Discord) based on preferences
    const eventType = notificationEventByStatus[status];
    if (eventType) {
      deps
        .dispatchNotification(eventType, {
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
        })
        .catch((error: unknown) => {
          logFailure("store_notification_failed", error, {
            reservationId,
            notification: eventType,
          });
        });
    }

    // Platform admin notification
    const storeInfo = { id: store.id, name: store.name, slug: store.slug };
    const currency = store.settings?.currency;
    if (status === "confirmed") {
      deps.notifyReservationConfirmed(storeInfo, reservation.number).catch(() => {});
    } else if (status === "rejected") {
      deps.notifyReservationRejected(storeInfo, reservation.number).catch(() => {});
    } else if (status === "ongoing") {
      deps.notifyEquipmentPickedUp(storeInfo, reservation.number).catch(() => {});
    } else if (status === "completed") {
      deps
        .notifyReservationCompleted(
          storeInfo,
          reservation.number,
          parseFloat(reservation.totalAmount),
          currency,
        )
        .catch(() => {});
    }

    revalidateReservation(reservationId);
    const responseWarnings: StatusChangeWarning[] = [
      ...validationWarnings.map((warning) => ({
        key: warning.key,
        params: warning.params,
      })),
      ...(tulipWarning ? [tulipWarning] : []),
    ];

    const analyticsAction = getReservationStatusAnalyticsAction(status);
    if (analyticsAction) {
      await deps.captureReservationActionSucceeded({
        distinctId: store.userId,
        storeId: store.id,
        reservationId,
        action: analyticsAction,
        properties: {
          status_before: previousStatus,
          status_after: status,
          warning_count: responseWarnings.length,
          ...actorProperties(actor),
        },
      });
    }

    return {
      ok: true,
      number: reservation.number,
      from: previousStatus,
      to: change.to,
      warnings: responseWarnings,
    };
  }

  /** The dashboard's cancel button: from any status that is not final. */
  async function cancel({
    store,
    reservationId,
    actor,
    actorUserId,
  }: StoreStatusChangeRequest): Promise<StoreStatusChangeOutcome> {
    const reservation = await db.query.reservations.findFirst({
      where: and(eq(reservations.id, reservationId), eq(reservations.storeId, store.id)),
      with: {
        customer: true,
      },
    });

    if (!reservation) {
      return { ok: false, error: "not_found" };
    }

    let cancellation: ChangeReservationStatusResult;
    try {
      cancellation = await db.transaction((tx) =>
        changeStoreReservationStatus(tx, {
          reservationId,
          storeId: store.id,
          to: "cancelled",
          actor,
          actorUserId,
          dates: { startDate: reservation.startDate, endDate: reservation.endDate },
        }),
      );
    } catch (error) {
      const unavailable = toUnavailable(error);
      if (unavailable) return unavailable;
      throw error;
    }
    // Gone, or already cancelled, completed, rejected or declined.
    if (!cancellation.changed) {
      return { ok: false, error: "refused", refusal: cancellation };
    }

    // Right after commit: the pay-as-you-go fee is voided.
    await deps.runReservationEffects(cancellation.effects);

    if (reservation.tulipContractId) {
      try {
        await deps.cancelTulipContractForReservation({ reservationId });
      } catch (error) {
        logFailure("tulip_contract_cancel_failed", error, {
          reservationId,
          contractId: reservation.tulipContractId,
        });
      }
    }

    // Dispatch admin notifications (SMS, Discord) based on preferences
    deps
      .dispatchNotification("reservation_cancelled", {
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
      })
      .catch((error: unknown) => {
        logFailure("store_notification_failed", error, {
          reservationId,
          notification: "reservation_cancelled",
        });
      });

    // Platform admin notification
    deps
      .notifyReservationCancelled(
        { id: store.id, name: store.name, slug: store.slug },
        reservation.number,
      )
      .catch(() => {});

    revalidateReservation(reservationId);
    await deps.captureReservationActionSucceeded({
      distinctId: store.userId,
      storeId: store.id,
      reservationId,
      action: reservationAnalyticsActions.cancelReservation,
      properties: {
        status_before: reservation.status,
        status_after: "cancelled",
        ...actorProperties(actor),
      },
    });

    return {
      ok: true,
      number: reservation.number,
      from: cancellation.from,
      to: cancellation.to,
      warnings: [],
    };
  }

  /**
   * The assistant and MCP. A cancellation works like the dashboard's cancel
   * button, the one a store user has: it also cancels the insurance contract
   * and notifies the store. Its status menu never sends a cancellation.
   */
  async function changeAsAgent({
    storeId,
    reservationId,
    to,
    actor,
    actorUserId,
    rejectionReason,
  }: AgentStatusChangeInput): Promise<AgentStatusChangeResult> {
    const store = await db.query.stores.findFirst({
      where: eq(stores.id, storeId),
      columns: statusChangeStoreColumns,
    });
    if (!store) return { ok: false, error: "not_found" };

    const outcome =
      to === "cancelled"
        ? await cancel({ store, reservationId, actor, actorUserId })
        : await updateStatus({
            store,
            reservationId,
            status: to,
            rejectionReason,
            actor,
            actorUserId,
          });

    if (outcome.ok || outcome.error === "not_found") return outcome;
    if (outcome.error === "unavailable") {
      return {
        ok: false,
        error: "refused",
        message: agentUnavailableMessages[outcome.message] ?? outcome.message,
      };
    }

    const { refusal } = outcome;
    if (refusal.reason === "not_found") return { ok: false, error: "not_found" };
    if (refusal.reason === "unexpected_status") {
      return {
        ok: false,
        error: "refused",
        message: `Not changed: the reservation became ${refusal.from} meanwhile. Read it again first.`,
      };
    }
    return {
      ok: false,
      error: "refused",
      message: invalidReservationTransitionMessage(refusal.from, to),
    };
  }

  return { updateStatus, cancel, changeAsAgent };
}

const reservationStatusService = createReservationStatusService();

export const updateStoreReservationStatus = reservationStatusService.updateStatus;
export const cancelStoreReservation = reservationStatusService.cancel;
export const changeReservationStatusAsAgent = reservationStatusService.changeAsAgent;
