"use client";

import { useTranslations } from "next-intl";

import {
  CUSTOMER_ACQUISITION_SOURCES,
  type CustomerAcquisitionSource,
  type ResolvedCustomerProfileSettings,
} from "@louez/types";
import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@louez/ui";

import { getAgeFromBirthDate } from "@/lib/customers/util.customer-age";

export interface CustomerProfileValue {
  birthDate: string;
  acquisitionSource: CustomerAcquisitionSource | "";
  acquisitionSourceDetail: string;
}

interface CustomerProfileFieldsProps {
  value: CustomerProfileValue;
  settings: ResolvedCustomerProfileSettings;
  /** Already-translated messages of the fields the form refused. */
  errors?: { birthDate?: string; acquisitionSource?: string };
  onChange: (changes: Partial<CustomerProfileValue>) => void;
}

const isSource = (value: string | null): value is CustomerAcquisitionSource =>
  CUSTOMER_ACQUISITION_SOURCES.some((source) => source === value);

/** Birth date and origin, the two profile facts Louez itself makes use of. */
export const CustomerProfileFields = ({
  value,
  settings,
  errors,
  onChange,
}: CustomerProfileFieldsProps) => {
  const t = useTranslations("dashboard.customers");
  const showBirthDate = settings.birthDate.visibility !== "hidden";
  const showSource = settings.acquisitionSource.visibility !== "hidden";
  const age = getAgeFromBirthDate(value.birthDate);
  const mark = (visibility: string | undefined) => (visibility === "required" ? " *" : "");

  if (!showBirthDate && !showSource) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {showBirthDate && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="customer-birth-date">
            {t("form.birthDate")}
            {mark(settings.birthDate.visibility)}
          </Label>
          <div className="flex items-center gap-3">
            <Input
              id="customer-birth-date"
              type="date"
              value={value.birthDate}
              max={new Date().toISOString().slice(0, 10)}
              className="sm:max-w-48"
              aria-invalid={Boolean(errors?.birthDate)}
              onChange={(event) => onChange({ birthDate: event.target.value })}
            />
            {age !== null && (
              <span className="text-muted-foreground shrink-0 text-sm">
                {t("form.ageYears", { age })}
              </span>
            )}
          </div>
          {errors?.birthDate && <p className="text-destructive text-sm">{errors.birthDate}</p>}
        </div>
      )}
      {showSource && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="customer-source">
            {t("form.acquisitionSource")}
            {mark(settings.acquisitionSource.visibility)}
          </Label>
          <Select
            items={CUSTOMER_ACQUISITION_SOURCES.map((source) => ({
              value: source,
              label: t(`sources.${source}`),
            }))}
            value={value.acquisitionSource || null}
            onValueChange={(next) => onChange({ acquisitionSource: isSource(next) ? next : "" })}
          >
            <SelectTrigger id="customer-source" aria-invalid={Boolean(errors?.acquisitionSource)}>
              <SelectValue placeholder={t("form.acquisitionSourcePlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {CUSTOMER_ACQUISITION_SOURCES.map((source) => (
                <SelectItem key={source} value={source} label={t(`sources.${source}`)}>
                  {t(`sources.${source}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors?.acquisitionSource && (
            <p className="text-destructive text-sm">{errors.acquisitionSource}</p>
          )}
        </div>
      )}
      {showSource &&
        (value.acquisitionSource === "other" || value.acquisitionSource === "partner") && (
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="customer-source-detail">{t("form.acquisitionSourceDetail")}</Label>
            <Input
              id="customer-source-detail"
              value={value.acquisitionSourceDetail}
              placeholder={t("form.acquisitionSourceDetailPlaceholder")}
              maxLength={255}
              onChange={(event) => onChange({ acquisitionSourceDetail: event.target.value })}
            />
          </div>
        )}
    </div>
  );
};
