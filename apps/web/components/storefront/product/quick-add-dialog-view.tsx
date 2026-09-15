"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Dialog, DialogHeader, DialogPopup, DialogTitle } from "@louez/ui";
import { cn } from "@louez/utils";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { QuickAddStep } from "./use-quick-add";

const STEP_LABEL_KEY: Record<QuickAddStep, "dates" | "options" | "extras"> = {
  period: "dates",
  variant: "options",
  extras: "extras",
};
const SPRING = { type: "spring", duration: 0.45, bounce: 0 } as const;

export const QuickAddDialogView = ({
  isOpen,
  step,
  steps,
  productName,
  onDismiss,
  children,
  autoFocus = true,
  modal = true,
}: {
  autoFocus?: boolean;
  modal?: boolean;
  isOpen: boolean;
  step: QuickAddStep | undefined;
  steps: QuickAddStep[];
  productName?: string;
  onDismiss: () => void;
  children: ReactNode;
}) => {
  const t = useTranslations("storefront");
  const isDesktop = useMediaQuery("(min-width: 640px)");
  const reducedMotion = useReducedMotion();
  const current = step ? steps.indexOf(step) : -1;
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
    step === "extras" ? `${t("accessories.productAdded")} · ${productName}` : productName;

  return (
    <Dialog
      modal={modal}
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <DialogPopup initialFocus={autoFocus} finalFocus={autoFocus} className="sm:max-w-3xl">
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
                {children}
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>
      </DialogPopup>
    </Dialog>
  );
};
