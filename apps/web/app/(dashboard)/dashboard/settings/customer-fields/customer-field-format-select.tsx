"use client";

import { useTranslations } from "next-intl";

import { CUSTOMER_FIELD_FORMATS, type CustomerFieldFormat } from "@louez/types";
import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@louez/ui";

interface CustomerFieldFormatSelectProps {
  id: string;
  value: CustomerFieldFormat | null;
  onChange: (format: CustomerFieldFormat | null) => void;
}

/** Sentinel of "Libre": a format is never an empty string. */
const FREE = "free";

const isFormat = (value: unknown): value is CustomerFieldFormat =>
  CUSTOMER_FIELD_FORMATS.some((format) => format === value);

/**
 * The identifier a text holds, when it is one Louez can check (a Brazilian
 * CPF, a Spanish DNI…): the value is verified and normalised as it is typed.
 */
export const CustomerFieldFormatSelect = ({
  id,
  value,
  onChange,
}: CustomerFieldFormatSelectProps) => {
  const t = useTranslations("dashboard.settings.customerFields.builder.inspector");
  const items = [
    { value: FREE, label: t("formats.free") },
    ...CUSTOMER_FIELD_FORMATS.map((format) => ({ value: format, label: t(`formats.${format}`) })),
  ];

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor={id}>{t("format")}</Label>
      <Select
        items={items}
        value={value ?? FREE}
        onValueChange={(next) => onChange(isFormat(next) ? next : null)}
      >
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value} label={item.label}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-muted-foreground text-xs">{t(value ? "formatHelp" : "formatFreeHelp")}</p>
    </div>
  );
};
