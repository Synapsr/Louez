import { useTranslations } from "next-intl";

import type { PricingKind } from "@louez/types";

import type { StockOption } from "../utils/util.product-kind-choices";

/** The names of the pricing kinds and stock options, shared by the cards, the
 *  card headers and the examples dialog. */
export const useProductKindLabels = () => {
  const t = useTranslations("dashboard.products.form");

  const pricing: Record<PricingKind, string> = {
    duration: t("pricingKindDuration"),
    fixed: t("pricingKindFixed"),
  };
  const stock: Record<StockOption, string> = {
    quantity: t("unitTracking.modeQuantity"),
    units: t("unitTracking.modeUnits"),
    consumable: t("stockKindConsumable"),
    untracked: t("stockKindUntracked"),
  };

  return { pricing, stock };
};
