"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, Checkbox, toastManager } from "@louez/ui";
import { cn } from "@louez/utils";

import {
  IMAGE_PROCESSING_BENCHMARK_FILTER,
  IMAGE_PROCESSING_BENCHMARK_VARIANTS,
} from "@/lib/ai/image/benchmark-fixtures";

interface BenchmarkCase {
  id: string;
  label: string;
  description: string;
  previewUrl: string;
}

interface ImageProcessingBenchmarkButtonProps {
  cases: BenchmarkCase[];
}

type BenchmarkState =
  | { status: "idle" }
  | { status: "running"; current: number; total: number; label: string };

export const ImageProcessingBenchmarkButton = ({ cases }: ImageProcessingBenchmarkButtonProps) => {
  const router = useRouter();
  const [state, setState] = useState<BenchmarkState>({ status: "idle" });
  const [enabledCaseIds, setEnabledCaseIds] = useState(() => new Set(cases.map(({ id }) => id)));
  const [enabledVariantIds, setEnabledVariantIds] = useState(
    () =>
      new Set<string>(
        IMAGE_PROCESSING_BENCHMARK_VARIANTS.filter((variant) => variant.selectedByDefault).map(
          ({ id }) => id,
        ),
      ),
  );
  const selectedCases = cases.filter(({ id }) => enabledCaseIds.has(id));
  const selectedVariants = IMAGE_PROCESSING_BENCHMARK_VARIANTS.filter(({ id }) =>
    enabledVariantIds.has(id),
  );
  // Image by image, every selected variant in a row, so results compare side by side.
  const runs = selectedCases.flatMap((benchmarkCase) =>
    selectedVariants.map((variant) => ({ benchmarkCase, variant })),
  );
  const isRunning = state.status === "running";

  const setVariantEnabled = (variantId: string, enabled: boolean) => {
    if (isRunning) return;
    setEnabledVariantIds((current) => {
      const next = new Set(current);
      if (enabled) next.add(variantId);
      else next.delete(variantId);
      return next;
    });
  };

  const setCaseEnabled = (caseId: string, enabled: boolean) => {
    if (isRunning) return;
    setEnabledCaseIds((current) => {
      const next = new Set(current);
      if (enabled) next.add(caseId);
      else next.delete(caseId);
      return next;
    });
  };

  const runBenchmark = async () => {
    if (isRunning || runs.length === 0) return;

    const suiteId = crypto.randomUUID();
    for (const [index, { benchmarkCase, variant }] of runs.entries()) {
      const runLabel = `${benchmarkCase.label} · ${variant.label}`;
      setState({
        status: "running",
        current: index + 1,
        total: runs.length,
        label: runLabel,
      });

      let response: Response;
      try {
        response = await fetch("/api/dev/image-processing/benchmark", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            suiteId,
            fixtureId: benchmarkCase.id,
            variantId: variant.id,
            suiteSize: runs.length,
          }),
        });
      } catch {
        setState({ status: "idle" });
        toastManager.add({
          title: `Suite interrompue sur « ${runLabel} »`,
          description:
            "La requête réseau n’a pas abouti. Les tests déjà terminés restent visibles.",
          type: "error",
        });
        router.push(
          `/dev/image-processing?store=${IMAGE_PROCESSING_BENCHMARK_FILTER}&suite=${suiteId}`,
        );
        return;
      }

      if (!response.ok) {
        setState({ status: "idle" });
        toastManager.add({
          title: `Suite interrompue sur « ${runLabel} »`,
          description: `Le serveur a répondu avec le statut ${response.status}. Les tests déjà terminés restent visibles.`,
          type: "error",
        });
        router.push(
          `/dev/image-processing?store=${IMAGE_PROCESSING_BENCHMARK_FILTER}&suite=${suiteId}`,
        );
        return;
      }
    }

    setState({ status: "idle" });
    toastManager.add({
      title: "Suite de test terminée",
      description: `${runs.length} générations ont exécuté le flow IA complet.`,
      type: "success",
    });
    router.push(
      `/dev/image-processing?store=${IMAGE_PROCESSING_BENCHMARK_FILTER}&suite=${suiteId}`,
    );
  };

  const progressLabel =
    state.status === "running"
      ? `Test ${state.current}/${state.total}`
      : selectedCases.length === 0
        ? "Sélectionnez une image"
        : selectedVariants.length === 0
          ? "Sélectionnez un modèle"
          : `Lancer ${runs.length} test${runs.length > 1 ? "s" : ""}`;

  return (
    <div className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div className="space-y-1">
          <h2 className="font-semibold">Suite de non-régression IA</h2>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Sélectionnez les images et les modèles, puis exécutez séquentiellement GPT Image, le
            détourage et la standardisation. Aucun crédit boutique n’est débité, mais chaque
            génération (image × modèle) déclenche un appel OpenAI au coût réel.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
          <Button
            type="button"
            onClick={runBenchmark}
            isPending={isRunning}
            pendingContent={progressLabel}
            disabled={runs.length === 0}
          >
            {progressLabel}
          </Button>
          <p className="min-h-4 text-right text-xs text-muted-foreground" aria-live="polite">
            {state.status === "running"
              ? state.label
              : `${selectedCases.length}/${cases.length} image${cases.length > 1 ? "s" : ""} activée${cases.length > 1 ? "s" : ""}`}
          </p>
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Modèles à comparer</legend>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {IMAGE_PROCESSING_BENCHMARK_VARIANTS.map((variant) => (
            <label
              key={variant.id}
              htmlFor={`benchmark-variant-${variant.id}`}
              className={cn(
                "flex items-start gap-2.5 rounded-lg border p-3 text-xs transition-[border-color,opacity]",
                enabledVariantIds.has(variant.id) ? "border-primary/40" : "opacity-60",
                isRunning ? "cursor-default" : "cursor-pointer",
              )}
            >
              <Checkbox
                id={`benchmark-variant-${variant.id}`}
                checked={enabledVariantIds.has(variant.id)}
                disabled={isRunning}
                onCheckedChange={(checked) => setVariantEnabled(variant.id, checked === true)}
              />
              <span className="min-w-0">
                <span className="block font-medium text-foreground">{variant.label}</span>
                <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">
                  {variant.model}
                </span>
                <span className="mt-1 block text-muted-foreground">{variant.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-1">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={isRunning || selectedCases.length === cases.length}
          onClick={() => setEnabledCaseIds(new Set(cases.map(({ id }) => id)))}
        >
          Tout activer
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={isRunning || selectedCases.length === 0}
          onClick={() => setEnabledCaseIds(new Set<string>())}
        >
          Tout désactiver
        </Button>
      </div>

      <ul className="grid gap-3 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {cases.map((benchmarkCase) => (
          <li
            key={benchmarkCase.id}
            className={cn(
              "overflow-hidden rounded-xl border bg-card transition-[border-color,box-shadow,opacity]",
              enabledCaseIds.has(benchmarkCase.id) ? "border-primary/40 shadow-sm" : "opacity-55",
            )}
          >
            <label
              htmlFor={`benchmark-${benchmarkCase.id}`}
              className={cn("block", isRunning ? "cursor-default" : "cursor-pointer")}
            >
              <div className="flex aspect-[4/3] items-center justify-center bg-muted/60">
                {/* Fixtures can be local or hosted on the public demo bucket. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={benchmarkCase.previewUrl}
                  alt={`Aperçu du cas ${benchmarkCase.label}`}
                  className="h-full w-full object-contain"
                  loading="lazy"
                  decoding="async"
                />
              </div>
              <div className="flex items-start gap-2.5 border-t p-3">
                <Checkbox
                  id={`benchmark-${benchmarkCase.id}`}
                  checked={enabledCaseIds.has(benchmarkCase.id)}
                  disabled={isRunning}
                  onCheckedChange={(checked) => setCaseEnabled(benchmarkCase.id, checked === true)}
                  aria-label={`Activer le test ${benchmarkCase.label}`}
                />
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{benchmarkCase.label}</p>
                  <p className="mt-1">{benchmarkCase.description}</p>
                </div>
              </div>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
};
