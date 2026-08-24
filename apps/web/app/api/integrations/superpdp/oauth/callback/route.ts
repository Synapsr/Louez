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
  createSuperPdpDirectoryEntry,
  exchangeSuperPdpAuthorizationCode,
  getSuperPdpCompany,
  getSuperPdpOAuthSession,
  listSuperPdpDirectoryEntries,
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

// Identifier of the company's reception address in the annuaire, built from
// the number registered at the PDP (sandbox numbers carry suffixes like
// 315143296_001, so the number is kept verbatim).
function getDirectoryIdentifier(company: {
  number: string;
  number_scheme: "sandbox" | "fr_siren" | "be_numero_entreprise";
}): string {
  return `${company.number_scheme === "be_numero_entreprise" ? "0208" : "0225"}:${company.number}`;
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

    const [providerSession, providerCompany, directoryEntries] = await Promise.all([
      getSuperPdpOAuthSession(token.accessToken),
      getSuperPdpCompany(token.accessToken),
      listSuperPdpDirectoryEntries(token.accessToken),
    ]);
    const directoryIdentifier = getDirectoryIdentifier(providerCompany);
    // The signup tunnel may already have registered a reception address
    // (possibly under another identifier the merchant chose there) — reuse it
    // rather than piling up entries.
    const directoryEntry =
      directoryEntries.data.find((entry) => entry.identifier === directoryIdentifier) ??
      directoryEntries.data[0] ??
      (await createSuperPdpDirectoryEntry({
        accessToken: token.accessToken,
        identifier: directoryIdentifier,
      }));
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
          superPdpCompanyId: providerCompany.id,
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
            superPdpCompanyId: providerCompany.id,
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
