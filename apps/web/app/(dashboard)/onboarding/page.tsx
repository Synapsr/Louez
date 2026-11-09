import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { eq } from "drizzle-orm";

import { db, users } from "@louez/db";
import { readStoreCreationHandoff } from "@louez/api/services/handoffs";

import { auth } from "@/lib/auth";
import { getMcpEndpoint } from "@/lib/agent-connections/mcp-endpoint";
import { isCurrentUserPlatformAdmin } from "@/lib/platform-admin";
import { getCurrentStore, getUserStores } from "@/lib/store-context";
import { getCountryByCode } from "@louez/utils/countries";
import { ONBOARDING_FALLBACK_COUNTRY } from "@/lib/utils/util.browser-country-detection";
import { detectCountryFromRequestHeaders } from "@/lib/utils/util.request-country-detection";

import { StoreOnboardingClientPage } from "./store-onboarding-client-page";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export default async function OnboardingStorePage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; handoff?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const { new: newStore, handoff } = await searchParams;
  // A store an agent proposed (ChatGPT's stores_create), the user continued
  // from its link: the step starts from it and completes that handoff.
  const handed = handoff ? await readStoreCreationHandoff(handoff, session.user.id) : null;
  const handedOver = handed?.payload.store ? { id: handed.id, store: handed.payload.store } : null;
  const isCreatingNewStore = newStore === "true" || handedOver !== null;

  const [user, currentStore, isPlatformAdmin, requestHeaders] = await Promise.all([
    db.query.users.findFirst({
      where: eq(users.id, session.user.id),
    }),
    getCurrentStore(),
    isCurrentUserPlatformAdmin(),
    headers(),
  ]);

  // A completed active store is not an onboarding draft. This also closes the
  // profile -> /onboarding loop for legacy users whose store was already ready.
  if (!isCreatingNewStore && currentStore?.onboardingCompleted) {
    redirect("/dashboard");
  }

  // Platform admins act on behalf of stores: their own user profile must never
  // become a prerequisite for inspecting or completing somebody else's draft.
  // A store handed over by an agent needs no profile either: the step would
  // lose the handoff, and the profile never gates the dashboard.
  if (!user?.profileCompletedAt && !isPlatformAdmin && !handedOver) {
    redirect("/onboarding/profile");
  }

  const stores = isPlatformAdmin ? await getUserStores() : [];
  const currentStoreId = currentStore?.id ?? stores[0]?.id ?? null;
  const savedCountry = isCreatingNewStore
    ? null
    : (getCountryByCode(currentStore?.settings?.country ?? "")?.code ?? null);
  const requestCountry = detectCountryFromRequestHeaders(requestHeaders)?.country ?? null;
  const initialCountry =
    handedOver?.store.country ?? savedCountry ?? requestCountry ?? ONBOARDING_FALLBACK_COUNTRY;

  return (
    <StoreOnboardingClientPage
      stores={stores}
      currentStoreId={isPlatformAdmin ? currentStoreId : null}
      editingStoreId={isCreatingNewStore ? null : (currentStore?.id ?? null)}
      initialCountry={initialCountry}
      shouldDetectBrowserCountry={!handedOver && !savedCountry && !requestCountry}
      handedOver={handedOver}
      accountEmail={session.user.email}
      mcpEndpoint={getMcpEndpoint()}
    />
  );
}
