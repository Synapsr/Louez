"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { customerCommunicationPreferences, db } from "@louez/db";
import { getCustomerSessionBySlug } from "@/lib/customer-auth/session";
import { log } from "@/lib/evlog";

export const updateCommunicationPreferences = async (input: unknown): Promise<{ ok: boolean }> => {
  const parsed = z
    .object({
      storeSlug: z.string().trim().min(1).max(255),
      emailReminders: z.boolean(),
      smsReminders: z.boolean(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false };
  const { storeSlug, ...preferences } = parsed.data;
  const session = await getCustomerSessionBySlug(storeSlug);
  if (!session) return { ok: false };
  try {
    await db
      .insert(customerCommunicationPreferences)
      .values({
        storeId: session.customer.storeId,
        customerId: session.customerId,
        ...preferences,
      })
      .onDuplicateKeyUpdate({ set: { ...preferences, updatedAt: new Date() } });
    revalidatePath("/(storefront)/[slug]/account/profile", "page");
    return { ok: true };
  } catch (error) {
    log.error(
      "customer-communications",
      error instanceof Error ? error.message : "Preferences update failed",
    );
    return { ok: false };
  }
};
