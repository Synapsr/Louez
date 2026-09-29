"use server";

import { db, stores } from "@louez/db";
import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { notifyStoreSettingsUpdated } from "@/lib/discord/platform-notifications";
import { log } from "@/lib/evlog";
import { getCurrentStore, hasPermission } from "@/lib/store-context";

import {
  buildCompanySettingsUpdate,
  buildReservationRulesUpdate,
  type CompanySettingsInput,
  type ReservationRulesInput,
} from "./util.store-settings";

// Slug validation schema
const slugSchema = z
  .string()
  .min(3)
  .max(50)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: "slug_format_invalid",
  });

const extensionRulesSchema = z.object({
  automaticExtensions: z.boolean(),
  maxExtensionDays: z.number().int().min(1).max(365).nullable(),
});

/** Country, currency and billing address (the "Entreprise" settings page). */
export async function updateCompanySettings(data: CompanySettingsInput) {
  try {
    const store = await getCurrentStore();

    if (!store) {
      return { error: "errors.storeNotFound" };
    }

    if (!hasPermission(store.role, "manage_settings")) {
      return { error: "errors.permissionDenied" };
    }

    await db
      .update(stores)
      .set({
        settings: buildCompanySettingsUpdate(store.settings, data),
        updatedAt: new Date(),
      })
      .where(eq(stores.id, store.id));

    notifyStoreSettingsUpdated({ id: store.id, name: store.name, slug: store.slug }).catch(
      () => {},
    );

    revalidatePath("/dashboard/settings");
    revalidatePath("/dashboard");
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    log.error("settings", `Company settings update failed: ${message}`);
    return { error: "errors.updateSettingsError" };
  }
}

/** Booking mode, durations, buffers and extensions (the "Règles de réservation" page). */
export async function updateReservationRules(data: ReservationRulesInput) {
  try {
    const extensionRules = extensionRulesSchema.safeParse(data);
    if (!extensionRules.success) return { error: "errors.invalidData" };

    const store = await getCurrentStore();

    if (!store) {
      return { error: "errors.storeNotFound" };
    }

    if (!hasPermission(store.role, "manage_settings")) {
      return { error: "errors.permissionDenied" };
    }

    await db
      .update(stores)
      .set({
        settings: buildReservationRulesUpdate(store.settings, data),
        updatedAt: new Date(),
      })
      .where(eq(stores.id, store.id));

    notifyStoreSettingsUpdated({ id: store.id, name: store.name, slug: store.slug }).catch(
      () => {},
    );

    revalidatePath("/dashboard/settings/reservations");
    revalidatePath("/dashboard/settings");
    revalidatePath("/dashboard");
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    log.error("settings", `Reservation rules update failed: ${message}`);
    return { error: "errors.updateSettingsError" };
  }
}

/**
 * Check if a slug is available for the current store
 */
export async function checkSlugAvailability(slug: string): Promise<{
  available: boolean;
  error?: string;
}> {
  try {
    const store = await getCurrentStore();
    if (!store) {
      return { available: false, error: "errors.storeNotFound" };
    }

    // Validate slug format
    const result = slugSchema.safeParse(slug);
    if (!result.success) {
      return { available: false, error: "errors.slugInvalidFormat" };
    }

    // Check if slug is already taken by another store
    const existingStore = await db.query.stores.findFirst({
      where: and(eq(stores.slug, slug), ne(stores.id, store.id)),
    });

    return { available: !existingStore };
  } catch (error) {
    console.error("Error checking slug availability:", error);
    return { available: false, error: "errors.checkSlugError" };
  }
}

/**
 * Update the store slug (URL)
 */
export async function updateStoreSlug(newSlug: string): Promise<{
  success?: boolean;
  error?: string;
  newSlug?: string;
}> {
  try {
    const store = await getCurrentStore();
    if (!store) {
      return { error: "errors.storeNotFound" };
    }

    if (!hasPermission(store.role, "manage_settings")) {
      return { error: "errors.permissionDenied" };
    }

    // Validate slug format
    const result = slugSchema.safeParse(newSlug);
    if (!result.success) {
      return { error: "errors.slugInvalidFormat" };
    }

    // Check if slug is the same
    if (store.slug === newSlug) {
      return { error: "errors.slugUnchanged" };
    }

    // Check if slug is available
    const existingStore = await db.query.stores.findFirst({
      where: and(eq(stores.slug, newSlug), ne(stores.id, store.id)),
    });

    if (existingStore) {
      return { error: "errors.slugTaken" };
    }

    // Update the slug
    const oldSlug = store.slug;
    await db
      .update(stores)
      .set({
        slug: newSlug,
        updatedAt: new Date(),
      })
      .where(eq(stores.id, store.id));

    // Revalidate all relevant paths
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/settings");
    revalidatePath("/online-store");
    revalidatePath(`/${oldSlug}`);
    revalidatePath(`/${newSlug}`);

    return { success: true, newSlug };
  } catch (error) {
    console.error("Error updating store slug:", error);
    return { error: "errors.updateSlugError" };
  }
}
