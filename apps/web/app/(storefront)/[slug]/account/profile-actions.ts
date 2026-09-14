"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { customers, db } from "@louez/db";
import { getCustomerSessionBySlug } from "@/lib/customer-auth/session";
import {
  customerProfileSchema,
  createCustomerProfileSchema,
} from "@/lib/customer-auth/validator.customer-profile";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";
import { log } from "@/lib/evlog";

export const updateCustomerProfile = async (
  input: unknown,
): Promise<{ ok: true } | { ok: false }> => {
  const parsed = z
    .object({ storeSlug: z.string().trim().min(1).max(255), profile: customerProfileSchema })
    .safeParse(input);
  if (!parsed.success) return { ok: false };
  const { storeSlug, profile } = parsed.data;
  const session = await getCustomerSessionBySlug(storeSlug);
  if (!session) return { ok: false };
  const store = await getStoreBySlug(storeSlug);
  if (
    !store ||
    !createCustomerProfileSchema(store.settings?.country ?? "FR").safeParse(profile).success
  )
    return { ok: false };
  const { isBusinessCustomer, ...fields } = profile;
  try {
    await db
      .update(customers)
      .set({
        ...fields,
        customerType: isBusinessCustomer ? "business" : "individual",
        updatedAt: new Date(),
      })
      .where(
        and(eq(customers.id, session.customerId), eq(customers.storeId, session.customer.storeId)),
      );
    revalidatePath("/(storefront)/[slug]", "layout");
    return { ok: true };
  } catch (error) {
    log.error("customer-profile", error instanceof Error ? error.message : "Profile update failed");
    return { ok: false };
  }
};
