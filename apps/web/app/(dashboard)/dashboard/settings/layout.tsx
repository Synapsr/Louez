import { getTranslations } from "next-intl/server";

import { SettingsNav } from "@/components/dashboard/settings-nav";
import { isElectronicInvoicingEnabled } from "@/lib/invoicing/feature";
import { isCurrentUserPlatformAdmin } from "@/lib/platform-admin";
import { getCurrentStore } from "@/lib/store-context";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("dashboard.settings");
  const isPlatformAdmin = await isCurrentUserPlatformAdmin();
  const store = await getCurrentStore();
  const electronicInvoicingEnabled = store ? await isElectronicInvoicingEnabled(store.id) : false;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{t("title")}</h1>
      </div>

      <div className="flex flex-col gap-4 sm:gap-6 xl:grid xl:grid-cols-[260px_1fr] xl:gap-10">
        <SettingsNav
          isPlatformAdmin={isPlatformAdmin}
          electronicInvoicingEnabled={electronicInvoicingEnabled}
        />
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
