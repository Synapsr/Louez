import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { SettingsPageShell } from "@/components/dashboard/settings-page-shell";
import { getCurrentStore } from "@/lib/store-context";
import { getStorePlan } from "@/lib/plan-limits";
import { ReviewBoosterForm } from "./review-booster-form";
import { getLocaleFromCountry } from "@/lib/email/i18n";
import { getCachedPlaceDetails } from "@/lib/google-places/cache";
import { mergeCurrentPlaceDetails } from "@/lib/google-places/util.place-summary";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export default async function ReviewBoosterPage() {
  const store = await getCurrentStore();

  if (!store) {
    redirect("/onboarding");
  }

  const plan = await getStorePlan(store.id);
  const t = await getTranslations("dashboard.settings");
  const storeLocale = getLocaleFromCountry(store.settings?.country);
  const placeDetails = store.reviewBoosterSettings?.googlePlaceId
    ? await getCachedPlaceDetails(store.reviewBoosterSettings.googlePlaceId)
    : null;
  const storeWithCurrentPlaceDetails = {
    ...store,
    reviewBoosterSettings: mergeCurrentPlaceDetails(store.reviewBoosterSettings, placeDetails),
  };

  return (
    <SettingsPageShell
      title={t("reviewBooster.title")}
      description={t("reviewBooster.description")}
    >
      <ReviewBoosterForm
        store={storeWithCurrentPlaceDetails}
        hasFeatureAccess={plan.features.reviewBooster}
        planSlug={plan.slug}
        storeLocale={storeLocale}
      />
    </SettingsPageShell>
  );
}
