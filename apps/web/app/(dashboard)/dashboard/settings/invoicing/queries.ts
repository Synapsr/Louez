import { and, eq } from "drizzle-orm";

import { db, storeIntegrations } from "@louez/db";

import { SUPERPDP_PROVIDER_KEY } from "@/lib/integrations/providers/superpdp/superpdp-client";

/** Everything step 3 needs to describe the Super PDP enrollment of a store. */
export type SuperPdpEnrollment = {
  companyVerificationStatus: string | null;
  connectedAt: Date | null;
  directoryEntryStatus: "pending" | "created" | "error" | null;
  enabled: boolean;
  environment: "sandbox" | "production";
  lastErrorCode: string | null;
  status: "disabled" | "active" | "needs_reconnect" | "error" | "syncing";
};

/**
 * Read the Super PDP enrollment of a store.
 * Returns `null` while the merchant has never started the OAuth flow.
 * Secrets stay in `integration_credentials` and are never selected here.
 */
export const getSuperPdpEnrollment = async (
  storeId: string,
): Promise<SuperPdpEnrollment | null> => {
  const integration = await db.query.storeIntegrations.findFirst({
    where: and(
      eq(storeIntegrations.storeId, storeId),
      eq(storeIntegrations.providerKey, SUPERPDP_PROVIDER_KEY),
    ),
    columns: { enabled: true, lastErrorCode: true, status: true },
    with: {
      superPdpSettings: {
        columns: {
          companyVerificationStatus: true,
          connectedAt: true,
          directoryEntryStatus: true,
          environment: true,
        },
      },
    },
  });

  if (!integration) return null;

  return {
    companyVerificationStatus: integration.superPdpSettings?.companyVerificationStatus ?? null,
    connectedAt: integration.superPdpSettings?.connectedAt ?? null,
    directoryEntryStatus: integration.superPdpSettings?.directoryEntryStatus ?? null,
    enabled: integration.enabled,
    environment: integration.superPdpSettings?.environment ?? "sandbox",
    lastErrorCode: integration.lastErrorCode,
    status: integration.status,
  };
};
