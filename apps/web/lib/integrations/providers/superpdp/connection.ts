import { and, eq, inArray, isNull } from "drizzle-orm";

import { db, storeIntegrations, storeSuperPdpIntegrations } from "@louez/db";

import { SUPERPDP_PROVIDER_KEY, SuperPdpApiError } from "./superpdp-client";

export type SuperPdpConnectionState =
  | "disconnected"
  | "pending"
  | "connected"
  | "revoked"
  | "error";

export function mapSuperPdpConnectionState(
  state: SuperPdpConnectionState,
): "disabled" | "syncing" | "active" | "needs_reconnect" | "error" {
  switch (state) {
    case "disconnected":
      return "disabled";
    case "pending":
      return "syncing";
    case "connected":
      return "active";
    case "revoked":
      return "needs_reconnect";
    case "error":
      return "error";
  }
}

export function getSuperPdpIntegrationForStore(
  storeId: string,
  statuses: Array<"active" | "error"> = ["active", "error"],
) {
  return db
    .select({
      integrationId: storeIntegrations.id,
      storeId: storeIntegrations.storeId,
      status: storeIntegrations.status,
      lastEventCursor: storeSuperPdpIntegrations.lastEventCursor,
    })
    .from(storeIntegrations)
    .innerJoin(
      storeSuperPdpIntegrations,
      eq(storeSuperPdpIntegrations.integrationId, storeIntegrations.id),
    )
    .where(
      and(
        eq(storeIntegrations.storeId, storeId),
        eq(storeIntegrations.providerKey, SUPERPDP_PROVIDER_KEY),
        eq(storeIntegrations.enabled, true),
        inArray(storeIntegrations.status, statuses),
      ),
    )
    .limit(1)
    .then(([integration]) => integration ?? null);
}

export function isSuperPdpReconnectError(error: unknown): boolean {
  if (error instanceof SuperPdpApiError && error.status === 401) return true;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("refresh token") || message.includes("credentials");
}

export async function markSuperPdpIntegrationFailure(
  integrationId: string,
  error: unknown,
): Promise<void> {
  const reconnectRequired = isSuperPdpReconnectError(error);
  const message = error instanceof Error ? error.message.slice(0, 2000) : "Unknown error";

  await db
    .update(storeIntegrations)
    .set({
      status: mapSuperPdpConnectionState(reconnectRequired ? "revoked" : "error"),
      lastErrorCode: reconnectRequired
        ? "superpdp_reconnect_required"
        : "superpdp_operation_failed",
      lastErrorMessage: message,
      lastHealthCheckAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(storeIntegrations.id, integrationId));
}

export async function markSuperPdpIntegrationHealthy(integrationId: string): Promise<void> {
  await db
    .update(storeIntegrations)
    .set({
      status: "active",
      lastErrorCode: null,
      lastErrorMessage: null,
      lastHealthCheckAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(storeIntegrations.id, integrationId));
}

export async function markSuperPdpIntegrationPendingValidation(
  integrationId: string,
): Promise<void> {
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(storeIntegrations)
      .set({
        status: mapSuperPdpConnectionState("pending"),
        lastErrorCode: null,
        lastErrorMessage: null,
        lastHealthCheckAt: now,
        updatedAt: now,
      })
      .where(eq(storeIntegrations.id, integrationId));
    await tx
      .update(storeSuperPdpIntegrations)
      .set({
        companyVerificationStatus: "pending",
        updatedAt: now,
      })
      .where(eq(storeSuperPdpIntegrations.integrationId, integrationId));
    await tx
      .update(storeSuperPdpIntegrations)
      .set({ connectedAt: now })
      .where(
        and(
          eq(storeSuperPdpIntegrations.integrationId, integrationId),
          isNull(storeSuperPdpIntegrations.connectedAt),
        ),
      );
  });
}
