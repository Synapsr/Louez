"use client";

import Link from "next/link";

import { CheckCircle2, Download, Loader2, Users } from "lucide-react";
import { useTranslations } from "next-intl";

import type { ImportEntityType, ImportRunCounts } from "@louez/types";
import { Button, Progress, ProgressIndicator, ProgressTrack } from "@louez/ui";

import { DashboardStatCard } from "@/components/dashboard/shared/dashboard-stat-card";
import { buildImportErrorReport, downloadTextFile } from "@/lib/import/util.import-report";
import { orpcClient } from "@/lib/orpc/client";

interface ImportRunStepProps {
  entity: ImportEntityType;
  runId: string;
  counts: ImportRunCounts | null;
  isComplete: boolean;
}

/** Progress while the wizard drives the import chunk by chunk, then its outcome. */
export const ImportRunStep = ({ entity, runId, counts, isComplete }: ImportRunStepProps) => {
  const t = useTranslations("dashboard.settings.import");

  const done = counts ? counts.created + counts.updated + counts.skipped + counts.errors : 0;
  const total = counts?.total ?? 0;

  const downloadErrors = async () => {
    const rows = await orpcClient.dashboard.imports.errorRows({ runId });
    downloadTextFile(
      `import-erreurs-${runId}.csv`,
      buildImportErrorReport(rows, {
        line: t("review.row", { index: "" }).trim(),
        reason: t("review.error"),
        translateReason: (code) => {
          if (t.has(`review.reasons.${code}`)) return t(`review.reasons.${code}`);
          return t.has(`products.reasons.${code}`) ? t(`products.reasons.${code}`) : code;
        },
      }),
    );
  };

  if (!isComplete) {
    return (
      <div className="mx-auto max-w-md space-y-4 py-10 text-center">
        <Loader2 className="text-muted-foreground mx-auto size-8 animate-spin" />
        <div>
          <p className="font-medium">{t("run.running")}</p>
          <p className="text-muted-foreground text-sm">{t("run.runningHint")}</p>
        </div>
        <Progress value={total > 0 ? (done / total) * 100 : 0}>
          <ProgressTrack>
            <ProgressIndicator />
          </ProgressTrack>
        </Progress>
        <p className="text-muted-foreground text-sm tabular-nums">
          {t("run.progress", { done, total })}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center gap-3">
        <CheckCircle2 className="text-success size-8 shrink-0" />
        <div>
          <h2 className="text-lg font-semibold">{t("run.doneTitle")}</h2>
          <p className="text-muted-foreground text-sm">{t("run.doneDescription")}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <DashboardStatCard
          title={t("run.created")}
          value={counts?.created ?? 0}
          icon={Users}
          accent="success"
        />
        <DashboardStatCard
          title={t("run.updated")}
          value={counts?.updated ?? 0}
          icon={Users}
          accent="progress"
        />
        <DashboardStatCard
          title={t("run.skipped")}
          value={counts?.skipped ?? 0}
          icon={Users}
          accent="neutral"
        />
        <DashboardStatCard
          title={t("run.errors")}
          value={counts?.errors ?? 0}
          icon={Users}
          accent="pending"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {entity === "products" ? (
          <Button render={<Link href="/dashboard/products?status=draft" />}>
            {t("products.view")}
          </Button>
        ) : (
          <Button render={<Link href={`/dashboard/customers?import=${runId}`} />}>
            {t("run.viewCustomers")}
          </Button>
        )}
        {(counts?.errors ?? 0) > 0 && (
          <Button type="button" variant="outline" onClick={downloadErrors}>
            <Download className="size-4" />
            {t("run.downloadErrors")}
          </Button>
        )}
        <Button render={<Link href="/dashboard/settings/import/new" />} variant="ghost">
          {t("run.another")}
        </Button>
      </div>
    </div>
  );
};
