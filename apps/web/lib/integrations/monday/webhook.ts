import { timingSafeEqual } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { markReservationForCalendarSync } from "@louez/api/services";
import {
  consumeReservationStock,
  db,
  reservationActivity,
  reservationMondayItems,
  reservationStatusConsumesStock,
  reservations,
  restoreReservationStock,
  storeMondayIntegrations,
} from "@louez/db";
import type { ReservationStatus } from "@louez/validations";

import { env } from "@/env";
import { log } from "@/lib/evlog";
import {
  recordMarketplaceFee,
  recordReservationFee,
  voidReservationFee,
} from "@/lib/pay-as-you-go";
import { resolveDateChangeRequests } from "@/lib/reservations/date-change-request.server";
import { checkExistingReservationInventory } from "@/lib/reservations/reserve-inventory";

import { type ResolvedMondayStoreConfig, resolveMondayStoreConfig } from "./config";
import { fetchMondayItemColumnText } from "./monday-client";
import {
  buildMondayReservationPayload,
  resolveLouezStatusFromMondayLabel,
} from "./monday-payload";

const mondayChallengeSchema = z.object({
  challenge: z.string().min(1),
});

const mondayStatusLabelValueSchema = z
  .object({
    label: z
      .object({
        text: z.string().nullable().optional(),
        index: z.number().optional(),
      })
      .optional(),
  })
  .passthrough();

export const mondayWebhookEventSchema = z
  .object({
    userId: z.union([z.number(), z.string()]).optional(),
    boardId: z.union([z.number(), z.string()]).optional(),
    pulseId: z.union([z.number(), z.string()]).optional(),
    itemId: z.union([z.number(), z.string()]).optional(),
    columnId: z.string().optional(),
    columnType: z.string().optional(),
    columnTitle: z.string().optional(),
    value: mondayStatusLabelValueSchema.nullable().optional(),
    previousValue: mondayStatusLabelValueSchema.nullable().optional(),
    triggerTime: z.string().optional(),
    subscriptionId: z.union([z.number(), z.string()]).optional(),
    triggerUuid: z.string().optional(),
  })
  .passthrough();

export const mondayWebhookPayloadSchema = z
  .object({
    challenge: z.string().optional(),
    event: mondayWebhookEventSchema.optional(),
  })
  .passthrough();

export type MondayWebhookEvent = z.infer<typeof mondayWebhookEventSchema>;

export function extractMondayChallenge(payload: unknown): string | null {
  const parsed = mondayChallengeSchema.safeParse(payload);
  return parsed.success ? parsed.data.challenge : null;
}

export function extractWebhookSecretFromRequest(request: Request): string | null {
  const url = new URL(request.url);
  const querySecret = url.searchParams.get("secret")?.trim();
  const headerSecret = request.headers.get("x-monday-webhook-secret")?.trim();
  const authHeader = request.headers.get("authorization")?.trim();
  const bearerSecret = authHeader?.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : authHeader;

  return querySecret || headerSecret || bearerSecret || null;
}

export function safeCompareSecrets(expected: string, candidate: string): boolean {
  const expectedBuffer = Buffer.from(expected.trim(), "utf8");
  const candidateBuffer = Buffer.from(candidate.trim(), "utf8");
  if (expectedBuffer.length !== candidateBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, candidateBuffer);
}

/**
 * Verifies the incoming webhook secret against either a store-configured `webhookSecret`
 * in `store_monday_integrations` or the global `MONDAY_WEBHOOK_SECRET` fallback.
 */
export async function verifyMondayWebhookRequest(request: Request): Promise<{
  authorized: boolean;
  matchedStoreId: string | null;
}> {
  const candidate = extractWebhookSecretFromRequest(request);
  if (!candidate) {
    return { authorized: false, matchedStoreId: null };
  }

  const url = new URL(request.url);
  const queryStoreId = url.searchParams.get("storeId")?.trim() || null;

  const storeConfigs = await db
    .select({
      storeId: storeMondayIntegrations.storeId,
      webhookSecret: storeMondayIntegrations.webhookSecret,
    })
    .from(storeMondayIntegrations);

  for (const row of storeConfigs) {
    if (queryStoreId && row.storeId !== queryStoreId) continue;
    if (row.webhookSecret && safeCompareSecrets(row.webhookSecret, candidate)) {
      return { authorized: true, matchedStoreId: row.storeId };
    }
  }

  const envSecret = env.MONDAY_WEBHOOK_SECRET?.trim();
  if (envSecret && safeCompareSecrets(envSecret, candidate)) {
    return { authorized: true, matchedStoreId: queryStoreId };
  }

  return { authorized: false, matchedStoreId: null };
}

export function isMondayBotUserEvent(
  event: MondayWebhookEvent,
  config?: Pick<ResolvedMondayStoreConfig, "botUserId"> | null,
): boolean {
  const botUserId = config?.botUserId?.trim() || env.MONDAY_BOT_USER_ID?.trim();
  if (!botUserId || event.userId === undefined || event.userId === null) {
    return false;
  }

  return String(event.userId).trim() === botUserId;
}

export function shouldProcessMondayWebhookColumn(
  event: MondayWebhookEvent,
  config?: Pick<ResolvedMondayStoreConfig, "columnConfig"> | null,
): boolean {
  const configuredStatusColumnId =
    config?.columnConfig.statusColumnId?.trim() || env.MONDAY_STATUS_COLUMN_ID?.trim();
  if (!configuredStatusColumnId) {
    return !event.columnType || event.columnType === "color" || event.columnType === "status";
  }

  return !event.columnId || event.columnId === configuredStatusColumnId;
}

/**
 * Processes an inbound monday.com status-change webhook asynchronously in the background.
 * Enforces double infinite-loop protection:
 * 1. Ignores events triggered by the store's configured `botUserId` (`MONDAY_BOT_USER_ID`).
 * 2. Idempotency check: only mutates DB when target Louez status differs from current status,
 *    and updates `reservation_monday_items.last_pushed_status` + `payload_hash` so the outbound
 *    worker does not re-push the same change back to monday.com.
 */
export async function processInboundMondayWebhookEvent(
  event: MondayWebhookEvent,
  matchedStoreId?: string | null,
): Promise<{
  action:
    | "ignored_bot"
    | "ignored_column"
    | "ignored_unmapped"
    | "not_found"
    | "noop_same_status"
    | "updated";
  reservationId?: string;
  previousStatus?: ReservationStatus;
  newStatus?: ReservationStatus;
}> {
  const rawItemId = event.pulseId ?? event.itemId;
  if (rawItemId === undefined || rawItemId === null) {
    return { action: "not_found" };
  }
  const mondayItemId = String(rawItemId).trim();

  const [mapping] = await db
    .select({
      id: reservationMondayItems.id,
      storeId: reservationMondayItems.storeId,
      reservationId: reservationMondayItems.reservationId,
    })
    .from(reservationMondayItems)
    .where(eq(reservationMondayItems.mondayItemId, mondayItemId))
    .limit(1);

  if (!mapping) {
    // Check if we at least have a store config to enforce botUserId filter early
    if (matchedStoreId) {
      const fallbackConfig = await resolveMondayStoreConfig(matchedStoreId);
      if (isMondayBotUserEvent(event, fallbackConfig)) {
        return { action: "ignored_bot" };
      }
    } else if (isMondayBotUserEvent(event, null)) {
      return { action: "ignored_bot" };
    }
    return { action: "not_found" };
  }

  const storeConfig = await resolveMondayStoreConfig(mapping.storeId);

  // Layer 1 infinite-loop protection: ignore events triggered by the integration bot user
  if (isMondayBotUserEvent(event, storeConfig)) {
    return { action: "ignored_bot" };
  }

  if (!shouldProcessMondayWebhookColumn(event, storeConfig)) {
    return { action: "ignored_column" };
  }

  // Extract status label from webhook payload; if missing, query monday.com GraphQL for this item
  let statusLabel = event.value?.label?.text?.trim() || null;
  const statusColumnId = storeConfig.columnConfig.statusColumnId;
  if (!statusLabel && statusColumnId && storeConfig.apiToken) {
    const fetched = await fetchMondayItemColumnText({
      itemId: mondayItemId,
      columnId: statusColumnId,
      credentials: {
        apiToken: storeConfig.apiToken,
        apiVersion: storeConfig.apiVersion,
      },
    });
    statusLabel = fetched?.statusText ?? null;
  }

  if (!statusLabel) {
    return { action: "ignored_unmapped" };
  }

  const targetStatus = resolveLouezStatusFromMondayLabel(statusLabel, storeConfig);
  if (!targetStatus) {
    log.warn({
      monday: {
        event: "webhook_unmapped_status_label",
        storeId: mapping.storeId,
        mondayItemId,
        statusLabel,
      },
    });
    return { action: "ignored_unmapped" };
  }

  const transition = await db.transaction(async (tx) => {
    const [lockedReservation] = await tx
      .select({
        id: reservations.id,
        storeId: reservations.storeId,
        status: reservations.status,
        source: reservations.source,
        startDate: reservations.startDate,
        endDate: reservations.endDate,
        pickedUpAt: reservations.pickedUpAt,
        returnedAt: reservations.returnedAt,
      })
      .from(reservations)
      .where(
        and(
          eq(reservations.id, mapping.reservationId),
          eq(reservations.storeId, mapping.storeId),
        ),
      )
      .for("update");

    if (!lockedReservation) {
      return { status: "not_found" as const };
    }

    // Layer 2 infinite-loop protection: idempotency check
    if (lockedReservation.status === targetStatus) {
      return {
        status: "noop_same_status" as const,
        reservationId: lockedReservation.id,
        currentStatus: lockedReservation.status,
      };
    }

    const previousStatus = lockedReservation.status;
    const prevConsumedStock = reservationStatusConsumesStock(previousStatus);
    const nextConsumesStock = reservationStatusConsumesStock(targetStatus);

    if (!prevConsumedStock && nextConsumesStock) {
      await checkExistingReservationInventory(tx, lockedReservation.id, lockedReservation.storeId);
      await consumeReservationStock(tx, lockedReservation.id, lockedReservation.storeId);
    } else if (prevConsumedStock && !nextConsumesStock && targetStatus !== "completed") {
      await restoreReservationStock(tx, lockedReservation.id, lockedReservation.storeId);
    }

    const now = new Date();
    const updateFields: Partial<typeof reservations.$inferInsert> = {
      status: targetStatus,
      updatedAt: now,
    };

    if (targetStatus === "ongoing" && !lockedReservation.pickedUpAt) {
      updateFields.pickedUpAt = now;
    } else if (targetStatus === "completed" && !lockedReservation.returnedAt) {
      updateFields.returnedAt = now;
    }

    await tx
      .update(reservations)
      .set(updateFields)
      .where(eq(reservations.id, lockedReservation.id));

    await resolveDateChangeRequests(
      tx,
      lockedReservation.id,
      lockedReservation.startDate,
      lockedReservation.endDate,
      targetStatus,
    );

    const activityTypeMap: Partial<
      Record<ReservationStatus, typeof reservationActivity.$inferInsert.activityType>
    > = {
      confirmed: "confirmed",
      ongoing: "picked_up",
      completed: "returned",
      cancelled: "cancelled",
      rejected: "rejected",
    };

    const activityType = activityTypeMap[targetStatus] ?? "modified";
    await tx.insert(reservationActivity).values({
      id: nanoid(),
      reservationId: lockedReservation.id,
      userId: null,
      activityType,
      description: `Status zaktualizowany z monday.com (${statusLabel})`,
      metadata: {
        source: "monday_webhook",
        mondayItemId,
        mondayUserId: event.userId ?? null,
        mondayStatusLabel: statusLabel,
        previousStatus,
        newStatus: targetStatus,
      },
    });

    return {
      status: "updated" as const,
      reservationId: lockedReservation.id,
      storeId: lockedReservation.storeId,
      reservationSource: lockedReservation.source,
      previousStatus,
      newStatus: targetStatus,
    };
  });

  if (transition.status === "not_found") {
    return { action: "not_found" };
  }

  const now = new Date();
  await db
    .update(storeMondayIntegrations)
    .set({
      lastWebhookAt: now,
      updatedAt: now,
    })
    .where(eq(storeMondayIntegrations.storeId, mapping.storeId));

  if (transition.status === "noop_same_status") {
    await db
      .update(reservationMondayItems)
      .set({
        lastPushedStatus: transition.currentStatus,
        updatedAt: now,
      })
      .where(eq(reservationMondayItems.id, mapping.id));

    return {
      action: "noop_same_status",
      reservationId: transition.reservationId,
      previousStatus: transition.currentStatus,
      newStatus: transition.currentStatus,
    };
  }

  // Update reservation_monday_items with the new payload hash and lastPushedStatus
  // so that Louez does not re-push the exact same status back to monday.com
  const fullReservation = await db.query.reservations.findFirst({
    where: eq(reservations.id, transition.reservationId),
    with: {
      store: true,
      customer: true,
      items: {
        with: {
          product: {
            with: {
              category: true,
              categoryLinks: {
                with: {
                  category: true,
                },
              },
            },
          },
          assignedUnits: true,
        },
      },
    },
  });

  if (fullReservation) {
    const built = buildMondayReservationPayload(
      fullReservation,
      storeConfig,
      env.NEXT_PUBLIC_APP_URL,
    );
    await db
      .update(reservationMondayItems)
      .set({
        payloadHash: built.payloadHash,
        lastPushedStatus: transition.newStatus,
        syncStatus: "synced",
        lastSyncedAt: now,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(reservationMondayItems.id, mapping.id));
  }

  // Also enqueue Google Calendar sync (without re-enqueueing monday.com)
  await markReservationForCalendarSync(transition.storeId, transition.reservationId, {
    skipMondaySync: true,
  });

  const BILLABLE_STATUSES: ReservationStatus[] = ["confirmed", "ongoing", "completed"];
  try {
    if (
      BILLABLE_STATUSES.includes(transition.newStatus) &&
      !BILLABLE_STATUSES.includes(transition.previousStatus)
    ) {
      await Promise.all([
        recordReservationFee({
          storeId: transition.storeId,
          reservationId: transition.reservationId,
          source: "manual",
        }),
        ...(transition.reservationSource === "marketplace"
          ? [
              recordMarketplaceFee({
                storeId: transition.storeId,
                reservationId: transition.reservationId,
                source: "manual",
              }),
            ]
          : []),
      ]);
    } else if (
      BILLABLE_STATUSES.includes(transition.previousStatus) &&
      !BILLABLE_STATUSES.includes(transition.newStatus)
    ) {
      await voidReservationFee(transition.reservationId);
    }
  } catch (feeError) {
    log.error({
      monday: {
        event: "payg_fee_update_failed",
        reservationId: transition.reservationId,
        error: feeError instanceof Error ? feeError.message : String(feeError),
      },
    });
  }

  return {
    action: "updated",
    reservationId: transition.reservationId,
    previousStatus: transition.previousStatus,
    newStatus: transition.newStatus,
  };
}
