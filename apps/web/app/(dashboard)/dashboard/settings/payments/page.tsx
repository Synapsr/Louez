import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { SettingsPageShell } from "@/components/dashboard/settings-page-shell";
import { log } from "@/lib/evlog";
import { isStripeConfigured } from "@/lib/plans";
import {
  getConnectedAccountFinances,
  type ConnectedAccountFinances,
} from "@/lib/stripe/connected-account-finances";
import { getCurrentStore } from "@/lib/store-context";
import { PaymentsContent } from "./payments-content";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export default async function PaymentsSettingsPage() {
  const store = await getCurrentStore();

  if (!store) {
    redirect("/onboarding");
  }

  const t = await getTranslations("dashboard.settings");
  const reservationMode = store.settings?.reservationMode ?? "request";
  const stripeConfigured = isStripeConfigured();
  let finances: ConnectedAccountFinances | null = null;

  if (stripeConfigured && store.stripeAccountId && store.stripeChargesEnabled) {
    try {
      finances = await getConnectedAccountFinances(store.stripeAccountId);
    } catch (error) {
      log.error(
        "payments",
        `failed to retrieve connected account finances: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return (
    <SettingsPageShell title={t("payments.title")} description={t("payments.description")}>
      <PaymentsContent
        stripeAccountId={store.stripeAccountId}
        stripeChargesEnabled={store.stripeChargesEnabled ?? false}
        stripeOnboardingComplete={store.stripeOnboardingComplete ?? false}
        reservationMode={reservationMode}
        stripeConfigured={stripeConfigured}
        defaultCurrency={store.settings?.currency ?? "EUR"}
        finances={finances}
      />
    </SettingsPageShell>
  );
}
