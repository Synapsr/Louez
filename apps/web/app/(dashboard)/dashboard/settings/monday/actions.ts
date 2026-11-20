"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";

import { and, desc, eq, gte, lte, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import {
  type MondayColumnIdsConfig,
  type MondayStatusLabelsConfig,
  db,
  reservationMondayItems,
  reservations,
  storeMondayIntegrations,
} from "@louez/db";
import type { ReservationStatus } from "@louez/validations";

import { env } from "@/env";
import {
  DEFAULT_MONDAY_STATUS_LABELS,
  encryptMondayApiToken,
  resolveMondayStoreConfig,
} from "@/lib/integrations/monday/config";
import {
  type MondayBoardInspectionResult,
  inspectMondayBoardAndAccount,
} from "@/lib/integrations/monday/monday-client";
import { processMondaySyncQueue } from "@/lib/integrations/monday/sync";
import { currentUserHasPermission, getCurrentStore } from "@/lib/store-context";

const mondaySettingsFormSchema = z.object({
  enabled: z.boolean(),
  apiToken: z.string().optional(),
  clearApiToken: z.boolean().optional(),
  apiVersion: z.string().trim().min(4).max(20).default("2024-10"),
  boardId: z.string().trim().max(64).optional(),
  groupId: z.string().trim().max(64).optional(),
  subitemBoardId: z.string().trim().max(64).optional(),
  botUserId: z.string().trim().max(64).optional(),
  webhookSecret: z.string().trim().max(128).optional(),
  columnConfig: z.object({
    statusColumnId: z.string().trim().max(64).optional(),
    timelineColumnId: z.string().trim().max(64).optional(),
    startDateColumnId: z.string().trim().max(64).optional(),
    endDateColumnId: z.string().trim().max(64).optional(),
    customerColumnId: z.string().trim().max(64).optional(),
    emailColumnId: z.string().trim().max(64).optional(),
    phoneColumnId: z.string().trim().max(64).optional(),
    linkColumnId: z.string().trim().max(64).optional(),
    numberColumnId: z.string().trim().max(64).optional(),
    totalColumnId: z.string().trim().max(64).optional(),
    notesColumnId: z.string().trim().max(64).optional(),
    subitemQuantityColumnId: z.string().trim().max(64).optional(),
    subitemTypeColumnId: z.string().trim().max(64).optional(),
    subitemUnitsColumnId: z.string().trim().max(64).optional(),
    subitemStatusColumnId: z.string().trim().max(64).optional(),
  }),
  statusLabels: z.object({
    quote: z.string().trim().max(64).optional(),
    pending: z.string().trim().max(64).optional(),
    confirmed: z.string().trim().max(64).optional(),
    ongoing: z.string().trim().max(64).optional(),
    completed: z.string().trim().max(64).optional(),
    cancelled: z.string().trim().max(64).optional(),
    rejected: z.string().trim().max(64).optional(),
    declined: z.string().trim().max(64).optional(),
  }),
  webhookStatusMapJson: z.string().optional(),
});

export type MondaySettingsFormInput = z.infer<typeof mondaySettingsFormSchema>;

export type MondayDashboardState = {
  storeId: string;
  enabled: boolean;
  hasApiToken: boolean;
  apiTokenMasked: string | null;
  apiVersion: string;
  boardId: string;
  groupId: string;
  subitemBoardId: string;
  botUserId: string;
  webhookSecret: string;
  webhookUrl: string;
  columnConfig: {
    statusColumnId: string;
    timelineColumnId: string;
    startDateColumnId: string;
    endDateColumnId: string;
    customerColumnId: string;
    emailColumnId: string;
    phoneColumnId: string;
    linkColumnId: string;
    numberColumnId: string;
    totalColumnId: string;
    notesColumnId: string;
    subitemQuantityColumnId: string;
    subitemTypeColumnId: string;
    subitemUnitsColumnId: string;
    subitemStatusColumnId: string;
  };
  statusLabels: Record<ReservationStatus, string>;
  webhookStatusMapJson: string;
  lastSyncAt: string | null;
  lastWebhookAt: string | null;
  lastError: string | null;
  queueStats: {
    syncedCount: number;
    pendingCount: number;
    failedCount: number;
    recentItems: Array<{
      reservationId: string;
      reservationNumber: string;
      mondayItemId: string | null;
      syncStatus: "pending" | "processing" | "synced" | "failed";
      attemptCount: number;
      lastSyncedAt: string | null;
      lastError: string | null;
    }>;
  };
};

function maskToken(token: string | null): string | null {
  if (!token) return null;
  if (token.length <= 10) return "••••••••";
  return `${token.slice(0, 6)}••••••••${token.slice(-4)}`;
}

function toEmptyOrTrimmed(val: string | null | undefined): string {
  return val?.trim() ?? "";
}

function toNullOrTrimmed(val: string | null | undefined): string | null {
  const trimmed = val?.trim();
  return trimmed ? trimmed : null;
}

export async function getMondayDashboardState(): Promise<
  { status: "success"; data: MondayDashboardState } | { status: "error"; error: string }
> {
  const store = await getCurrentStore();
  if (!store) {
    return { status: "error", error: "errors.unauthorized" };
  }

  const canManage = await currentUserHasPermission("manage_settings");
  if (!canManage) {
    return { status: "error", error: "errors.unauthorized" };
  }

  const resolved = await resolveMondayStoreConfig(store.id);

  // Ensure a webhookSecret is always available to copy
  let webhookSecret = resolved.webhookSecret;
  if (!webhookSecret) {
    webhookSecret = randomBytes(24).toString("hex");
    const now = new Date();
    await db
      .insert(storeMondayIntegrations)
      .values({
        id: nanoid(),
        storeId: store.id,
        enabled: resolved.enabled,
        webhookSecret,
        createdAt: now,
        updatedAt: now,
      })
      .onDuplicateKeyUpdate({
        set: {
          webhookSecret,
          updatedAt: now,
        },
      });
  }

  const allQueueRows = await db
    .select({
      reservationId: reservationMondayItems.reservationId,
      mondayItemId: reservationMondayItems.mondayItemId,
      syncStatus: reservationMondayItems.syncStatus,
      attemptCount: reservationMondayItems.attemptCount,
      lastSyncedAt: reservationMondayItems.lastSyncedAt,
      lastError: reservationMondayItems.lastError,
      updatedAt: reservationMondayItems.updatedAt,
      reservationNumber: reservations.number,
    })
    .from(reservationMondayItems)
    .innerJoin(reservations, eq(reservations.id, reservationMondayItems.reservationId))
    .where(eq(reservationMondayItems.storeId, store.id))
    .orderBy(desc(reservationMondayItems.updatedAt))
    .limit(100);

  let syncedCount = 0;
  let pendingCount = 0;
  let failedCount = 0;
  for (const row of allQueueRows) {
    if (row.syncStatus === "synced") syncedCount++;
    else if (row.syncStatus === "failed") failedCount++;
    else pendingCount++;
  }

  const webhookUrl = `${env.NEXT_PUBLIC_APP_URL}/api/webhooks/monday?storeId=${encodeURIComponent(store.id)}&secret=${encodeURIComponent(webhookSecret)}`;

  return {
    status: "success",
    data: {
      storeId: store.id,
      enabled: resolved.enabled,
      hasApiToken: resolved.hasApiToken,
      apiTokenMasked: maskToken(resolved.apiToken),
      apiVersion: resolved.apiVersion,
      boardId: toEmptyOrTrimmed(resolved.boardId),
      groupId: toEmptyOrTrimmed(resolved.groupId),
      subitemBoardId: toEmptyOrTrimmed(resolved.subitemBoardId),
      botUserId: toEmptyOrTrimmed(resolved.botUserId),
      webhookSecret,
      webhookUrl,
      columnConfig: {
        statusColumnId: toEmptyOrTrimmed(resolved.columnConfig.statusColumnId),
        timelineColumnId: toEmptyOrTrimmed(resolved.columnConfig.timelineColumnId),
        startDateColumnId: toEmptyOrTrimmed(resolved.columnConfig.startDateColumnId),
        endDateColumnId: toEmptyOrTrimmed(resolved.columnConfig.endDateColumnId),
        customerColumnId: toEmptyOrTrimmed(resolved.columnConfig.customerColumnId),
        emailColumnId: toEmptyOrTrimmed(resolved.columnConfig.emailColumnId),
        phoneColumnId: toEmptyOrTrimmed(resolved.columnConfig.phoneColumnId),
        linkColumnId: toEmptyOrTrimmed(resolved.columnConfig.linkColumnId),
        numberColumnId: toEmptyOrTrimmed(resolved.columnConfig.numberColumnId),
        totalColumnId: toEmptyOrTrimmed(resolved.columnConfig.totalColumnId),
        notesColumnId: toEmptyOrTrimmed(resolved.columnConfig.notesColumnId),
        subitemQuantityColumnId: toEmptyOrTrimmed(
          resolved.columnConfig.subitemQuantityColumnId,
        ),
        subitemTypeColumnId: toEmptyOrTrimmed(resolved.columnConfig.subitemTypeColumnId),
        subitemUnitsColumnId: toEmptyOrTrimmed(resolved.columnConfig.subitemUnitsColumnId),
        subitemStatusColumnId: toEmptyOrTrimmed(resolved.columnConfig.subitemStatusColumnId),
      },
      statusLabels: resolved.statusLabels,
      webhookStatusMapJson:
        Object.keys(resolved.webhookStatusMap).length > 0
          ? JSON.stringify(resolved.webhookStatusMap, null, 2)
          : "",
      lastSyncAt: resolved.lastSyncAt ? resolved.lastSyncAt.toISOString() : null,
      lastWebhookAt: resolved.lastWebhookAt ? resolved.lastWebhookAt.toISOString() : null,
      lastError: resolved.lastError,
      queueStats: {
        syncedCount,
        pendingCount,
        failedCount,
        recentItems: allQueueRows.slice(0, 12).map((item) => ({
          reservationId: item.reservationId,
          reservationNumber: item.reservationNumber,
          mondayItemId: item.mondayItemId,
          syncStatus: item.syncStatus,
          attemptCount: item.attemptCount,
          lastSyncedAt: item.lastSyncedAt ? item.lastSyncedAt.toISOString() : null,
          lastError: item.lastError,
        })),
      },
    },
  };
}

export async function saveMondayIntegrationSettings(
  input: MondaySettingsFormInput,
): Promise<{ status: "success" } | { status: "error"; error: string }> {
  const store = await getCurrentStore();
  if (!store) {
    return { status: "error", error: "Brak autoryzacji sklepu." };
  }

  const canManage = await currentUserHasPermission("manage_settings");
  if (!canManage) {
    return { status: "error", error: "Tylko Administrator lub Właściciel może edytować integrację monday.com." };
  }

  const parsed = mondaySettingsFormSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: "Nieprawidłowe dane formularza konfiguracji." };
  }

  const data = parsed.data;

  let parsedWebhookMap: Record<string, string> | null = null;
  if (data.webhookStatusMapJson && data.webhookStatusMapJson.trim().length > 0) {
    try {
      const raw: unknown = JSON.parse(data.webhookStatusMapJson);
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return {
          status: "error",
          error: "Dodatkowe mapowanie statusów Webhook (JSON) musi być poprawnym obiektem JSON.",
        };
      }
      parsedWebhookMap = Object.fromEntries(
        Object.entries(raw).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
    } catch {
      return {
        status: "error",
        error: "Błąd składni JSON w polu dodatkowego mapowania statusów Webhook.",
      };
    }
  }

  const [existing] = await db
    .select()
    .from(storeMondayIntegrations)
    .where(eq(storeMondayIntegrations.storeId, store.id))
    .limit(1);

  let apiTokenEncrypted = existing?.apiTokenEncrypted ?? null;
  if (data.clearApiToken) {
    apiTokenEncrypted = null;
  } else if (data.apiToken && data.apiToken.trim().length > 0) {
    try {
      apiTokenEncrypted = encryptMondayApiToken(data.apiToken.trim());
    } catch (error) {
      return {
        status: "error",
        error: error instanceof Error ? error.message : "Nie udało się zaszyfrować tokena API.",
      };
    }
  }

  const columnConfig: MondayColumnIdsConfig = {
    statusColumnId: toNullOrTrimmed(data.columnConfig.statusColumnId),
    timelineColumnId: toNullOrTrimmed(data.columnConfig.timelineColumnId),
    startDateColumnId: toNullOrTrimmed(data.columnConfig.startDateColumnId),
    endDateColumnId: toNullOrTrimmed(data.columnConfig.endDateColumnId),
    customerColumnId: toNullOrTrimmed(data.columnConfig.customerColumnId),
    emailColumnId: toNullOrTrimmed(data.columnConfig.emailColumnId),
    phoneColumnId: toNullOrTrimmed(data.columnConfig.phoneColumnId),
    linkColumnId: toNullOrTrimmed(data.columnConfig.linkColumnId),
    numberColumnId: toNullOrTrimmed(data.columnConfig.numberColumnId),
    totalColumnId: toNullOrTrimmed(data.columnConfig.totalColumnId),
    notesColumnId: toNullOrTrimmed(data.columnConfig.notesColumnId),
    subitemQuantityColumnId: toNullOrTrimmed(data.columnConfig.subitemQuantityColumnId),
    subitemTypeColumnId: toNullOrTrimmed(data.columnConfig.subitemTypeColumnId),
    subitemUnitsColumnId: toNullOrTrimmed(data.columnConfig.subitemUnitsColumnId),
    subitemStatusColumnId: toNullOrTrimmed(data.columnConfig.subitemStatusColumnId),
  };

  const statusLabels: MondayStatusLabelsConfig = {
    quote: toNullOrTrimmed(data.statusLabels.quote) ?? DEFAULT_MONDAY_STATUS_LABELS.quote,
    pending: toNullOrTrimmed(data.statusLabels.pending) ?? DEFAULT_MONDAY_STATUS_LABELS.pending,
    confirmed:
      toNullOrTrimmed(data.statusLabels.confirmed) ?? DEFAULT_MONDAY_STATUS_LABELS.confirmed,
    ongoing: toNullOrTrimmed(data.statusLabels.ongoing) ?? DEFAULT_MONDAY_STATUS_LABELS.ongoing,
    completed:
      toNullOrTrimmed(data.statusLabels.completed) ?? DEFAULT_MONDAY_STATUS_LABELS.completed,
    cancelled:
      toNullOrTrimmed(data.statusLabels.cancelled) ?? DEFAULT_MONDAY_STATUS_LABELS.cancelled,
    rejected: toNullOrTrimmed(data.statusLabels.rejected) ?? DEFAULT_MONDAY_STATUS_LABELS.rejected,
    declined: toNullOrTrimmed(data.statusLabels.declined) ?? DEFAULT_MONDAY_STATUS_LABELS.declined,
  };

  const webhookSecret =
    toNullOrTrimmed(data.webhookSecret) ||
    existing?.webhookSecret ||
    randomBytes(24).toString("hex");
  const now = new Date();

  await db
    .insert(storeMondayIntegrations)
    .values({
      id: nanoid(),
      storeId: store.id,
      enabled: data.enabled,
      apiTokenEncrypted,
      apiVersion: data.apiVersion.trim() || "2024-10",
      boardId: toNullOrTrimmed(data.boardId),
      groupId: toNullOrTrimmed(data.groupId),
      subitemBoardId: toNullOrTrimmed(data.subitemBoardId),
      botUserId: toNullOrTrimmed(data.botUserId),
      webhookSecret,
      columnConfig,
      statusLabels,
      webhookStatusMap: parsedWebhookMap,
      createdAt: now,
      updatedAt: now,
    })
    .onDuplicateKeyUpdate({
      set: {
        enabled: data.enabled,
        apiTokenEncrypted,
        apiVersion: data.apiVersion.trim() || "2024-10",
        boardId: toNullOrTrimmed(data.boardId),
        groupId: toNullOrTrimmed(data.groupId),
        subitemBoardId: toNullOrTrimmed(data.subitemBoardId),
        botUserId: toNullOrTrimmed(data.botUserId),
        webhookSecret,
        columnConfig,
        statusLabels,
        webhookStatusMap: parsedWebhookMap,
        updatedAt: now,
      },
    });

  revalidatePath("/dashboard/settings/monday");
  revalidatePath("/dashboard/settings/integrations");
  return { status: "success" };
}

export async function testAndInspectMondayBoard(params: {
  apiToken?: string;
  apiVersion?: string;
  boardId: string;
  subitemBoardId?: string;
}): Promise<
  | { status: "success"; inspection: MondayBoardInspectionResult }
  | { status: "error"; error: string }
> {
  const store = await getCurrentStore();
  if (!store) {
    return { status: "error", error: "Brak autoryzacji sklepu." };
  }

  const canManage = await currentUserHasPermission("manage_settings");
  if (!canManage) {
    return { status: "error", error: "Brak uprawnień administratora." };
  }

  const boardId = params.boardId.trim();
  if (!boardId) {
    return { status: "error", error: "Podaj najpierw ID głównej tablicy (Board ID)." };
  }

  const resolved = await resolveMondayStoreConfig(store.id);
  const apiToken = params.apiToken?.trim() || resolved.apiToken;
  if (!apiToken) {
    return {
      status: "error",
      error: "Podaj lub zapisz najpierw Token API monday.com.",
    };
  }

  try {
    const inspection = await inspectMondayBoardAndAccount({
      boardId,
      subitemBoardId: params.subitemBoardId?.trim() || resolved.subitemBoardId,
      credentials: {
        apiToken,
        apiVersion: params.apiVersion?.trim() || resolved.apiVersion,
      },
    });

    if (!inspection.board) {
      return {
        status: "error",
        error: `Połączono z monday.com, ale nie znaleziono tablicy o ID ${boardId}. Sprawdź uprawnienia tokena do tej tablicy.`,
      };
    }

    return { status: "success", inspection };
  } catch (error) {
    return {
      status: "error",
      error:
        error instanceof Error
          ? error.message
          : "Nie udało się połączyć z API GraphQL monday.com.",
    };
  }
}

export async function triggerMondayManualSync(options?: {
  enqueueActiveReservations?: boolean;
}): Promise<
  | {
      status: "success";
      enqueued: number;
      processed: number;
      synced: number;
      failed: number;
    }
  | { status: "error"; error: string }
> {
  const store = await getCurrentStore();
  if (!store) {
    return { status: "error", error: "Brak autoryzacji sklepu." };
  }

  const canManage = await currentUserHasPermission("manage_settings");
  if (!canManage) {
    return { status: "error", error: "Brak uprawnień administratora." };
  }

  const resolved = await resolveMondayStoreConfig(store.id);
  if (!resolved.enabled || !resolved.apiToken || !resolved.boardId) {
    return {
      status: "error",
      error: "Najpierw włącz integrację oraz zapisz Token API i ID Tablicy (Board ID).",
    };
  }

  let enqueued = 0;

  if (options?.enqueueActiveReservations) {
    const now = new Date();
    const pastSince = new Date(now);
    pastSince.setDate(pastSince.getDate() - 30);
    const futureUntil = new Date(now);
    futureUntil.setMonth(futureUntil.getMonth() + 12);

    const activeReservations = await db
      .select({ id: reservations.id })
      .from(reservations)
      .where(
        and(
          eq(reservations.storeId, store.id),
          or(
            and(lte(reservations.startDate, now), gte(reservations.endDate, now)),
            and(gte(reservations.startDate, now), lte(reservations.startDate, futureUntil)),
            and(gte(reservations.startDate, pastSince), lte(reservations.startDate, now)),
          ),
        ),
      );

    for (const res of activeReservations) {
      await db
        .insert(reservationMondayItems)
        .values({
          id: nanoid(),
          storeId: store.id,
          reservationId: res.id,
          mondayBoardId: resolved.boardId,
          syncStatus: "pending",
          attemptCount: 0,
          nextAttemptAt: now,
          updatedAt: now,
        })
        .onDuplicateKeyUpdate({
          set: {
            mondayBoardId: resolved.boardId,
            payloadHash: null, // Force full re-push
            syncStatus: "pending",
            attemptCount: 0,
            nextAttemptAt: now,
            lastError: null,
            updatedAt: now,
          },
        });
      enqueued++;
    }
  } else {
    // Re-enable any failed rows for this store so they can be retried now
    const now = new Date();
    await db
      .update(reservationMondayItems)
      .set({
        syncStatus: "pending",
        attemptCount: 0,
        nextAttemptAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(reservationMondayItems.storeId, store.id),
          eq(reservationMondayItems.syncStatus, "failed"),
        ),
      );
  }

  const queueResult = await processMondaySyncQueue({
    storeId: store.id,
    limit: 25,
  });

  revalidatePath("/dashboard/settings/monday");
  return {
    status: "success",
    enqueued,
    ...queueResult,
  };
}
