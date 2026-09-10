"use client";

import { ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";

import { Label, Switch } from "@louez/ui";

import { useFormatMoney } from "@/hooks/use-format-money";

import type { TulipInsuranceMode, TulipQuotePreview } from "../checkout.types";
import { getCheckoutInsuranceState } from "../util.checkout-insurance";

interface InsuranceOptionCardProps {
  mode: Exclude<TulipInsuranceMode, "no_public">;
  preview: TulipQuotePreview;
  isLoading: boolean;
  isFetched: boolean;
  /** Premium quoted for this cart, shown even while the switch is off. */
  quotedAmount: number;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  fieldId: string;
}

/**
 * Optional coverage keeps its switch. Included coverage is identified only
 * after a successful quote confirms there is no extra charge.
 */
export const InsuranceOptionCard = ({
  mode,
  preview,
  isLoading,
  isFetched,
  quotedAmount,
  checked,
  onCheckedChange,
  fieldId,
}: InsuranceOptionCardProps) => {
  const t = useTranslations("storefront.checkout");
  const tErrors = useTranslations("errors");
  const formatMoney = useFormatMoney();

  const isRequired = mode === "required";
  const insuranceState = getCheckoutInsuranceState({
    mode,
    preview,
    isLoading,
    isFetched,
    checked,
  });
  const isPending = insuranceState === "loading";
  const isUnavailable = insuranceState === "unavailable";
  const isIncluded = insuranceState === "included";
  const isCoverApplied = isIncluded || insuranceState === "selected";
  const priceLabel = isPending
    ? t("insuranceEstimating")
    : isUnavailable
      ? t("insuranceOptionalUnavailableShort")
      : quotedAmount > 0
        ? formatMoney(quotedAmount)
        : null;
  const errorMessage =
    isUnavailable && preview.quoteError?.startsWith("errors.")
      ? tErrors(preview.quoteError.slice("errors.".length))
      : null;

  return (
    <div className="flex items-start gap-3 rounded-2xl bg-muted p-4">
      <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Label
          htmlFor={isRequired ? undefined : fieldId}
          className="text-base font-medium leading-snug"
        >
          {t(isIncluded ? "insuranceIncludedLabel" : "insuranceLineLabel")}
          {priceLabel && <span className="text-muted-foreground"> · {priceLabel}</span>}
        </Label>
        <p className="text-xs text-muted-foreground">
          {t(isIncluded ? "insuranceIncludedHelp" : "insuranceOptionalHelp")}
        </p>
        {isCoverApplied && preview.uninsuredProductCount > 0 && (
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
        isCoverApplied && (
          <span className="shrink-0 rounded-full bg-success/12 px-2.5 py-1 text-xs font-medium text-success">
            {t(isIncluded ? "insuranceIncluded" : "insuranceRequiredBadge")}
          </span>
        )
      ) : (
        <Switch
          id={fieldId}
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={isPending || isUnavailable}
          className="shrink-0"
        />
      )}
    </div>
  );
};
