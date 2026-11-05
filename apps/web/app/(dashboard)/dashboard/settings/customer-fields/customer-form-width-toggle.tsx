"use client";

import { useTranslations } from "next-intl";

import { CUSTOMER_FIELD_WIDTHS, type CustomerFieldWidth } from "@louez/types";
import { Toggle, ToggleGroup } from "@louez/ui";

import { CustomerFormWidthGlyph } from "./customer-form-width-glyph";

interface CustomerFormWidthToggleProps {
  width: CustomerFieldWidth;
  onChange: (width: CustomerFieldWidth) => void;
}

/** Narrow to wide, left to right. */
const OPTIONS: readonly CustomerFieldWidth[] = ["half", "full"];

const isWidth = (value: unknown): value is CustomerFieldWidth =>
  CUSTOMER_FIELD_WIDTHS.some((width) => width === value);

/** Half or full row, in one click from the field itself: the current one pressed. */
export const CustomerFormWidthToggle = ({ width, onChange }: CustomerFormWidthToggleProps) => {
  const t = useTranslations("dashboard.settings.customerFields.builder.width");

  return (
    <ToggleGroup
      aria-label={t("label")}
      size="sm"
      value={[width]}
      // Pressing the current width again would leave none: only a change counts.
      onValueChange={(next) => {
        const picked = next.find((value) => value !== width);
        if (isWidth(picked)) onChange(picked);
      }}
      className="bg-muted rounded-md p-0.5"
    >
      {OPTIONS.map((option) => (
        <Toggle
          key={option}
          value={option}
          aria-label={t(`${option}Label`)}
          title={t(`${option}Label`)}
          className="text-muted-foreground data-pressed:bg-background data-pressed:text-foreground h-5 min-w-6 rounded-sm px-1 sm:h-5 sm:min-w-6"
        >
          <CustomerFormWidthGlyph width={option} />
        </Toggle>
      ))}
    </ToggleGroup>
  );
};
