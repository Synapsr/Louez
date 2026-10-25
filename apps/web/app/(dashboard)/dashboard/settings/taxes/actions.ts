"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db, markStoreReservations, stores } from "@louez/db";
import { beforeTaxRateBps } from "@/lib/billing-sync/money";
import { getCurrentStore, hasPermission } from "@/lib/store-context";
import type { TaxSettings } from "@louez/types";

const taxSettingsSchema = z.object({
  enabled: z.boolean(),
  defaultRate: z.number().min(0).max(100),
  displayMode: z.enum(["inclusive", "exclusive"]),
  taxLabel: z.string().max(20).optional(),
  taxNumber: z.string().max(30).optional(),
});

type TaxSettingsInput = z.infer<typeof taxSettingsSchema>;

export async function updateTaxSettings(data: TaxSettingsInput) {
  const store = await getCurrentStore();
  if (!store) {
    return { error: "errors.unauthorized" };
  }

  if (!hasPermission(store.role, "manage_settings")) {
    return { error: "errors.permissionDenied" };
  }

  const validated = taxSettingsSchema.safeParse(data);
  if (!validated.success) {
    return { error: "errors.invalidData" };
  }

  const taxSettings: TaxSettings = {
    enabled: validated.data.enabled,
    defaultRate: validated.data.defaultRate,
    displayMode: validated.data.displayMode,
    taxLabel: validated.data.taxLabel || undefined,
    taxNumber: validated.data.taxNumber || undefined,
  };

  const currentSettings = store.settings || {
    reservationMode: "payment" as const,
    minRentalMinutes: 60,
    maxRentalMinutes: null,
    advanceNoticeMinutes: 1440,
    turnoverBufferMinutes: 0,
  };

  // The billing snapshot total of a reservation written from the dashboard follows
  // the store's tax settings (contract Q6), so a change of the rate that applies
  // marks every reservation of the store.
  await db.transaction(async (tx) => {
    const [stored] = await tx
      .select({ settings: stores.settings })
      .from(stores)
      .where(eq(stores.id, store.id))
      .for("update");
    await tx
      .update(stores)
      .set({
        settings: {
          ...currentSettings,
          tax: taxSettings,
        },
        updatedAt: new Date(),
      })
      .where(eq(stores.id, store.id));
    if (beforeTaxRateBps(stored?.settings?.tax) !== beforeTaxRateBps(taxSettings)) {
      await markStoreReservations(tx, store.id);
    }
  });

  revalidatePath("/dashboard/settings/taxes");
  revalidatePath("/dashboard/products", "layout");
  return { success: true };
}
