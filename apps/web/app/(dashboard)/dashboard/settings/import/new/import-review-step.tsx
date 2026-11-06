"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import type { ImportDuplicateStrategy, ImportEntityType } from "@louez/types";
import {
  Badge,
  Card,
  CardPanel,
  Skeleton,
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
} from "@louez/ui";

import { FormRadioCardGroup } from "@/components/form/form-radio-card-group";
import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";
import { orpc } from "@/lib/orpc/react";

import { ImportReviewRow } from "./import-review-row";

interface ImportReviewStepProps {
  entity: ImportEntityType;
  runId: string;
  columns: string[];
  strategy: ImportDuplicateStrategy;
  onStrategyChange: (strategy: ImportDuplicateStrategy) => void;
}

const ACTIONS = ["create", "update", "skip", "error"] as const;

export const ImportReviewStep = ({
  entity,
  runId,
  columns,
  strategy,
  onStrategyChange,
}: ImportReviewStepProps) => {
  const t = useTranslations("dashboard.settings.import.review");
  const tProducts = useTranslations("dashboard.settings.import.products");
  const isProducts = entity === "products";
  const queryClient = useQueryClient();

  const previewOptions = orpc.dashboard.imports.preview.queryOptions({ input: { runId } });
  const { data: preview, isPending } = useQuery(previewOptions);
  const refresh = () => queryClient.invalidateQueries({ queryKey: previewOptions.queryKey });

  const updateRun = useMutation(
    orpc.dashboard.imports.updateRun.mutationOptions({ onSuccess: refresh }),
  );
  const updateRow = useMutation(
    orpc.dashboard.imports.updateRow.mutationOptions({ onSuccess: refresh }),
  );

  if (isPending || !preview) return <Skeleton className="h-72 w-full" />;

  const firstWithRows = ACTIONS.find((action) => preview.counts[action] > 0) ?? "create";

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="text-muted-foreground text-sm">
          {t("description")}{" "}
          {isProducts
            ? tProducts("existingNote")
            : t("dateOrder", { format: t(preview.dateOrder) })}
        </p>
      </div>

      <Card>
        <CardPanel className="grid grid-cols-2 divide-x divide-y p-0 sm:grid-cols-4 sm:divide-y-0">
          {ACTIONS.map((action) => (
            <div key={action} className="p-4">
              <p className="text-muted-foreground text-xs font-medium">{t(action)}</p>
              <p className="text-xl font-semibold tabular-nums sm:text-2xl">
                {preview.counts[action]}
              </p>
            </div>
          ))}
        </CardPanel>
      </Card>

      {preview.counts.update > 0 || strategy !== "fill_empty" ? (
        <FormRadioCardGroup
          label={isProducts ? tProducts("strategyTitle") : t("strategyTitle")}
          columns={3}
          value={strategy}
          onChange={(next) => {
            onStrategyChange(next);
            updateRun.mutate({ runId, duplicateStrategy: next });
          }}
          options={[
            {
              value: "fill_empty",
              label: t("fillEmpty"),
              description: isProducts
                ? tProducts("fillEmptyDescription")
                : t("fillEmptyDescription"),
            },
            {
              value: "overwrite",
              label: t("overwrite"),
              description: isProducts
                ? tProducts("overwriteDescription")
                : t("overwriteDescription"),
            },
            {
              value: "skip",
              label: t("skipExisting"),
              description: isProducts
                ? tProducts("skipExistingDescription")
                : t("skipExistingDescription"),
            },
          ]}
        />
      ) : null}

      <DashboardSectionCard title={t("title")} contentClassName="p-0 sm:p-0">
        <Tabs defaultValue={firstWithRows}>
          <div className="overflow-x-auto px-4 sm:px-5">
            <TabsList variant="underline" className="w-max">
              {ACTIONS.map((action) => (
                <TabsTab key={action} value={action}>
                  {t(action)}
                  <Badge variant={action === "error" ? "failed" : "secondary"} size="sm">
                    {preview.counts[action]}
                  </Badge>
                </TabsTab>
              ))}
            </TabsList>
          </div>
          {ACTIONS.map((action) => (
            <TabsPanel key={action} value={action}>
              {preview.samples[action].length === 0 ? (
                <p className="text-muted-foreground p-6 text-center text-sm">{t("emptyTab")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead />
                        {columns.map((column) => (
                          <TableHead key={column} className="whitespace-nowrap">
                            {column}
                          </TableHead>
                        ))}
                        <TableHead />
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.samples[action].map((row) => (
                        <ImportReviewRow
                          key={row.rowIndex}
                          row={row}
                          columns={columns}
                          isSaving={updateRow.isPending}
                          onSave={(rowIndex, payload) =>
                            updateRow.mutate({ runId, rowIndex, payload })
                          }
                        />
                      ))}
                    </TableBody>
                  </Table>
                  {preview.counts[action] > preview.samples[action].length && (
                    <p className="text-muted-foreground border-t p-3 text-xs">
                      {t("sampleNote", { count: preview.samples[action].length })}
                    </p>
                  )}
                </div>
              )}
            </TabsPanel>
          ))}
        </Tabs>
      </DashboardSectionCard>
    </div>
  );
};
