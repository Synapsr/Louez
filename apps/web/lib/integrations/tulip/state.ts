import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { db, storeIntegrations, storeTulipIntegrations } from '@louez/db';
import type { TulipPublicMode } from '@louez/types';

import {
  DEFAULT_TULIP_SETTINGS,
  type TulipResolvedSettings,
  getTulipApiKey,
} from '@/lib/integrations/tulip/settings';

export const TULIP_PROVIDER_KEY = 'tulip';

type TulipIntegrationStatus =
  | 'disabled'
  | 'active'
  | 'needs_reconnect'
  | 'error'
  | 'syncing';

type TulipIntegrationRecord = Awaited<
  ReturnType<typeof getTulipIntegrationForStore>
>;

export type ResolvedTulipIntegration = {
  integration: TulipIntegrationRecord | null;
  settings: TulipResolvedSettings;
  connected: boolean;
  storedPublicMode: TulipPublicMode;
  archivedRenterUid: string | null;
  connectionIssue: string | null;
};

function normalizeOptionalText(
  value: string | null | undefined,
): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

function normalizeDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function toIsoString(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export async function getTulipIntegrationForStore(storeId: string) {
  return db.query.storeIntegrations.findFirst({
    where: and(
      eq(storeIntegrations.storeId, storeId),
      eq(storeIntegrations.providerKey, TULIP_PROVIDER_KEY),
    ),
    with: {
      tulipSettings: true,
    },
  });
}

export async function resolveTulipIntegrationForStore(
  storeId: string,
): Promise<ResolvedTulipIntegration> {
  const integration = await getTulipIntegrationForStore(storeId);
  const tulipSettings = integration?.tulipSettings ?? null;

  if (!integration || !tulipSettings) {
    return {
      integration: integration ?? null,
      settings: {
        enabled: false,
        connectedAt: null,
        publicMode: 'no_public',
        renterUid: null,
      },
      connected: false,
      storedPublicMode: DEFAULT_TULIP_SETTINGS.publicMode,
      archivedRenterUid: null,
      connectionIssue: null,
    };
  }

  const renterUid = normalizeOptionalText(tulipSettings.renterUid);
  const storedPublicMode = tulipSettings.publicMode;
  const hasApiKey = Boolean(getTulipApiKey());
  const connected = Boolean(hasApiKey && renterUid);
  const enabled = connected && integration.enabled;

  return {
    integration,
    settings: {
      enabled,
      connectedAt: toIsoString(tulipSettings.connectedAt),
      publicMode: enabled ? storedPublicMode : 'no_public',
      renterUid,
    },
    connected,
    storedPublicMode,
    archivedRenterUid: normalizeOptionalText(tulipSettings.archivedRenterUid),
    connectionIssue:
      renterUid && !hasApiKey ? 'errors.tulipNotConfigured' : null,
  };
}

export async function saveTulipIntegrationForStore(params: {
  storeId: string;
  connectedByUserId?: string | null;
  enabled: boolean;
  status?: TulipIntegrationStatus;
  publicMode: TulipPublicMode;
  renterUid: string | null;
  archivedRenterUid?: string | null;
  connectedAt?: Date | string | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
}): Promise<{ integrationId: string }> {
  const existing = await getTulipIntegrationForStore(params.storeId);
  const integrationId = existing?.id ?? nanoid();
  const now = new Date();
  const status = params.status ?? (params.enabled ? 'active' : 'disabled');

  await db.transaction(async (tx) => {
    if (existing) {
      await tx
        .update(storeIntegrations)
        .set({
          enabled: params.enabled,
          connectedByUserId:
            params.connectedByUserId === undefined
              ? existing.connectedByUserId
              : params.connectedByUserId,
          status,
          lastErrorCode: params.lastErrorCode ?? null,
          lastErrorMessage: params.lastErrorMessage ?? null,
          updatedAt: now,
        })
        .where(eq(storeIntegrations.id, integrationId));
    } else {
      await tx.insert(storeIntegrations).values({
        id: integrationId,
        storeId: params.storeId,
        providerKey: TULIP_PROVIDER_KEY,
        category: 'insurance',
        enabled: params.enabled,
        connectedByUserId: params.connectedByUserId ?? null,
        status,
        lastErrorCode: params.lastErrorCode ?? null,
        lastErrorMessage: params.lastErrorMessage ?? null,
      });
    }

    const connectedAt = normalizeDate(params.connectedAt);

    await tx
      .insert(storeTulipIntegrations)
      .values({
        id: nanoid(),
        integrationId,
        renterUid: normalizeOptionalText(params.renterUid),
        archivedRenterUid: normalizeOptionalText(params.archivedRenterUid),
        publicMode: params.publicMode,
        connectedAt,
      })
      .onDuplicateKeyUpdate({
        set: {
          renterUid: normalizeOptionalText(params.renterUid),
          archivedRenterUid: normalizeOptionalText(params.archivedRenterUid),
          publicMode: params.publicMode,
          connectedAt,
          updatedAt: now,
        },
      });
  });

  return { integrationId };
}
