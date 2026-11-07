import { revalidatePath } from "next/cache";
import { after } from "next/server";

import type { ApiEvent } from "@louez/api";

import { notifyProductCreated, notifyProductUpdated } from "@/lib/discord/platform-notifications";
import { captureProductServerEvent } from "@/lib/product-analytics/analytics";
import { productAnalyticsEvents } from "@/lib/product-analytics/analytics-events";

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
    default:
      return null;
  }
}
