"use client";

import { CalendarDays } from "lucide-react";
import { useTranslations } from "next-intl";

import type { TaxSettings } from "@louez/types";
import { Button, Separator } from "@louez/ui";
import { cn, isFixedPriceProduct } from "@louez/utils";

import { ProductImage } from "@/components/product/product-image";
import { InsuredProductShield } from "@/components/storefront/ui/insured-product-shield";
import { SeasonalPriceBreakdown } from "@/components/storefront/product/seasonal-price-breakdown";
import { BillingDetail } from "@/components/storefront/product/billing-detail";
import { getStorefrontBillingDetail } from "@/lib/utils/util.storefront-product-pricing";
import { Price } from "@/components/storefront/ui/price";
import type { CartItem } from "@/contexts/cart-context";
import { useDiscountVisibility } from "@/contexts/store-context";
import { useFormatLocale } from "@/hooks/use-format-locale";
import { useFormatMoney } from "@/hooks/use-format-money";
import { calculateCartItemPrice } from "@/lib/utils/cart-pricing";
import { groupCartLinesByParent } from "@/lib/utils/cart-required-accessories";
import { getDetailedDuration } from "@/lib/utils/duration";
import { getEffectiveDiscountPercent } from "@/lib/utils/util.discount-visibility";

import type {
  CheckoutTulipInsurance,
  LineResolutionState,
  ReservationMode,
  TulipQuotePreview,
  ValidatedPromo,
} from "../checkout.types";
import { CheckoutDeposit } from "./checkout-deposit";
import type { CheckoutTotals } from "../util.checkout-totals";
import { getCheckoutInsuranceState } from "../util.checkout-insurance";

interface CheckoutOrderSummaryProps {
  items: CartItem[];
  reservationMode: ReservationMode;
  taxSettings?: TaxSettings;
  globalStartDate: string | null;
  globalEndDate: string | null;
  subtotal: number;
  originalSubtotal: number;
  totalSavings: number;
  totalDeposit: number;
  totals: CheckoutTotals;
  hasDeliveryLegs: boolean;
  deliveryFee: number;
  deliveryFeeReady: boolean;
  tulipInsurance?: CheckoutTulipInsurance;
  tulipQuote: {
    preview: TulipQuotePreview;
    isLoading: boolean;
    isFetched: boolean;
    appliedAmount: number;
  };
  tulipInsuranceOptIn: boolean;
  lineResolutions: Record<string, LineResolutionState>;
  promo: ValidatedPromo | null;
  discountAmount: number;
  onEditDates: () => void;
  /** `card` = desktop sticky card; `bare` = inside the mobile disclosure. */
  variant?: "card" | "bare";
  className?: string;
}

const SummaryRow = ({
  label,
  value,
  tone = "default",
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  tone?: "default" | "success" | "muted";
}) => (
  <div className="flex items-center justify-between gap-3 text-sm">
    <span className="text-muted-foreground">{label}</span>
    <span
      className={cn(
        "tabular-nums",
        tone === "success" && "font-medium text-success",
        tone === "muted" && "text-muted-foreground",
      )}
    >
      {value}
    </span>
  </div>
);

export const CheckoutOrderSummary = ({
  items,
  reservationMode,
  taxSettings,
  globalStartDate,
  globalEndDate,
  subtotal,
  originalSubtotal,
  totalSavings,
  totalDeposit,
  totals,
  hasDeliveryLegs,
  deliveryFee,
  deliveryFeeReady,
  tulipInsurance,
  tulipQuote,
  tulipInsuranceOptIn,
  lineResolutions,
  promo,
  discountAmount,
  onEditDates,
  variant = "card",
  className,
}: CheckoutOrderSummaryProps) => {
  const t = useTranslations("storefront.checkout");
  const formatMoney = useFormatMoney();
  const { intl: formatLocale } = useFormatLocale();
  const isDiscountVisible = useDiscountVisibility();

  const insuranceState = getCheckoutInsuranceState({
    mode: tulipInsurance?.enabled ? tulipInsurance.mode : "no_public",
    preview: tulipQuote.preview,
    isLoading: tulipQuote.isLoading,
    isFetched: tulipQuote.isFetched,
    checked: tulipInsuranceOptIn,
  });
  const showInsurance = insuranceState !== "hidden";
  const showInsuranceLine = showInsurance && insuranceState !== "loading";
  const isCoverApplied = insuranceState === "included" || insuranceState === "selected";
  const insuranceValue = (() => {
    if (insuranceState === "unavailable") return t("insuranceOptionalUnavailableShort");
    if (insuranceState === "included") return t("insuranceIncluded");
    if (tulipQuote.appliedAmount > 0) return formatMoney(tulipQuote.appliedAmount);
    return isCoverApplied ? t("insuranceOptionalEnabled") : t("insuranceOptionalDisabled");
  })();

  const orderedLines = groupCartLinesByParent(items).flatMap((group) => [
    { item: group.line, parentName: undefined },
    ...group.children.map((child) => ({ item: child, parentName: group.line.productName })),
  ]);

  const periodLabel = (() => {
    if (!globalStartDate || !globalEndDate) return null;
    const dateFormat = new Intl.DateTimeFormat(formatLocale, { day: "numeric", month: "short" });
    const { days, hours } = getDetailedDuration(globalStartDate, globalEndDate);
    const duration = days === 0 ? `${hours}h` : hours === 0 ? `${days}j` : `${days}j ${hours}h`;
    return `${dateFormat.format(new Date(globalStartDate))} → ${dateFormat.format(new Date(globalEndDate))} · ${duration}`;
  })();

  return (
    <div
      className={cn(
        "flex flex-col gap-4",
        variant === "card" && "rounded-2xl bg-card p-4 shadow-card sm:p-6",
        className,
      )}
    >
      {variant === "card" && <h2 className="text-lg font-semibold leading-snug">{t("summary")}</h2>}

      {periodLabel && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
          <span className="truncate">{periodLabel}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onEditDates}
            aria-label={t("advanceNotice.editDates")}
            className="shrink-0"
          >
            <CalendarDays />
          </Button>
        </div>
      )}

      <ul className="flex flex-col gap-3">
        {orderedLines.map(({ item, parentName }) => {
          const priceResult = calculateCartItemPrice(item, globalStartDate, globalEndDate);
          const showItemDiscount = isDiscountVisible(getEffectiveDiscountPercent(priceResult));
          const billingDetail = getStorefrontBillingDetail(
            item,
            priceResult,
            globalStartDate,
            globalEndDate,
          );
          const resolution = lineResolutions[item.lineId];
          const attributes = item.resolvedAttributes ?? item.selectedAttributes;

          return (
            <li
              key={item.lineId}
              className={cn("flex flex-wrap gap-x-3 gap-y-2", parentName && "ml-4 border-l pl-3")}
            >
              <ProductImage
                src={item.productImage}
                alt={item.productName}
                sizes="56px"
                containerClassName="h-12 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <p className="truncate text-sm font-medium">{item.productName}</p>
                  {isCoverApplied &&
                    tulipQuote.preview.insuredProductIds.includes(item.productId) && (
                      <InsuredProductShield label={t("insuranceCoveredProductTooltip")} />
                    )}
                </div>
                {attributes && Object.keys(attributes).length > 0 && (
                  <p className="truncate text-xs text-muted-foreground">
                    {Object.values(attributes).join(" · ")}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {parentName && priceResult.subtotal === 0
                    ? t("included")
                    : `${item.quantity} × ${formatMoney(priceResult.subtotal / Math.max(1, item.quantity))}${
                        isFixedPriceProduct(item) ? ` · ${t("fixedPrice")}` : ""
                      }`}
                </p>
                {resolution?.status === "loading" && (
                  <p className="text-xs text-muted-foreground">{t("lineCheckingAvailability")}</p>
                )}
                {(resolution?.status === "invalid" || item.unavailableReason) && (
                  <p className="text-xs text-destructive">{t("lineNeedsUpdateInline")}</p>
                )}
              </div>
              <div className="text-right">
                <p className="text-sm font-medium tabular-nums">
                  {formatMoney(priceResult.subtotal)}
                </p>
                {showItemDiscount && priceResult.discountPercent != null && (
                  <p className="text-xs text-success">
                    -{Math.floor(priceResult.discountPercent)}%
                  </p>
                )}
              </div>
              {billingDetail || priceResult.seasonalSegments?.length ? (
                <div className="flex w-full flex-col gap-2">
                  <BillingDetail detail={billingDetail} />
                  <SeasonalPriceBreakdown
                    segments={priceResult.seasonalSegments}
                    seasons={item.seasonalPricings}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <Separator />

      <div className="flex flex-col gap-2">
        {totalSavings > 0 ? (
          <>
            <SummaryRow
              label={t("pricing.subtotal")}
              value={<s>{formatMoney(originalSubtotal)}</s>}
              tone="muted"
            />
            <SummaryRow
              label={t("pricing.discount")}
              value={`-${formatMoney(totalSavings)}`}
              tone="success"
            />
          </>
        ) : (
          <SummaryRow label={t("pricing.subtotal")} value={formatMoney(subtotal)} />
        )}

        {promo && discountAmount > 0 && (
          <SummaryRow
            label={t("promoCode.discount", { code: promo.code })}
            value={`-${formatMoney(discountAmount)}`}
            tone="success"
          />
        )}

        {hasDeliveryLegs && (
          <SummaryRow
            label={t("deliveryFee")}
            value={
              !deliveryFeeReady ? "—" : deliveryFee === 0 ? t("free") : formatMoney(deliveryFee)
            }
            tone={deliveryFeeReady && deliveryFee === 0 ? "success" : "default"}
          />
        )}

        {insuranceState === "loading" && (
          <SummaryRow
            label={t("insuranceLineLabel")}
            value={t("insuranceEstimating")}
            tone="muted"
          />
        )}
        {showInsuranceLine && <SummaryRow label={t("insuranceLineLabel")} value={insuranceValue} />}

        <Separator />

        <div className="flex items-baseline justify-between gap-3">
          <span className="text-base font-medium">{t("pricing.total")}</span>
          <Price amount={totals.total} size="lg" tone="primary" />
        </div>

        {totals.isPartialPayment && (
          <>
            <SummaryRow
              label={t("toPayNow")}
              value={<span className="font-semibold">{formatMoney(totals.amountDueNow)}</span>}
            />
            <p className="text-xs text-muted-foreground">
              {t("remainingAtPickup", { amount: formatMoney(totals.remainingAmount) })}
            </p>
          </>
        )}

        {totalDeposit > 0 && (
          <div className="mt-1 flex flex-col gap-1 border-t pt-2">
            <CheckoutDeposit amount={totalDeposit} reservationMode={reservationMode} />
          </div>
        )}

        {taxSettings?.enabled && (
          <p className="text-xs text-muted-foreground">
            {taxSettings.displayMode === "inclusive"
              ? t("pricesIncludeTax")
              : t("pricesExcludeTax")}
          </p>
        )}
      </div>
    </div>
  );
};
