import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { SettingsPageShell } from "@/components/dashboard/settings-page-shell";
import { getCurrentStore } from "@/lib/store-context";

import { CompanySettingsForm } from "./company-settings-form";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export default async function CompanySettingsPage() {
  const store = await getCurrentStore();

  if (!store) {
    redirect("/onboarding");
  }

  const t = await getTranslations("dashboard.settings");

  return (
    <SettingsPageShell title={t("company")} description={t("companySettings.description")}>
      <CompanySettingsForm settings={store.settings} />
    </SettingsPageShell>
  );
}
