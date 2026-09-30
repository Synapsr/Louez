import type { CustomerFieldValues } from "@louez/types";

import type { StorefrontCustomerField } from "./customer-fields.types";

interface DisplayOptions {
  /** Intl locale of the page (`useFormatLocale().intl`). */
  intlLocale: string;
  /** What a ticked checkbox reads as ("Oui"). */
  yesLabel: string;
}

type DisplayedField = Pick<StorefrontCustomerField, "type" | "unit">;

/**
 * One stored value as a customer reads it ("80,5 cm", "12 mars 2026",
 * "Oui"). Empty when there is nothing worth showing, an unticked box included.
 */
export const formatCustomerFieldDisplayValue = (
  field: DisplayedField,
  value: string | undefined,
  options: DisplayOptions,
): string => {
  const raw = value?.trim() ?? "";
  if (raw === "") return "";

  switch (field.type) {
    case "checkbox":
      return raw === "true" ? options.yesLabel : "";
    case "number": {
      const amount = Number(raw);
      const text = Number.isFinite(amount)
        ? new Intl.NumberFormat(options.intlLocale).format(amount)
        : raw;
      return field.unit ? `${text} ${field.unit}` : text;
    }
    case "date": {
      // Stored as a calendar day: read at UTC midnight so no timezone shifts it.
      const date = new Date(`${raw}T00:00:00Z`);
      return Number.isNaN(date.getTime())
        ? raw
        : new Intl.DateTimeFormat(options.intlLocale, {
            dateStyle: "medium",
            timeZone: "UTC",
          }).format(date);
    }
    default:
      return field.unit ? `${raw} ${field.unit}` : raw;
  }
};

export interface FilledFieldValue {
  id: string;
  label: string;
  value: string;
}

/** The filled values of a unit or a customer, in field order, ready for a recap line. */
export const getFilledFieldValues = (
  fields: readonly (DisplayedField & Pick<StorefrontCustomerField, "id" | "label">)[],
  values: CustomerFieldValues,
  options: DisplayOptions,
): FilledFieldValue[] =>
  fields.flatMap((field) => {
    const value = formatCustomerFieldDisplayValue(field, values[field.id], options);
    return value ? [{ id: field.id, label: field.label, value }] : [];
  });

/** A field the store requires is still empty: the unit needs completing. */
export const hasMissingRequiredValue = (
  fields: readonly Pick<StorefrontCustomerField, "id" | "collectMode">[],
  values: CustomerFieldValues,
): boolean => fields.some((field) => field.collectMode === "required" && !values[field.id]?.trim());
