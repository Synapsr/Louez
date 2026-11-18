"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db, reservations } from "@louez/db";

import {
  createReservationInstantAccessUrl,
  INSTANT_ACCESS_SHORT_TTL_MS,
} from "@/lib/customer-auth/instant-access";
import { log } from "@/lib/evlog";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";
import { simulateTestReservationPayment } from "@/lib/test-reservations/simulate-payment";
import {
  getStorefrontTestMode,
  isOwnTestReservation,
} from "@/lib/test-reservations/storefront-test-mode";

const inputSchema = z.object({
  slug: z.string().trim().min(1).max(64),
  reservationId: z.string().trim().min(1).max(64),
});

export type SimulateTestPaymentResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * The button of the simulated payment page (lib/test-reservations): only in this
 * browser's test mode, only for the store's test reservation that this member
 * started. A pending one is paid and confirmed (`simulateTestReservationPayment`,
 * once, whatever the clicks; busy while another call pays it); then the owner
 * lands on it signed in, without a code, as a paying customer does.
 */
export async function simulateTestPayment(input: unknown): Promise<SimulateTestPaymentResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const { slug, reservationId } = parsed.data;

  try {
    const store = await getStoreBySlug(slug);
    if (!store) return { ok: false, error: "errors.storeNotFound" };
    const testMode = await getStorefrontTestMode(store.id);
    if (!testMode) return { ok: false, error: "errors.testModeRequired" };
    const reservation = await db.query.reservations.findFirst({
      where: and(
        eq(reservations.id, reservationId),
        eq(reservations.storeId, store.id),
        eq(reservations.isTest, true),
      ),
      columns: { id: true, status: true },
      with: { customer: { columns: { email: true } } },
    });
    // Only the member who started it: nothing paid, no link, before any write.
    if (!reservation || !isOwnTestReservation(testMode, reservation.customer.email)) {
      return { ok: false, error: "errors.reservationNotFound" };
    }

    const paid =
      reservation.status === "pending"
        ? await simulateTestReservationPayment({ storeId: store.id, reservationId })
        : null;
    if (paid && !paid.ok && paid.error === "not_found") {
      return { ok: false, error: "errors.reservationNotFound" };
    }
    // Another call is paying it right now: the owner tries again in a moment.
    if (paid && !paid.ok && paid.error === "busy") {
      return { ok: false, error: "errors.testPaymentBusy" };
    }

    const url = await createReservationInstantAccessUrl({
      storeId: store.id,
      storeSlug: store.slug,
      customerEmail: reservation.customer.email,
      reservationId,
      ttlMs: INSTANT_ACCESS_SHORT_TTL_MS,
      redirectPath:
        paid?.ok === true
          ? `/account/reservations/${reservationId}?event=payment_received`
          : `/account/reservations/${reservationId}`,
    });
    return { ok: true, url };
  } catch (error) {
    log.error(
      "test-reservations",
      `simulated payment failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { ok: false, error: "errors.generic" };
  }
}
