"use server";

import { z } from "zod";

import { buildRateLimitKey, checkRateLimit } from "@/lib/customer-auth/rate-limit";
import { getLocaleFromCountry } from "@/lib/email/i18n";
import { sendContactMessageEmail } from "@/lib/email/send";
import { log } from "@/lib/evlog";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";
import { resolveStoreContactChannels } from "@/lib/storefront/util.store-contact";

import { buildContactMessageSchema } from "./validator.contact";

export type SendContactMessageError = "invalidData" | "unavailable" | "rateLimited" | "generic";

export type SendContactMessageResult = { ok: true } | { ok: false; error: SendContactMessageError };

const inputSchema = z.object({
  storeSlug: z.string().trim().min(1).max(255),
  values: z.unknown(),
});

/**
 * Forwards a contact form message to the store by email. Public, so it
 * checks the form is enabled for that store, validates the message against
 * the store's own rules, drops honeypot hits silently and limits bursts per
 * sender address, like the OTP flow. No IP dimension: reading `headers()`
 * from a module a client component imports makes Next treat the whole
 * contact route as uncached and refuse to prerender it.
 */
export const sendContactMessage = async (rawInput: unknown): Promise<SendContactMessageResult> => {
  const input = inputSchema.safeParse(rawInput);
  if (!input.success) return { ok: false, error: "invalidData" };

  const store = await getStoreBySlug(input.data.storeSlug);
  if (!store) return { ok: false, error: "unavailable" };

  const channels = resolveStoreContactChannels(store);
  if (!channels.form) return { ok: false, error: "unavailable" };

  const parsed = buildContactMessageSchema(channels.form.phoneField).safeParse(input.data.values);
  if (!parsed.success) return { ok: false, error: "invalidData" };

  const values = parsed.data;

  // A filled honeypot is a bot: pretend it worked so it learns nothing.
  if (values.website !== "") return { ok: true };

  const decision = checkRateLimit("contact", buildRateLimitKey(store.id, values.email));
  if (!decision.allowed) {
    return { ok: false, error: "rateLimited" };
  }

  try {
    await sendContactMessageEmail({
      to: channels.form.recipient,
      storeId: store.id,
      storeName: store.name,
      primaryColor: store.theme?.primaryColor,
      senderName: `${values.firstName} ${values.lastName}`,
      senderEmail: values.email,
      senderPhone: values.phone === "" ? null : values.phone,
      message: values.message,
      locale: getLocaleFromCountry(store.settings?.country),
    });
    return { ok: true };
  } catch (error) {
    log.error(
      "storefront-contact",
      `send failed for store ${store.id}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { ok: false, error: "generic" };
  }
};
