import { and, count, eq, sql } from "drizzle-orm";

import { db, products, reservations } from "@louez/db";

/**
 * Whether the setup list shows the "activate online payments" step: hidden for
 * stores that chose request mode, otherwise tracks Stripe chargeability (the
 * KYC can be left pending during onboarding — payment mode silently degrades
 * to request mode until it's done).
 */
export type OnlinePaymentsStep = "hidden" | "todo" | "done";

/** The counts the setup list needs, and nothing more: it runs on every page. */
export interface SetupProgressCounts {
  activeProductCount: number;
  totalReservations: number;
  completedReservations: number;
}

export async function getSetupProgressCounts(storeId: string): Promise<SetupProgressCounts> {
  const [productRows, reservationRows] = await Promise.all([
    db
      .select({ active: count() })
      .from(products)
      .where(and(eq(products.storeId, storeId), eq(products.status, "active"))),
    db
      .select({
        total: count(),
        completed: sql<number>`SUM(CASE WHEN ${reservations.status} = 'completed' THEN 1 ELSE 0 END)`,
      })
      .from(reservations)
      .where(eq(reservations.storeId, storeId)),
  ]);

  return {
    activeProductCount: productRows[0]?.active ?? 0,
    totalReservations: reservationRows[0]?.total ?? 0,
    completedReservations: Number(reservationRows[0]?.completed) || 0,
  };
}
