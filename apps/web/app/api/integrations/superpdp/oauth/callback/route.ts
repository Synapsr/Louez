import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  db,
  integrationCredentials,
  storeIntegrations,
  storeLegalProfiles,
  storeSuperPdpIntegrations,
} from "@louez/db";

import { env } from "@/env";
import { auth } from "@/lib/auth";
import { log } from "@/lib/evlog";
import { encryptIntegrationSecret } from "@/lib/integrations/credentials";
import { syncSuperPdpVatRegime } from "@/lib/integrations/providers/superpdp/company";
import { mapSuperPdpConnectionState } from "@/lib/integrations/providers/superpdp/connection";
import { parseSuperPdpOAuthState } from "@/lib/integrations/providers/superpdp/oauth-state";
import {
  SUPERPDP_CATEGORY,
  SUPERPDP_PROVIDER_KEY,
  exchangeSuperPdpAuthorizationCode,
  findOrCreateSuperPdpDirectoryEntry,
  getSuperPdpCompany,
  getSuperPdpOAuthSession,
  isSuperPdpPendingValidationError,
  type SuperPdpCompany,
} from "@/lib/integrations/providers/superpdp/superpdp-client";
import { verifyStoreAccess } from "@/lib/store-context";

const DEFAULT_RETURN_TO = "/dashboard/settings/invoicing";
const callbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

function appendResult(returnTo: string, key: string, value: string): string {
  const separator = returnTo.includes("?") ? "&" : "?";
  return `${returnTo}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsedQuery = callbackQuerySchema.safeParse({
    code: url.searchParams.get("code"),
    state: url.searchParams.get("state"),
  });
  const session = await auth();
  if (!parsedQuery.success || !session?.user?.id) {
    redirect(`${DEFAULT_RETURN_TO}?error=oauth`);
  }

  const state = parseSuperPdpOAuthState(parsedQuery.data.state);
  if (!state || state.userId !== session.user.id) {
    redirect(`${DEFAULT_RETURN_TO}?error=oauth`);
  }

  const role = await verifyStoreAccess(state.storeId);
  if (role !== "owner" && role !== "platform_admin") {
    redirect(`${DEFAULT_RETURN_TO}?error=permissionDenied`);
  }

  const [profile] = await db
    .select({
      companyNumber: storeLegalProfiles.companyNumber,
      companyNumberScheme: storeLegalProfiles.companyNumberScheme,
    })
    .from(storeLegalProfiles)
    .where(eq(storeLegalProfiles.storeId, state.storeId))
    .limit(1);
  if (!profile?.companyNumberScheme) {
    redirect(`${DEFAULT_RETURN_TO}?error=legalProfileIncomplete`);
  }

  try {
    const token = await exchangeSuperPdpAuthorizationCode(parsedQuery.data.code);
    const encryptedAccessToken = encryptIntegrationSecret(token.accessToken);
    const encryptedRefreshToken = encryptIntegrationSecret(token.refreshToken);
    const now = new Date();

    const integrationId = await db.transaction(async (tx) => {
      await tx
        .insert(storeIntegrations)
        .values({
          id: nanoid(),
          storeId: state.storeId,
          providerKey: SUPERPDP_PROVIDER_KEY,
          category: SUPERPDP_CATEGORY,
          enabled: true,
          connectedByUserId: session.user.id,
          providerAccountEmail: session.user.email,
          status: mapSuperPdpConnectionState("pending"),
          updatedAt: now,
        })
        .onDuplicateKeyUpdate({
          set: {
            enabled: true,
            connectedByUserId: session.user.id,
            providerAccountEmail: session.user.email,
            status: mapSuperPdpConnectionState("pending"),
            lastErrorCode: null,
            lastErrorMessage: null,
            updatedAt: now,
          },
        });
      const [integration] = await tx
        .select({ id: storeIntegrations.id })
        .from(storeIntegrations)
        .where(
          and(
            eq(storeIntegrations.storeId, state.storeId),
            eq(storeIntegrations.providerKey, SUPERPDP_PROVIDER_KEY),
          ),
        )
        .limit(1);
      if (!integration) {
        throw new Error("Super PDP integration was not found after enrollment");
      }

      await tx
        .insert(integrationCredentials)
        .values({
          id: nanoid(),
          integrationId: integration.id,
          credentialKind: "oauth",
          accessTokenEncrypted: encryptedAccessToken.encrypted,
          refreshTokenEncrypted: encryptedRefreshToken.encrypted,
          expiresAt: token.expiresAt,
          scopes: token.scopes,
          keyVersion: encryptedRefreshToken.keyVersion,
          updatedAt: now,
        })
        .onDuplicateKeyUpdate({
          set: {
            accessTokenEncrypted: encryptedAccessToken.encrypted,
            refreshTokenEncrypted: encryptedRefreshToken.encrypted,
            expiresAt: token.expiresAt,
            scopes: token.scopes,
            keyVersion: encryptedRefreshToken.keyVersion,
            updatedAt: now,
          },
        });

      return integration.id;
    });

    let providerCompany: SuperPdpCompany | null = null;
    try {
      const providerSession = await getSuperPdpOAuthSession(token.accessToken);
      const company = await getSuperPdpCompany(token.accessToken);
      providerCompany = company;
      const directoryEntry = await findOrCreateSuperPdpDirectoryEntry({
        accessToken: token.accessToken,
        company,
      });
      const integrationStatus = mapSuperPdpConnectionState(
        providerSession.company_verification_status === "verified"
          ? "connected"
          : providerSession.company_verification_status === "failed"
            ? "error"
            : "pending",
      );

      await db.transaction(async (tx) => {
        await tx
          .update(storeIntegrations)
          .set({
            status: integrationStatus,
            lastErrorCode: null,
            lastErrorMessage: null,
            updatedAt: now,
          })
          .where(eq(storeIntegrations.id, integrationId));
        await tx
          .insert(storeSuperPdpIntegrations)
          .values({
            id: nanoid(),
            integrationId,
            environment: env.SUPERPDP_ENVIRONMENT,
            superPdpCompanyId: company.id,
            companyVerificationStatus: providerSession.company_verification_status,
            directoryEntryId: directoryEntry.id,
            directoryEntryStatus: directoryEntry.status,
            sendAndReceive: true,
            connectedAt: now,
            updatedAt: now,
          })
          .onDuplicateKeyUpdate({
            set: {
              environment: env.SUPERPDP_ENVIRONMENT,
              superPdpCompanyId: company.id,
              companyVerificationStatus: providerSession.company_verification_status,
              directoryEntryId: directoryEntry.id,
              directoryEntryStatus: directoryEntry.status,
              sendAndReceive: true,
              connectedAt: now,
              updatedAt: now,
            },
          });
      });

      // Best-effort: the PDP needs the VAT regime before accepting sends.
      await syncSuperPdpVatRegime(state.storeId);
    } catch (error) {
      if (!isSuperPdpPendingValidationError(error)) throw error;

      await db.transaction(async (tx) => {
        await tx
          .update(storeIntegrations)
          .set({
            status: mapSuperPdpConnectionState("pending"),
            lastErrorCode: null,
            lastErrorMessage: null,
            updatedAt: now,
          })
          .where(eq(storeIntegrations.id, integrationId));
        await tx
          .insert(storeSuperPdpIntegrations)
          .values({
            id: nanoid(),
            integrationId,
            environment: env.SUPERPDP_ENVIRONMENT,
            superPdpCompanyId: providerCompany?.id ?? null,
            companyVerificationStatus: "pending",
            directoryEntryId: null,
            directoryEntryStatus: null,
            sendAndReceive: true,
            connectedAt: now,
            updatedAt: now,
          })
          .onDuplicateKeyUpdate({
            set: {
              environment: env.SUPERPDP_ENVIRONMENT,
              ...(providerCompany ? { superPdpCompanyId: providerCompany.id } : {}),
              companyVerificationStatus: "pending",
              directoryEntryId: null,
              directoryEntryStatus: null,
              sendAndReceive: true,
              connectedAt: now,
              updatedAt: now,
            },
          });
      });
      log.info({
        superpdp: {
          event: "account_validation_pending",
          integrationId,
          operation: "oauth_callback",
          storeId: state.storeId,
        },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    log.error("superpdp", `OAuth enrollment failed: ${message}`);
    await db
      .update(storeIntegrations)
      .set({
        status: mapSuperPdpConnectionState("error"),
        lastErrorCode: "superpdp_oauth_failed",
        lastErrorMessage: message,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(storeIntegrations.storeId, state.storeId),
          eq(storeIntegrations.providerKey, SUPERPDP_PROVIDER_KEY),
        ),
      );
    redirect(appendResult(state.returnTo, "error", "oauth"));
  }

  redirect(appendResult(state.returnTo, "connected", SUPERPDP_PROVIDER_KEY));
}
