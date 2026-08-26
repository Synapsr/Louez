import { getAccessoryCandidates } from "@louez/api/services";
import { categories, db } from "@louez/db";
import { getCurrentStore } from "@/lib/store-context";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { isImageBackgroundRemovalEnabled } from "@/lib/ai/image/background-removal";
import { isAiImageEnhanceEnabled } from "@/lib/ai/image/credits";

import { ProductForm } from "../product-form";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export default async function NewProductPage() {
  const t = await getTranslations("dashboard.products");
  const store = await getCurrentStore();

  if (!store) {
    redirect("/onboarding");
  }

  const [categoriesList, availableAccessories] = await Promise.all([
    db.query.categories.findMany({
      where: eq(categories.storeId, store.id),
      orderBy: [categories.order],
    }),
    getAccessoryCandidates({ storeId: store.id }),
  ]);

  const showAiContext = store.aiAdvisorSettings?.enabled === true;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("newProduct")}</h1>
        <p className="text-muted-foreground">{t("newProductDescription")}</p>
      </div>

      <ProductForm
        categories={categoriesList}
        availableAccessories={availableAccessories}
        storeTaxSettings={store.settings?.tax}
        showAiContext={showAiContext}
        imageEnhanceEnabled={isAiImageEnhanceEnabled()}
        imageBackgroundRemovalEnabled={isImageBackgroundRemovalEnabled()}
      />
    </div>
  );
}
