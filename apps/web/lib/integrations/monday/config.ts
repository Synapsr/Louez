import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";

import {
  type MondayColumnIdsConfig,
  type MondayStatusLabelsConfig,
  db,
  storeMondayIntegrations,
} from "@louez/db";
import type { ReservationStatus } from "@louez/validations";

import { env } from "@/env";
import { decryptIntegrationSecret, encryptIntegrationSecret } from "@/lib/integrations/credentials";

const FALLBACK_PREFIX = "fb1.";
const ALGORITHM = "aes-256-gcm";

function getFallbackKey(): Buffer {
  const secretSource = env.INTEGRATION_ENCRYPTION_KEY || "louez-monday-default-secret";
  return createHash("sha256").update(secretSource).digest();
}

export function encryptMondayApiToken(token: string): string {
  if (env.INTEGRATION_ENCRYPTION_KEY) {
    return encryptIntegrationSecret(token).encrypted;
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getFallbackKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${FALLBACK_PREFIX}${[
    iv.toString("base64url"),
    authTag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".")}`;
}

export function decryptMondayApiToken(encryptedValue: string): string {
  if (encryptedValue.startsWith(FALLBACK_PREFIX)) {
    const raw = encryptedValue.slice(FALLBACK_PREFIX.length);
    const [ivValue, authTagValue, ciphertextValue] = raw.split(".");
    if (!ivValue || !authTagValue || !ciphertextValue) {
      throw new Error("Invalid encrypted monday.com API token format");
    }

    const decipher = createDecipheriv(
      ALGORITHM,
      getFallbackKey(),
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(authTagValue, "base64url"));

    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }

  return decryptIntegrationSecret(encryptedValue);
}

export const DEFAULT_MONDAY_STATUS_LABELS: Record<ReservationStatus, string> = {
  quote: "Oczekująca",
  pending: "Oczekująca",
  confirmed: "Gotowa do wydania",
  ongoing: "Wydana",
  completed: "Zakończona",
  cancelled: "Anulowane",
  rejected: "Anulowane",
  declined: "Anulowane",
};

export type ResolvedMondayStoreConfig = {
  storeId: string;
  enabled: boolean;
  apiToken: string | null;
  hasApiToken: boolean;
  apiVersion: string;
  boardId: string | null;
  groupId: string | null;
  subitemBoardId: string | null;
  botUserId: string | null;
  webhookSecret: string | null;
  columnConfig: Required<MondayColumnIdsConfig>;
  statusLabels: Record<ReservationStatus, string>;
  webhookStatusMap: Record<string, ReservationStatus>;
  lastSyncAt: Date | null;
  lastWebhookAt: Date | null;
  lastError: string | null;
};

function trimOrNull(val: string | null | undefined): string | null {
  const trimmed = val?.trim();
  return trimmed ? trimmed : null;
}

function parseJsonStatusLabels(raw: string | undefined): Partial<MondayStatusLabelsConfig> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Partial<MondayStatusLabelsConfig>;
    }
  } catch {
    // Ignore invalid JSON
  }
  return {};
}

function isValidStatus(value: string): value is ReservationStatus {
  return (
    value === "pending" ||
    value === "confirmed" ||
    value === "ongoing" ||
    value === "completed" ||
    value === "cancelled" ||
    value === "rejected" ||
    value === "quote" ||
    value === "declined"
  );
}

function parseWebhookStatusMap(
  dbMap: Record<string, string> | null | undefined,
  envJson: string | undefined,
): Record<string, ReservationStatus> {
  const result: Record<string, ReservationStatus> = {};

  if (envJson) {
    try {
      const parsed: unknown = JSON.parse(envJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === "string" && isValidStatus(v)) {
            result[k] = v;
          }
        }
      }
    } catch {
      // Ignore
    }
  }

  if (dbMap && typeof dbMap === "object") {
    for (const [k, v] of Object.entries(dbMap)) {
      if (typeof v === "string" && isValidStatus(v)) {
        result[k] = v;
      }
    }
  }

  return result;
}

export async function resolveMondayStoreConfig(
  storeId: string,
): Promise<ResolvedMondayStoreConfig> {
  const [row] = await db
    .select()
    .from(storeMondayIntegrations)
    .where(eq(storeMondayIntegrations.storeId, storeId))
    .limit(1);

  let decryptedToken: string | null = null;
  if (row?.apiTokenEncrypted) {
    try {
      decryptedToken = decryptMondayApiToken(row.apiTokenEncrypted);
    } catch {
      decryptedToken = null;
    }
  }

  const apiToken = decryptedToken || trimOrNull(env.MONDAY_API_TOKEN);
  const boardId = trimOrNull(row?.boardId) ?? trimOrNull(env.MONDAY_BOARD_ID);
  const enabled = row ? row.enabled : Boolean(env.MONDAY_ENABLED && apiToken && boardId);

  const dbCol = row?.columnConfig ?? {};
  const columnConfig: Required<MondayColumnIdsConfig> = {
    statusColumnId: trimOrNull(dbCol.statusColumnId) ?? trimOrNull(env.MONDAY_STATUS_COLUMN_ID),
    timelineColumnId:
      trimOrNull(dbCol.timelineColumnId) ?? trimOrNull(env.MONDAY_TIMELINE_COLUMN_ID),
    startDateColumnId:
      trimOrNull(dbCol.startDateColumnId) ?? trimOrNull(env.MONDAY_START_DATE_COLUMN_ID),
    endDateColumnId:
      trimOrNull(dbCol.endDateColumnId) ?? trimOrNull(env.MONDAY_END_DATE_COLUMN_ID),
    customerColumnId:
      trimOrNull(dbCol.customerColumnId) ?? trimOrNull(env.MONDAY_CUSTOMER_COLUMN_ID),
    emailColumnId: trimOrNull(dbCol.emailColumnId) ?? trimOrNull(env.MONDAY_EMAIL_COLUMN_ID),
    phoneColumnId: trimOrNull(dbCol.phoneColumnId) ?? trimOrNull(env.MONDAY_PHONE_COLUMN_ID),
    linkColumnId: trimOrNull(dbCol.linkColumnId) ?? trimOrNull(env.MONDAY_LINK_COLUMN_ID),
    numberColumnId: trimOrNull(dbCol.numberColumnId) ?? trimOrNull(env.MONDAY_NUMBER_COLUMN_ID),
    totalColumnId: trimOrNull(dbCol.totalColumnId) ?? trimOrNull(env.MONDAY_TOTAL_COLUMN_ID),
    notesColumnId: trimOrNull(dbCol.notesColumnId) ?? trimOrNull(env.MONDAY_NOTES_COLUMN_ID),
    subitemQuantityColumnId:
      trimOrNull(dbCol.subitemQuantityColumnId) ??
      trimOrNull(env.MONDAY_SUBITEM_QUANTITY_COLUMN_ID),
    subitemTypeColumnId:
      trimOrNull(dbCol.subitemTypeColumnId) ?? trimOrNull(env.MONDAY_SUBITEM_TYPE_COLUMN_ID),
    subitemUnitsColumnId:
      trimOrNull(dbCol.subitemUnitsColumnId) ?? trimOrNull(env.MONDAY_SUBITEM_UNITS_COLUMN_ID),
    subitemStatusColumnId:
      trimOrNull(dbCol.subitemStatusColumnId) ?? trimOrNull(env.MONDAY_SUBITEM_STATUS_COLUMN_ID),
  };

  const envLabels = parseJsonStatusLabels(env.MONDAY_STATUS_LABELS);
  const dbLabels = row?.statusLabels ?? {};
  const statusLabels: Record<ReservationStatus, string> = {
    quote:
      trimOrNull(dbLabels.quote) ??
      trimOrNull(envLabels.quote) ??
      DEFAULT_MONDAY_STATUS_LABELS.quote,
    pending:
      trimOrNull(dbLabels.pending) ??
      trimOrNull(envLabels.pending) ??
      DEFAULT_MONDAY_STATUS_LABELS.pending,
    confirmed:
      trimOrNull(dbLabels.confirmed) ??
      trimOrNull(envLabels.confirmed) ??
      DEFAULT_MONDAY_STATUS_LABELS.confirmed,
    ongoing:
      trimOrNull(dbLabels.ongoing) ??
      trimOrNull(envLabels.ongoing) ??
      DEFAULT_MONDAY_STATUS_LABELS.ongoing,
    completed:
      trimOrNull(dbLabels.completed) ??
      trimOrNull(envLabels.completed) ??
      DEFAULT_MONDAY_STATUS_LABELS.completed,
    cancelled:
      trimOrNull(dbLabels.cancelled) ??
      trimOrNull(envLabels.cancelled) ??
      DEFAULT_MONDAY_STATUS_LABELS.cancelled,
    rejected:
      trimOrNull(dbLabels.rejected) ??
      trimOrNull(envLabels.rejected) ??
      DEFAULT_MONDAY_STATUS_LABELS.rejected,
    declined:
      trimOrNull(dbLabels.declined) ??
      trimOrNull(envLabels.declined) ??
      DEFAULT_MONDAY_STATUS_LABELS.declined,
  };

  return {
    storeId,
    enabled,
    apiToken,
    hasApiToken: Boolean(apiToken),
    apiVersion: trimOrNull(row?.apiVersion) || env.MONDAY_API_VERSION || "2024-10",
    boardId,
    groupId: trimOrNull(row?.groupId) ?? trimOrNull(env.MONDAY_GROUP_ID),
    subitemBoardId: trimOrNull(row?.subitemBoardId) ?? trimOrNull(env.MONDAY_SUBITEM_BOARD_ID),
    botUserId: trimOrNull(row?.botUserId) ?? trimOrNull(env.MONDAY_BOT_USER_ID),
    webhookSecret: trimOrNull(row?.webhookSecret) ?? trimOrNull(env.MONDAY_WEBHOOK_SECRET),
    columnConfig,
    statusLabels,
    webhookStatusMap: parseWebhookStatusMap(row?.webhookStatusMap, env.MONDAY_WEBHOOK_STATUS_MAP),
    lastSyncAt: row?.lastSyncAt ?? null,
    lastWebhookAt: row?.lastWebhookAt ?? null,
    lastError: row?.lastError ?? null,
  };
}

export function isMondayStoreConfigReady(config: ResolvedMondayStoreConfig): boolean {
  return Boolean(config.enabled && config.apiToken && config.boardId);
}
