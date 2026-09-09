import "server-only";

import { cache } from "react";

import { and, eq } from "drizzle-orm";

import { db, stores } from "@louez/db";

/**
 * Columns a storefront request may read. Operator-only settings (Discord
 * webhook, owner phone, ICS token, notification preferences, referral and
 * billing fields) stay out of the storefront tree: a page that needs one of
 * them for a server action reads it on its own.
 */
const storefrontStoreColumns = {
  id: true,
  slug: true,
  name: true,
  description: true,
  email: true,
  phone: true,
  address: true,
  latitude: true,
  longitude: true,
  logoUrl: true,
  darkLogoUrl: true,
  settings: true,
  theme: true,
  cgv: true,
  legalNotice: true,
  includeCgvInContract: true,
  stripeAccountId: true,
  stripeChargesEnabled: true,
  aiAdvisorSettings: true,
  reviewBoosterSettings: true,
  onboardingCompleted: true,
  createdAt: true,
  updatedAt: true,
} as const;

const readStoreBySlug = (slug: string) =>
  db.query.stores.findFirst({
    columns: storefrontStoreColumns,
    where: and(eq(stores.slug, slug), eq(stores.onboardingCompleted, true)),
  });

/** The store row as the storefront sees it. */
export type StorefrontStore = NonNullable<Awaited<ReturnType<typeof readStoreBySlug>>>;

/**
 * The onboarded store behind a storefront slug, or null.
 *
 * Wrapped in React `cache()`: the layout, `generateMetadata`
 * and the page of one request all share a single query.
 * Stores still in onboarding are invisible here — every storefront entry
 * point answers 404 for them, so the guard lives in one place.
 */
export const getStoreBySlug = cache(
  async (slug: string): Promise<StorefrontStore | null> => (await readStoreBySlug(slug)) ?? null,
);
