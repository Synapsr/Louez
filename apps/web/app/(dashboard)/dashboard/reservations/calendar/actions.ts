"use server";

import { db, stores } from "@louez/db";
import { getGoogleCalendarIntegrationForStore } from "@/lib/integrations/calendar/state";
import { getCurrentStore } from "@/lib/store-context";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

export async function generateIcsToken() {
  const store = await getCurrentStore();

  if (!store) {
    return { error: "errors.unauthorized" };
  }

  // Generate a new 32-character token
  const token = nanoid(32);

  await db
    .update(stores)
    .set({
      icsToken: token,
      updatedAt: new Date(),
    })
    .where(eq(stores.id, store.id));

  return { success: true, token };
}

export async function getIcsToken() {
  const store = await getCurrentStore();

  if (!store) {
    return { error: "errors.unauthorized" };
  }

  // Return existing token or generate one if it doesn't exist
  if (store.icsToken) {
    return { success: true, token: store.icsToken };
  }

  // Generate and save a new token
  return generateIcsToken();
}

export async function regenerateIcsToken() {
  // Simply generate a new token, which invalidates the old one
  return generateIcsToken();
}

/**
 * Everything the sync-calendar dialog needs in a single round trip: the ICS
 * token (created on the fly the first time) and whether Google Calendar is
 * already connected, so the dialog can offer "connect" or "manage".
 */
export async function getCalendarSyncState(): Promise<
  { success: true; token: string; googleConnected: boolean } | { error: string }
> {
  const store = await getCurrentStore();

  if (!store) {
    return { error: "errors.unauthorized" };
  }

  const [tokenResult, googleIntegration] = await Promise.all([
    getIcsToken(),
    getGoogleCalendarIntegrationForStore(store.id),
  ]);

  if ("error" in tokenResult || !tokenResult.token) {
    return { error: "errors.generic" };
  }

  return {
    success: true,
    token: tokenResult.token,
    googleConnected: Boolean(googleIntegration?.credentials?.refreshTokenEncrypted),
  };
}
