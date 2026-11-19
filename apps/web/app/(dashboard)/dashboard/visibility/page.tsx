import Link from "next/link";
import { redirect } from "next/navigation";

import { and, asc, desc, eq } from "drizzle-orm";
import { Megaphone } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { db, products } from "@louez/db";
import { Button, Card } from "@louez/ui";

import { DashboardEmptyState } from "@/components/dashboard/shared/dashboard-empty-state";
import { VisibilityGuide } from "@/components/dashboard/visibility/visibility-guide";
import { env } from "@/env";
import { canUseAiVisibility } from "@/lib/ai-visibility/entitlement";
import { serverApi } from "@/lib/api/server-api";
import { getProductPath } from "@/lib/seo";
import { getCurrentStore } from "@/lib/store-context";
import { getStorefrontUrl } from "@/lib/storefront-url";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/** Enough for the share tool's product list; past that a loueur shares the store. */
const SHAREABLE_PRODUCTS_LIMIT = 50;

/** "Se faire connaître": the actions that bring a new store its first customers. */
export default async function VisibilityPage() {
  const store = await getCurrentStore();
  if (!store) redirect("/onboarding");

  const t = await getTranslations("dashboard.visibility");
  const api = await serverApi();
  const aiIncluded = await canUseAiVisibility(store);
  const [checklist, view, aiView, activeProducts] = await Promise.all([
    api.stores.getLaunchChecklist({}),
    api.visibility.get({}),
    aiIncluded ? api.visibility.getAi({}) : null,
    db.query.products.findMany({
      columns: { id: true, name: true, slug: true },
      where: and(eq(products.storeId, store.id), eq(products.status, "active")),
      orderBy: [asc(products.displayOrder), desc(products.createdAt)],
      limit: SHAREABLE_PRODUCTS_LIMIT,
    }),
  ]);

  // Sharing a store nobody can book wastes its first impression.
  if (!checklist.online || !checklist.catalog.hasActiveProduct) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <Card className="items-center pb-8">
          <DashboardEmptyState
            icon={Megaphone}
            title={t("notReady.title")}
            description={t("notReady.description")}
          />
          <Button render={<Link href="/dashboard" />}>{t("notReady.action")}</Button>
        </Card>
      </div>
    );
  }

  return (
    <VisibilityGuide
      storeId={store.id}
      storeName={store.name}
      storeSlug={store.slug}
      storeUrl={getStorefrontUrl(store.slug, "/")}
      products={activeProducts.map((product) => ({
        id: product.id,
        name: product.name,
        url: getStorefrontUrl(store.slug, getProductPath(product)),
      }))}
      initialView={view}
      aiView={aiView}
      marketplaceAvailable={Boolean(env.MARKETPLACE_URL)}
      accentColor={store.theme?.primaryColor ?? null}
      logoUrl={store.logoUrl}
    />
  );
}
