"use client";

import { useTranslations } from "next-intl";

import { CUSTOMER_ACQUISITION_SOURCES, type CustomerAcquisitionSource } from "@louez/types";
import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@louez/ui";
import { acquisitionSourceTakesDetail } from "@louez/validations";

interface CustomerSourceInputProps {
  id: string;
  source: CustomerAcquisitionSource | "";
  detail: string;
  onSourceChange: (source: CustomerAcquisitionSource | "") => void;
  onDetailChange: (detail: string) => void;
  required: boolean;
  /** Already-translated message when the form refused the source. */
  error?: string;
}

const isSource = (value: string | null): value is CustomerAcquisitionSource =>
  CUSTOMER_ACQUISITION_SOURCES.some((source) => source === value);

/** "Comment vous a-t-il connu ?", and its "Précisez" under it for a source that takes one. */
export const CustomerSourceInput = ({
  id,
  source,
  detail,
  onSourceChange,
  onDetailChange,
  required,
  error,
}: CustomerSourceInputProps) => {
  const t = useTranslations("dashboard.customers");
  const label = t("form.acquisitionSource");

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-2">
        <Label htmlFor={id} data-error={Boolean(error)}>
          {required ? `${label} *` : label}
        </Label>
        <Select
          items={CUSTOMER_ACQUISITION_SOURCES.map((value) => ({
            value,
            label: t(`sources.${value}`),
          }))}
          value={source || null}
          onValueChange={(next) => onSourceChange(isSource(next) ? next : "")}
        >
          <SelectTrigger id={id} aria-invalid={Boolean(error)}>
            <SelectValue placeholder={t("form.acquisitionSourcePlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {CUSTOMER_ACQUISITION_SOURCES.map((value) => (
              <SelectItem key={value} value={value} label={t(`sources.${value}`)}>
                {t(`sources.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {error && <p className="text-destructive text-sm">{error}</p>}
      </div>
      {acquisitionSourceTakesDetail(source) && (
        <div className="flex min-w-0 flex-col gap-2">
          <Label htmlFor={`${id}-detail`}>{t("form.acquisitionSourceDetail")}</Label>
          <Input
            id={`${id}-detail`}
            value={detail}
            placeholder={t("form.acquisitionSourceDetailPlaceholder")}
            maxLength={255}
            autoComplete="off"
            onChange={(event) => onDetailChange(event.target.value)}
          />
        </div>
      )}
    </div>
  );
};
