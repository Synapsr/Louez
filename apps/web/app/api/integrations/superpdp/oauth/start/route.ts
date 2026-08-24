import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { redirect } from "next/navigation";

import { db, storeIntegrations, storeLegalProfiles, storeSuperPdpIntegrations } from "@louez/db";

import { env } from "@/env";
import { auth } from "@/lib/auth";
import { mapSuperPdpConnectionState } from "@/lib/integrations/providers/superpdp/connection";
import { createSuperPdpOAuthState } from "@/lib/integrations/providers/superpdp/oauth-state";
import {
  SUPERPDP_CATEGORY,
  SUPERPDP_PROVIDER_KEY,
  buildSuperPdpAuthorizationUrl,
} from "@/lib/integrations/providers/superpdp/superpdp-client";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { getCurrentStore } from "@/lib/store-context";
import { createLoginUrl, sanitizeCallbackUrl } from "@/lib/utils/util.url";

const DEFAULT_RETURN_TO = "/dashboard/settings/invoicing";

function hasCompletedLegalProfile(profile: {
  legalName: string;
  legalForm: string;
  companyNumber: string;
  companyNumberScheme: "fr_siren" | "be_bce" | null;
  registeredAddress: string;
  registeredPostalCode: string;
  registeredCity: string;
  country: string;
}): profile is typeof profile & {
  companyNumberScheme: "fr_siren" | "be_bce";
} {
  const requiredText = [
    profile.legalName,
    profile.legalForm,
    profile.companyNumber,
    profile.registeredAddress,
    profile.registeredPostalCode,
    profile.registeredCity,
    profile.country,
  ];

  return Boolean(
    profile.companyNumberScheme && requiredText.every((value) => value.trim().length > 0),
  );
}

export async function GET(request: Request) {
  const session = await auth();
  const store = await getCurrentStore();
  const returnTo = sanitizeCallbackUrl(
    new URL(request.url).searchParams.get("returnTo") ?? DEFAULT_RETURN_TO,
  );

  if (!session?.user?.id || !store) {
    redirect(createLoginUrl(returnTo));
  }

  const canManageIntegration =
    store.role === "owner" ||
    store.role === "platform_admin" ||
    isPlatformAdmin(session.user.email);
  if (!canManageIntegration) {
    redirect(`${DEFAULT_RETURN_TO}?error=permissionDenied`);
  }

  const [profile] = await db
    .select({
      legalName: storeLegalProfiles.legalName,
      legalForm: storeLegalProfiles.legalForm,
      companyNumber: storeLegalProfiles.companyNumber,
      companyNumberScheme: storeLegalProfiles.companyNumberScheme,
      registeredAddress: storeLegalProfiles.registeredAddress,
      registeredPostalCode: storeLegalProfiles.registeredPostalCode,
      registeredCity: storeLegalProfiles.registeredCity,
      country: storeLegalProfiles.country,
    })
    .from(storeLegalProfiles)
    .where(eq(storeLegalProfiles.storeId, store.id))
    .limit(1);
  if (!profile || !hasCompletedLegalProfile(profile)) {
    redirect(`${DEFAULT_RETURN_TO}?error=legalProfileIncomplete`);
  }

  let authorizationUrl: string;
  try {
    const state = createSuperPdpOAuthState({
      storeId: store.id,
      userId: session.user.id,
      returnTo,
    });
    authorizationUrl = buildSuperPdpAuthorizationUrl({
      state,
      companyNumber: profile.companyNumber,
      companyNumberScheme: profile.companyNumberScheme,
      loginHint: session.user.email,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "Super PDP OAuth is not configured" ||
        error.message.includes("INTEGRATION_ENCRYPTION_KEY"))
    ) {
      redirect(`${DEFAULT_RETURN_TO}?error=superPdpNotConfigured`);
    }
    throw error;
  }

  await db.transaction(async (tx) => {
    await tx
      .insert(storeIntegrations)
      .values({
        id: nanoid(),
        storeId: store.id,
        providerKey: SUPERPDP_PROVIDER_KEY,
        category: SUPERPDP_CATEGORY,
        enabled: true,
        connectedByUserId: session.user.id,
        providerAccountEmail: session.user.email,
        status: mapSuperPdpConnectionState("pending"),
        updatedAt: new Date(),
      })
      .onDuplicateKeyUpdate({
        set: {
          enabled: true,
          connectedByUserId: session.user.id,
          providerAccountEmail: session.user.email,
          status: mapSuperPdpConnectionState("pending"),
          lastErrorCode: null,
          lastErrorMessage: null,
          updatedAt: new Date(),
        },
      });
    const [integration] = await tx
      .select({ id: storeIntegrations.id })
      .from(storeIntegrations)
      .where(
        and(
          eq(storeIntegrations.storeId, store.id),
          eq(storeIntegrations.providerKey, SUPERPDP_PROVIDER_KEY),
        ),
      )
      .limit(1);
    if (!integration) throw new Error("Super PDP integration was not created");

    await tx
      .insert(storeSuperPdpIntegrations)
      .values({
        id: nanoid(),
        integrationId: integration.id,
        environment: env.SUPERPDP_ENVIRONMENT,
        sendAndReceive: true,
        updatedAt: new Date(),
      })
      .onDuplicateKeyUpdate({
        set: {
          environment: env.SUPERPDP_ENVIRONMENT,
          sendAndReceive: true,
          updatedAt: new Date(),
        },
      });
  });

  redirect(authorizationUrl);
}
