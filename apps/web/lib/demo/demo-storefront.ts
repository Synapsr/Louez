import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db, products } from "@louez/db";

import { env } from "@/env";

import { scenarioPeriod } from "./scenario-period";
import { DEMO_VERTICALS, isDemoVerticalKey, type DemoScenario } from "./verticals";

export interface DemoStorefrontScenario {
  key: DemoScenario["key"];
  title: string;
  pitch: string;
  steps: string[];
  quantity: number;
  /** The product page, store-relative (`/product/<slug>`). */
  productPath: string;
  /** The product's first photo. */
  image: string | null;
  /** The rental period the guide puts in the cart, ISO. */
  startDate: string;
  endDate: string;
}

export interface DemoStorefrontGuideData {
  scenarios: DemoStorefrontScenario[];
  /**
   * « Voir côté loueur »: the visitor's last booking in the dashboard, on the
   * app host where the demo account is signed in (app/demo/rental-side).
   */
  rentalSideUrl: string;
}

/**
 * What the storefront of a demo store offers its visitor: the trade's two
 * bookings to try as a customer, each opening its product with the dates
 * chosen, and the way to the same booking on the rental side. Null for any
 * other store, or when a scenario's product is not in the store.
 */
export async function getDemoStorefrontGuide(store: {
  id: string;
  demoVertical: string | null;
}): Promise<DemoStorefrontGuideData | null> {
  if (!isDemoVerticalKey(store.demoVertical)) return null;
  const vertical = DEMO_VERTICALS[store.demoVertical];
  const nameByKey = new Map(vertical.products.map((product) => [product.key, product.name]));
  const names = vertical.scenarios.map((scenario) => nameByKey.get(scenario.productKey) ?? "");

  const rows = await db
    .select({ name: products.name, slug: products.slug, id: products.id, images: products.images })
    .from(products)
    .where(and(eq(products.storeId, store.id), inArray(products.name, names)));
  const byName = new Map(rows.map((row) => [row.name, row]));

  const now = new Date();
  const scenarios: DemoStorefrontScenario[] = [];
  for (const scenario of vertical.scenarios) {
    const product = byName.get(nameByKey.get(scenario.productKey) ?? "");
    if (!product) return null;
    const { start, end } = scenarioPeriod(vertical, scenario, now);
    scenarios.push({
      key: scenario.key,
      title: scenario.title,
      pitch: scenario.pitch,
      steps: scenario.steps,
      quantity: scenario.quantity,
      productPath: `/product/${product.slug ?? product.id}`,
      image: product.images?.[0] ?? null,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    });
  }

  return {
    scenarios,
    rentalSideUrl: `${env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "")}/demo/rental-side`,
  };
}
