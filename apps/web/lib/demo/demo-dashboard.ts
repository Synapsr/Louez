import "server-only";

import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";

import { db, payments, reservations } from "@louez/db";

import { getStorefrontUrl } from "@/lib/storefront-url";

import {
  DEMO_VERTICALS,
  isDemoVerticalKey,
  type DemoGuideStep,
  type DemoVertical,
} from "./verticals";
import { parisDayAt } from "./paris-time";

export interface DemoGuideLink extends DemoGuideStep {
  href: string;
  /** Opens the storefront: another site, a new tab. */
  external: boolean;
}

export interface DemoDashboardContext {
  vertical: DemoVertical;
  storefrontUrl: string;
  signupUrl: string;
  /** Whole hours before the store is erased, null when it has no end. */
  hoursLeft: number | null;
  steps: DemoGuideLink[];
}

/**
 * What the dashboard of a demo store shows above its pages: the banner, and
 * the guide whose steps lead to the store's own bookings (a departure of the
 * day, a rental under way with its deposit). Null for any other store.
 */
export async function getDemoDashboardContext(store: {
  id: string;
  slug: string;
  demoVertical: string | null;
  demoExpiresAt: Date | null;
}): Promise<DemoDashboardContext | null> {
  if (!isDemoVerticalKey(store.demoVertical)) return null;
  const vertical = DEMO_VERTICALS[store.demoVertical];
  const now = new Date();
  const dayStart = parisDayAt(now, 0, 0);

  // The next departure to prepare: today's first, else the next one.
  const [departure] = await db
    .select({ id: reservations.id })
    .from(reservations)
    .where(
      and(
        eq(reservations.storeId, store.id),
        eq(reservations.status, "confirmed"),
        gte(reservations.startDate, dayStart),
      ),
    )
    .orderBy(asc(reservations.startDate))
    .limit(1);

  const [withDeposit] = await db
    .select({ id: reservations.id })
    .from(reservations)
    .innerJoin(payments, eq(payments.reservationId, reservations.id))
    .where(
      and(
        eq(reservations.storeId, store.id),
        eq(reservations.status, "ongoing"),
        inArray(payments.type, ["deposit"]),
      ),
    )
    .orderBy(desc(reservations.endDate))
    .limit(1);

  const storefrontUrl = getStorefrontUrl(store.slug);
  const hrefOf = (step: DemoGuideStep): { href: string; external: boolean } => {
    switch (step.key) {
      case "book":
        return { href: storefrontUrl, external: true };
      case "see_booking":
        return { href: "/dashboard/reservations", external: false };
      case "check_in":
        return {
          href: departure ? `/dashboard/reservations/${departure.id}` : "/dashboard/reservations",
          external: false,
        };
      case "deposit":
        return {
          href: withDeposit
            ? `/dashboard/reservations/${withDeposit.id}`
            : "/dashboard/reservations",
          external: false,
        };
      case "catalog":
        return { href: "/dashboard/products", external: false };
    }
  };

  return {
    vertical,
    storefrontUrl,
    signupUrl: "/demo/signup",
    hoursLeft: store.demoExpiresAt
      ? Math.max(0, Math.floor((store.demoExpiresAt.getTime() - now.getTime()) / 3_600_000))
      : null,
    steps: vertical.guide.map((step) => ({ ...step, ...hrefOf(step) })),
  };
}
