import Link from "next/link";
import { redirect } from "next/navigation";

import { Upload } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Button } from "@louez/ui";
import { hasPermission } from "@louez/utils";

import { SettingsPageShell } from "@/components/dashboard/settings-page-shell";
import { getCurrentStore } from "@/lib/store-context";

import { ImportHistory } from "./import-history";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export default async function ImportSettingsPage() {
  const store = await getCurrentStore();
  if (!store) redirect("/onboarding");
  // Same gate as exporting: the import rewrites the customer base.
  if (!hasPermission(store.role, "manage_settings")) redirect("/dashboard/settings");

  const t = await getTranslations("dashboard.settings.import");

  return (
    <SettingsPageShell
      title={t("title")}
      description={t("description")}
      actions={
        <Button render={<Link href="/dashboard/settings/import/new" />}>
          <Upload className="size-4" />
          {t("newImport")}
        </Button>
      }
    >
      <ImportHistory timezone={store.settings?.timezone ?? null} />
    </SettingsPageShell>
  );
}
