import { redirect } from "next/navigation";

import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

import { db, users } from "@louez/db";

import { SettingsPageShell } from "@/components/dashboard/settings-page-shell";
import { auth } from "@/lib/auth";
import { getCurrentStore } from "@/lib/store-context";

import { CustomerFieldsBuilder } from "./customer-fields-builder";
import { CustomerFieldsBuilderProvider } from "./customer-fields-builder-context";
import { CustomerFieldsHeaderActions } from "./customer-fields-header-actions";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export default async function CustomerFieldsSettingsPage() {
  const [store, session] = await Promise.all([getCurrentStore(), auth()]);
  if (!store) redirect("/onboarding");

  const t = await getTranslations("dashboard.settings.customerFields");

  // The activity declared at onboarding decides which templates are put forward.
  const profile = session?.user?.id
    ? await db.query.users.findFirst({
        columns: { productCategory: true },
        where: eq(users.id, session.user.id),
      })
    : null;

  return (
    // The header buttons, the two tabs and the Sheets share one state: which tab, which field
    // is open, which dialog is open.
    <CustomerFieldsBuilderProvider
      settings={{
        country: store.settings?.country ?? null,
        productCategory: profile?.productCategory ?? null,
        storeTheme: store.theme
          ? { mode: store.theme.mode, primaryColor: store.theme.primaryColor }
          : null,
      }}
    >
      <SettingsPageShell
        title={t("title")}
        description={t("builder.pageDescription")}
        actions={<CustomerFieldsHeaderActions />}
      >
        <CustomerFieldsBuilder />
      </SettingsPageShell>
    </CustomerFieldsBuilderProvider>
  );
}
