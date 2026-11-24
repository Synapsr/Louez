import { and, eq, inArray, lt, lte } from "drizzle-orm";

import {
  db,
  reservationMondayItems,
  reservationMondaySubitems,
  reservations,
  storeMondayIntegrations,
} from "@louez/db";
import type { ReservationStatus } from "@louez/validations";

import { env } from "@/env";
import { log } from "@/lib/evlog";

import {
  type ResolvedMondayStoreConfig,
  isMondayStoreConfigReady,
  resolveMondayStoreConfig,
} from "./config";
import {
  type MondayApiCredentials,
  MondayApiError,
  createMondayItem,
  createMondayItemUpdate,
  createMondaySubitem,
  updateMondayItemColumns,
} from "./monday-client";
import { buildMondayReservationPayload, isCancelledReservationStatus } from "./monday-payload";

const MAX_ATTEMPTS = 8;

export function computeMondayRetryDate(attemptCount: number, retryAfterSeconds?: number): Date {
  if (retryAfterSeconds && retryAfterSeconds > 0) {
    return new Date(Date.now() + retryAfterSeconds * 1000);
  }
  const delayMinutes = Math.min(24 * 60, 2 ** Math.max(0, attemptCount));
  return new Date(Date.now() + delayMinutes * 60 * 1000);
}

async function loadReservationForMondaySync(reservationId: string) {
  return db.query.reservations.findFirst({
    where: eq(reservations.id, reservationId),
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
}

async function reconcileMondayChecklist(params: {
  mondayMappingId: string;
  storeId: string;
  mondayParentItemId: string;
  configuredSubitemBoardId: string | null;
  credentials: MondayApiCredentials;
  subitemId: string | null;
  subitemBoardId: string | null;
  checklistHash: string;
  previousChecklistHash: string | null;
  checklistBody: string;
}): Promise<void> {
  let subitemId = params.subitemId;
  let subitemBoardId = params.subitemBoardId || params.configuredSubitemBoardId;
  let previousChecklistHash = params.previousChecklistHash;

  const createChecklistSubitem = async (): Promise<string> => {
    const created = await createMondaySubitem({
      parentItemId: params.mondayParentItemId,
      itemName: "Sprzęt do przygotowania",
      credentials: params.credentials,
    });

    subitemId = created.id;
    subitemBoardId = created.subitemBoardId ?? subitemBoardId;
    previousChecklistHash = null;

    await db.transaction(async (tx) => {
      await tx
        .update(reservationMondayItems)
        .set({
          checklistSubitemId: subitemId,
          checklistSubitemBoardId: subitemBoardId,
          checklistHash: null,
          updatedAt: new Date(),
        })
        .where(eq(reservationMondayItems.id, params.mondayMappingId));

      if (created.subitemBoardId && !params.configuredSubitemBoardId) {
        await tx
          .update(storeMondayIntegrations)
          .set({
            subitemBoardId: created.subitemBoardId,
            updatedAt: new Date(),
          })
          .where(eq(storeMondayIntegrations.storeId, params.storeId));
      }
    });

    return created.id;
  };

  if (!subitemId) {
    subitemId = await createChecklistSubitem();
  }

  if (previousChecklistHash === params.checklistHash) {
    return;
  }

  if (!subitemId) {
    throw new Error("Nie udało się utworzyć podzadania checklisty monday.com");
  }

  try {
    await createMondayItemUpdate({
      itemId: subitemId,
      body: params.checklistBody,
      credentials: params.credentials,
    });
  } catch (error) {
    if (!(error instanceof MondayApiError && error.kind === "not_found")) {
      throw error;
    }

    subitemId = await createChecklistSubitem();
    await createMondayItemUpdate({
      itemId: subitemId,
      body: params.checklistBody,
      credentials: params.credentials,
    });
  }

  await db
    .update(reservationMondayItems)
    .set({
      checklistHash: params.checklistHash,
      updatedAt: new Date(),
    })
    .where(eq(reservationMondayItems.id, params.mondayMappingId));
}

async function processMondayOutboxRow(
  row: {
    id: string;
    storeId: string;
    reservationId: string;
    mondayBoardId: string | null;
    mondayItemId: string | null;
    checklistSubitemId: string | null;
    checklistSubitemBoardId: string | null;
    checklistHash: string | null;
    payloadHash: string | null;
    lastPushedStatus: string | null;
    attemptCount: number;
  },
  storeConfig: ResolvedMondayStoreConfig,
): Promise<void> {
  if (!storeConfig.apiToken || !storeConfig.boardId) {
    throw new Error("Brak skonfigurowanego tokena API lub Board ID monday.com");
  }

  const credentials: MondayApiCredentials = {
    apiToken: storeConfig.apiToken,
    apiVersion: storeConfig.apiVersion,
  };
  const boardId = storeConfig.boardId;

  const reservation = await loadReservationForMondaySync(row.reservationId);
  if (!reservation) {
    await db
      .update(reservationMondayItems)
      .set({
        syncStatus: "synced",
        lastSyncedAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(reservationMondayItems.id, row.id));
    return;
  }

  const built = buildMondayReservationPayload(reservation, storeConfig, env.NEXT_PUBLIC_APP_URL);

  // Fast-path idempotency: if mondayItemId exists and payloadHash matches, skip GraphQL mutation
  const checklistIsCurrent =
    built.isCancelled ||
    (row.checklistSubitemId !== null && row.checklistHash === built.checklist.hash);

  if (row.mondayItemId && row.payloadHash === built.payloadHash && checklistIsCurrent) {
    await db
      .update(reservationMondayItems)
      .set({
        syncStatus: "synced",
        lastPushedStatus: reservation.status,
        lastSyncedAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(reservationMondayItems.id, row.id));
    return;
  }

  let mondayItemId = row.mondayItemId;
  let checklistSubitemId = row.checklistSubitemId;
  let checklistSubitemBoardId = row.checklistSubitemBoardId;
  let checklistHash = row.checklistHash;
  const previousPushedStatus = row.lastPushedStatus as ReservationStatus | null;

  if (mondayItemId) {
    try {
      await updateMondayItemColumns({
        boardId: row.mondayBoardId || boardId,
        itemId: mondayItemId,
        columnValues: {
          ...built.columnValues,
          name: built.itemName,
        },
        credentials,
      });
    } catch (error) {
      if (!(error instanceof MondayApiError && error.kind === "not_found")) {
        throw error;
      }

      // Main item was manually deleted on monday.com: clear stale subitem mappings & recreate item
      await db.transaction(async (tx) => {
        await tx
          .delete(reservationMondaySubitems)
          .where(eq(reservationMondaySubitems.reservationId, row.reservationId));
        await tx
          .update(reservationMondayItems)
          .set({
            checklistSubitemId: null,
            checklistSubitemBoardId: null,
            checklistHash: null,
            updatedAt: new Date(),
          })
          .where(eq(reservationMondayItems.id, row.id));
      });
      checklistSubitemId = null;
      checklistSubitemBoardId = null;
      checklistHash = null;
      mondayItemId = null;
    }
  }

  if (!mondayItemId) {
    const created = await createMondayItem({
      boardId,
      groupId: storeConfig.groupId,
      itemName: built.itemName,
      columnValues: built.columnValues,
      credentials,
    });
    mondayItemId = created.id;

    // Persist mondayItemId immediately so even if a later subitem call hits a rate limit,
    // the next retry won't create a duplicate main Item
    await db
      .update(reservationMondayItems)
      .set({
        mondayBoardId: boardId,
        mondayItemId,
        updatedAt: new Date(),
      })
      .where(eq(reservationMondayItems.id, row.id));
  }

  // Keep the last preparation checklist visible when a reservation is cancelled.
  if (!built.isCancelled) {
    await reconcileMondayChecklist({
      mondayMappingId: row.id,
      storeId: row.storeId,
      mondayParentItemId: mondayItemId,
      configuredSubitemBoardId: storeConfig.subitemBoardId,
      credentials,
      subitemId: checklistSubitemId,
      subitemBoardId: checklistSubitemBoardId,
      checklistHash: built.checklist.hash,
      previousChecklistHash: checklistHash,
      checklistBody: built.checklist.body,
    });
  }

  // If the reservation transitioned into a cancelled/rejected state, post an operational comment
  const wasPreviouslyCancelled = previousPushedStatus
    ? isCancelledReservationStatus(previousPushedStatus)
    : false;
  if (built.isCancelled && !wasPreviouslyCancelled) {
    try {
      await createMondayItemUpdate({
        itemId: mondayItemId,
        body: `⚠️ Rezerwacja #${reservation.number} została anulowana w systemie Louez (status: ${reservation.status}). Prosimy o przerwanie kompletacji sprzętu / przygotowania pomieszczeń.`,
        credentials,
      });
    } catch (updateError) {
      log.warn({
        monday: {
          event: "cancellation_comment_failed",
          reservationId: row.reservationId,
          mondayItemId,
          error: updateError instanceof Error ? updateError.message : String(updateError),
        },
      });
    }
  }

  const now = new Date();
  await db
    .update(reservationMondayItems)
    .set({
      mondayBoardId: boardId,
      mondayItemId,
      payloadHash: built.payloadHash,
      lastPushedStatus: reservation.status,
      syncStatus: "synced",
      lastSyncedAt: now,
      lastError: null,
      updatedAt: now,
    })
    .where(eq(reservationMondayItems.id, row.id));

  await db
    .update(storeMondayIntegrations)
    .set({
      lastSyncAt: now,
      lastError: null,
      updatedAt: now,
    })
    .where(eq(storeMondayIntegrations.storeId, row.storeId));
}

export async function processMondaySyncQueue(options?: {
  limit?: number;
  reservationId?: string;
  storeId?: string;
}): Promise<{
  processed: number;
  synced: number;
  failed: number;
}> {
  const limit = options?.limit ?? 20;
  const now = new Date();

  const whereConditions = [
    inArray(reservationMondayItems.syncStatus, ["pending", "failed"]),
    lt(reservationMondayItems.attemptCount, MAX_ATTEMPTS),
    lte(reservationMondayItems.nextAttemptAt, now),
  ];

  if (options?.reservationId) {
    whereConditions.push(eq(reservationMondayItems.reservationId, options.reservationId));
  }
  if (options?.storeId) {
    whereConditions.push(eq(reservationMondayItems.storeId, options.storeId));
  }

  const dueRows = await db
    .select({
      id: reservationMondayItems.id,
      storeId: reservationMondayItems.storeId,
      reservationId: reservationMondayItems.reservationId,
      mondayBoardId: reservationMondayItems.mondayBoardId,
      mondayItemId: reservationMondayItems.mondayItemId,
      checklistSubitemId: reservationMondayItems.checklistSubitemId,
      checklistSubitemBoardId: reservationMondayItems.checklistSubitemBoardId,
      checklistHash: reservationMondayItems.checklistHash,
      payloadHash: reservationMondayItems.payloadHash,
      lastPushedStatus: reservationMondayItems.lastPushedStatus,
      attemptCount: reservationMondayItems.attemptCount,
    })
    .from(reservationMondayItems)
    .where(and(...whereConditions))
    .limit(limit);

  if (dueRows.length === 0) {
    return { processed: 0, synced: 0, failed: 0 };
  }

  const configByStoreId = new Map<string, ResolvedMondayStoreConfig>();
  let synced = 0;
  let failed = 0;

  for (const row of dueRows) {
    let storeConfig = configByStoreId.get(row.storeId);
    if (!storeConfig) {
      storeConfig = await resolveMondayStoreConfig(row.storeId);
      configByStoreId.set(row.storeId, storeConfig);
    }

    if (!isMondayStoreConfigReady(storeConfig)) {
      continue;
    }

    await db
      .update(reservationMondayItems)
      .set({
        syncStatus: "processing",
        updatedAt: new Date(),
      })
      .where(eq(reservationMondayItems.id, row.id));

    try {
      await processMondayOutboxRow(row, storeConfig);
      synced++;
    } catch (error) {
      failed++;
      const isMondayError = error instanceof MondayApiError;
      const retryAfterSeconds = isMondayError ? error.retryAfterSeconds : undefined;
      const isRetryable = isMondayError ? error.retryable : true;
      const nextAttemptCount = isRetryable ? row.attemptCount + 1 : MAX_ATTEMPTS;
      const message = error instanceof Error ? error.message : "Unknown monday.com sync error";

      log.error({
        monday: {
          event: "sync_failed",
          storeId: row.storeId,
          reservationId: row.reservationId,
          mondayItemId: row.mondayItemId,
          attemptCount: nextAttemptCount,
          retryable: isRetryable,
          error: message,
        },
      });

      const errNow = new Date();
      await db
        .update(reservationMondayItems)
        .set({
          syncStatus: "failed",
          attemptCount: nextAttemptCount,
          nextAttemptAt: computeMondayRetryDate(nextAttemptCount, retryAfterSeconds),
          lastError: message,
          updatedAt: errNow,
        })
        .where(eq(reservationMondayItems.id, row.id));

      await db
        .update(storeMondayIntegrations)
        .set({
          lastError: message,
          updatedAt: errNow,
        })
        .where(eq(storeMondayIntegrations.storeId, row.storeId));

      if (isMondayError && (error.kind === "rate_limit" || error.kind === "complexity_limit")) {
        break;
      }
    }
  }

  return {
    processed: synced + failed,
    synced,
    failed,
  };
}
