import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { eq } from "drizzle-orm";

import { db, users } from "@louez/db";

import { auth } from "@/lib/auth";
import { isCurrentUserPlatformAdmin } from "@/lib/platform-admin";
import { getCurrentStore, getUserStores } from "@/lib/store-context";
import { getCountryByCode } from "@/lib/utils/countries";
import { ONBOARDING_FALLBACK_COUNTRY } from "@/lib/utils/util.browser-country-detection";
import { detectCountryFromRequestHeaders } from "@/lib/utils/util.request-country-detection";

import { StoreOnboardingClientPage } from "./store-onboarding-client-page";

export default async function OnboardingStorePage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const { new: newStore } = await searchParams;

  // First things first: meet the user before their store.
  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
  });
  if (!user?.profileCompletedAt) {
    redirect("/onboarding/profile");
  }

  const [currentStore, isPlatformAdmin, requestHeaders] = await Promise.all([
    getCurrentStore(),
    isCurrentUserPlatformAdmin(),
    headers(),
  ]);
  const stores = isPlatformAdmin ? await getUserStores() : [];
  const currentStoreId = currentStore?.id ?? stores[0]?.id ?? null;
  const isCreatingNewStore = newStore === "true";
  const savedCountry = isCreatingNewStore
    ? null
    : (getCountryByCode(currentStore?.settings?.country ?? "")?.code ?? null);
  const requestCountry = detectCountryFromRequestHeaders(requestHeaders)?.country ?? null;
  const initialCountry = savedCountry ?? requestCountry ?? ONBOARDING_FALLBACK_COUNTRY;

  return (
    <StoreOnboardingClientPage
      stores={stores}
      currentStoreId={isPlatformAdmin ? currentStoreId : null}
      editingStoreId={isCreatingNewStore ? null : (currentStore?.id ?? null)}
      initialCountry={initialCountry}
      shouldDetectBrowserCountry={!savedCountry && !requestCountry}
    />
  );
}
