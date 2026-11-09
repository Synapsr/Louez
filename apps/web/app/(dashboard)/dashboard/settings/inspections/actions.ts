"use server";

import { db, mergeStoreRow } from "@louez/db";
import { getCurrentStore, hasPermission } from "@/lib/store-context";
import { inspectionSettingsSchema } from "@louez/validations";
import { revalidatePath } from "next/cache";
import type { InspectionSettings, StoreSettings } from "@louez/types";

type InspectionSettingsInput = {
  enabled: boolean;
  mode: "optional" | "recommended" | "required";
  requireCustomerSignature: boolean;
  autoGeneratePdf: boolean;
  maxPhotosPerItem: number;
};

export async function updateInspectionSettings(
  data: InspectionSettingsInput,
): Promise<{ success?: boolean; error?: string }> {
  const store = await getCurrentStore();

  if (!store) {
    return { error: "errors.unauthorized" };
  }

  if (!hasPermission(store.role, "manage_settings")) {
    return { error: "errors.permissionDenied" };
  }

  const validated = inspectionSettingsSchema.safeParse(data);

  if (!validated.success) {
    return { error: "errors.invalidData" };
  }

  // Build inspection settings object
  const inspectionSettings: InspectionSettings = {
    enabled: validated.data.enabled,
    mode: validated.data.mode,
    requireCustomerSignature: validated.data.requireCustomerSignature,
    autoGeneratePdf: validated.data.autoGeneratePdf,
    maxPhotosPerItem: validated.data.maxPhotosPerItem,
  };

  // Merged into the settings as stored now, under the store's lock: a section
  // saved meanwhile is kept.
  await mergeStoreRow(db, store.id, ({ settings }) => {
    const currentSettings: StoreSettings = settings || {
      reservationMode: "request",
      minRentalMinutes: 60,
      maxRentalMinutes: null,
      advanceNoticeMinutes: 1440,
      turnoverBufferMinutes: 0,
    };
    return { set: { settings: { ...currentSettings, inspection: inspectionSettings } } };
  });

  revalidatePath("/dashboard/settings/inspections");

  return { success: true };
}
