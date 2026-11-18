"use client";

import { useEffect, useRef } from "react";

import Link from "next/link";

import { useQuery } from "@tanstack/react-query";
import { ChartLine, ChevronDown, ExternalLink, ListChecks, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

import type { AiVisibilityView } from "@louez/api/contracts/ai-visibility";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@louez/ui";

import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";
import { visibilityQueries } from "@/lib/queries/visibility.queries";

import { AiAssistantTable } from "./ai-assistant-table";
import { AiReadinessRow } from "./ai-readiness-row";
import { AiVisibilityStat } from "./ai-visibility-stat";
import { useVisibilityAnalytics } from "./use-visibility-analytics";
import { toAiAssistantRows } from "./util.ai-assistant-rows";

interface AiVisibilityOverviewProps {
  storeId: string;
  /** Read by the page on the server. */
  initialView: AiVisibilityView;
  /** The storefront's llms.txt, the file assistants read; null while the store is not online. */
  llmsTxtUrl: string | null;
  /** False on an instance with `LOUEZ_SEARCH_INDEXING=off`: no engine nor assistant sees it. */
  indexingEnabled: boolean;
}

/**
 * « Être trouvé par les IA », its own page: what the store's data lacks for an
 * assistant to describe it, each with the page that fixes it, then what came
 * of it over 28 days. The per-assistant breakdown stays folded.
 */
export const AiVisibilityOverview = ({
  storeId,
  initialView,
  llmsTxtUrl,
  indexingEnabled,
}: AiVisibilityOverviewProps) => {
  const t = useTranslations("dashboard.visibility.ai");
  const analytics = useVisibilityAnalytics(storeId);
  const { data: view } = useQuery({ ...visibilityQueries.getAi(), initialData: initialView });
  const readyCount = view.readiness.filter((item) => item.ready).length;
  const itemCount = view.readiness.length;

  const tracked = useRef(false);
  useEffect(() => {
    if (tracked.current) return;
    tracked.current = true;
    analytics.aiViewed("page", {
      readyCount: initialView.readiness.filter((item) => item.ready).length,
      itemCount: initialView.readiness.length,
      aiVisits: initialView.visits.total,
      aiCrawls: initialView.crawls.total,
    });
  }, [analytics, initialView]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground mt-1">{t("description")}</p>
      </div>

      {!indexingEnabled && (
        <Alert variant="warning">
          <AlertDescription>{t("indexingOff")}</AlertDescription>
        </Alert>
      )}

      <DashboardSectionCard
        title={t("readiness.title")}
        icon={ListChecks}
        accent="progress"
        action={
          <Badge variant={readyCount === itemCount ? "success" : "tertiary"}>
            {t("readyCount", { ready: readyCount, total: itemCount })}
          </Badge>
        }
      >
        <ul className="divide-y rounded-xl border">
          {view.readiness.map((item) => (
            <AiReadinessRow
              key={item.key}
              item={item}
              onFix={() => analytics.aiFixOpened("page", item.key)}
            />
          ))}
        </ul>
      </DashboardSectionCard>

      <DashboardSectionCard
        title={t("results.title")}
        description={t("stats.period")}
        icon={Sparkles}
        accent="success"
        contentClassName="space-y-4"
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <AiVisibilityStat value={view.visits.total} label={t("stats.visits")} />
          <AiVisibilityStat value={view.bookings.total} label={t("stats.bookings")} />
          <AiVisibilityStat value={view.crawls.total} label={t("stats.crawls")} />
        </div>

        <Button variant="outline" size="sm" render={<Link href="/dashboard/analytics/ai" />}>
          <ChartLine />
          {t("results.openAnalytics")}
        </Button>

        <Collapsible>
          <CollapsibleTrigger className="text-muted-foreground hover:text-foreground group flex items-center gap-1 text-sm">
            {t("details")}
            <ChevronDown className="size-3.5 transition-transform group-data-[panel-open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="space-y-4 pt-3 text-sm">
              <AiAssistantTable rows={toAiAssistantRows(view)} />
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p>{t("llmsTxt.reads", { count: view.crawls.llmsTxt })}</p>
                {llmsTxtUrl && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="self-start"
                    render={<a href={llmsTxtUrl} target="_blank" rel="noopener noreferrer" />}
                    onClick={() => analytics.aiFixOpened("page", "llms_txt")}
                  >
                    {t("llmsTxt.open")}
                    <ExternalLink />
                  </Button>
                )}
              </div>
              <p className="text-muted-foreground">{t("note")}</p>
            </div>
          </CollapsiblePanel>
        </Collapsible>
      </DashboardSectionCard>
    </div>
  );
};
