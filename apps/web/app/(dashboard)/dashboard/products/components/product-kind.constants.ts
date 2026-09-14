import type { ComponentType } from "react";

import type { PricingKind } from "@louez/types";
import {
  ConsumableStockIcon,
  DurationPricingIcon,
  FlatRatePricingIcon,
  QuantityStockIcon,
  UnitTrackingStockIcon,
  UntrackedStockIcon,
} from "@louez/ui/icons";

import type { StockOption } from "../utils/util.product-kind-choices";

type KindIcon = ComponentType<{ className?: string }>;

export const PRICING_KIND_ICONS: Record<PricingKind, KindIcon> = {
  duration: DurationPricingIcon,
  fixed: FlatRatePricingIcon,
};

export const STOCK_OPTION_ICONS: Record<StockOption, KindIcon> = {
  quantity: QuantityStockIcon,
  units: UnitTrackingStockIcon,
  consumable: ConsumableStockIcon,
  untracked: UntrackedStockIcon,
};

/** Same ids as the onboarding product categories, whose labels name the tabs. */
type ExampleTradeId =
  | "bikes"
  | "sportsOutdoor"
  | "partyEvents"
  | "toolsDiy"
  | "vehicles"
  | "electronics";

interface KindExample {
  id: string;
  pricingKind: PricingKind;
  stock: StockOption;
}

interface KindExampleTrade {
  id: ExampleTradeId;
  products: readonly KindExample[];
}

/**
 * Typical products per trade with the settings that suit them: two per stock
 * option, both pricing kinds in every trade. A choice card's examples dialog
 * lists, for each trade, the products that share its option.
 */
export const KIND_EXAMPLE_TRADES: readonly KindExampleTrade[] = [
  {
    id: "bikes",
    products: [
      { id: "ebike", pricingKind: "duration", stock: "units" },
      { id: "cargoBike", pricingKind: "duration", stock: "units" },
      { id: "helmet", pricingKind: "duration", stock: "quantity" },
      { id: "bikeLock", pricingKind: "fixed", stock: "quantity" },
      { id: "innerTube", pricingKind: "fixed", stock: "consumable" },
      { id: "energyBar", pricingKind: "fixed", stock: "consumable" },
      { id: "guidedTour", pricingKind: "duration", stock: "untracked" },
      { id: "bikeWash", pricingKind: "fixed", stock: "untracked" },
    ],
  },
  {
    id: "sportsOutdoor",
    products: [
      { id: "wetsuit", pricingKind: "duration", stock: "units" },
      { id: "skis", pricingKind: "duration", stock: "units" },
      { id: "paddle", pricingKind: "duration", stock: "quantity" },
      { id: "lifeJacket", pricingKind: "fixed", stock: "quantity" },
      { id: "gasCartridge", pricingKind: "fixed", stock: "consumable" },
      { id: "sunscreen", pricingKind: "fixed", stock: "consumable" },
      { id: "surfLesson", pricingKind: "duration", stock: "untracked" },
      { id: "skiWaxing", pricingKind: "fixed", stock: "untracked" },
    ],
  },
  {
    id: "partyEvents",
    products: [
      { id: "marquee", pricingKind: "duration", stock: "units" },
      { id: "speaker", pricingKind: "duration", stock: "units" },
      { id: "chairs", pricingKind: "fixed", stock: "quantity" },
      { id: "glasses", pricingKind: "fixed", stock: "quantity" },
      { id: "tablecloths", pricingKind: "fixed", stock: "consumable" },
      { id: "smokeFluid", pricingKind: "fixed", stock: "consumable" },
      { id: "setup", pricingKind: "fixed", stock: "untracked" },
      { id: "djService", pricingKind: "duration", stock: "untracked" },
    ],
  },
  {
    id: "toolsDiy",
    products: [
      { id: "miniExcavator", pricingKind: "duration", stock: "units" },
      { id: "generator", pricingKind: "duration", stock: "units" },
      { id: "drill", pricingKind: "duration", stock: "quantity" },
      { id: "ladder", pricingKind: "duration", stock: "quantity" },
      { id: "diamondBlade", pricingKind: "fixed", stock: "consumable" },
      { id: "sandpaper", pricingKind: "fixed", stock: "consumable" },
      { id: "siteDelivery", pricingKind: "fixed", stock: "untracked" },
      { id: "operator", pricingKind: "duration", stock: "untracked" },
    ],
  },
  {
    id: "vehicles",
    products: [
      { id: "van", pricingKind: "duration", stock: "units" },
      { id: "camper", pricingKind: "duration", stock: "units" },
      { id: "childSeat", pricingKind: "fixed", stock: "quantity" },
      { id: "roofBox", pricingKind: "duration", stock: "quantity" },
      { id: "fuel", pricingKind: "fixed", stock: "consumable" },
      { id: "adblue", pricingKind: "fixed", stock: "consumable" },
      { id: "driver", pricingKind: "duration", stock: "untracked" },
      { id: "cleaning", pricingKind: "fixed", stock: "untracked" },
    ],
  },
  {
    id: "electronics",
    products: [
      { id: "camera", pricingKind: "duration", stock: "units" },
      { id: "projector", pricingKind: "duration", stock: "units" },
      { id: "battery", pricingKind: "duration", stock: "quantity" },
      { id: "tripod", pricingKind: "duration", stock: "quantity" },
      { id: "memoryCard", pricingKind: "fixed", stock: "consumable" },
      { id: "gaffer", pricingKind: "fixed", stock: "consumable" },
      { id: "installation", pricingKind: "fixed", stock: "untracked" },
      { id: "technician", pricingKind: "duration", stock: "untracked" },
    ],
  },
];
