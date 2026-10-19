/**
 * Values prefilled on a new Stripe Connect account from what the store
 * already knows. Kept free of the Stripe client so they can be unit-tested.
 */

import { stripHtml } from "@/lib/util.seo-text";

// MCC 7394: "Equipment, Tool, Furniture, and Appliance Rental and Leasing" —
// the closest generic industry code for a rental business. Prefilled on the
// connected account so the hosted KYC's Industry dropdown starts on it; the
// merchant can still pick a more specific vertical in the Stripe form.
export const RENTAL_MCC = "7394";

/**
 * Normalize a store name into a valid Stripe statement descriptor: what the
 * end customer sees on their card statement. Stripe requires 5–22 characters,
 * at least one letter, no `<>\'"*`. Returns undefined when the name can't
 * make a valid descriptor (better to let the merchant type one in the KYC).
 */
export function toStatementDescriptor(name: string): string | undefined {
  const normalized = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[<>\\'"*]/g, "")
    .replace(/[^\x20-\x7e]/g, "") // Stripe only accepts printable ASCII
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .slice(0, 22)
    .trim();

  if (normalized.length < 5 || !/[a-zA-Z]/.test(normalized)) {
    return undefined;
  }
  return normalized;
}

/**
 * Turn the store description (rich-text editor HTML) into the plain text
 * Stripe accepts as `business_profile.product_description`: Stripe rejects
 * the whole account creation when the value contains HTML tags. `&amp;` is
 * decoded so "Sono & Lumière" reads right in the KYC; `&lt;`/`&gt;` stay
 * encoded so decoding can never rebuild a tag.
 */
export function toProductDescription(html: string | null | undefined): string | undefined {
  const text = html ? stripHtml(html).replace(/&amp;/g, "&").slice(0, 500).trim() : "";
  return text || undefined;
}
