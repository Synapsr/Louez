"use client";
import { useStoreTimezone, useStorePeriodRules } from "@/contexts/store-context";
import { usePricingNow } from "@/hooks/use-pricing-now";
import { getSeasonalCalendarPricing } from "@/lib/utils/util.storefront-seasonal-pricing";
import { PeriodEditor } from "@/components/storefront/date-picker/period-editor";
import { useMediaQuery } from "@/hooks/use-media-query";
import { QuickAddExtrasStep } from "./quick-add-extras-step";
import { QuickAddVariantStep } from "./quick-add-variant-step";
import { QuickAddDialogView } from "./quick-add-dialog-view";
import type { QuickAddFlow } from "./use-quick-add";

export const QuickAddDialog = ({ flow }: { flow: QuickAddFlow }) => {
  const promotionTimezone = useStoreTimezone();
  const promotionNow = usePricingNow();
  const rules = useStorePeriodRules();
  const isDesktop = useMediaQuery("(min-width: 640px)");
  const { state, period } = flow;
  const step = state?.step;
  return (
    <QuickAddDialogView
      isOpen={state !== null}
      step={step}
      steps={state?.steps ?? []}
      productName={state?.product.name}
      onDismiss={flow.dismiss}
    >
      {state && step === "period" ? (
        <PeriodEditor
          key={state.product.id}
          productId={state.product.id}
          seasonalPricing={getSeasonalCalendarPricing(state.product, {
            timezone: promotionTimezone,
            now: promotionNow,
          })}
          value={null}
          rules={rules}
          variant="sheet"
          months={isDesktop ? 2 : 1}
          onApply={flow.applyPeriod}
        />
      ) : null}

      {state && step === "variant" && period ? (
        <QuickAddVariantStep
          product={state.product}
          period={period}
          onConfirm={flow.applyVariant}
        />
      ) : null}

      {state && step === "extras" ? (
        <QuickAddExtrasStep
          quantity={state.quantity}
          product={state.product}
          period={period}
          onDone={flow.finish}
        />
      ) : null}
    </QuickAddDialogView>
  );
};
