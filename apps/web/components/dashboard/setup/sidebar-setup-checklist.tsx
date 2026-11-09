"use client";

import { useEffect, useState } from "react";

import { useReducedMotion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Popover,
  PopoverPopup,
  PopoverTrigger,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@louez/ui";

import { useStorefrontUrl } from "@/hooks/use-storefront-url";
import type { OnlinePaymentsStep, SetupProgressCounts } from "@/lib/dashboard/setup-progress";

import { WELCOME_OVERLAY_COMPLETED_EVENT } from "../welcome-overlay";
import { type OnlinePaymentsContext, useSetupChecklistItems } from "./use-setup-checklist-items";
import { SetupChecklistStep } from "./setup-checklist-step";
import { SetupProgressRing } from "./setup-progress-ring";

/**
 * Opens the setup list from elsewhere (an empty state that points at it).
 */
export const OPEN_SETUP_CHECKLIST_EVENT = "louez:open-setup-checklist";

interface SidebarSetupChecklistProps {
  counts: SetupProgressCounts;
  storeSlug: string;
  onlinePaymentsStep: OnlinePaymentsStep;
  onlinePaymentsContext: OnlinePaymentsContext;
  /** Shown under the steps, e.g. the launch offer while seats remain. */
  footer?: React.ReactNode;
}

/**
 * The setup list, in compact form at the foot of the sidebar: progress ring,
 * "2/6" and the next step to do. A click opens the full list beside the
 * sidebar. It disappears once every step is done.
 */
export const SidebarSetupChecklist = ({
  counts,
  storeSlug,
  onlinePaymentsStep,
  onlinePaymentsContext,
  footer,
}: SidebarSetupChecklistProps) => {
  const t = useTranslations("dashboard.home");
  const reducedMotion = useReducedMotion() ?? false;
  const { getAbsoluteUrl } = useStorefrontUrl(storeSlug);
  const { items, completedCount, progress, nextStep } = useSetupChecklistItems({
    counts,
    onlinePaymentsStep,
    onlinePaymentsContext,
  });
  const [open, setOpen] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(nextStep?.key ?? null);

  useEffect(() => {
    // The list opens on its own right after the welcome moment, and on demand
    // from the page; never on a phone, where the sidebar is a closed sheet.
    const openOnDesktop = () => {
      if (window.matchMedia("(min-width: 768px)").matches) setOpen(true);
    };
    window.addEventListener(WELCOME_OVERLAY_COMPLETED_EVENT, openOnDesktop);
    window.addEventListener(OPEN_SETUP_CHECKLIST_EVENT, openOnDesktop);
    return () => {
      window.removeEventListener(WELCOME_OVERLAY_COMPLETED_EVENT, openOnDesktop);
      window.removeEventListener(OPEN_SETUP_CHECKLIST_EVENT, openOnDesktop);
    };
  }, []);

  if (!nextStep) return null;

  return (
    <SidebarMenuItem>
      <Popover open={open} onOpenChange={setOpen}>
        <SidebarMenuButton
          size="lg"
          tooltip={t("setup.title")}
          render={<PopoverTrigger />}
          className="bg-sidebar-accent shadow-card data-popup-open:shadow-raised h-auto py-2"
        >
          <SetupProgressRing progress={progress} />
          <span className="flex min-w-0 flex-1 flex-col text-left">
            <span className="flex items-baseline gap-1.5 text-sm font-semibold">
              {t("setup.title")}
              <span className="text-muted-foreground text-xs font-medium tabular-nums">
                {completedCount}/{items.length}
              </span>
            </span>
            <span className="text-muted-foreground truncate text-xs">
              {t(`setup.steps.${nextStep.key}`)}
            </span>
          </span>
          <ChevronRight className="text-muted-foreground size-4 shrink-0" />
        </SidebarMenuButton>
        <PopoverPopup side="right" align="end" sideOffset={12} className="w-80">
          <div className="space-y-1 p-1">
            <div className="px-3 pt-2 pb-1">
              <p className="text-sm font-semibold">{t("setup.title")}</p>
              <p className="text-muted-foreground text-xs">{t("setup.description")}</p>
            </div>
            <ul className="space-y-0.5">
              {items.map((item, index) => {
                const isExpanded = !item.completed && expandedKey === item.key;
                return (
                  <SetupChecklistStep
                    key={item.key}
                    item={item}
                    index={index}
                    isCurrent={item.key === nextStep.key}
                    isExpanded={isExpanded}
                    storeUrl={getAbsoluteUrl()}
                    reducedMotion={reducedMotion}
                    onToggle={() => setExpandedKey(isExpanded ? null : item.key)}
                  />
                );
              })}
            </ul>
            {footer && <div className="border-t px-1 pt-2 pb-1">{footer}</div>}
          </div>
        </PopoverPopup>
      </Popover>
    </SidebarMenuItem>
  );
};
