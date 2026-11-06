"use client";

import { useState } from "react";

import Link from "next/link";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, MoreHorizontal } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Skeleton,
  toastManager,
} from "@louez/ui";

import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { buildImportErrorReport, downloadTextFile } from "@/lib/import/util.import-report";
import { orpcClient } from "@/lib/orpc/client";
import { orpc } from "@/lib/orpc/react";
import { formatStoreDate } from "@/lib/utils/store-date";
import { getErrorMessageKey } from "@/lib/utils/util.error-message";

interface ImportHistoryProps {
  timezone: string | null;
}

const STATUS_VARIANTS = {
  draft: "secondary",
  ready: "secondary",
  running: "progress",
  completed: "success",
  failed: "failed",
  reverted: "expired",
} as const;

export const ImportHistory = ({ timezone }: ImportHistoryProps) => {
  const t = useTranslations("dashboard.settings.import");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [reverting, setReverting] = useState<string | null>(null);

  const listOptions = orpc.dashboard.imports.list.queryOptions();
  const { data: runs, isPending } = useQuery(listOptions);

  const revert = useMutation(
    orpc.dashboard.imports.revert.mutationOptions({
      onSuccess: (result) => {
        toastManager.add({ title: t("history.revertDone", result), type: "success" });
        queryClient.invalidateQueries({ queryKey: listOptions.queryKey });
      },
      onError: (error) => {
        const key = getErrorMessageKey(error);
        toastManager.add({
          title: tErrors.has(key) ? tErrors(key) : tErrors("generic"),
          type: "error",
        });
      },
      onSettled: () => setReverting(null),
    }),
  );

  const downloadErrors = async (runId: string) => {
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

  if (isPending) return <Skeleton className="h-40 w-full" />;

  if (!runs || runs.length === 0) {
    return (
      <EmptyState
        icon={FileSpreadsheet}
        title={t("history.empty")}
        description={t("history.emptyDescription")}
      />
    );
  }

  return (
    <DashboardSectionCard title={t("history.title")}>
      <ul className="divide-y">
        {runs.map((run) => (
          <li key={run.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
            <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
              <FileSpreadsheet className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <span className="truncate">
                  {run.fileName ?? t(`history.entity.${run.entityType}`)}
                </span>
                <Badge variant={STATUS_VARIANTS[run.status]} size="sm">
                  {t(`history.status.${run.status}`)}
                </Badge>
              </p>
              <p className="text-muted-foreground text-xs">
                {formatStoreDate(run.createdAt, timezone ?? undefined, "DATE_AT_TIME", locale)}
                {run.counts && ` · ${t("history.result", run.counts)}`}
              </p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon" aria-label={t("history.title")} />}
              >
                <MoreHorizontal className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {run.entityType === "products" ? (
                  <DropdownMenuItem render={<Link href="/dashboard/products?status=draft" />}>
                    {t("products.viewHistory")}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    render={<Link href={`/dashboard/customers?import=${run.id}`} />}
                  >
                    {t("history.viewCustomers")}
                  </DropdownMenuItem>
                )}
                {(run.counts?.errors ?? 0) > 0 && (
                  <DropdownMenuItem onClick={() => downloadErrors(run.id)}>
                    {t("history.downloadErrors")}
                  </DropdownMenuItem>
                )}
                {run.status === "completed" && (
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setReverting(run.id)}
                  >
                    {t("history.revert")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ))}
      </ul>

      <AlertDialog open={reverting !== null} onOpenChange={(open) => !open && setReverting(null)}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("history.revertTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("history.revertDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {t("history.keep")}
            </AlertDialogClose>
            <Button
              variant="destructive"
              isPending={revert.isPending}
              onClick={() => reverting && revert.mutate({ runId: reverting })}
            >
              {t("history.revertConfirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </DashboardSectionCard>
  );
};
