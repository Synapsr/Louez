import { revalidatePath } from "next/cache";
import { after } from "next/server";

import type { ApiEvent } from "@louez/api";

import { logReservationGateRefusal } from "@/lib/billing/reservation-gate";
import { notifyProductCreated, notifyProductUpdated } from "@/lib/discord/platform-notifications";
import {
  captureProductServerEvent,
  captureReservationActionSucceeded,
} from "@/lib/product-analytics/analytics";
import {
  productAnalyticsEvents,
  reservationAnalyticsActions,
} from "@/lib/product-analytics/analytics-events";
import { runStatusChangeEffects } from "@/lib/reservations/status-change-effects";

/**
 * The app's effects of a write the agent-ready API committed
 * (`ApiPorts.afterCommit`): the dashboard pages it changes are revalidated
 * now, the platform notification and the analytics event run once the
 * answer is sent. Never throws.
 */
export function runAfterCommit(event: ApiEvent): void {
  try {
    for (const path of pathsToRevalidate(event)) revalidatePath(path);
  } catch (error) {
    console.error("Revalidation after an API write failed:", error);
  }

  const effect = backgroundEffect(event);
  if (!effect) return;
  const run = () => effect().catch((error) => console.error("An API write effect failed:", error));
  try {
    after(run);
  } catch {
    // Outside a request (a script): run it now, without waiting.
    void run();
  }
}

function pathsToRevalidate(event: ApiEvent): string[] {
  switch (event.type) {
    case "product.created":
    case "products.changed":
      return ["/dashboard/products"];
    case "product.updated":
    case "product.units.changed":
      return [
        "/dashboard/products",
        `/dashboard/products/${event.productId}`,
        `/dashboard/products/${event.productId}/edit`,
      ];
    case "product.seasonalPricing.changed":
      return [
        `/dashboard/products/${event.productId}`,
        `/dashboard/products/${event.productId}/edit`,
      ];
    case "reservation.statusChanged":
      return ["/dashboard/reservations", `/dashboard/reservations/${event.reservationId}`];
    case "reservation.notesUpdated":
      return [`/dashboard/reservations/${event.reservationId}`];
    case "reservation.gateRefused":
      return [];
  }
}

function backgroundEffect(event: ApiEvent): (() => Promise<void>) | null {
  const store = "store" in event ? event.store : null;
  if (!store) return null;
  const storeInfo = { id: store.id, name: store.name, slug: store.slug };

  switch (event.type) {
    case "product.created":
      return async () => {
        await Promise.all([
          notifyProductCreated(storeInfo, event.productName),
          captureProductServerEvent({
            distinctId: store.ownerUserId,
            event: productAnalyticsEvents.productCreated,
            properties: {
              feature: "product_catalog",
              surface: "dashboard",
              store_id: store.id,
              product_id: event.productId,
              // The dashboard, or the agent or API client that created it.
              created_from: event.transport === "rpc" ? "dashboard" : event.transport,
              ...event.facts,
            },
          }),
        ]);
      };
    case "product.updated":
      return () => notifyProductUpdated(storeInfo, event.productName);
    case "reservation.statusChanged":
      return () => runStatusChangeEffects(event);
    case "reservation.notesUpdated":
      // The dashboard records its own success event in the browser.
      if (event.transport === "rpc") return null;
      return () =>
        captureReservationActionSucceeded({
          distinctId: store.ownerUserId,
          storeId: store.id,
          reservationId: event.reservationId,
          action: reservationAnalyticsActions.updateNotes,
          properties: {
            has_notes: event.hasNotes,
            actor: event.transport,
            surface: event.transport,
          },
        });
    case "reservation.gateRefused":
      return async () =>
        logReservationGateRefusal(
          { storeId: store.id, reason: event.reason },
          event.transport === "rpc" ? "dashboard" : event.transport === "mcp" ? "mcp" : "api",
        );
    default:
      return null;
  }
}
