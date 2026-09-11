import type { TaxSettings } from "@louez/types";

import type { ProductFormComponentApi, ProductFormValues } from "../types";
import type { PricingDraft } from "./use-pricing-draft";

/**
 * - `base` — the product's own rate ladder.
 * - `season` — one seasonal period. VAT, deposit and the calculation mode are
 *   product-level, so they are read-only or absent here.
 * - `fixed` — a flat fee. No duration, so no ladder, no mode and no curve.
 */
export type PricingScope = "base" | "season" | "fixed";

export interface PricingSectionProps {
  scope?: PricingScope;
  draft: PricingDraft;
  form: ProductFormComponentApi;
  watchedValues: ProductFormValues;
  currency: string;
  currencySymbol: string;
  storeTaxSettings?: TaxSettings;
  disabled: boolean;
  /** Leave the season being edited and go back to the product's base rates. */
  onSwitchToBase?: () => void;
  /** Surface field errors even on fields the merchant has not touched yet. */
  showValidationErrors?: boolean;
  /** Rows the server rejected as duplicate durations. */
  duplicateRateTierIndexes?: number[];
}
