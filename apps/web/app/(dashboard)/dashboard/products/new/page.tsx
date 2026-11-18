import { getAccessoryCandidates } from "@louez/api/services";
import { db, products } from "@louez/db";
import { and, eq } from "drizzle-orm";
import { serverApi } from "@/lib/api/server-api";
import { getCurrentStore } from "@/lib/store-context";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { isImageBackgroundRemovalEnabled } from "@/lib/ai/image/background-removal";
import { isAiImageEnhanceEnabled } from "@/lib/ai/image/credits";

import { ProductForm } from "../product-form";
import { productPermissions } from "../util.product-permissions";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export default async function NewProductPage() {
  const t = await getTranslations("dashboard.products");
  const store = await getCurrentStore();

  if (!store) {
    redirect("/onboarding");
  }

  const api = await serverApi();
  // The form reads every category itself; the first page shows until then.
  const [categoriesPage, availableAccessories, [activeProduct]] = await Promise.all([
    api.categories.list({}),
    getAccessoryCandidates({ storeId: store.id }),
    // None yet: this one makes the store bookable (the test reservation's offer).
    db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.storeId, store.id), eq(products.status, "active")))
      .limit(1),
  ]);

  const showAiContext = store.aiAdvisorSettings?.enabled === true;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("newProduct")}</h1>
        <p className="text-muted-foreground">{t("newProductDescription")}</p>
      </div>

      <ProductForm
        key="new-product"
        categories={categoriesPage.items}
        availableAccessories={availableAccessories}
        storeTaxSettings={store.settings?.tax}
        currency={store.settings?.currency ?? "EUR"}
        storeTimezone={store.settings?.timezone}
        showAiContext={showAiContext}
        imageEnhanceEnabled={isAiImageEnhanceEnabled()}
        imageBackgroundRemovalEnabled={isImageBackgroundRemovalEnabled()}
        canDelete={productPermissions(store.role).canDelete}
        isFirstProduct={!activeProduct}
      />
    </div>
  );
}
