import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { SettingsPageShell } from "@/components/dashboard/settings-page-shell";
import { getCurrentStore } from "@/lib/store-context";

import { getStoreLegalProfile } from "./actions";
import { InvoicingSettingsForm } from "./invoicing-settings-form";
import { PdpTransmissionCard } from "./pdp-transmission-card";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export default async function InvoicingSettingsPage() {
  const store = await getCurrentStore();

  if (!store) {
    redirect("/onboarding");
  }

  const t = await getTranslations("dashboard.settings.invoicing");
  const { profile } = await getStoreLegalProfile();
  const defaultCountry = store.settings?.billingAddress?.country ?? "FR";

  return (
    <SettingsPageShell title={t("title")} description={t("description")}>
      <InvoicingSettingsForm profile={profile} defaultCountry={defaultCountry} />
      <PdpTransmissionCard />
    </SettingsPageShell>
  );
}
