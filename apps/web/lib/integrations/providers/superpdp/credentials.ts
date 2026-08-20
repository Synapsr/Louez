import { eq, sql } from "drizzle-orm";

import { db, integrationCredentials } from "@louez/db";

import { decryptIntegrationSecret, encryptIntegrationSecret } from "@/lib/integrations/credentials";

import { refreshSuperPdpTokens } from "./superpdp-client";

const ACCESS_TOKEN_EXPIRY_SKEW_MS = 60_000;

export async function getSuperPdpAccessToken(
  integrationId: string,
  forceRefresh = false,
): Promise<string> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT integration_id FROM ${integrationCredentials} WHERE integration_id = ${integrationId} FOR UPDATE`,
    );
    const [credential] = await tx
      .select({
        accessTokenEncrypted: integrationCredentials.accessTokenEncrypted,
        refreshTokenEncrypted: integrationCredentials.refreshTokenEncrypted,
        expiresAt: integrationCredentials.expiresAt,
      })
      .from(integrationCredentials)
      .where(eq(integrationCredentials.integrationId, integrationId))
      .limit(1);

    if (!credential) {
      throw new Error("Super PDP credentials are missing");
    }

    if (
      !forceRefresh &&
      credential.accessTokenEncrypted &&
      credential.expiresAt &&
      credential.expiresAt.getTime() > Date.now() + ACCESS_TOKEN_EXPIRY_SKEW_MS
    ) {
      return decryptIntegrationSecret(credential.accessTokenEncrypted);
    }

    if (!credential.refreshTokenEncrypted) {
      throw new Error("Super PDP refresh token is missing");
    }

    const refreshed = await refreshSuperPdpTokens(
      decryptIntegrationSecret(credential.refreshTokenEncrypted),
    );
    const encryptedAccessToken = encryptIntegrationSecret(refreshed.accessToken);
    const encryptedRefreshToken = encryptIntegrationSecret(refreshed.refreshToken);

    await tx
      .update(integrationCredentials)
      .set({
        accessTokenEncrypted: encryptedAccessToken.encrypted,
        refreshTokenEncrypted: encryptedRefreshToken.encrypted,
        expiresAt: refreshed.expiresAt,
        scopes: refreshed.scopes,
        keyVersion: encryptedRefreshToken.keyVersion,
        updatedAt: new Date(),
      })
      .where(eq(integrationCredentials.integrationId, integrationId));

    return refreshed.accessToken;
  });
}

export async function withSuperPdpAccessToken<T>(
  integrationId: string,
  operation: (accessToken: string) => Promise<T>,
): Promise<T> {
  const accessToken = await getSuperPdpAccessToken(integrationId);
  try {
    return await operation(accessToken);
  } catch (error) {
    if (!(error instanceof Error) || !("status" in error) || error.status !== 401) {
      throw error;
    }

    const refreshedAccessToken = await getSuperPdpAccessToken(integrationId, true);
    return operation(refreshedAccessToken);
  }
}
