import { notFound, redirect } from "next/navigation";

import { PartnerDetail } from "@/components/dashboard/partners/partner-detail";
import { serverApi } from "@/lib/api/server-api";
import { getCurrentStore } from "@/lib/store-context";
import { getStorefrontUrl } from "@/lib/storefront-url";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/** A partner: its link and poster, and its monthly statement. */
export default async function PartnerPage({ params }: { params: Promise<{ partnerId: string }> }) {
  const store = await getCurrentStore();
  if (!store) redirect("/onboarding");

  const { partnerId } = await params;
  const api = await serverApi();
  const statement = await api.partners.getStatement({ partnerId }).catch(() => null);
  if (!statement) notFound();

  return (
    <PartnerDetail
      storeId={store.id}
      storeName={store.name}
      storeUrl={getStorefrontUrl(store.slug, "/")}
      initialStatement={statement}
      accentColor={store.theme?.primaryColor ?? null}
      logoUrl={store.logoUrl}
    />
  );
}
