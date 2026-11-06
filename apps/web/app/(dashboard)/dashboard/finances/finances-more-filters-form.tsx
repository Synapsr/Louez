"use client";

import { revalidateLogic } from "@tanstack/react-form";
import { useTranslations } from "next-intl";
import { z } from "zod";

import { Button, SelectItem } from "@louez/ui";
import {
  getCurrencySymbol,
  PAYMENT_MOVEMENT_NATURES,
  type PaymentMovementNature,
} from "@louez/utils";
import { FINANCE_MOVEMENT_STATUSES, type FinanceMovementStatus } from "@louez/validations";

import { useStoreCurrency } from "@/contexts/store-context";
import { useAppForm } from "@/hooks/form/form";

import { NATURE_LABEL_KEYS } from "./finances.constants";

export interface FinancesMoreFiltersValue {
  nature: PaymentMovementNature | null;
  status: FinanceMovementStatus | null;
  min: number | null;
  max: number | null;
}

interface FinancesMoreFiltersFormProps {
  value: FinancesMoreFiltersValue;
  onApply: (value: FinancesMoreFiltersValue) => void;
}

const ALL = "all";

/** "12,5" and "12.5" both read as twelve and a half; blank means no bound. */
const parseAmount = (raw: string): number | null => {
  const amount = Number.parseFloat(raw.trim().replace(",", "."));
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
};

export const FinancesMoreFiltersForm = ({ value, onApply }: FinancesMoreFiltersFormProps) => {
  const t = useTranslations("dashboard.finances");
  const currencySymbol = getCurrencySymbol(useStoreCurrency());

  const amountSchema = z
    .string()
    .refine((raw) => raw.trim() === "" || parseAmount(raw) !== null, t("filters.amountInvalid"));
  const schema = z
    .object({ nature: z.string(), status: z.string(), min: amountSchema, max: amountSchema })
    .refine(
      ({ min, max }) => {
        const [low, high] = [parseAmount(min), parseAmount(max)];
        return low === null || high === null || high >= low;
      },
      { message: t("filters.amountRangeError"), path: ["max"] },
    );

  const form = useAppForm({
    defaultValues: {
      nature: value.nature ?? ALL,
      status: value.status ?? ALL,
      min: value.min === null ? "" : String(value.min),
      max: value.max === null ? "" : String(value.max),
    },
    validators: { onSubmit: schema },
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    onSubmit: ({ value: submitted }) =>
      onApply({
        nature: PAYMENT_MOVEMENT_NATURES.find((nature) => nature === submitted.nature) ?? null,
        status: FINANCE_MOVEMENT_STATUSES.find((status) => status === submitted.status) ?? null,
        min: parseAmount(submitted.min),
        max: parseAmount(submitted.max),
      }),
  });

  const natureItems = [
    { value: ALL, label: t("filters.allNatures") },
    ...PAYMENT_MOVEMENT_NATURES.map((nature) => ({
      value: nature,
      label: t(`nature.${NATURE_LABEL_KEYS[nature]}`),
    })),
  ];
  const statusItems = [
    { value: ALL, label: t("filters.allStatuses") },
    ...FINANCE_MOVEMENT_STATUSES.map((status) => ({ value: status, label: t(`status.${status}`) })),
  ];

  return (
    <form.AppForm>
      <form.Form formName="finances-more-filters" className="space-y-4">
        <form.AppField name="nature">
          {(field) => (
            <field.Select label={t("filters.nature")} items={natureItems} className="w-full">
              {natureItems.map((item) => (
                <SelectItem key={item.value} value={item.value} label={item.label}>
                  {item.label}
                </SelectItem>
              ))}
            </field.Select>
          )}
        </form.AppField>

        <form.AppField name="status">
          {(field) => (
            <field.Select label={t("filters.status")} items={statusItems} className="w-full">
              {statusItems.map((item) => (
                <SelectItem key={item.value} value={item.value} label={item.label}>
                  {item.label}
                </SelectItem>
              ))}
            </field.Select>
          )}
        </form.AppField>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t("filters.amount")}</legend>
          <div className="grid grid-cols-2 gap-3">
            <form.AppField name="min">
              {(field) => (
                <field.Input
                  inputMode="decimal"
                  placeholder={t("filters.minAmount")}
                  aria-label={t("filters.minAmount")}
                  suffix={currencySymbol}
                />
              )}
            </form.AppField>
            <form.AppField name="max">
              {(field) => (
                <field.Input
                  inputMode="decimal"
                  placeholder={t("filters.maxAmount")}
                  aria-label={t("filters.maxAmount")}
                  suffix={currencySymbol}
                />
              )}
            </form.AppField>
          </div>
        </fieldset>

        <div className="flex justify-end gap-2 border-t pt-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onApply({ nature: null, status: null, min: null, max: null })}
          >
            {t("filters.reset")}
          </Button>
          <form.SubscribeButton>{t("filters.apply")}</form.SubscribeButton>
        </div>
      </form.Form>
    </form.AppForm>
  );
};
