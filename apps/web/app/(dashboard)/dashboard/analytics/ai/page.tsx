import Link from "next/link";
import { redirect } from "next/navigation";

import { getTranslations } from "next-intl/server";

import { Button, Card } from "@louez/ui";
import {
  CartSolidIcon,
  ChartColumnIcon,
  EyeIcon,
  ParticipantsSolidIcon,
  PercentageIcon,
  SparklesIcon,
} from "@louez/ui/icons";

import { DashboardEmptyState } from "@/components/dashboard/shared/dashboard-empty-state";
import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";
import { DashboardStatCard } from "@/components/dashboard/shared/dashboard-stat-card";
import { AiAssistantTable } from "@/components/dashboard/visibility/ai-assistant-table";
import { canUseAiVisibility } from "@/lib/ai-visibility/entitlement";
import { serverApi } from "@/lib/api/server-api";
import { getRequestFormatLocale } from "@/lib/i18n/format-locale.server";
import { getCurrentStore } from "@/lib/store-context";

import { parsePeriod } from "../period";
import { STATS_GRID_CLASS_NAME } from "../stats-grid";
import { TrendChart } from "../trend-chart";
import { AiTrafficNote } from "./ai-traffic-note";
import { AiTrafficViewed } from "./ai-traffic-viewed";
import { percentChange, shareOf, toAiTrendPoints } from "./util.ai-trend";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

interface AiTrafficPageProps {
  searchParams: Promise<{ period?: string }>;
}

/**
 * Analyses → Assistants IA: the visits ChatGPT, Perplexity, Claude, Gemini or
 * Copilot sent over the period, the reservations made during them, and their
 * crawlers' reads. Counted as described in docs/analytics/visibility.md.
 */
export default async function AiTrafficPage({ searchParams }: AiTrafficPageProps) {
  const store = await getCurrentStore();
  if (!store) redirect("/onboarding");
  const t = await getTranslations("dashboard.analytics.ai");

  if (!(await canUseAiVisibility(store))) {
    return (
      <Card className="items-center pb-8">
        <DashboardEmptyState
          icon={SparklesIcon}
          title={t("notIncluded.title")}
          description={t("notIncluded.description")}
        />
      </Card>
    );
  }

  const period = parsePeriod((await searchParams).period);
  const [api, { intl }] = await Promise.all([serverApi(), getRequestFormatLocale()]);
  const view = await api.visibility.getAiTraffic({ period });
  const share = shareOf(view.visits.total, view.visits.all);

  return (
    <div className="space-y-4 sm:space-y-6">
      <AiTrafficViewed
        storeId={store.id}
        aiVisits={view.visits.total}
        aiCrawls={view.crawls.total}
      />

      <div className={STATS_GRID_CLASS_NAME}>
        <DashboardStatCard
          title={t("stats.visits")}
          value={view.visits.total.toLocaleString(intl)}
          icon={ParticipantsSolidIcon}
          accent="progress"
          trend={percentChange(view.visits.total, view.visits.previous)}
          subtitle={t("stats.vsPrevious")}
        />
        <DashboardStatCard
          title={t("stats.share")}
          value={
            share === null
              ? "—"
              : new Intl.NumberFormat(intl, { style: "percent", maximumFractionDigits: 1 }).format(
                  share / 100,
                )
          }
          icon={PercentageIcon}
          accent="submitted"
          subtitle={t("stats.shareOf", { count: view.visits.all })}
        />
        <DashboardStatCard
          title={t("stats.bookings")}
          value={view.bookings.total.toLocaleString(intl)}
          icon={CartSolidIcon}
          accent="success"
          subtitle={t("stats.bookingsSubtitle")}
        />
        <DashboardStatCard
          title={t("stats.crawls")}
          value={view.crawls.total.toLocaleString(intl)}
          icon={EyeIcon}
          accent="neutral"
          subtitle={t("stats.llmsTxt", { count: view.crawls.llmsTxt })}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <DashboardSectionCard
          title={t("trend.title")}
          description={t("trend.description")}
          icon={ChartColumnIcon}
          accent="progress"
          className="lg:col-span-2"
        >
          <TrendChart
            data={toAiTrendPoints(view, intl)}
            labels={{ visitors: t("trend.visits"), conversions: t("trend.bookings") }}
          />
        </DashboardSectionCard>

        <DashboardSectionCard
          title={t("byAssistant.title")}
          icon={SparklesIcon}
          accent="success"
          contentClassName="space-y-4"
        >
          <AiAssistantTable rows={view.byAssistant} />
          <Button variant="outline" size="sm" render={<Link href="/dashboard/visibility/ai" />}>
            {t("improve")}
          </Button>
        </DashboardSectionCard>
      </div>

      <AiTrafficNote />
    </div>
  );
}
