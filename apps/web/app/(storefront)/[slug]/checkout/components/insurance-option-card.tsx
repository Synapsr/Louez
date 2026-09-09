"use client";

import { ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";

import { Label, Switch } from "@louez/ui";

import { useFormatMoney } from "@/hooks/use-format-money";

import type { TulipInsuranceMode, TulipQuotePreview } from "../checkout.types";

interface InsuranceOptionCardProps {
  mode: Exclude<TulipInsuranceMode, "no_public">;
  preview: TulipQuotePreview;
  isLoading: boolean;
  /** Premium quoted for this cart, shown even while the switch is off. */
  quotedAmount: number;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  fieldId: string;
}

/**
 * Tulip cover as one row: title with the price, a Switch when optional,
 * "Incluse" when the store requires it. The optional opt-in defaults to
 * false (no pre-ticked paid extra); the premium stays visible in the label.
 */
export const InsuranceOptionCard = ({
  mode,
  preview,
  isLoading,
  quotedAmount,
  checked,
  onCheckedChange,
  fieldId,
}: InsuranceOptionCardProps) => {
  const t = useTranslations("storefront.checkout");
  const tErrors = useTranslations("errors");
  const formatMoney = useFormatMoney();

  const isRequired = mode === "required";
  const isUnavailable = preview.quoteUnavailable;
  const priceLabel = isLoading
    ? t("insuranceEstimating")
    : quotedAmount > 0
      ? formatMoney(quotedAmount)
      : isUnavailable
        ? t("insuranceOptionalUnavailableShort")
        : null;
  const errorMessage =
    isUnavailable && preview.quoteError?.startsWith("errors.")
      ? tErrors(preview.quoteError.slice("errors.".length))
      : null;

  return (
    <div className="flex items-start gap-3 rounded-2xl bg-muted p-4">
      <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Label htmlFor={fieldId} className="text-base font-medium leading-snug">
          {t("insuranceLineLabel")}
          {priceLabel && <span className="text-muted-foreground"> · {priceLabel}</span>}
        </Label>
        <p className="text-xs text-muted-foreground">{t("insuranceOptionalHelp")}</p>
        {preview.insuredProductCount > 0 && preview.uninsuredProductCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {t("insurancePartialCoverage", {
              insured: preview.insuredProductCount,
              uninsured: preview.uninsuredProductCount,
            })}
          </p>
        )}
        {errorMessage && <p className="text-xs text-warning">{errorMessage}</p>}
      </div>
      {isRequired ? (
        <span className="shrink-0 rounded-full bg-success/12 px-2.5 py-1 text-xs font-medium text-success">
          {t("insuranceIncluded")}
        </span>
      ) : (
        <Switch
          id={fieldId}
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={isLoading || isUnavailable}
          className="shrink-0"
        />
      )}
    </div>
  );
};
