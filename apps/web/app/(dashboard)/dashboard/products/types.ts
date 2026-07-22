import type { ComponentType, ReactNode } from "react";

import type { PricingMode, ProductTaxSettings, TaxSettings } from "@louez/types";
import type { DurationUnit } from "@louez/utils";
import type { ProductInput } from "@louez/validations";

export interface Category {
  id: string;
  name: string;
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
  categoryId: string | null;
  price: string;
  deposit: string | null;
  pricingMode?: PricingMode | null;
  basePeriodMinutes?: number | null;
  pricingTiers?: PricingTierData[];
  quantity: number;
  status: "draft" | "active" | "archived" | null;
  images: string[] | null;
  videoUrl: string | null;
  taxSettings?: ProductTaxSettings | null;
  enforceStrictTiers?: boolean;
  accessoryIds?: string[];
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
  categories: Category[];
  currency?: string;
  storeTaxSettings?: TaxSettings;
  availableAccessories?: AvailableAccessory[];
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
  setFieldMeta: (name: any, updater: any) => void;
  setFieldValue: (name: any, value: any) => void;
}
