import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { db, storeLocations } from "@louez/db";
import { getCurrentStore } from "@/lib/store-context";
import { DeliverySettingsContent } from "./delivery-settings-content";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export default async function DeliverySettingsPage() {
  const store = await getCurrentStore();

  if (!store) {
    redirect("/onboarding");
  }

  // Check if store has coordinates configured
  const hasCoordinates = Boolean(store.latitude && store.longitude);
  const locations = await db.query.storeLocations.findMany({
    where: eq(storeLocations.storeId, store.id),
    orderBy: (fields, { desc, asc }) => [desc(fields.isActive), asc(fields.createdAt)],
  });

  return (
    <DeliverySettingsContent store={store} hasCoordinates={hasCoordinates} locations={locations} />
  );
}
