"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db, reservationItems, reservations } from "@louez/db";
import { markReservationForCalendarSync } from "@louez/api/services";
import { extractExclusiveFromInclusive } from "@louez/utils";
import { getCurrentStore, hasPermission } from "@/lib/store-context";

const settlePriceInput = z.object({
  reservationId: z.string().length(21),
  itemId: z.string().length(21),
  unitPrice: z.number().finite().min(0).max(1_000_000),
});

const money = (amount: number) => (Math.round((amount + Number.EPSILON) * 100) / 100).toFixed(2);

export async function settleNegotiableReservationItemPrice(input: {
  reservationId: string;
  itemId: string;
  unitPrice: number;
}) {
  const parsed = settlePriceInput.safeParse(input);
  if (!parsed.success) return { error: "errors.invalidData" };

  const store = await getCurrentStore();
  if (!store || !hasPermission(store.role, "write")) return { error: "errors.unauthorized" };

  const result = await db.transaction(async (tx) => {
    const [reservation] = await tx
      .select({
        id: reservations.id,
        subtotalAmount: reservations.subtotalAmount,
        totalAmount: reservations.totalAmount,
        subtotalExclTax: reservations.subtotalExclTax,
        taxAmount: reservations.taxAmount,
        status: reservations.status,
      })
      .from(reservations)
      .where(
        and(eq(reservations.id, parsed.data.reservationId), eq(reservations.storeId, store.id)),
      )
      .for("update");
    if (!reservation || (reservation.status !== "pending" && reservation.status !== "quote")) {
      return { error: "errors.reservationNotFound" } as const;
    }

    const [item] = await tx
      .select({
        id: reservationItems.id,
        quantity: reservationItems.quantity,
        totalPrice: reservationItems.totalPrice,
        taxRate: reservationItems.taxRate,
        pricePending: reservationItems.pricePending,
      })
      .from(reservationItems)
      .where(
        and(
          eq(reservationItems.id, parsed.data.itemId),
          eq(reservationItems.reservationId, reservation.id),
        ),
      )
      .for("update");
    if (!item?.pricePending) return { error: "errors.invalidData" } as const;

    const agreedUnitPrice = Number(money(parsed.data.unitPrice));
    const totalPrice = Number(money(agreedUnitPrice * item.quantity));
    const delta = totalPrice - Number(item.totalPrice);
    const taxRate = item.taxRate === null ? null : Number(item.taxRate);
    const displayMode = store.settings?.tax?.displayMode ?? "inclusive";
    const taxEnabled = taxRate !== null && Number.isFinite(taxRate);
    const totalExclTax =
      taxEnabled && displayMode === "inclusive"
        ? extractExclusiveFromInclusive(totalPrice, taxRate)
        : totalPrice;
    const unitPriceExclTax =
      taxEnabled && displayMode === "inclusive"
        ? extractExclusiveFromInclusive(agreedUnitPrice, taxRate)
        : agreedUnitPrice;
    const lineTax = taxEnabled
      ? displayMode === "inclusive"
        ? Number(money(totalPrice - totalExclTax))
        : Number(money((totalPrice * taxRate) / 100))
      : null;
    const taxDelta = lineTax ?? 0;

    await tx
      .update(reservationItems)
      .set({
        unitPrice: money(agreedUnitPrice),
        totalPrice: money(totalPrice),
        pricePending: false,
        taxAmount: lineTax === null ? null : money(lineTax),
        priceExclTax: taxEnabled ? money(unitPriceExclTax) : null,
        totalExclTax: taxEnabled ? money(totalExclTax) : null,
      })
      .where(eq(reservationItems.id, item.id));

    await tx
      .update(reservations)
      .set({
        subtotalAmount: money(Number(reservation.subtotalAmount) + delta),
        totalAmount: money(
          Number(reservation.totalAmount) +
            delta +
            (taxEnabled && displayMode === "exclusive" ? taxDelta : 0),
        ),
        ...(reservation.subtotalExclTax !== null && taxEnabled
          ? {
              subtotalExclTax: money(
                Number(reservation.subtotalExclTax) + totalExclTax - Number(item.totalPrice),
              ),
            }
          : {}),
        ...(reservation.taxAmount !== null && taxEnabled
          ? { taxAmount: money(Number(reservation.taxAmount) + taxDelta) }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(reservations.id, reservation.id));

    return { success: true } as const;
  });

  if ("error" in result) return result;
  await markReservationForCalendarSync(store.id, parsed.data.reservationId);
  revalidatePath("/dashboard/reservations");
  revalidatePath(`/dashboard/reservations/${parsed.data.reservationId}`);
  return result;
}
