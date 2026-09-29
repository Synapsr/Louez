"use client";

import { useMemo, useState } from "react";
import { ArrowUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@louez/ui";
import { ProductsPageHeading } from "@/app/(dashboard)/dashboard/products/products-page-heading";
import { ProductsFiltersView } from "@/app/(dashboard)/dashboard/products/products-filters-view";
import { ProductsTable } from "@/app/(dashboard)/dashboard/products/products-table";
import type { ProductStatusFilter } from "@/app/(dashboard)/dashboard/products/types";
import { KeyboardShortcutsProvider } from "@/components/shared/keyboard-shortcuts-provider";
import { getDemoCategories } from "@/lib/landing-demos/fixtures";
import { filterDemoProducts, getDemoProductList } from "@/lib/landing-demos/products";
import { useDemoLocale } from "@/components/landing-demos/use-demo-locale";

export const ProductsCatalog = ({ onOpenProduct }: { onOpenProduct?: (id: string) => void }) => {
  const locale = useDemoLocale();
  const t = useTranslations("dashboard.products");
  const products = useMemo(() => getDemoProductList(locale), [locale]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [status, setStatus] = useState<ProductStatusFilter>("all");
  const [search, setSearch] = useState("");
  const filtered = filterDemoProducts(products, { categoryIds, status, search });
  // Like the app: the tabs count what the categories and the search leave, whatever the status.
  const scope = filterDemoProducts(products, { categoryIds, status: "all", search });
  return (
    <div className="space-y-4 sm:space-y-6" data-demo-target="products-catalog">
      <ProductsPageHeading readOnly />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <KeyboardShortcutsProvider initialShortcuts={{}}>
            <ProductsFiltersView
              categories={getDemoCategories(locale)}
              counts={{ all: scope.length, active: scope.length, draft: 0, archived: 0 }}
              status={status}
              categoryIds={categoryIds}
              search={search}
              setStatus={setStatus}
              setCategoryIds={setCategoryIds}
              setSearch={setSearch}
              autoFocus={false}
              searchDisabled
            />
          </KeyboardShortcutsProvider>
        </div>
        <Button disabled variant="outline" className="hidden shrink-0 sm:inline-flex">
          <ArrowUpDown className="mr-2 h-4 w-4" />
          {t("reorder")}
        </Button>
      </div>
      <ProductsTable
        products={filtered}
        currency="EUR"
        readOnly
        onOpenProduct={onOpenProduct}
        getProductHref={() => "/demos/landing/products-list"}
      />
    </div>
  );
};
