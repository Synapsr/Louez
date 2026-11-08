"use server";

import { db, markStore, stores } from "@louez/db";
import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentStore, hasPermission } from "@/lib/store-context";

// Slug validation schema
const slugSchema = z
  .string()
  .min(3)
  .max(50)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: "slug_format_invalid",
  });

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
    await db.transaction(async (tx) => {
      await tx
        .update(stores)
        .set({
          slug: newSlug,
          updatedAt: new Date(),
        })
        .where(eq(stores.id, store.id));
      await markStore(tx, store.id);
    });

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
