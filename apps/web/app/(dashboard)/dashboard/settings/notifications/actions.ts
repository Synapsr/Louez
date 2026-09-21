"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@louez/db";
import { stores } from "@louez/db";
import { getCurrentStore, hasPermission } from "@/lib/store-context";
import { validateDiscordWebhook, sendTestDiscordNotification } from "@/lib/discord/client";
import { discordWebhookSchema } from "@louez/validations";
import { getSmsQuotaStatus } from "@/lib/plan-limits";
import { notifyNotificationSettingsUpdated } from "@/lib/discord/platform-notifications";
import { validateAndNormalizePhone } from "@/lib/sms/phone";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS,
} from "@louez/types";
import { getLocaleFromCountry, type EmailLocale } from "@/lib/email/i18n";

// Language name mapping for display
const LANGUAGE_NAMES: Record<EmailLocale, string> = {
  fr: "Francais",
  en: "English",
  de: "Deutsch",
  es: "Espanol",
  it: "Italiano",
  nl: "Nederlands",
  pl: "Polski",
  pt: "Portugues",
};

export async function getNotificationSettings() {
  const store = await getCurrentStore();
  if (!store) return { error: "errors.unauthorized" };

  const smsQuota = await getSmsQuotaStatus(store.id);

  // Determine locale from store country
  const locale = getLocaleFromCountry(store.settings?.country);
  const languageName = LANGUAGE_NAMES[locale];

  return {
    // Admin notification settings — merge over defaults so stores saved before
    // newer event types (e.g. admin reminders) still expose every key.
    settings: { ...DEFAULT_NOTIFICATION_SETTINGS, ...store.notificationSettings },
    discordWebhookUrl: store.discordWebhookUrl,
    ownerPhone: store.ownerPhone,
    smsQuota: {
      current: smsQuota.current,
      limit: smsQuota.planLimit,
      prepaidBalance: smsQuota.prepaidBalance,
      allowed: smsQuota.allowed,
      totalAvailable: smsQuota.totalAvailable,
    },
    // Customer notification settings
    customerSettings: store.customerNotificationSettings || DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS,
    storeLocale: locale,
    storeLanguageName: languageName,
  };
}

export async function updateDiscordWebhook(webhookUrl: string | null) {
  const store = await getCurrentStore();
  if (!store) return { error: "errors.unauthorized" };

  if (!hasPermission(store.role, "manage_settings")) {
    return { error: "errors.permissionDenied" };
  }

  // Allow null/empty to disconnect
  if (!webhookUrl || webhookUrl.trim() === "") {
    await db
      .update(stores)
      .set({
        discordWebhookUrl: null,
        updatedAt: new Date(),
      })
      .where(eq(stores.id, store.id));

    notifyNotificationSettingsUpdated({ id: store.id, name: store.name, slug: store.slug }).catch(
      () => {},
    );

    revalidatePath("/dashboard/settings/notifications");
    return { success: true };
  }

  // Validate format
  const validated = discordWebhookSchema.safeParse({ webhookUrl });
  if (!validated.success) {
    return { error: "errors.invalidWebhookUrl" };
  }

  // Validate webhook is actually reachable
  const isValid = await validateDiscordWebhook(webhookUrl);
  if (!isValid) {
    return { error: "errors.discordWebhookInvalid" };
  }

  await db
    .update(stores)
    .set({
      discordWebhookUrl: webhookUrl,
      updatedAt: new Date(),
    })
    .where(eq(stores.id, store.id));

  notifyNotificationSettingsUpdated({ id: store.id, name: store.name, slug: store.slug }).catch(
    () => {},
  );

  revalidatePath("/dashboard/settings/notifications");
  return { success: true };
}

export async function testDiscordWebhook() {
  const store = await getCurrentStore();
  if (!store) return { error: "errors.unauthorized" };

  if (!hasPermission(store.role, "manage_settings")) {
    return { error: "errors.permissionDenied" };
  }
  if (!store.discordWebhookUrl) return { error: "errors.noDiscordWebhook" };

  const result = await sendTestDiscordNotification(store.discordWebhookUrl, store.name);

  if (!result.success) {
    return { error: result.error || "errors.discordTestFailed" };
  }

  return { success: true };
}

export async function updateOwnerPhone(phone: string | null) {
  const store = await getCurrentStore();
  if (!store) return { error: "errors.unauthorized" };

  if (!hasPermission(store.role, "manage_settings")) {
    return { error: "errors.permissionDenied" };
  }

  // Allow null/empty to remove
  if (!phone || phone.trim() === "") {
    await db
      .update(stores)
      .set({
        ownerPhone: null,
        updatedAt: new Date(),
      })
      .where(eq(stores.id, store.id));

    notifyNotificationSettingsUpdated({ id: store.id, name: store.name, slug: store.slug }).catch(
      () => {},
    );

    revalidatePath("/dashboard/settings/notifications");
    return { success: true, phone: null };
  }

  // Validate and normalize to E.164 format
  const phoneResult = validateAndNormalizePhone(phone);
  if (!phoneResult.valid || !phoneResult.normalized) {
    return { error: "errors.invalidPhoneNumber" };
  }

  const normalizedPhone = phoneResult.normalized;

  await db
    .update(stores)
    .set({
      ownerPhone: normalizedPhone,
      updatedAt: new Date(),
    })
    .where(eq(stores.id, store.id));

  notifyNotificationSettingsUpdated({ id: store.id, name: store.name, slug: store.slug }).catch(
    () => {},
  );

  revalidatePath("/dashboard/settings/notifications");
  return { success: true, phone: normalizedPhone };
}
