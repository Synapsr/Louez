import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";

import { isBillingSyncEnabled } from "@louez/db";

import { isCurrentUserPlatformAdmin } from "@/lib/platform-admin";
import { getCurrentStore } from "@/lib/store-context";

import { getBillingAccess } from "./billing-access";

/**
 * For a billing page (louez-billing docs/api, README §10, §12): 404 outside service
 * mode, and the settings for whoever `getBillingAccess` turns away. The active store and
 * the viewer's access to it.
 */
export async function requireBillingPages() {
  await connection();
  if (!isBillingSyncEnabled()) notFound();
  const store = await getCurrentStore();
  if (!store) redirect("/onboarding");
  const access = await getBillingAccess(store, await isCurrentUserPlatformAdmin());
  if (!access) redirect("/dashboard/settings");
  return { store, access };
}
