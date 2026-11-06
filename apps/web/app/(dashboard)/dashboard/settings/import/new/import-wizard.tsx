"use client";

import Link from "next/link";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { Button, StepActions, StepContent, Stepper } from "@louez/ui";

import { getImportRequirements } from "@/lib/import/util.import-mapping";
import { orpc } from "@/lib/orpc/react";

import { ImportColumnsStep } from "./import-columns-step";
import { ImportFileStep } from "./import-file-step";
import { ImportReviewStep } from "./import-review-step";
import { ImportRunStep } from "./import-run-step";
import { ImportSourceStep } from "./import-source-step";
import { IMPORT_STEP_IDS } from "./import-wizard.types";
import { useImportWizard } from "./use-import-wizard";

export const ImportWizard = () => {
  const t = useTranslations("dashboard.settings.import");
  const wizard = useImportWizard();
  const { step, data, runId } = wizard;
  const isMappingReady = getImportRequirements(wizard.entity, wizard.mapping).every(
    (requirement) => requirement.isMet,
  );

  // Same query as the review step (deduplicated): the primary button names how many rows will be written.
  const { data: preview } = useQuery({
    ...orpc.dashboard.imports.preview.queryOptions({ input: { runId: runId ?? "" } }),
    enabled: step === 3 && runId !== null,
  });
  const writable = preview ? preview.counts.create + preview.counts.update : 0;

  const steps = IMPORT_STEP_IDS.map((id) => ({
    id,
    title: t(`steps.${id}`),
    description: t(`steps.${id}Description`),
  }));

  return (
    <div className="space-y-6">
      <Stepper steps={steps} currentStep={step} />

      <StepContent key={step} direction={wizard.direction}>
        {step === 0 && (
          <ImportSourceStep
            entity={wizard.entity}
            origin={wizard.origin}
            onEntityChange={wizard.setEntity}
            onOriginChange={wizard.setOrigin}
          />
        )}
        {step === 1 && (
          <ImportFileStep origin={wizard.origin} data={data} onData={wizard.setData} />
        )}
        {step === 2 && data && (
          <ImportColumnsStep
            entity={wizard.entity}
            data={data}
            mapping={wizard.mapping}
            suggested={wizard.suggested}
            onMappingChange={wizard.setMapping}
          />
        )}
        {step === 3 && data && runId && (
          <ImportReviewStep
            entity={wizard.entity}
            runId={runId}
            columns={data.table.headers}
            strategy={wizard.strategy}
            onStrategyChange={wizard.setStrategy}
          />
        )}
        {step === 4 && runId && (
          <ImportRunStep
            entity={wizard.entity}
            runId={runId}
            counts={wizard.counts}
            isComplete={wizard.isComplete}
          />
        )}
      </StepContent>

      {step < 4 && (
        <StepActions>
          {step === 0 ? (
            <Button render={<Link href="/dashboard/settings/import" />} variant="ghost">
              {t("actions.cancel")}
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              // Once rows are staged the file step is behind: going back would stage them twice.
              disabled={step === 2 || wizard.stage.isPending}
              onClick={() => wizard.go(step - 1)}
            >
              {t("actions.back")}
            </Button>
          )}

          {step === 0 && (
            <Button type="button" onClick={() => wizard.go(1)}>
              {t("actions.next")}
            </Button>
          )}
          {step === 1 && (
            <Button
              type="button"
              disabled={!data}
              isPending={wizard.stage.isPending}
              onClick={() => data && wizard.stage.mutate(data)}
            >
              {wizard.stage.isPending && data
                ? t("file.staging", { done: wizard.staged, total: data.table.rows.length })
                : t("actions.next")}
            </Button>
          )}
          {step === 2 && (
            <Button
              type="button"
              disabled={!isMappingReady}
              isPending={wizard.saveMapping.isPending}
              onClick={() => wizard.saveMapping.mutate()}
            >
              {t("actions.next")}
            </Button>
          )}
          {step === 3 && (
            <Button
              type="button"
              disabled={writable === 0}
              isPending={wizard.run.isPending}
              onClick={() => wizard.run.mutate()}
            >
              {wizard.entity === "products"
                ? t("products.start", { count: writable })
                : t("review.start", { count: writable })}
            </Button>
          )}
        </StepActions>
      )}
    </div>
  );
};
