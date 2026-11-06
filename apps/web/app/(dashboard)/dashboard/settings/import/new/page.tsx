import { redirect } from "next/navigation";

import { getTranslations } from "next-intl/server";

import { hasPermission } from "@louez/utils";

import { SettingsPageShell } from "@/components/dashboard/settings-page-shell";
import { getCurrentStore } from "@/lib/store-context";

import { ImportWizard } from "./import-wizard";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export default async function NewImportPage() {
  const store = await getCurrentStore();
  if (!store) redirect("/onboarding");
  if (!hasPermission(store.role, "manage_settings")) redirect("/dashboard/settings");

  const t = await getTranslations("dashboard.settings.import");

  return (
    <SettingsPageShell
      title={t("newImport")}
      description={t("description")}
      width="wide"
      back={{ href: "/dashboard/settings/import", label: t("title") }}
    >
      <ImportWizard />
    </SettingsPageShell>
  );
}
