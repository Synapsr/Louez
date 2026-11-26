import { z } from "zod";

import type { PricingMode } from "@louez/types";

import type { CustomItem } from "../types";

/** The price field typed in last: the other one follows it. */
export type CustomItemPriceField = "unit" | "total";

/** What the custom item dialog holds, as typed. */
export interface CustomItemFormValues {
  name: string;
  description: string;
  unitPrice: string;
  totalPrice: string;
  deposit: string;
  quantity: string;
  pricingMode: PricingMode;
  priceField: CustomItemPriceField;
}

/** A custom item as the dialog saves it; the reservation form keeps its id. */
export type CustomItemValues = Omit<CustomItem, "id">;

export type CustomItemFormError = "priceRequired" | "selectPeriodFirst" | "nameRequired";

/** When editing: the item, and the form as it opened on it. */
export interface CustomItemFormOrigin {
  item: CustomItem;
  form: CustomItemFormValues;
}

export type CustomItemFormResult =
  | { ok: true; values: CustomItemValues }
  | { ok: false; errors: CustomItemFormError[] };

export const emptyCustomItemForm: CustomItemFormValues = {
  name: "",
  description: "",
  unitPrice: "",
  totalPrice: "",
  deposit: "",
  quantity: "1",
  pricingMode: "day",
  priceField: "total",
};

export const pricingModeToBasePeriodMinutes = (mode: PricingMode): number => {
  if (mode === "hour") return 60;
  if (mode === "week") return 10080;
  return 1440;
};

/** The unit price a total stands for, over the quantity and the duration; empty when it has none. */
export const unitPriceFromTotal = (totalPrice: string, quantity: string, duration: number) => {
  const total = parseFloat(totalPrice);
  const units = parseInt(quantity) || 1;
  if (isNaN(total) || total <= 0 || duration <= 0) return "";
  return (total / (units * duration)).toFixed(2);
};

/** The total a unit price comes to, over the quantity and the duration; empty when it has none. */
export const totalFromUnitPrice = (unitPrice: string, quantity: string, duration: number) => {
  const unit = parseFloat(unitPrice);
  const units = parseInt(quantity) || 1;
  if (isNaN(unit) || unit <= 0 || duration <= 0) return "";
  return (unit * units * duration).toFixed(2);
};

/**
 * The price field that follows the one typed in last, once the quantity or
 * the duration changed: a total stays and its unit price follows, or the
 * other way round.
 */
export const followingPrice = (
  values: CustomItemFormValues,
  duration: number,
): { field: "unitPrice" | "totalPrice"; value: string } =>
  values.priceField === "total"
    ? {
        field: "unitPrice",
        value: unitPriceFromTotal(values.totalPrice, values.quantity, duration),
      }
    : {
        field: "totalPrice",
        value: totalFromUnitPrice(values.unitPrice, values.quantity, duration),
      };

/** The dialog opened on an item: its total is the line's, from its exact unit price. */
export const customItemFormFromItem = (
  item: CustomItem,
  duration: number,
): CustomItemFormValues => ({
  name: item.name,
  description: item.description,
  unitPrice: item.unitPrice.toFixed(2),
  totalPrice: duration > 0 ? (item.unitPrice * item.quantity * duration).toFixed(2) : "",
  deposit: item.deposit > 0 ? String(item.deposit) : "",
  quantity: String(item.quantity),
  pricingMode: item.pricingMode,
  priceField: "total",
});

const priceIsUnchanged = (values: CustomItemFormValues, origin: CustomItemFormOrigin) =>
  values.unitPrice === origin.form.unitPrice &&
  values.totalPrice === origin.form.totalPrice &&
  values.quantity === origin.form.quantity &&
  values.pricingMode === origin.form.pricingMode;

/**
 * Once there is a period, the dialog checks the price and name. The unit
 * price comes from the field typed in last. Editing without touching the
 * pricing fields keeps the item's exact unit price.
 */
export const resolveCustomItemForm = (
  values: CustomItemFormValues,
  duration: number,
  origin?: CustomItemFormOrigin,
): CustomItemFormResult => {
  if (duration <= 0) return { ok: false, errors: ["selectPeriodFirst"] };

  const errors: CustomItemFormError[] = [];
  const quantity = parseInt(values.quantity) || 1;

  let unitPrice = 0;
  if (origin && priceIsUnchanged(values, origin)) {
    unitPrice = origin.item.unitPrice;
  } else if (values.priceField === "total") {
    const totalPrice = parseFloat(values.totalPrice);
    if (isNaN(totalPrice) || totalPrice <= 0) errors.push("priceRequired");
    else unitPrice = totalPrice / (quantity * duration);
  } else {
    unitPrice = parseFloat(values.unitPrice);
    if (isNaN(unitPrice) || unitPrice <= 0) errors.push("priceRequired");
  }

  const name = values.name.trim();
  if (!name) errors.push("nameRequired");

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    values: {
      name,
      description: values.description.trim(),
      unitPrice,
      deposit: parseFloat(values.deposit) || 0,
      quantity,
      pricingMode: values.pricingMode,
      basePeriodMinutes: pricingModeToBasePeriodMinutes(values.pricingMode),
    },
  };
};

/**
 * The dialog's schema: what `resolveCustomItemForm` lacks, under the field
 * that holds it. A missing price shows under the price field typed in last.
 */
export const createCustomItemFormSchema = ({
  getDuration,
  origin,
  messages,
}: {
  getDuration: (mode: PricingMode) => number;
  origin?: CustomItemFormOrigin;
  messages: Record<CustomItemFormError, string>;
}) =>
  z
    .object({
      name: z.string(),
      description: z.string(),
      unitPrice: z.string(),
      totalPrice: z.string(),
      deposit: z.string(),
      quantity: z.string(),
      pricingMode: z.enum(["hour", "day", "week"]),
      priceField: z.enum(["unit", "total"]),
    })
    .superRefine((values, ctx) => {
      const result = resolveCustomItemForm(values, getDuration(values.pricingMode), origin);
      if (result.ok) return;
      const priceField = values.priceField === "total" ? "totalPrice" : "unitPrice";
      for (const error of result.errors) {
        ctx.addIssue({
          code: "custom",
          path: [error === "nameRequired" ? "name" : priceField],
          message: messages[error],
        });
      }
    });
