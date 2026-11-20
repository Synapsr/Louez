import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  db,
  reservationCalendarEvents,
  storeCalendarIntegrations,
  storeIntegrations,
} from "@louez/db";

export async function markReservationForCalendarSync(
  storeId: string,
  reservationId: string,
): Promise<void> {
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
