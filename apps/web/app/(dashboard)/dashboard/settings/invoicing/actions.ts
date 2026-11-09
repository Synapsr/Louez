"use server";

import { revalidatePath } from "next/cache";

import { and, eq } from "drizzle-orm";

import {
  db,
  integrationCredentials,
  markStore,
  storeIntegrations,
  storeLegalProfiles,
  storeSuperPdpIntegrations,
} from "@louez/db";

import { SUPERPDP_PROVIDER_KEY } from "@/lib/integrations/providers/superpdp/superpdp-client";
import { getCurrentStore, hasPermission } from "@/lib/store-context";

export type StoreLegalProfileActionResult =
  | { status: "success" }
  | { status: "error"; error: string };

/**
 * Development-only escape hatch: wipe the legal profile and the Super PDP
 * enrollment of the active store so the setup wizard can be replayed.
 */
export async function resetInvoicingSetupForDev(): Promise<StoreLegalProfileActionResult> {
  if (process.env.NODE_ENV === "production") {
    return { status: "error", error: "errors.unauthorized" };
  }

  const store = await getCurrentStore();
  if (!store) {
    return { status: "error", error: "errors.unauthorized" };
  }

  if (!hasPermission(store.role, "manage_settings")) {
    return { status: "error", error: "errors.permissionDenied" };
  }

  const integration = await db.query.storeIntegrations.findFirst({
    where: and(
      eq(storeIntegrations.storeId, store.id),
      eq(storeIntegrations.providerKey, SUPERPDP_PROVIDER_KEY),
    ),
    columns: { id: true },
  });

  await db.transaction(async (tx) => {
    if (integration) {
      await tx
        .delete(integrationCredentials)
        .where(eq(integrationCredentials.integrationId, integration.id));
      await tx
        .delete(storeSuperPdpIntegrations)
        .where(eq(storeSuperPdpIntegrations.integrationId, integration.id));
      await tx.delete(storeIntegrations).where(eq(storeIntegrations.id, integration.id));
    }

    await tx.delete(storeLegalProfiles).where(eq(storeLegalProfiles.storeId, store.id));
    await markStore(tx, store.id);
  });

  revalidatePath("/dashboard/settings/invoicing");
  return { status: "success" };
}
