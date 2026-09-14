"use client";

import { useTranslations } from "next-intl";

import type { BookingAttributeAxis } from "@louez/types";
import { Label, Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@louez/ui";

interface BookingAttributeSelectsProps {
  axes: BookingAttributeAxis[];
  /** Selectable values per axis key, already filtered for the period. */
  values: Record<string, string[]>;
  selected: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  /** One-line hint under the selects: units left, split notice. */
  hint?: string;
}

/**
 * One select per attribute axis. "Any" is a real `null` item, not a
 * sentinel string: leaving an axis open lets the cart pick a combination.
 */
export const BookingAttributeSelects = ({
  axes,
  values,
  selected,
  onChange,
  hint,
}: BookingAttributeSelectsProps) => {
  const t = useTranslations("storefront.product");

  const setAxis = (key: string, value: string | null) => {
    const next = { ...selected };
    if (value) {
      next[key] = value;
    } else {
      delete next[key];
    }
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-sm font-medium">{t("bookingAttributes")}</Label>
      <div className="grid gap-2 sm:grid-cols-2">
        {axes.map((axis) => {
          const options = values[axis.key] ?? [];
          return (
            <Select
              key={axis.key}
              value={selected[axis.key] ?? null}
              onValueChange={(value: string | null) => setAxis(axis.key, value)}
            >
              <SelectTrigger aria-label={axis.label} className="h-11 text-base sm:h-9 sm:text-sm">
                <SelectValue>
                  {selected[axis.key]
                    ? `${axis.label} · ${selected[axis.key]}`
                    : `${axis.label} · ${t("booking.anyOption")}`}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value={null} label={t("booking.anyOption")}>
                  {t("booking.anyOption")}
                </SelectItem>
                {options.length > 0 ? (
                  options.map((value) => (
                    <SelectItem key={value} value={value} label={value}>
                      {value}
                    </SelectItem>
                  ))
                ) : (
                  <SelectItem value={`empty:${axis.key}`} label={axis.label} disabled>
                    {t("bookingAttributesNoOptions", { attribute: axis.label })}
                  </SelectItem>
                )}
              </SelectPopup>
            </Select>
          );
        })}
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
};
