"use client";

import Link from "next/link";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, ChevronDown, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";
import { cn } from "@louez/utils";

import type { SetupChecklistItem } from "./use-setup-checklist-items";
import { SetupStepIndicator } from "./setup-step-indicator";

const EASE_OUT_CUBIC = [0.215, 0.61, 0.355, 1] as const;

interface SetupChecklistStepProps {
  item: SetupChecklistItem;
  index: number;
  isCurrent: boolean;
  isExpanded: boolean;
  storeUrl: string;
  reducedMotion: boolean;
  onToggle: () => void;
}

/** One setup step: done, or expandable to its explanation and action. */
export const SetupChecklistStep = ({
  item,
  index,
  isCurrent,
  isExpanded,
  storeUrl,
  reducedMotion,
  onToggle,
}: SetupChecklistStepProps) => {
  const t = useTranslations("dashboard.home");
  const isExpandable = !item.completed && Boolean(item.description);

  return (
    <li className="relative">
      <button
        type="button"
        disabled={!isExpandable}
        aria-expanded={isExpandable ? isExpanded : undefined}
        onClick={onToggle}
        className={cn(
          "group/trigger flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left",
          isExpandable && "hover:bg-muted/50 transition-colors duration-150",
        )}
      >
        <SetupStepIndicator
          completed={item.completed}
          isCurrent={isCurrent}
          index={index}
          reducedMotion={reducedMotion}
        />
        <span
          className={cn(
            "flex-1 text-[13px]",
            item.completed && "text-muted-foreground/70 decoration-muted-foreground/40 line-through",
            isCurrent && "font-medium",
          )}
        >
          {t(`setup.steps.${item.key}`)}
        </span>
        {isExpandable && (
          <ChevronDown
            className={cn(
              "text-muted-foreground group-hover/trigger:text-foreground size-3.5 shrink-0 transition-transform duration-200",
              isExpanded && "text-foreground rotate-180",
            )}
          />
        )}
      </button>

      <AnimatePresence initial={false}>
        {isExpanded && item.description && (
          <motion.div
            initial={reducedMotion ? false : { height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            transition={reducedMotion ? { duration: 0 } : { duration: 0.48, ease: EASE_OUT_CUBIC }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3.5 pl-10.5">
              <p className="text-muted-foreground text-xs leading-relaxed">
                {t(`setup.descriptions.${item.description}`)}
              </p>
              {(item.href || item.showStoreLink) && (
                <div className="mt-2.5 flex flex-col items-start gap-1">
                  {item.href && (
                    <Button className="h-7.5 text-xs" render={<Link href={item.href} />}>
                      {t(item.action || "setup.start")}
                      <ArrowRight />
                    </Button>
                  )}
                  {item.showStoreLink && (
                    <Button
                      variant="ghost"
                      className="text-muted-foreground h-7.5 text-xs"
                      render={<a href={storeUrl} target="_blank" rel="noreferrer" />}
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
};
