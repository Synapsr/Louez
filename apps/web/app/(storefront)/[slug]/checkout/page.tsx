import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

import { db, promoCodes, storeLocations } from "@louez/db";

import { PageTracker } from "@/components/storefront/page-tracker";
import { StorefrontPageRefresh } from "@/components/storefront/ui/storefront-page-refresh";
import { StorefrontSection } from "@/components/storefront/ui/storefront-section";
import { isAdvisorReachableForStore } from "@/lib/ai/advisor/eligibility";
import { resolveTulipIntegrationForStore } from "@/lib/integrations/tulip/state";
import { getEffectiveReservationMode } from "@/lib/reservation-mode";
import { generateStoreMetadata } from "@/lib/seo";
import { getStoreBySlug, type StorefrontStore } from "@/lib/storefront/get-store-by-slug";
import { getMinRentalMinutes } from "@/lib/utils/rental-duration";

import { getCustomerSession } from "../account/actions";
import { CheckoutForm } from "./checkout-form";
import type { CheckoutLocationOption } from "./checkout.types";
import { toCheckoutInitialCustomer } from "./util.checkout-customer";

interface CheckoutPageProps {
  params: Promise<{ slug: string }>;
}

// Private page data is cached only in this browser for thirty seconds.
export const unstable_dynamicStaleTime = 30;

const toNumber = (value: string | null): number | null => (value ? parseFloat(value) : null);

const getCheckoutLocations = async (store: StorefrontStore): Promise<CheckoutLocationOption[]> => {
  if (!store.settings?.delivery?.multiLocationEnabled) {
    return [];
  }

  const additionalLocations = await db.query.storeLocations.findMany({
    where: and(eq(storeLocations.storeId, store.id), eq(storeLocations.isActive, true)),
    orderBy: (locations, { asc }) => [asc(locations.createdAt)],
  });

  return [
    {
      id: null,
      name: store.name,
      address: store.address,
      city: null,
      postalCode: null,
      country: store.settings?.country ?? "FR",
      latitude: toNumber(store.latitude),
      longitude: toNumber(store.longitude),
    },
    ...additionalLocations.map((location) => ({
      id: location.id,
      name: location.name,
      address: location.address,
      city: location.city,
      postalCode: location.postalCode,
      country: location.country,
      latitude: toNumber(location.latitude),
      longitude: toNumber(location.longitude),
    })),
  ];
};

/** True when at least one promo code can currently be applied. */
const hasActivePromoCodes = async (storeId: string): Promise<boolean> => {
  const now = new Date();
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(promoCodes)
    .where(
      and(
        eq(promoCodes.storeId, storeId),
        eq(promoCodes.isActive, true),
        or(isNull(promoCodes.startsAt), lt(promoCodes.startsAt, now)),
        or(isNull(promoCodes.expiresAt), gt(promoCodes.expiresAt, now)),
        or(
          isNull(promoCodes.maxUsageCount),
          sql`${promoCodes.currentUsageCount} < ${promoCodes.maxUsageCount}`,
        ),
      ),
    );
  return (row?.count ?? 0) > 0;
};

export async function generateMetadata({ params }: CheckoutPageProps): Promise<Metadata> {
  const { slug } = await params;
  const [store, t] = await Promise.all([
    getStoreBySlug(slug),
    getTranslations("storefront.checkout"),
  ]);

  if (!store) {
    return { title: t("title") };
  }

  return generateStoreMetadata(store, {
    title: `${t("title")} - ${store.name}`,
    noIndex: true,
  });
}

const CheckoutPage = async ({ params }: CheckoutPageProps) => {
  const { slug } = await params;
  const store = await getStoreBySlug(slug);

  if (!store) {
    notFound();
  }

  const [tulip, locations, activePromoCodes, advisorReachable, session] = await Promise.all([
    resolveTulipIntegrationForStore(store.id),
    getCheckoutLocations(store),
    hasActivePromoCodes(store.id),
    isAdvisorReachableForStore(store),
    getCustomerSession(slug),
  ]);

  const tulipMode = tulip.settings.enabled ? tulip.settings.publicMode : "no_public";

  return (
    <>
      <StorefrontPageRefresh renderedAt={Date.now()} />
      <PageTracker page="checkout" />
      <StorefrontSection spacing="tight">
        <CheckoutForm
          storeSlug={slug}
          storeId={store.id}
          pricingMode="day"
          reservationMode={getEffectiveReservationMode(store)}
          // Decision 12: Tulip needs the customer identity, so the address stays required.
          requireCustomerAddress
          taxSettings={store.settings?.tax}
          depositPercentage={store.settings?.onlinePaymentDepositPercentage ?? 100}
          deliverySettings={store.settings?.delivery}
          storeAddress={store.address}
          storeLatitude={toNumber(store.latitude)}
          storeLongitude={toNumber(store.longitude)}
          storeName={store.name}
          storeCountry={store.settings?.country ?? "FR"}
          locations={locations}
          tulipInsurance={{
            enabled: tulip.settings.enabled && tulipMode !== "no_public",
            mode: tulipMode,
          }}
          hasActivePromoCodes={activePromoCodes}
          advisorMode={advisorReachable ? (store.aiAdvisorSettings?.mode ?? null) : null}
          businessHours={store.settings?.businessHours}
          advanceNoticeMinutes={store.settings?.advanceNoticeMinutes ?? 0}
          minRentalMinutes={getMinRentalMinutes(store.settings)}
          timezone={store.settings?.timezone}
          initialCustomer={session ? toCheckoutInitialCustomer(session.customer) : null}
        />
      </StorefrontSection>
    </>
  );
};

export default CheckoutPage;
