import { redirect } from "next/navigation";

import { PartnersOverview } from "@/components/dashboard/partners/partners-overview";
import { serverApi } from "@/lib/api/server-api";
import { getCurrentStore } from "@/lib/store-context";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/** « Partenaires »: the store's local partners and what it owes them this month. */
export default async function PartnersPage() {
  const store = await getCurrentStore();
  if (!store) redirect("/onboarding");

  const api = await serverApi();
  const list = await api.partners.list({});

  return <PartnersOverview storeId={store.id} initialList={list} />;
}
