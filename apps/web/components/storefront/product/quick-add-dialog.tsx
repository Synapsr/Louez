"use client";

import { useEffect, useRef, useState } from "react";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";

import { Dialog, DialogHeader, DialogPopup, DialogTitle } from "@louez/ui";
import { cn } from "@louez/utils";

import { getSeasonalCalendarPricing } from "@/lib/utils/util.storefront-seasonal-pricing";
import { PeriodEditor } from "@/components/storefront/date-picker/period-editor";

import { useMediaQuery } from "@/hooks/use-media-query";

import { useStorePeriodRules } from "@/contexts/store-context";

import { QuickAddExtrasStep } from "./quick-add-extras-step";
import { QuickAddVariantStep } from "./quick-add-variant-step";
import type { QuickAddFlow, QuickAddStep } from "./use-quick-add";

interface QuickAddDialogProps {
  flow: QuickAddFlow;
}

const STEP_LABEL_KEY: Record<QuickAddStep, "dates" | "options" | "extras"> = {
  period: "dates",
  variant: "options",
  extras: "extras",
};

/** The stepper's own spring, so the frame and the content move as one. */
const SPRING = { type: "spring", duration: 0.45, bounce: 0 } as const;

/** Above `sm` the dialog is centered on a tall viewport; below it is a drawer. */
const DESKTOP_QUERY = "(min-width: 640px)";

/**
 * The questions a quick add cannot ask on a card, one screen each: the
 * dates when none are chosen, the variant when there is one to pick, the
 * optional accessories once the product is in the cart. The flow decides
 * which screens exist; this draws the open one in one and the same frame,
 * with the onboarding's progress bars as soon as there is more than one,
 * each screen sliding in as the last one fades out, the frame easing to
 * the new height underneath.
 */
export const QuickAddDialog = ({ flow }: QuickAddDialogProps) => {
  const t = useTranslations("storefront");
  const rules = useStorePeriodRules();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const reducedMotion = useReducedMotion();
  const { state, period } = flow;
  const step = state?.step;
  const steps = state?.steps ?? [];
  const current = step ? steps.indexOf(step) : -1;
  const isOpen = state !== null;

  // The frame follows the content's height, measured rather than `auto`,
  // so it can animate. On the phone the drawer scrolls instead.
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    const element = contentRef.current;
    if (!isOpen || !element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHeight(entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [isOpen]);

  const transition = reducedMotion ? { duration: 0 } : SPRING;
  const title =
    step === "period"
      ? t("quickAdd.chooseDates")
      : step === "variant"
        ? t("quickAdd.chooseOptions")
        : t("accessories.youMightAlsoLike");
  const subtitle =
    step === "extras"
      ? `${t("accessories.productAdded")} · ${state?.product.name}`
      : state?.product.name;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) flow.dismiss();
      }}
    >
      <DialogPopup className="sm:max-w-3xl">
        <DialogHeader className="gap-4">
          {/* The onboarding's progress bars: one per step, no words. */}
          {steps.length > 1 && step ? (
            <div
              role="progressbar"
              aria-valuemin={1}
              aria-valuemax={steps.length}
              aria-valuenow={current + 1}
              aria-valuetext={t(`quickAdd.steps.${STEP_LABEL_KEY[step]}`)}
              className="flex gap-1.5 sm:pe-6"
            >
              {steps.map((entry, index) => (
                <div
                  key={entry}
                  className={cn(
                    "h-[4px] flex-1 rounded-full transition-colors duration-500",
                    index <= current ? "bg-foreground" : "bg-border",
                  )}
                />
              ))}
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            <DialogTitle>{title}</DialogTitle>
            <p className="text-muted-foreground text-sm">{subtitle}</p>
          </div>
        </DialogHeader>

        <motion.div
          initial={false}
          animate={{ height: isDesktop && height !== null ? height : "auto" }}
          transition={transition}
          className="flex min-h-0 flex-col overflow-hidden"
        >
          <div ref={contentRef} className="flex min-h-0 flex-col">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={step}
                initial={{ opacity: 0, x: 16, filter: "blur(4px)" }}
                animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, x: -16, filter: "blur(4px)" }}
                transition={transition}
                className="flex min-h-0 flex-col"
              >
                {state && step === "period" ? (
                  <PeriodEditor
                    key={state.product.id}
                    productId={state.product.id}
                    seasonalPricing={getSeasonalCalendarPricing(state.product)}
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
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>
      </DialogPopup>
    </Dialog>
  );
};
