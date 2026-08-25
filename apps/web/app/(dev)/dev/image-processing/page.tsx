import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";

import { Badge, Card, CardDescription, CardHeader, CardPanel, CardTitle } from "@louez/ui";

import {
  type ImageProcessingDebugRun,
  isImageProcessingDebugEnabled,
  listImageProcessingDebugRuns,
} from "@/lib/ai/image/debug-artifacts";
import {
  IMAGE_PROCESSING_BENCHMARK_CASES,
  IMAGE_PROCESSING_BENCHMARK_FILTER,
  IMAGE_PROCESSING_BENCHMARK_SCOPE_ID,
} from "@/lib/ai/image/benchmark-fixtures";
import { auth } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { getUserStores, hasPermission } from "@/lib/store-context";
import { createLoginUrl } from "@/lib/utils/util.url";

import { ImageProcessingBenchmarkButton } from "./image-processing-benchmark-button";
import { ImageProcessingStoreFilter } from "./image-processing-store-filter";
import { FORMAT_LOCALE } from "@/lib/i18n/format-locale";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = {
  title: "Traitement des images · Dev",
  robots: {
    index: false,
    follow: false,
  },
};

const dateFormatter = new Intl.DateTimeFormat(FORMAT_LOCALE, {
  dateStyle: "medium",
  timeStyle: "medium",
  timeZone: "Europe/Paris",
});

const usdFormatter = new Intl.NumberFormat(FORMAT_LOCALE, {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 3,
  maximumFractionDigits: 4,
});

const eurFormatter = new Intl.NumberFormat(FORMAT_LOCALE, {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 3,
});

const numberFormatter = new Intl.NumberFormat(FORMAT_LOCALE, {
  maximumFractionDigits: 2,
});

const searchParamsSchema = z.object({
  store: z.union([z.string().length(21), z.literal(IMAGE_PROCESSING_BENCHMARK_FILTER)]).optional(),
  suite: z.uuid().optional(),
});

interface ImageProcessingDevPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)} s`;
}

function formatByteSize(byteSize: number): string {
  if (byteSize < 1024 * 1024) return `${Math.round(byteSize / 1024)} Ko`;
  return `${(byteSize / (1024 * 1024)).toFixed(1)} Mo`;
}

function filenameFromKey(key: string): string {
  return key.split("/").pop() ?? key;
}

function formatRange(range: { min: number; max: number }, formatter: Intl.NumberFormat): string {
  if (Math.abs(range.max - range.min) < 0.000_001) return formatter.format(range.min);
  return `${formatter.format(range.min)} – ${formatter.format(range.max)}`;
}

function formatPercentageRange(range: { min: number; max: number }): string {
  if (Math.abs(range.max - range.min) < 0.01) {
    return `${numberFormatter.format(range.min)} %`;
  }
  return `${numberFormatter.format(range.min)} – ${numberFormatter.format(range.max)} %`;
}

function providerCostSourceLabel(
  source: NonNullable<ImageProcessingDebugRun["economics"]>["providerCostSource"],
): string {
  if (source === "measured_usage") return "usage OpenAI mesuré";
  if (source === "configured_flat") return "forfait configuré";
  return "coût non disponible";
}

function summarizeEconomics(runs: ImageProcessingDebugRun[]) {
  const economics = runs.flatMap((run) => (run.economics ? [run.economics] : []));
  if (economics.length === 0) return null;

  const costed = economics.filter(
    (item): item is typeof item & { providerCostUsd: number } => item.providerCostUsd !== null,
  );
  const priced = economics.filter(
    (item): item is typeof item & { modeledRevenueEur: { min: number; max: number } } =>
      item.modeledRevenueEur !== null,
  );
  const margined = economics.filter(
    (
      item,
    ): item is typeof item & {
      modeledRevenueEur: { min: number; max: number };
      grossMarginEur: { min: number; max: number };
    } => item.modeledRevenueEur !== null && item.grossMarginEur !== null,
  );
  const totalRevenue = priced.reduce(
    (total, item) => ({
      min: total.min + item.modeledRevenueEur.min,
      max: total.max + item.modeledRevenueEur.max,
    }),
    { min: 0, max: 0 },
  );
  const totalMargin = margined.reduce(
    (total, item) => ({
      min: total.min + item.grossMarginEur.min,
      max: total.max + item.grossMarginEur.max,
    }),
    { min: 0, max: 0 },
  );
  const totalMarginedRevenue = margined.reduce(
    (total, item) => ({
      min: total.min + item.modeledRevenueEur.min,
      max: total.max + item.modeledRevenueEur.max,
    }),
    { min: 0, max: 0 },
  );

  return {
    runCount: economics.length,
    costedRunCount: costed.length,
    marginedRunCount: margined.length,
    tariffCredits: economics.reduce((total, item) => total + item.tariffCredits, 0),
    chargedCredits: economics.reduce((total, item) => total + item.chargedCredits, 0),
    providerCostUsd: costed.reduce((total, item) => total + item.providerCostUsd, 0),
    modeledRevenueEur: priced.length > 0 ? totalRevenue : null,
    grossMarginPercent:
      margined.length > 0 && totalMarginedRevenue.min > 0
        ? {
            min: (totalMargin.min / totalMarginedRevenue.min) * 100,
            max: (totalMargin.max / totalMarginedRevenue.max) * 100,
          }
        : null,
  };
}

const ImageProcessingDevPage = async ({ searchParams }: ImageProcessingDevPageProps) => {
  await connection();

  if (!isImageProcessingDebugEnabled()) {
    notFound();
  }

  const session = await auth();
  if (!session?.user?.id) {
    redirect(createLoginUrl("/dev/image-processing"));
  }

  const canRunBenchmark = isPlatformAdmin(session.user.email);

  const readableStores = (await getUserStores()).filter((store) =>
    hasPermission(store.role, "read"),
  );
  if (readableStores.length === 0 && !canRunBenchmark) {
    redirect("/onboarding");
  }

  const parsedSearchParams = searchParamsSchema.safeParse(await searchParams);
  if (!parsedSearchParams.success) {
    notFound();
  }

  const selectedScope = parsedSearchParams.data.store ?? null;
  const selectedBenchmark = selectedScope === IMAGE_PROCESSING_BENCHMARK_FILTER;
  if (selectedBenchmark && !canRunBenchmark) {
    notFound();
  }
  if (parsedSearchParams.data.suite && !selectedBenchmark) {
    notFound();
  }

  const selectedStoreId = selectedBenchmark ? null : selectedScope;
  const selectedStore = selectedStoreId
    ? readableStores.find((store) => store.id === selectedStoreId)
    : null;
  if (selectedStoreId && !selectedStore) {
    notFound();
  }

  const storeRuns = selectedBenchmark
    ? []
    : (
        await Promise.all(
          (selectedStore ? [selectedStore] : readableStores).map(async (store) => {
            const runs = await listImageProcessingDebugRuns(store.id);
            return runs.map((run) => ({
              run,
              scope: { kind: "store" as const, id: store.id, name: store.name },
            }));
          }),
        )
      ).flat();
  const benchmarkRuns = selectedBenchmark
    ? (await listImageProcessingDebugRuns(IMAGE_PROCESSING_BENCHMARK_SCOPE_ID, 100))
        .filter(
          (run) =>
            !parsedSearchParams.data.suite ||
            run.benchmark?.suiteId === parsedSearchParams.data.suite,
        )
        .map((run) => ({
          run,
          scope: {
            kind: "benchmark" as const,
            id: IMAGE_PROCESSING_BENCHMARK_SCOPE_ID,
            name: "Suite de test",
          },
        }))
    : [];
  const runs = [...storeRuns, ...benchmarkRuns]
    .sort(
      (left, right) =>
        new Date(right.run.createdAt).getTime() - new Date(left.run.createdAt).getTime(),
    )
    .slice(0, 25);
  const economicsSummary = summarizeEconomics(runs.map(({ run }) => run));
  const benchmarkSuiteSize =
    runs.find(({ run }) => run.benchmark?.suiteSize)?.run.benchmark?.suiteSize ??
    IMAGE_PROCESSING_BENCHMARK_CASES.length;
  const scopeLabel = selectedBenchmark
    ? parsedSearchParams.data.suite
      ? `la suite ${parsedSearchParams.data.suite.slice(0, 8)}`
      : "la suite de test"
    : selectedStore
      ? `la boutique « ${selectedStore.name} »`
      : "vos boutiques";

  return (
    <main className="min-h-screen bg-muted/20 px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-8">
        <header className="space-y-4 border-b pb-6">
          <Badge variant="pending" className="w-fit">
            Diagnostic privé
          </Badge>
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Comparaison du traitement des images
            </h1>
            <p className="max-w-3xl text-sm text-muted-foreground sm:text-base">
              Les 25 derniers traitements de {scopeLabel}. Chaque colonne montre exactement l’image
              produite à cette étape. Les fichiers restent privés et accessibles uniquement aux
              membres autorisés.
            </p>
          </div>
        </header>

        {canRunBenchmark ? (
          <ImageProcessingBenchmarkButton
            cases={IMAGE_PROCESSING_BENCHMARK_CASES.map(
              ({ id, label, description, previewUrl }) => ({
                id,
                label,
                description,
                previewUrl,
              }),
            )}
          />
        ) : null}

        <section
          className="flex flex-col justify-between gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-end"
          aria-label="Filtrer les traitements"
        >
          <ImageProcessingStoreFilter
            stores={readableStores.map(({ id, name }) => ({ id, name }))}
            selectedStoreId={selectedScope}
            allowBenchmark={canRunBenchmark}
          />
          <p className="text-xs text-muted-foreground">
            {selectedBenchmark && parsedSearchParams.data.suite ? (
              <>
                {runs.length}/{benchmarkSuiteSize} cas terminé
                {runs.length > 1 ? "s" : ""}
              </>
            ) : (
              <>
                {runs.length} traitement{runs.length > 1 ? "s" : ""} affiché
                {runs.length > 1 ? "s" : ""}
              </>
            )}
          </p>
        </section>

        {economicsSummary ? (
          <section className="space-y-3" aria-labelledby="economics-summary-title">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 id="economics-summary-title" className="text-lg font-semibold">
                  Économie des générations IA capturées
                </h2>
                <p className="text-xs text-muted-foreground">
                  La marge est indicative : avant TVA, frais Stripe, stockage et calcul du worker.
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                {economicsSummary.runCount} génération
                {economicsSummary.runCount > 1 ? "s" : ""} avec données économiques
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border bg-card p-4">
                <p className="text-xs text-muted-foreground">Tarif simulé</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {numberFormatter.format(economicsSummary.tariffCredits)} crédits
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {numberFormatter.format(economicsSummary.chargedCredits)} réellement débités
                </p>
              </div>

              <div className="rounded-xl border bg-card p-4">
                <p className="text-xs text-muted-foreground">Coût fournisseur cumulé</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {economicsSummary.costedRunCount > 0
                    ? usdFormatter.format(economicsSummary.providerCostUsd)
                    : "Non disponible"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {economicsSummary.costedRunCount}/{economicsSummary.runCount} générations
                  chiffrées
                </p>
              </div>

              <div className="rounded-xl border bg-card p-4">
                <p className="text-xs text-muted-foreground">Valeur brute des crédits</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {economicsSummary.modeledRevenueEur
                    ? formatRange(economicsSummary.modeledRevenueEur, eurFormatter)
                    : "Non disponible"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Selon le prix unitaire des packs configurés
                </p>
              </div>

              <div className="rounded-xl border bg-card p-4">
                <p className="text-xs text-muted-foreground">Marge brute indicative</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {economicsSummary.grossMarginPercent
                    ? formatPercentageRange(economicsSummary.grossMarginPercent)
                    : "Non disponible"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {economicsSummary.marginedRunCount}/{economicsSummary.runCount} générations
                  comparables
                </p>
              </div>
            </div>
          </section>
        ) : null}

        {runs.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Aucun traitement capturé</CardTitle>
              <CardDescription>
                {selectedBenchmark
                  ? "Lancez la suite de non-régression pour créer ses premiers résultats."
                  : "Lancez « Améliorer avec l’IA » ou « Supprimer le fond », puis rechargez cette page."}
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="space-y-8">
            {runs.map(({ run, scope }) => (
              <Card key={`${scope.id}:${run.runId}`} className="overflow-hidden">
                <CardHeader className="border-b">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle>
                          {run.operation === "enhance"
                            ? "Amélioration avec l’IA"
                            : "Suppression du fond"}
                        </CardTitle>
                        <Badge variant={run.operation === "enhance" ? "progress" : "submitted"}>
                          {run.stages.length} étapes
                        </Badge>
                        <Badge variant="outline">{scope.name}</Badge>
                        {run.benchmark ? (
                          <Badge variant="pending">{run.benchmark.fixtureLabel}</Badge>
                        ) : null}
                      </div>
                      <CardDescription>
                        {dateFormatter.format(new Date(run.createdAt))} · durée totale{" "}
                        {formatDuration(run.totalDurationMs)}
                      </CardDescription>
                    </div>

                    <div className="text-right text-xs text-muted-foreground">
                      <p>Source : {filenameFromKey(run.sourceKey)}</p>
                      <p>Résultat : {filenameFromKey(run.outputKey)}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-x-5 gap-y-1 pt-2 text-xs text-muted-foreground">
                    {run.configuration.aiModel ? (
                      <span>
                        IA : {run.configuration.aiModel} · qualité {run.configuration.aiQuality}
                      </span>
                    ) : null}
                    {run.configuration.framingMode ? (
                      <span>
                        Cadrage :{" "}
                        {run.configuration.framingMode === "preserve" ? "conservé" : "recentré"}
                      </span>
                    ) : null}
                    <span>
                      Détourage :{" "}
                      {run.configuration.backgroundRemovalMethod === "chroma-key"
                        ? "fond chroma"
                        : run.configuration.backgroundRemovalMethod === "semantic-fallback"
                          ? "fond chroma, puis fallback worker"
                          : run.configuration.backgroundRemovalModel === "worker-managed"
                            ? "modèle géré par le worker"
                            : run.configuration.backgroundRemovalModel}
                    </span>
                    <span className="font-mono">Run {run.runId}</span>
                    {run.benchmark ? (
                      <span className="font-mono">Suite {run.benchmark.suiteId}</span>
                    ) : null}
                  </div>

                  {run.operation === "enhance" ? (
                    run.economics ? (
                      <div className="mt-3 grid gap-3 border-t pt-4 sm:grid-cols-2 xl:grid-cols-4">
                        <div>
                          <p className="text-xs text-muted-foreground">Crédits</p>
                          <p className="text-base font-semibold tabular-nums">
                            {numberFormatter.format(run.economics.tariffCredits)} au tarif
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {numberFormatter.format(run.economics.chargedCredits)} réellement
                            débités
                          </p>
                        </div>

                        <div>
                          <p className="text-xs text-muted-foreground">Coût OpenAI</p>
                          <p className="text-base font-semibold tabular-nums">
                            {run.economics.providerCostUsd === null
                              ? "Non disponible"
                              : usdFormatter.format(run.economics.providerCostUsd)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {providerCostSourceLabel(run.economics.providerCostSource)}
                          </p>
                        </div>

                        <div>
                          <p className="text-xs text-muted-foreground">Valeur brute des crédits</p>
                          <p className="text-base font-semibold tabular-nums">
                            {run.economics.modeledRevenueEur
                              ? formatRange(run.economics.modeledRevenueEur, eurFormatter)
                              : "Packs non configurés"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {run.economics.creditUnitPriceEur
                              ? `${formatRange(run.economics.creditUnitPriceEur, eurFormatter)} / crédit`
                              : "AI_CREDIT_PACKAGES requis"}
                          </p>
                        </div>

                        <div>
                          <p className="text-xs text-muted-foreground">Marge brute indicative</p>
                          <p className="text-base font-semibold tabular-nums">
                            {run.economics.grossMarginPercent
                              ? formatPercentageRange(run.economics.grossMarginPercent)
                              : "Conversion non configurée"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {run.economics.usdToEurRate
                              ? `1 USD = ${numberFormatter.format(run.economics.usdToEurRate)} EUR`
                              : "AI_IMAGE_USD_TO_EUR_RATE requis"}
                          </p>
                        </div>

                        {run.economics.usage ? (
                          <p className="text-xs text-muted-foreground sm:col-span-2 xl:col-span-4">
                            Tokens OpenAI — entrée image{" "}
                            {numberFormatter.format(run.economics.usage.inputImageTokens)}, entrée
                            texte {numberFormatter.format(run.economics.usage.inputTextTokens)},
                            sortie {numberFormatter.format(run.economics.usage.outputTokens)}, total{" "}
                            {numberFormatter.format(run.economics.usage.totalTokens)}
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
                        Données économiques non capturées pour cette ancienne génération.
                      </p>
                    )
                  ) : null}
                </CardHeader>

                <CardPanel className="p-4 sm:p-5">
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {run.stages.map((stage, index) => (
                      <figure key={stage.id} className="overflow-hidden rounded-xl border bg-card">
                        <div className="flex aspect-[4/3] items-center justify-center bg-muted/60">
                          {/* The browser must send its auth cookie directly to the private route. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={
                              scope.kind === "benchmark"
                                ? `/api/dev/image-processing/${run.runId}/${stage.id}?scope=${IMAGE_PROCESSING_BENCHMARK_FILTER}`
                                : `/api/dev/image-processing/${run.runId}/${stage.id}?storeId=${scope.id}`
                            }
                            alt={`${stage.label} du traitement ${run.runId} pour ${scope.name}`}
                            className="h-full w-full object-contain"
                            loading="lazy"
                            decoding="async"
                          />
                        </div>
                        <figcaption className="space-y-1 border-t px-3 py-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium">
                              {index + 1}. {stage.label}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {formatByteSize(stage.byteSize)}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {stage.contentType}
                            {stage.durationMs === null
                              ? ""
                              : ` · ${formatDuration(stage.durationMs)}`}
                          </p>
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                </CardPanel>
              </Card>
            ))}
          </div>
        )}
      </div>
    </main>
  );
};

export default ImageProcessingDevPage;
