import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { db } from "@louez/db";
import { promoCodes } from "@louez/db";
import { getCurrentStore } from "@/lib/store-context";
import { PromoCodesSettingsContent } from "./promo-codes-settings-content";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export default async function PromoCodesSettingsPage() {
  const store = await getCurrentStore();

  if (!store) {
    redirect("/onboarding");
  }

  const currency = store.settings?.currency || "EUR";

  const codes = await db.query.promoCodes.findMany({
    where: eq(promoCodes.storeId, store.id),
    orderBy: (promoCodes, { desc }) => [desc(promoCodes.createdAt)],
  });

  return (
    <PromoCodesSettingsContent codes={codes} currency={currency} />
  );
}
