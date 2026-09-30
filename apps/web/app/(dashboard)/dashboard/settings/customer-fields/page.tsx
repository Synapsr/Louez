import { redirect } from "next/navigation";

import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

import { db, users } from "@louez/db";

import { SettingsPageShell } from "@/components/dashboard/settings-page-shell";
import { auth } from "@/lib/auth";
import { getCurrentStore } from "@/lib/store-context";

import { CustomerFieldsManager } from "./customer-fields-manager";

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
    <SettingsPageShell title={t("title")} description={t("description")} width="wide">
      <CustomerFieldsManager
        country={store.settings?.country ?? null}
        productCategory={profile?.productCategory ?? null}
        profileSettings={store.settings?.customerProfile ?? {}}
      />
    </SettingsPageShell>
  );
}
