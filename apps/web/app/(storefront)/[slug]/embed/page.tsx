import { Suspense } from "react";
import { notFound } from "next/navigation";

import type { StoreSettings } from "@louez/types";

import { EmbedDatePicker } from "@/components/storefront/embed-date-picker";
import { getStorefrontUrl } from "@/lib/storefront-url";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";
import { getMinRentalMinutes } from "@/lib/utils/rental-duration";

// Reuse the embed settings during a short browsing session.
export const unstable_dynamicStaleTime = 300;

interface EmbedPageProps {
  params: Promise<{ slug: string }>;
}

const EmbedPage = async ({ params }: EmbedPageProps) => {
  const { slug } = await params;

  // Shares the request's store read with the layout; the layout already
  // answered 404 for an unknown store.
  const store = await getStoreBySlug(slug);

  if (!store) {
    notFound();
  }

  const settings: Partial<StoreSettings> = store.settings ?? {};

  return (
    <div className="p-2">
      <Suspense fallback={<div className="h-36 animate-pulse rounded-2xl bg-muted" />}>
        <EmbedDatePicker
          rentalUrl={getStorefrontUrl(slug, "/catalog")}
          pricingMode="day"
          businessHours={settings.businessHours}
          advanceNotice={settings.advanceNoticeMinutes ?? 0}
          minRentalMinutes={getMinRentalMinutes(settings)}
          timezone={settings.timezone}
          deliveryEnabled={settings.delivery?.enabled ?? false}
        />
      </Suspense>
    </div>
  );
};

export default EmbedPage;
