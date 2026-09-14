"use client";

import { useTranslations } from "next-intl";

import type { PricingKind } from "@louez/types";
import {
  Button,
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
} from "@louez/ui";
import { QuestionCircleIcon } from "@louez/ui/icons";

import { useProductKindLabels } from "../hooks/use-product-kind-labels";
import type { StockOption } from "../utils/util.product-kind-choices";
import { ProductFormKindChip } from "./product-form-kind-chip";
import {
  KIND_EXAMPLE_TRADES,
  PRICING_KIND_ICONS,
  STOCK_OPTION_ICONS,
} from "./product-kind.constants";

type ProductFormKindExamplesDialogProps =
  | { axis: "pricing"; value: PricingKind }
  | { axis: "stock"; value: StockOption };

/**
 * The "?" button of a choice card: for each trade, the typical products
 * that take this option, so a rental company reads its own case rather than an
 * abstract description. Each product also shows its setting on the other axis,
 * since the two choices go together.
 */
export const ProductFormKindExamplesDialog = (selection: ProductFormKindExamplesDialogProps) => {
  const t = useTranslations("dashboard.products.form.kindExamples");
  // The trades are the onboarding product categories: reuse their names.
  const tTrades = useTranslations("onboarding.profile.productCategories");
  const labels = useProductKindLabels();

  const OptionIcon =
    selection.axis === "pricing"
      ? PRICING_KIND_ICONS[selection.value]
      : STOCK_OPTION_ICONS[selection.value];
  const option =
    selection.axis === "pricing" ? labels.pricing[selection.value] : labels.stock[selection.value];
  const matches = (product: (typeof KIND_EXAMPLE_TRADES)[number]["products"][number]) =>
    selection.axis === "pricing"
      ? product.pricingKind === selection.value
      : product.stock === selection.value;

  return (
    <Dialog>
      <DialogTrigger
        render={<Button type="button" variant="tertiary" size="icon-sm" />}
        aria-label={t("title", { option })}
      >
        <QuestionCircleIcon data-slot="icon" />
      </DialogTrigger>
      <DialogPopup className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <OptionIcon className="text-muted-foreground size-5 shrink-0" />
            {t("title", { option })}
          </DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {/* Six trades do not fit in a row of tabs: they stand in a column
              beside the products, and scroll sideways on a phone instead. */}
          <Tabs
            defaultValue={KIND_EXAMPLE_TRADES[0].id}
            orientation="vertical"
            className="gap-4 max-sm:data-[orientation=vertical]:flex-col"
          >
            <div className="-mx-1 shrink-0 overflow-x-auto px-1 pb-1 sm:mx-0 sm:w-48 sm:px-0">
              <TabsList className="max-sm:data-[orientation=vertical]:flex-row sm:w-full">
                {KIND_EXAMPLE_TRADES.map((trade) => (
                  <TabsTab
                    key={trade.id}
                    value={trade.id}
                    className="max-sm:data-[orientation=vertical]:w-auto"
                  >
                    {tTrades(trade.id)}
                  </TabsTab>
                ))}
              </TabsList>
            </div>

            {KIND_EXAMPLE_TRADES.map((trade) => (
              <TabsPanel key={trade.id} value={trade.id} className="min-w-0">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4">
                  <div className="text-muted-foreground col-span-2 grid grid-cols-subgrid pb-2 text-xs">
                    <span>{t("product")}</span>
                    <span>{selection.axis === "pricing" ? t("stock") : t("pricing")}</span>
                  </div>
                  {trade.products.filter(matches).map((product) => (
                    <div
                      key={product.id}
                      className="col-span-2 grid grid-cols-subgrid items-center border-t py-2.5"
                    >
                      <span className="text-sm font-medium">{t(`${trade.id}.${product.id}`)}</span>
                      {selection.axis === "pricing" ? (
                        <ProductFormKindChip
                          icon={STOCK_OPTION_ICONS[product.stock]}
                          label={labels.stock[product.stock]}
                        />
                      ) : (
                        <ProductFormKindChip
                          icon={PRICING_KIND_ICONS[product.pricingKind]}
                          label={labels.pricing[product.pricingKind]}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </TabsPanel>
            ))}
          </Tabs>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
};
