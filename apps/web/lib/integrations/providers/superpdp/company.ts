import { eq } from "drizzle-orm";

import { db, storeLegalProfiles } from "@louez/db";

import { log } from "@/lib/evlog";

import { getSuperPdpIntegrationForStore } from "./connection";
import { withSuperPdpAccessToken } from "./credentials";
import { updateSuperPdpCompanyVatRegime } from "./superpdp-client";

/**
 * Push the store's VAT regime to Super PDP — their e-reporting declaration
 * calendar depends on it, and sends are refused while it is unset. Silently
 * skips stores without a connected integration or a chosen regime; never
 * throws (callers treat the sync as best-effort and the next attempt happens
 * on the following profile save).
 */
export async function syncSuperPdpVatRegime(storeId: string): Promise<void> {
  try {
    const [profile] = await db
      .select({
        vatRegime: storeLegalProfiles.vatRegime,
        hasVatOnDebits: storeLegalProfiles.hasVatOnDebits,
      })
      .from(storeLegalProfiles)
      .where(eq(storeLegalProfiles.storeId, storeId))
      .limit(1);
    if (!profile?.vatRegime) return;

    const integration = await getSuperPdpIntegrationForStore(storeId);
    if (!integration) return;

    const vatRegime = profile.vatRegime;
    await withSuperPdpAccessToken(integration.integrationId, (accessToken) =>
      updateSuperPdpCompanyVatRegime({
        accessToken,
        vatRegime,
        hasVatOnDebits: profile.hasVatOnDebits,
      }),
    );
  } catch (error) {
    log.error(
      "superpdp",
      `VAT regime sync failed for store ${storeId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
