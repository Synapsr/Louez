import { redirect } from "next/navigation";

import { getTranslations } from "next-intl/server";

import { hasPermission } from "@louez/utils";

import { serverApi } from "@/lib/api/server-api";
import { loadNeedsALook } from "@/lib/inbox/needs-a-look";
import { getCurrentStore } from "@/lib/store-context";

import { NeedsALookList } from "./needs-a-look-list";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/** What Louez could not settle on its own, read from the store's inbox (`NEEDS_A_LOOK_TYPES`). */
const NeedsALookPage = async () => {
  const store = await getCurrentStore();
  if (!store) redirect("/onboarding");

  const [t, needsALook] = await Promise.all([
    getTranslations("dashboard.needsALook"),
    loadNeedsALook((await serverApi()).inbox),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground mt-1">{t("description")}</p>
      </div>
      <NeedsALookList
        items={needsALook.items}
        incomplete={needsALook.incomplete}
        canAcknowledge={hasPermission(store.role, "write")}
      />
    </div>
  );
};

export default NeedsALookPage;
