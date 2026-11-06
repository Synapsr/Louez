"use client";

import { useEffect, useState } from "react";

import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { Badge, Tabs, TabsList, TabsPanel, TabsTab, toastManager } from "@louez/ui";
import { ChartColumnIcon, CreditCardSolidIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";
import type {
  FinanceDepositsOutput,
  FinanceMovement,
  FinanceMovementsInput,
  FinanceMovementsOutput,
  FinanceOutstandingInput,
  FinanceOutstandingOutput,
  FinancePeriodInput,
  FinanceSummary,
} from "@louez/validations";

import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";
import { useDebounce } from "@/hooks/use-debounce";
import { orpc } from "@/lib/orpc/react";

import { FINANCES_PATH, FINANCE_TABS, serializeFinanceSearchParams } from "./finances.constants";
import { FinancesCashflowChart } from "./finances-cashflow-chart";
import { FinancesDepositsTab } from "./finances-deposits-tab";
import { FinancesExportMenu } from "./finances-export-menu";
import { FinancesFirstUse } from "./finances-first-use";
import { FinancesHeader } from "./finances-header";
import { FinancesMethodsCard } from "./finances-methods-card";
import { FinancesMovementSheet } from "./finances-movement-sheet";
import { FinancesMovementsTab } from "./finances-movements-tab";
import { FinancesOutstandingTab } from "./finances-outstanding-tab";
import { FinancesPeriodControl } from "./finances-period-control";
import { FinancesPrintRecap } from "./finances-print-recap";
import { FinancesStatCards } from "./finances-stat-cards";
import { useFinancesSearchState } from "./use-finances-search-state";
import { isSameInput, toMovementsInput, toOutstandingInput, toPeriodInput } from "./util.finances";

/** Server-rendered data, each with the input it was fetched for. */
export interface FinancesInitialData {
  summaryInput: FinancePeriodInput;
  summary: FinanceSummary;
  movementsInput: FinanceMovementsInput;
  movements?: FinanceMovementsOutput;
  outstandingInput: FinanceOutstandingInput;
  outstanding?: FinanceOutstandingOutput;
  deposits?: FinanceDepositsOutput;
}

interface FinancesPageContentProps {
  initial: FinancesInitialData;
  /** The store's current day and the render instant, fixed on the server so hydration agrees. */
  today: string;
  now: Date;
  canExportCsv: boolean;
  stripeConnected: boolean;
}

interface PrintRecap {
  movements: FinanceMovement[];
  truncated: boolean;
  printedAt: Date;
}

const SEARCH_DEBOUNCE_MS = 300;
const STALE_TIME_MS = 30_000;

const isFinanceTab = (value: unknown): value is (typeof FINANCE_TABS)[number] =>
  FINANCE_TABS.some((tab) => tab === value);

export const FinancesPageContent = ({
  initial,
  today,
  now,
  canExportCsv,
  stripeConnected,
}: FinancesPageContentProps) => {
  const t = useTranslations("dashboard.finances");
  const { state, setState, setFilters } = useFinancesSearchState();
  const [printRecap, setPrintRecap] = useState<PrintRecap | null>(null);

  const periodInput = toPeriodInput(state);
  // The field follows every keystroke; the query waits for the typing to pause.
  const debouncedSearch = useDebounce(state.q, SEARCH_DEBOUNCE_MS);
  const movementsInput = toMovementsInput({ ...state, q: debouncedSearch });
  const outstandingInput = toOutstandingInput(state);

  const summaryQuery = useQuery({
    ...orpc.dashboard.finances.summary.queryOptions({ input: periodInput }),
    initialData: isSameInput(periodInput, initial.summaryInput) ? initial.summary : undefined,
    placeholderData: keepPreviousData,
    staleTime: STALE_TIME_MS,
  });
  const movementsQuery = useQuery({
    ...orpc.dashboard.finances.movements.queryOptions({ input: movementsInput }),
    initialData: isSameInput(movementsInput, initial.movementsInput)
      ? initial.movements
      : undefined,
    placeholderData: keepPreviousData,
    staleTime: STALE_TIME_MS,
    enabled: state.tab === "movements",
  });
  const outstandingQuery = useQuery({
    ...orpc.dashboard.finances.outstanding.queryOptions({ input: outstandingInput }),
    initialData: isSameInput(outstandingInput, initial.outstandingInput)
      ? initial.outstanding
      : undefined,
    placeholderData: keepPreviousData,
    staleTime: STALE_TIME_MS,
    enabled: state.tab === "outstanding",
  });
  const depositsQuery = useQuery({
    ...orpc.dashboard.finances.deposits.queryOptions({ input: {} }),
    initialData: initial.deposits,
    staleTime: STALE_TIME_MS,
    enabled: state.tab === "deposits",
  });

  const recapMutation = useMutation(
    orpc.dashboard.finances.recap.mutationOptions({
      onSuccess: (recap) => setPrintRecap({ ...recap, printedAt: new Date() }),
      onError: () => toastManager.add({ title: t("export.printError"), type: "error" }),
    }),
  );

  // The print dialog can only open once the sheet is in the DOM, so it follows
  // the commit that renders it; `afterprint` puts the screen back.
  useEffect(() => {
    if (!printRecap) return;
    const clear = () => setPrintRecap(null);
    window.addEventListener("afterprint", clear, { once: true });
    window.print();
    return () => window.removeEventListener("afterprint", clear);
  }, [printRecap]);

  // `initialData` covers the first paint; afterwards the previous period stays
  // on screen while the next one loads, so this only misses on a failed fetch.
  const summary = summaryQuery.data ?? initial.summary;
  const range = { from: summary.window.from, to: summary.window.to };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className={cn("space-y-4 sm:space-y-6", printRecap && "print:hidden")}>
        <FinancesHeader
          actions={
            <>
              <FinancesPeriodControl
                period={state.period}
                range={range}
                today={today}
                onPeriodChange={(period, nextRange) =>
                  void setFilters({
                    period,
                    from: nextRange?.from ?? null,
                    to: nextRange?.to ?? null,
                  })
                }
              />
              <FinancesExportMenu
                range={range}
                canExportCsv={canExportCsv}
                isPreparingPrint={recapMutation.isPending}
                onPrint={() => recapMutation.mutate(periodInput)}
              />
            </>
          }
        />

        {summaryQuery.isError && <p className="text-muted-foreground text-sm">{t("loadError")}</p>}

        {!summary.hasPayments ? (
          <FinancesFirstUse stripeConnected={stripeConnected} />
        ) : (
          <>
            <div
              className={cn("transition-opacity", summaryQuery.isPlaceholderData && "opacity-60")}
            >
              <FinancesStatCards
                totals={summary.totals}
                outstanding={summary.outstanding}
                outstandingHref={`${serializeFinanceSearchParams(FINANCES_PATH, {
                  ...state,
                  tab: "outstanding",
                  page: null,
                  movement: null,
                })}#finances-tabs`}
              />
            </div>

            <div
              className={cn(
                "grid gap-4 transition-opacity xl:grid-cols-3 print:hidden",
                summaryQuery.isPlaceholderData && "opacity-60",
              )}
            >
              <DashboardSectionCard
                title={t("chart.title")}
                description={t(
                  summary.window.granularity === "month"
                    ? "chart.descriptionMonth"
                    : "chart.descriptionDay",
                )}
                icon={ChartColumnIcon}
                accent="success"
                className="xl:col-span-2"
              >
                <FinancesCashflowChart
                  series={summary.series}
                  granularity={summary.window.granularity}
                />
              </DashboardSectionCard>

              <DashboardSectionCard
                title={t("methods.title")}
                description={t("methods.description")}
                icon={CreditCardSolidIcon}
                accent="primary"
              >
                <FinancesMethodsCard
                  methods={summary.byMethod}
                  activeMethod={state.method}
                  onMethodSelect={(method) => void setFilters({ method, tab: "movements" })}
                />
              </DashboardSectionCard>
            </div>

            <Tabs
              id="finances-tabs"
              className="scroll-mt-20 gap-4"
              value={state.tab}
              onValueChange={(value) => {
                if (isFinanceTab(value)) void setState({ tab: value, page: null });
              }}
            >
              {/* The tab strip scrolls sideways on a phone rather than wrapping. */}
              <div className="overflow-x-auto overflow-y-hidden pb-px print:hidden">
                <TabsList variant="underline" className="w-max">
                  <TabsTab value="movements">{t("tabs.movements")}</TabsTab>
                  <TabsTab value="outstanding">
                    {t("tabs.outstanding")}
                    <Badge
                      variant={summary.outstanding.reservationCount > 0 ? "pending" : "expired"}
                      size="sm"
                    >
                      {summary.outstanding.reservationCount}
                    </Badge>
                  </TabsTab>
                  <TabsTab value="deposits">
                    {t("tabs.deposits")}
                    <Badge variant={summary.depositCount > 0 ? "progress" : "expired"} size="sm">
                      {summary.depositCount}
                    </Badge>
                  </TabsTab>
                </TabsList>
              </div>

              <TabsPanel value="movements">
                <FinancesMovementsTab
                  data={movementsQuery.data}
                  isError={movementsQuery.isError}
                  isStale={movementsQuery.isPlaceholderData}
                />
              </TabsPanel>
              <TabsPanel value="outstanding">
                <FinancesOutstandingTab
                  data={outstandingQuery.data}
                  isError={outstandingQuery.isError}
                  now={now}
                />
              </TabsPanel>
              <TabsPanel value="deposits">
                <FinancesDepositsTab
                  data={depositsQuery.data}
                  isError={depositsQuery.isError}
                  now={now}
                />
              </TabsPanel>
            </Tabs>
          </>
        )}
      </div>

      {printRecap && (
        <FinancesPrintRecap
          summary={summary}
          movements={printRecap.movements}
          truncated={printRecap.truncated}
          printedAt={printRecap.printedAt}
        />
      )}

      {/* The sheet is a peek, not a page: it rewrites the URL without stacking history. */}
      <FinancesMovementSheet
        movementId={state.movement}
        onOpenChange={() => void setState({ movement: null }, { history: "replace" })}
        onSelect={(movementId) => void setState({ movement: movementId }, { history: "replace" })}
      />
    </div>
  );
};
