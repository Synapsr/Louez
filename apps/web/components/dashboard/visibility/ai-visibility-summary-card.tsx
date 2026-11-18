"use client";

import { useEffect, useRef } from "react";

import Link from "next/link";

import { ChevronDown, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

import type { AiVisibilityView } from "@louez/api/contracts/ai-visibility";
import { Badge, Button, Card, Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@louez/ui";

import { DashboardIconTile } from "@/components/dashboard/shared/dashboard-icon-tile";
import { usePersistedToggle } from "@/hooks/use-persisted-toggle";

import { AiVisibilityStat } from "./ai-visibility-stat";
import { useVisibilityAnalytics } from "./use-visibility-analytics";

/** Folded or not, per browser: closing the summary folds it, it never hides it. */
const OPEN_STORAGE_KEY = "louez:visibility:ai-summary-open";

interface AiVisibilitySummaryCardProps {
  storeId: string;
  /** Read by the page on the server. */
  view: AiVisibilityView;
}

/**
 * « Être trouvé par les IA » on « Se faire connaître »: how ready the store
 * is, and what assistants brought over 28 days, with the way to its page and
 * to the AI sources of Analyses. It folds to its header, never further.
 */
export const AiVisibilitySummaryCard = ({ storeId, view }: AiVisibilitySummaryCardProps) => {
  const t = useTranslations("dashboard.visibility.ai");
  const analytics = useVisibilityAnalytics(storeId);
  const [open, setOpen] = usePersistedToggle(OPEN_STORAGE_KEY, true);
  const readyCount = view.readiness.filter((item) => item.ready).length;
  const itemCount = view.readiness.length;

  const tracked = useRef(false);
  useEffect(() => {
    if (tracked.current) return;
    tracked.current = true;
    analytics.aiViewed("summary", {
      readyCount,
      itemCount,
      aiVisits: view.visits.total,
      aiCrawls: view.crawls.total,
    });
  }, [analytics, readyCount, itemCount, view]);

  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger
          render={<button type="button" />}
          className="group flex w-full items-center gap-3 p-4 text-left sm:p-5"
        >
          <DashboardIconTile icon={Sparkles} accent="progress" />
          <span className="min-w-0 flex-1 font-semibold">{t("title")}</span>
          <Badge variant={readyCount === itemCount ? "success" : "tertiary"}>
            {t("readyCount", { ready: readyCount, total: itemCount })}
          </Badge>
          <ChevronDown
            aria-hidden
            className="text-muted-foreground size-4 shrink-0 transition-transform group-data-[panel-open]:rotate-180"
          />
          <span className="sr-only">{open ? t("summary.fold") : t("summary.unfold")}</span>
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <div className="space-y-4 px-4 pb-4 sm:px-5 sm:pb-5">
            <p className="text-muted-foreground text-sm">{t("description")}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <AiVisibilityStat value={view.visits.total} label={t("stats.visits")} />
              <AiVisibilityStat value={view.bookings.total} label={t("stats.bookings")} />
              <AiVisibilityStat value={view.crawls.total} label={t("stats.crawls")} />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                size="sm"
                render={<Link href="/dashboard/visibility/ai" />}
                onClick={() => analytics.aiFixOpened("summary", "ai_page")}
              >
                {readyCount === itemCount ? t("summary.openPage") : t("summary.complete")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                render={<Link href="/dashboard/analytics/ai" />}
                onClick={() => analytics.aiFixOpened("summary", "analytics")}
              >
                {t("results.openAnalytics")}
              </Button>
            </div>
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </Card>
  );
};
