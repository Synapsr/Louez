import { revalidatePath } from "next/cache";
import { after } from "next/server";

import type { ApiEvent } from "@louez/api";
import type { SettingsSection } from "@louez/api/platform/ports";

import { logReservationGateRefusal } from "@/lib/billing/reservation-gate";
import { syncSuperPdpVatRegime } from "@/lib/integrations/providers/superpdp/company";
import {
  notifyProductCreated,
  notifyProductUpdated,
  notifyStoreSettingsUpdated,
} from "@/lib/discord/platform-notifications";
import { captureProductServerEvent } from "@/lib/product-analytics/analytics";
import { invalidateStoreViewport } from "@/lib/storefront/get-store-viewport";
import { productAnalyticsEvents } from "@/lib/product-analytics/analytics-events";

/**
 * The app's effects of a write the agent-ready API committed
 * (`ApiPorts.afterCommit`): the dashboard pages it changes are revalidated
 * now, the platform notification and the analytics event run once the
 * answer is sent. Never throws.
 */
export function runAfterCommit(event: ApiEvent): void {
  try {
    for (const slug of staleViewports(event)) invalidateStoreViewport(slug);
    for (const path of pathsToRevalidate(event)) {
      if (typeof path === "string") revalidatePath(path);
      else revalidatePath(path.path, path.type);
    }
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

/** The stores whose cached storefront theme colour no longer holds. */
function staleViewports(event: ApiEvent): string[] {
  if (event.type === "store.storefrontUpdated" && event.themeChanged) return [event.store.slug];
  // A page visited at the new address before the move cached the default theme.
  if (event.type === "store.slugChanged") return [event.previousSlug, event.store.slug];
  // A visit before the launch cached the default theme of a store it could not find.
  if (event.type === "store.launched") return [event.store.slug];
  return [];
}

/** The pages each settings section shows, as its former server action revalidated them. */
function settingsPaths(
  section: SettingsSection,
  storeSlug: string,
): Array<string | { path: string; type: "layout" }> {
  switch (section) {
    case "company":
      return ["/dashboard/settings", "/dashboard"];
    case "reservationRules":
      return ["/dashboard/settings/reservations", "/dashboard/settings", "/dashboard"];
    case "businessHours":
      // Every storefront page of the store: the layout covers the product pages too.
      return [
        "/dashboard/settings/hours",
        "/dashboard/settings",
        { path: `/${storeSlug}`, type: "layout" },
      ];
    case "delivery":
      return ["/dashboard/settings/delivery", "/dashboard/settings"];
    case "locations":
      return ["/dashboard/settings/delivery"];
    case "taxes":
      return ["/dashboard/settings/taxes", { path: "/dashboard/products", type: "layout" }];
    case "storeInfo":
      return ["/dashboard"];
    case "legal":
      return [];
  }
}

function pathsToRevalidate(event: ApiEvent): Array<string | { path: string; type: "layout" }> {
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
    case "store.settingsUpdated":
      return settingsPaths(event.section, event.store.slug);
    case "store.storefrontUpdated":
      return [];
    case "store.legalProfileUpdated":
      return ["/dashboard/settings/invoicing"];
    case "store.launched":
      // The dashboard's layout sent the store to the onboarding until now.
      return [
        { path: "/dashboard", type: "layout" },
        { path: `/${event.store.slug}`, type: "layout" },
      ];
    case "store.slugChanged":
      return [
        "/dashboard",
        "/dashboard/settings",
        "/online-store",
        `/${event.previousSlug}`,
        `/${event.store.slug}`,
      ];
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
    case "store.legalProfileUpdated":
      // The PDP's e-reporting calendar follows the VAT regime (best effort).
      return () => syncSuperPdpVatRegime(store.id);
    case "store.settingsUpdated":
      // The company and reservation rules pages notified the platform; the others never did.
      return event.section === "company" || event.section === "reservationRules"
        ? () => notifyStoreSettingsUpdated(storeInfo)
        : null;
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
