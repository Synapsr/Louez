"use server";

import { getLocale } from "next-intl/server";
import { z } from "zod";

import { env } from "@/env";
import { auth } from "@/lib/auth";
import { getBillingAccess } from "@/lib/billing/billing-access";
import { BILLING_CARD_STEP_PATH, BILLING_SETTINGS_PATH } from "@/lib/billing/billing-routes";
import {
  type BillingDetailsField,
  type BillingDetailsForm,
  saveBillingDetails,
  startCardSetup,
} from "@/lib/billing-sync/pages";
import { isCurrentUserPlatformAdmin } from "@/lib/platform-admin";
import { getCurrentStore } from "@/lib/store-context";

// The billing pages' two changes (louez-billing docs/api, README §10): the billing
// details, and Stripe Checkout for the card. Only the owner of the active store, when
// the service bills it, makes them (billing-access.ts); a platform admin only reads.

export type BillingActionError =
  | { readonly error: "forbidden" | "unavailable" | "failed" }
  | { readonly error: "invalid"; readonly fields: readonly BillingDetailsField[] };

/** The owner's user and the active store's id, or null for anyone else. */
async function ownerOfActiveStore() {
  const [session, store, isPlatformAdmin] = await Promise.all([
    auth(),
    getCurrentStore(),
    isCurrentUserPlatformAdmin(),
  ]);
  const userId = session?.user?.id;
  if (!userId || !store) return null;
  const access = await getBillingAccess(store, isPlatformAdmin);
  return access?.role === "owner" ? { userId, storeId: store.id } : null;
}

const text = z.string().max(1000);
const detailsForm = z
  .object({
    legalName: text,
    email: text,
    line1: text,
    line2: text,
    postalCode: text,
    city: text,
    state: text,
    country: text,
    vatNumber: text,
  })
  .strict() satisfies z.ZodType<BillingDetailsForm>;

/** Puts the details on the store's platform customer; the service checks each field. */
export async function saveBillingDetailsAction(
  form: BillingDetailsForm,
): Promise<{ readonly ok: true } | BillingActionError> {
  const owner = await ownerOfActiveStore();
  if (!owner) return { error: "forbidden" };
  const parsed = detailsForm.safeParse(form);
  if (!parsed.success) return { error: "failed" };
  const saved = await saveBillingDetails(owner.storeId, owner.userId, parsed.data);
  if (saved.ok) return { ok: true };
  if (saved.reason === "invalid") return { error: "invalid", fields: saved.fields };
  return { error: saved.reason === "failed" ? "failed" : "unavailable" };
}

/**
 * Stripe Checkout in setup mode for the store's card. It comes back to the page that
 * opened it, which saves the card (lib/billing/card-return.ts).
 */
export async function startBillingCardSetup(
  from: "settings" | "onboarding",
): Promise<{ readonly url: string } | BillingActionError> {
  const owner = await ownerOfActiveStore();
  if (!owner) return { error: "forbidden" };
  const path = from === "onboarding" ? BILLING_CARD_STEP_PATH : BILLING_SETTINGS_PATH;
  const started = await startCardSetup(owner.storeId, {
    userId: owner.userId,
    locale: await getLocale(),
    returnUrl: `${env.NEXT_PUBLIC_APP_URL}${path}`,
  });
  if (started.ok) return { url: started.value.url };
  return { error: started.reason === "failed" ? "failed" : "unavailable" };
}
