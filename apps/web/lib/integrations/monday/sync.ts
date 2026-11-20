import { and, eq, inArray, lt, lte } from "drizzle-orm";
import { nanoid } from "nanoid";

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
  deleteMondaySubitem,
  updateMondayItemColumns,
} from "./monday-client";
import {
  type BuiltMondaySubitemPayload,
  buildMondayReservationPayload,
  isCancelledReservationStatus,
} from "./monday-payload";

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

async function reconcileMondaySubitems(params: {
  storeId: string;
  reservationId: string;
  mondayParentItemId: string;
  configuredSubitemBoardId: string | null;
  credentials: MondayApiCredentials;
  desiredSubitems: BuiltMondaySubitemPayload[];
}): Promise<void> {
  const existingRows = await db
    .select()
    .from(reservationMondaySubitems)
    .where(eq(reservationMondaySubitems.reservationId, params.reservationId));

  const existingByReservationItemId = new Map(
    existingRows.map((row) => [row.reservationItemId, row]),
  );
  const desiredIds = new Set(params.desiredSubitems.map((sub) => sub.reservationItemId));

  // 1. Delete subitems for reservation_items that were removed during reservation editing
  for (const existing of existingRows) {
    if (!desiredIds.has(existing.reservationItemId)) {
      await deleteMondaySubitem({
        subitemId: existing.mondaySubitemId,
        credentials: params.credentials,
      });
      await db
        .delete(reservationMondaySubitems)
        .where(eq(reservationMondaySubitems.id, existing.id));
    }
  }

  let discoveredSubitemBoardId = params.configuredSubitemBoardId;

  // 2. Create or update desired subitems
  for (const desired of params.desiredSubitems) {
    const existing = existingByReservationItemId.get(desired.reservationItemId);

    if (!existing) {
      const created = await createMondaySubitem({
        parentItemId: params.mondayParentItemId,
        itemName: desired.name,
        columnValues: desired.columnValues,
        credentials: params.credentials,
      });

      const resolvedSubBoardId = created.subitemBoardId ?? discoveredSubitemBoardId ?? null;
      if (created.subitemBoardId && !discoveredSubitemBoardId) {
        discoveredSubitemBoardId = created.subitemBoardId;
        await db
          .update(storeMondayIntegrations)
          .set({
            subitemBoardId: created.subitemBoardId,
            updatedAt: new Date(),
          })
          .where(eq(storeMondayIntegrations.storeId, params.storeId));
      }

      const now = new Date();
      await db
        .insert(reservationMondaySubitems)
        .values({
          id: nanoid(),
          reservationId: params.reservationId,
          reservationItemId: desired.reservationItemId,
          mondayParentItemId: params.mondayParentItemId,
          mondaySubitemBoardId: resolvedSubBoardId,
          mondaySubitemId: created.id,
          itemKind: desired.itemKind,
          payloadHash: desired.payloadHash,
          createdAt: now,
          updatedAt: now,
        })
        .onDuplicateKeyUpdate({
          set: {
            mondayParentItemId: params.mondayParentItemId,
            mondaySubitemBoardId: resolvedSubBoardId,
            mondaySubitemId: created.id,
            itemKind: desired.itemKind,
            payloadHash: desired.payloadHash,
            updatedAt: now,
          },
        });
      continue;
    }

    // If subitem already exists and its payloadHash changed, update it in monday.com
    if (existing.payloadHash !== desired.payloadHash) {
      const subitemBoardId = existing.mondaySubitemBoardId || discoveredSubitemBoardId;

      if (subitemBoardId) {
        try {
          await updateMondayItemColumns({
            boardId: subitemBoardId,
            itemId: existing.mondaySubitemId,
            columnValues: {
              ...desired.columnValues,
              name: desired.name,
            },
            credentials: params.credentials,
          });

          await db
            .update(reservationMondaySubitems)
            .set({
              itemKind: desired.itemKind,
              payloadHash: desired.payloadHash,
              updatedAt: new Date(),
            })
            .where(eq(reservationMondaySubitems.id, existing.id));
          continue;
        } catch (error) {
          // If the subitem was manually deleted on the monday.com board, recreate it
          if (!(error instanceof MondayApiError && error.kind === "not_found")) {
            throw error;
          }
        }
      } else {
        // No subitemBoardId cached yet: delete and recreate to capture board.id
        await deleteMondaySubitem({
          subitemId: existing.mondaySubitemId,
          credentials: params.credentials,
        });
      }

      const recreated = await createMondaySubitem({
        parentItemId: params.mondayParentItemId,
        itemName: desired.name,
        columnValues: desired.columnValues,
        credentials: params.credentials,
      });

      const resolvedSubBoardId = recreated.subitemBoardId ?? discoveredSubitemBoardId ?? null;
      await db
        .update(reservationMondaySubitems)
        .set({
          mondayParentItemId: params.mondayParentItemId,
          mondaySubitemBoardId: resolvedSubBoardId,
          mondaySubitemId: recreated.id,
          itemKind: desired.itemKind,
          payloadHash: desired.payloadHash,
          updatedAt: new Date(),
        })
        .where(eq(reservationMondaySubitems.id, existing.id));
    }
  }
}

async function processMondayOutboxRow(
  row: {
    id: string;
    storeId: string;
    reservationId: string;
    mondayBoardId: string | null;
    mondayItemId: string | null;
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

  const built = buildMondayReservationPayload(
    reservation,
    storeConfig,
    env.NEXT_PUBLIC_APP_URL,
  );

  // Fast-path idempotency: if mondayItemId exists and payloadHash matches, skip GraphQL mutation
  if (row.mondayItemId && row.payloadHash === built.payloadHash) {
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
      await db
        .delete(reservationMondaySubitems)
        .where(eq(reservationMondaySubitems.reservationId, row.reservationId));
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

  // Reconcile subitems (equipment products & rented rooms).
  // Note: When a reservation is cancelled, we DO NOT delete the main item or its subitems
  // so warehouse staff can see what was being prepared; we only change status to "Anulowane"
  // and post an Update comment.
  if (!built.isCancelled) {
    await reconcileMondaySubitems({
      storeId: row.storeId,
      reservationId: row.reservationId,
      mondayParentItemId: mondayItemId,
      configuredSubitemBoardId: storeConfig.subitemBoardId,
      credentials,
      desiredSubitems: built.subitems,
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

      if (
        isMondayError &&
        (error.kind === "rate_limit" || error.kind === "complexity_limit")
      ) {
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
