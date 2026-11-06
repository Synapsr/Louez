"use client";

import { useState } from "react";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import type {
  ImportColumnMapping,
  ImportDuplicateStrategy,
  ImportEntityType,
  ImportRunCounts,
} from "@louez/types";
import { toastManager } from "@louez/ui";
import { IMPORT_LIMITS } from "@louez/validations";

import { chunkRows } from "@/lib/import/util.import-file";
import { orpcClient } from "@/lib/orpc/client";
import { getErrorMessageKey } from "@/lib/utils/util.error-message";

import type { ImportOrigin, ImportSourceData } from "./import-wizard.types";

/** Everything the wizard holds between its steps, and the server calls that move it forward. */
export const useImportWizard = () => {
  const tErrors = useTranslations("errors");
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<"forward" | "backward">("forward");
  const [entity, setEntity] = useState<ImportEntityType>("customers");
  const [origin, setOrigin] = useState<ImportOrigin>("file");
  const [data, setData] = useState<ImportSourceData | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ImportColumnMapping>({});
  const [suggested, setSuggested] = useState<ImportColumnMapping>({});
  const [strategy, setStrategy] = useState<ImportDuplicateStrategy>("fill_empty");
  const [staged, setStaged] = useState(0);
  const [counts, setCounts] = useState<ImportRunCounts | null>(null);
  const [isComplete, setIsComplete] = useState(false);

  const go = (next: number) => {
    setDirection(next > step ? "forward" : "backward");
    setStep(next);
  };

  const onError = (error: unknown) => {
    const key = getErrorMessageKey(error);
    toastManager.add({
      title: tErrors.has(key) ? tErrors(key) : tErrors("generic"),
      type: "error",
    });
  };

  /** Creates the run and sends the rows, a few hundred per request. */
  const stage = useMutation({
    mutationFn: async (source: ImportSourceData) => {
      const run = await orpcClient.dashboard.imports.createRun({
        entityType: entity,
        source: source.origin === "paste" ? "paste" : "csv",
        fileName: source.fileName,
        columns: source.table.headers,
      });
      let offset = 0;
      for (const rows of chunkRows(source.table.rows, IMPORT_LIMITS.rowsPerCall)) {
        await orpcClient.dashboard.imports.stageRows({ runId: run.id, offset, rows });
        offset += rows.length;
        setStaged(offset);
      }
      return run;
    },
    onSuccess: (run) => {
      setRunId(run.id);
      setMapping(run.mapping);
      setSuggested(run.mapping);
      go(2);
    },
    onError,
  });

  const saveMapping = useMutation({
    mutationFn: async () => {
      if (!runId) return;
      await orpcClient.dashboard.imports.updateRun({ runId, mapping, duplicateStrategy: strategy });
    },
    onSuccess: () => go(3),
    onError,
  });

  /** Starts the import, then asks for the next chunk until none is left. */
  const run = useMutation({
    mutationFn: async () => {
      if (!runId) return;
      await orpcClient.dashboard.imports.start({ runId });
      go(4);
      let status = "running";
      while (status === "running") {
        const progress = await orpcClient.dashboard.imports.processNext({ runId });
        setCounts(progress.counts);
        status = progress.status;
      }
      setIsComplete(true);
    },
    onError,
  });

  return {
    step,
    direction,
    go,
    entity,
    setEntity,
    origin,
    setOrigin: (next: ImportOrigin) => {
      setOrigin(next);
      setData(null);
    },
    data,
    setData,
    runId,
    mapping,
    setMapping,
    suggested,
    strategy,
    setStrategy,
    staged,
    counts,
    isComplete,
    stage,
    saveMapping,
    run,
  };
};
