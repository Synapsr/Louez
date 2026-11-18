"use client";

import { useEffect, useRef } from "react";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ExternalLink, Sparkles } from "lucide-react";
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

interface AiVisibilityCardProps {
  storeId: string;
  /** Read by the page on the server. */
  initialView: AiVisibilityView;
  /** The storefront's llms.txt, the file assistants read. */
  llmsTxtUrl: string;
  /** False on an instance with `LOUEZ_SEARCH_INDEXING=off`: no engine nor assistant sees it. */
  indexingEnabled: boolean;
}

/**
 * « Être trouvé par les IA »: what the store's data lacks for an assistant to
 * describe it, with the page that fixes each item, then the visits assistants
 * sent and their crawlers' reads. The breakdown stays folded.
 */
export const AiVisibilityCard = ({
  storeId,
  initialView,
  llmsTxtUrl,
  indexingEnabled,
}: AiVisibilityCardProps) => {
  const t = useTranslations("dashboard.visibility.ai");
  const analytics = useVisibilityAnalytics(storeId);
  const { data: view } = useQuery({ ...visibilityQueries.getAi(), initialData: initialView });
  const readyCount = view.readiness.filter((item) => item.ready).length;
  const itemCount = view.readiness.length;

  const tracked = useRef(false);
  useEffect(() => {
    if (tracked.current) return;
    tracked.current = true;
    analytics.aiViewed({
      readyCount: initialView.readiness.filter((item) => item.ready).length,
      itemCount: initialView.readiness.length,
      aiVisits: initialView.visits.total,
      aiCrawls: initialView.crawls.total,
    });
  }, [analytics, initialView]);

  return (
    <DashboardSectionCard
      title={t("title")}
      icon={Sparkles}
      accent="progress"
      action={
        <Badge variant={readyCount === itemCount ? "success" : "tertiary"}>
          {t("readyCount", { ready: readyCount, total: itemCount })}
        </Badge>
      }
      contentClassName="space-y-4"
    >
      {/* In the body, not the header: the header clamps its description to one line. */}
      <p className="text-muted-foreground text-sm">{t("description")}</p>

      {!indexingEnabled && (
        <Alert variant="warning">
          <AlertDescription>{t("indexingOff")}</AlertDescription>
        </Alert>
      )}

      <ul className="divide-y rounded-xl border">
        {view.readiness.map((item) => (
          <AiReadinessRow
            key={item.key}
            item={item}
            onFix={() => analytics.aiFixOpened(item.key)}
          />
        ))}
      </ul>

      <div className="grid grid-cols-2 gap-3">
        <AiVisibilityStat value={view.visits.total} label={t("stats.visits")} />
        <AiVisibilityStat value={view.crawls.total} label={t("stats.crawls")} />
      </div>

      <Collapsible>
        <CollapsibleTrigger className="text-muted-foreground hover:text-foreground group flex items-center gap-1 text-sm">
          {t("details")}
          <ChevronDown className="size-3.5 transition-transform group-data-[panel-open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <div className="space-y-4 pt-3 text-sm">
            <AiAssistantTable view={view} />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p>{t("llmsTxt.reads", { count: view.crawls.llmsTxt })}</p>
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                render={<a href={llmsTxtUrl} target="_blank" rel="noopener noreferrer" />}
                onClick={() => analytics.aiFixOpened("llms_txt")}
              >
                {t("llmsTxt.open")}
                <ExternalLink />
              </Button>
            </div>
            <p className="text-muted-foreground">{t("note")}</p>
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </DashboardSectionCard>
  );
};
