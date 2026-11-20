import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  db,
  reservationCalendarEvents,
  reservationMondayItems,
  storeCalendarIntegrations,
  storeIntegrations,
  storeMondayIntegrations,
} from "@louez/db";

export async function markReservationForMondaySync(
  storeId: string,
  reservationId: string,
): Promise<void> {
  const [storeMonday] = await db
    .select({
      enabled: storeMondayIntegrations.enabled,
      boardId: storeMondayIntegrations.boardId,
    })
    .from(storeMondayIntegrations)
    .where(eq(storeMondayIntegrations.storeId, storeId))
    .limit(1);

  const envEnabled = process.env.MONDAY_ENABLED === "true" && Boolean(process.env.MONDAY_BOARD_ID);
  const isEnabled = storeMonday ? storeMonday.enabled : envEnabled;
  const boardId = storeMonday?.boardId?.trim() || process.env.MONDAY_BOARD_ID?.trim() || null;

  if (!isEnabled || !boardId) {
    return;
  }

  const now = new Date();
  await db
    .insert(reservationMondayItems)
    .values({
      id: nanoid(),
      storeId,
      reservationId,
      mondayBoardId: boardId,
      syncStatus: "pending",
      attemptCount: 0,
      nextAttemptAt: now,
      updatedAt: now,
    })
    .onDuplicateKeyUpdate({
      set: {
        syncStatus: "pending",
        attemptCount: 0,
        nextAttemptAt: now,
        lastError: null,
        updatedAt: now,
      },
    });
}

export async function markReservationForCalendarSync(
  storeId: string,
  reservationId: string,
  options?: { skipMondaySync?: boolean },
): Promise<void> {
  if (!options?.skipMondaySync) {
    await markReservationForMondaySync(storeId, reservationId);
  }

  const integrations = await db
    .select({ integrationId: storeIntegrations.id })
    .from(storeIntegrations)
    .innerJoin(
      storeCalendarIntegrations,
      eq(storeCalendarIntegrations.integrationId, storeIntegrations.id),
    )
    .where(
      and(
        eq(storeIntegrations.storeId, storeId),
        eq(storeIntegrations.category, "calendar"),
        eq(storeIntegrations.enabled, true),
        inArray(storeIntegrations.status, ["active", "error", "syncing"]),
        eq(storeIntegrations.providerKey, "google-calendar"),
      ),
    );

  for (const integration of integrations) {
    const now = new Date();
    await db
      .insert(reservationCalendarEvents)
      .values({
        id: nanoid(),
        reservationId,
        integrationId: integration.integrationId,
        syncStatus: "pending",
        attemptCount: 0,
        nextAttemptAt: now,
        updatedAt: now,
      })
      .onDuplicateKeyUpdate({
        set: {
          syncStatus: "pending",
          attemptCount: 0,
          nextAttemptAt: now,
          lastError: null,
          updatedAt: now,
        },
      });
  }
}
