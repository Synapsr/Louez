"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Check, ChevronDown, ExternalLink } from "lucide-react";

import { Button } from "@louez/ui";
import { cn } from "@louez/utils";

import { env } from "@/env";

import { useMeasuredSize } from "./use-measured-size";

// Types defined inline to avoid server-only module import
interface StoreMetrics {
  activeProductCount: number;
  totalReservations: number;
  completedReservations: number;
}

/**
 * Whether the checklist shows the "activate online payments" step: hidden for
 * stores that chose request mode, otherwise tracks Stripe chargeability (the
 * KYC can be left pending during onboarding — payment mode silently degrades
 * to request mode until it's done).
 */
export type OnlinePaymentsStep = "hidden" | "todo" | "done";

interface SetupChecklistProps {
  metrics: StoreMetrics;
  storeSlug: string;
  onlinePaymentsStep?: OnlinePaymentsStep;
  className?: string;
}

interface ChecklistItem {
  key: string;
  completed: boolean;
  href?: string;
  action?: string;
  /** Translation key under setup.descriptions — makes the step expandable */
  description?: string;
  showStoreLink?: boolean;
}

const EASE_OUT_CUBIC = [0.215, 0.61, 0.355, 1] as const;

const MORPH_RING = "0 0 0 1px var(--border)";
const SHELL_TRANSITION = {
  duration: 0.58,
  ease: EASE_OUT_CUBIC,
} as const;
const CONTENT_TRANSITION = {
  duration: 0.48,
  ease: EASE_OUT_CUBIC,
} as const;

function ProgressRing({ progress }: { progress: number }) {
  const radius = 10;
  const circumference = radius * 2 * Math.PI;

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 shrink-0 -rotate-90">
      <circle
        cx="12"
        cy="12"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="3.5"
        className="text-border"
      />
      <circle
        cx="12"
        cy="12"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeDasharray={circumference}
        strokeDashoffset={circumference - (progress / 100) * circumference}
        strokeLinecap="round"
        className="text-primary transition-[stroke-dashoffset] duration-500 ease-out"
      />
    </svg>
  );
}

function StepIndicator({
  completed,
  isCurrent,
  index,
  reducedMotion,
}: {
  completed: boolean;
  isCurrent: boolean;
  index: number;
  reducedMotion: boolean;
}) {
  return (
    <span
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium tabular-nums",
        completed
          ? "bg-primary/10 text-primary border border-primary border-dashed "
          : isCurrent
            ? "border border-primary border-dashed text-muted-foreground"
            : "border border-border border-dashed text-muted-foreground",
      )}
    >
      {completed ? (
        <motion.span
          initial={reducedMotion ? false : { scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.2, ease: EASE_OUT_CUBIC, delay: index * 0.04 }}
          className="flex"
        >
          <Check className="size-3" strokeWidth={3} />
        </motion.span>
      ) : null}
    </span>
  );
}

export function SetupChecklist({
  metrics,
  storeSlug,
  onlinePaymentsStep = "hidden",
}: SetupChecklistProps) {
  const t = useTranslations("dashboard.home");
  const tCommon = useTranslations("common");
  const reducedMotion = useReducedMotion() ?? false;

  const [open, setOpen] = useState(false);
  const [expandedLayout, setExpandedLayout] = useState(false);
  const [itemHeightIsAnimating, setItemHeightIsAnimating] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const {
    ref: measureRef,
    measureNow,
    size: measuredSize,
  } = useMeasuredSize({ observeHeight: !itemHeightIsAnimating });

  const items: ChecklistItem[] = [
    {
      key: "createAccount",
      completed: true,
    },
    {
      key: "configureStore",
      completed: true,
    },
    {
      key: "addFirstProduct",
      completed: metrics.activeProductCount > 0,
      href: "/dashboard/products/new",
      action: "setup.addFirstProduct",
      description: "addFirstProduct",
    },
    ...(onlinePaymentsStep !== "hidden"
      ? [
          {
            key: "connectStripe",
            completed: onlinePaymentsStep === "done",
            href: "/dashboard/settings/payments",
            action: "setup.connectStripe",
            description: "connectStripe",
          },
        ]
      : []),
    {
      key: "firstReservation",
      completed: metrics.totalReservations > 0,
      href: "/dashboard/reservations/new?source=onboarding",
      action: "setup.createReservation",
      description: "firstReservation",
      showStoreLink: true,
    },
    {
      key: "firstCompleted",
      completed: metrics.completedReservations > 0,
      description: "firstCompleted",
    },
  ];

  const completedCount = items.filter((item) => item.completed).length;
  const progress = Math.round((completedCount / items.length) * 100);
  const allCompleted = completedCount === items.length;

  // Find the next uncompleted step
  const nextStep = items.find((item) => !item.completed);

  const [expandedKey, setExpandedKey] = useState<string | null>(nextStep?.key ?? null);

  const toggleChecklist = () => {
    measureNow();

    if (open) {
      setOpen(false);
      setExpandedLayout(false);
      return;
    }

    setExpandedLayout(true);
    setOpen(true);
  };

  const toggleChecklistItem = (itemKey: string, isExpanded: boolean) => {
    setItemHeightIsAnimating(true);
    setExpandedKey(isExpanded ? null : itemKey);
  };

  const handleItemHeightAnimationComplete = () => {
    measureNow();
    setItemHeightIsAnimating(false);
  };

  // The panel stays open on outside clicks; only Escape or the header toggles it.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        measureNow();
        setOpen(false);
        setExpandedLayout(false);
        triggerRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [measureNow, open]);

  if (allCompleted) {
    return null;
  }

  const storeUrl = `https://${storeSlug}.${env.NEXT_PUBLIC_APP_DOMAIN}`;

  return (
    <div className="fixed right-6 bottom-0 z-50 max-sm:right-4 max-sm:bottom-4">
      <motion.div
        initial={false}
        animate={
          measuredSize.width > 0 && measuredSize.height > 0
            ? {
                width: measuredSize.width,
                height: itemHeightIsAnimating ? "auto" : measuredSize.height,
                borderRadius: expandedLayout ? 14 : 12,
              }
            : undefined
        }
        transition={
          reducedMotion
            ? { duration: 0 }
            : {
                width: SHELL_TRANSITION,
                height: itemHeightIsAnimating ? { duration: 0 } : SHELL_TRANSITION,
                borderRadius: SHELL_TRANSITION,
              }
        }
        className="bg-popover text-popover-foreground overflow-hidden"
        style={{ borderRadius: expandedLayout ? 14 : 12, boxShadow: MORPH_RING }}
      >
        <div
          ref={measureRef}
          className={cn("relative", expandedLayout ? "w-80 max-w-[calc(100vw-2rem)]" : "w-max")}
        >
          <div className={cn(expandedLayout && "bg-background p-1")}>
            <button
              ref={triggerRef}
              type="button"
              aria-expanded={open}
              title={open ? tCommon("close") : undefined}
              onClick={toggleChecklist}
              className={cn(
                "hover:bg-muted/50 group/header focus-visible:outline-ring/50 relative flex w-full items-center gap-2 px-3 py-2 text-left outline-none transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2",
                expandedLayout && "rounded-lg",
              )}
            >
              <span className="flex">
                <ProgressRing progress={progress} />
              </span>
              <span className="text-sm font-medium whitespace-nowrap">{t("setup.title")}</span>
              <span className="text-muted-foreground ml-auto text-sm whitespace-nowrap tabular-nums">
                {completedCount}/{items.length}
              </span>
              <AnimatePresence initial={false} mode="popLayout">
                {open && (
                  <motion.span
                    initial={reducedMotion ? false : { opacity: 0, rotate: -90 }}
                    animate={{ opacity: 1, rotate: 0 }}
                    exit={{ opacity: 0, rotate: -90 }}
                    transition={reducedMotion ? { duration: 0 } : CONTENT_TRANSITION}
                    className="flex"
                  >
                    <ChevronDown className="text-muted-foreground group-hover/header:text-foreground size-4 shrink-0 transition-colors duration-150" />
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          </div>

          <AnimatePresence initial={false} mode="popLayout">
            {open && (
              <motion.div
                initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={reducedMotion ? { duration: 0 } : CONTENT_TRANSITION}
              >
                <ul className="space-y-1 border-t p-1">
                  {items.map((item, index) => {
                    const isCurrent = !item.completed && nextStep?.key === item.key;
                    const isExpandable = !item.completed && Boolean(item.description);
                    const isExpanded = isExpandable && expandedKey === item.key;

                    return (
                      <li key={item.key} className="relative">
                        <button
                          type="button"
                          disabled={!isExpandable}
                          aria-expanded={isExpandable ? isExpanded : undefined}
                          onClick={() => toggleChecklistItem(item.key, isExpanded)}
                          className={cn(
                            "group/trigger flex w-full items-center gap-2.5 rounded-lg px-4 py-2.5 text-left",
                            isExpandable && "hover:bg-muted/50 transition-colors duration-150",
                          )}
                        >
                          <StepIndicator
                            completed={item.completed}
                            isCurrent={isCurrent}
                            index={index}
                            reducedMotion={reducedMotion}
                          />
                          <span
                            className={cn(
                              "flex-1 text-[13px]",
                              item.completed &&
                                "text-muted-foreground/70 line-through decoration-muted-foreground/40",
                              isCurrent && "font-medium",
                            )}
                          >
                            {t(`setup.steps.${item.key}`)}
                          </span>
                          {isExpandable && (
                            <ChevronDown
                              className={cn(
                                "text-muted-foreground size-3.5 shrink-0 transition-transform duration-200",
                                "group-hover/trigger:text-foreground",
                                isExpanded && "rotate-180 text-foreground",
                              )}
                            />
                          )}
                        </button>

                        <AnimatePresence initial={false}>
                          {isExpanded && (
                            <motion.div
                              initial={reducedMotion ? false : { height: 0 }}
                              animate={{ height: "auto" }}
                              exit={{ height: 0 }}
                              transition={reducedMotion ? { duration: 0 } : SHELL_TRANSITION}
                              onAnimationComplete={handleItemHeightAnimationComplete}
                              className="overflow-hidden"
                            >
                              <div className="px-4 pb-3.5 pl-11.5">
                                <p className="text-muted-foreground text-xs leading-relaxed">
                                  {t(`setup.descriptions.${item.description}`)}
                                </p>
                                {(item.href || item.showStoreLink) && (
                                  <div className="mt-2.5 flex flex-col  gap-1 items-start">
                                    {item.href && (
                                      <Button
                                        className="h-7.5 text-xs"
                                        render={<Link href={item.href} />}
                                      >
                                        {t(item.action || "setup.start")}
                                        <ArrowRight />
                                      </Button>
                                    )}
                                    {item.showStoreLink && (
                                      <Button
                                        variant="ghost"
                                        className="text-muted-foreground h-7.5 text-xs"
                                        render={
                                          <a href={storeUrl} target="_blank" rel="noreferrer" />
                                        }
                                      >
                                        {t("setup.viewStore")}
                                        <ExternalLink />
                                      </Button>
                                    )}
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </li>
                    );
                  })}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
