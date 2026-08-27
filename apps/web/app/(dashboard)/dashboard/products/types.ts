import type { ComponentType, ReactNode } from "react";

import type { FormRadioGroupProps } from "@/components/form/form-radio-group";
import type { StockKindChangeBlocker } from "@louez/db";
import type {
  PricingKind,
  PricingMode,
  ProductImageHistory,
  ProductTaxSettings,
  StockKind,
  TaxSettings,
} from "@louez/types";
import type { DurationUnit } from "@louez/utils";
import type { ProductAccessoryLinkInput, ProductInput } from "@louez/validations";

export interface Category {
  id: string;
  name: string;
}

export const PRODUCT_STATUS_FILTERS = ["all", "active", "draft", "archived"] as const;

export type ProductStatusFilter = (typeof PRODUCT_STATUS_FILTERS)[number];

/** A row of the products list, as returned by `dashboard.products.list`. */
export interface ProductListItem {
  id: string;
  name: string;
  images: string[] | null;
  price: string;
  deposit: string | null;
  quantity: number;
  status: "draft" | "active" | "archived" | null;
  category: {
    id: string;
    name: string;
  } | null;
}

export interface ProductCounts {
  all: number;
  active: number;
  draft: number;
  archived: number;
}

export interface ProductsList {
  products: ProductListItem[];
  counts: ProductCounts;
}

export interface SeasonalPricingData {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  price: string;
  tiers: Array<{
    id: string;
    period: number | null;
    price: string | null;
    minDuration: number | null;
    discountPercent: string | null;
    displayOrder: number | null;
  }>;
}

export interface PricingTierData {
  id: string;
  minDuration?: number | null;
  discountPercent?: string | null;
  price?: string | null;
  period?: number | null;
  displayOrder: number | null;
}

export interface PriceDurationValue {
  price: string;
  duration: number;
  unit: DurationUnit;
}

export interface RateTierInput {
  id?: string;
  price: string;
  duration: number;
  unit: DurationUnit;
  // UI-only derived value, not persisted in DB.
  discountPercent?: number;
}

export interface ProductUnitData {
  id: string;
  identifier: string;
  attributes?: Record<string, string> | null;
  hasActiveAssignment?: boolean;
}

export interface BookingAttributeAxisData {
  key: string;
  label: string;
  position: number;
}

export interface Product {
  id: string;
  name: string;
  description: string | null;
  aiContext?: string | null;
  categoryId: string | null;
  categoryIds?: string[];
  price: string;
  deposit: string | null;
  pricingKind?: PricingKind | null;
  stockKind?: StockKind | null;
  pricingMode?: PricingMode | null;
  basePeriodMinutes?: number | null;
  pricingTiers?: PricingTierData[];
  quantity: number;
  status: "draft" | "active" | "archived" | null;
  images: string[] | null;
  imageHistory?: ProductImageHistory[] | null;
  videoUrl: string | null;
  taxSettings?: ProductTaxSettings | null;
  enforceStrictTiers?: boolean;
  accessories?: ProductAccessoryLinkInput[];
  trackUnits?: boolean;
  units?: ProductUnitData[];
  bookingAttributeAxes?: BookingAttributeAxisData[] | null;
}

export interface AvailableAccessory {
  id: string;
  name: string;
  price: string;
  images: string[] | null;
}

export interface ProductFormProps {
  product?: Product;
  stockKindChangeBlockers?: StockKindChangeBlocker[];
  categories: Category[];
  currency?: string;
  storeTaxSettings?: TaxSettings;
  availableAccessories?: AvailableAccessory[];
  showAiContext?: boolean;
  imageEnhanceEnabled?: boolean;
  imageBackgroundRemovalEnabled?: boolean;
}

export type ProductFormValues = Omit<ProductInput, "taxSettings"> & {
  taxSettings: ProductTaxSettings;
};

export interface ProductFormComponentApi {
  AppField: ComponentType<{
    name: any;
    children: (field: any) => ReactNode;
  }>;
  Field: ComponentType<{
    name: any;
    children: (field: any) => ReactNode;
  }>;
  RadioGroup: ComponentType<FormRadioGroupProps>;
  setFieldMeta: (name: any, updater: any) => void;
  setFieldValue: (name: any, value: any) => void;
}
