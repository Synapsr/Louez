"use client";

import { ReceiptText } from "lucide-react";
import { useTranslations } from "next-intl";

import { Skeleton } from "@louez/ui";
import { cn } from "@louez/utils";
import { FINANCE_PAGE_SIZES, type FinanceMovementsOutput } from "@louez/validations";

import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";

import { FinancesActiveFilters } from "./finances-active-filters";
import { FinancesMovementsCards } from "./finances-movements-cards";
import { FinancesMovementsFilters } from "./finances-movements-filters";
import { FinancesMovementsTable } from "./finances-movements-table";
import { useFinancesSearchState } from "./use-finances-search-state";
import { groupMovementsByDay } from "./util.finances";

interface FinancesMovementsTabProps {
  data: FinanceMovementsOutput | undefined;
  isError: boolean;
  /** Rows on screen belong to the previous filters while the next ones load. */
  isStale: boolean;
}

export const FinancesMovementsTab = ({ data, isError, isStale }: FinancesMovementsTabProps) => {
  const t = useTranslations("dashboard.finances");
  const { state, setState, setFilters, clearFilters } = useFinancesSearchState();
  const days = data ? groupMovementsByDay(data) : [];
  const openMovement = (movementId: string) =>
    void setState({ movement: movementId }, { history: "replace" });

  return (
    <div className="space-y-4">
      <div className="space-y-3 print:hidden">
        <FinancesMovementsFilters
          state={state}
          // Typing rewrites the URL in place: one history entry per search, not per letter.
          onSearchChange={(search) =>
            void setFilters({ q: search || null }, { history: "replace" })
          }
          onDirectionChange={(direction) => void setFilters({ direction })}
          onMethodChange={(method) => void setFilters({ method })}
          onMoreFiltersApply={(value) => void setFilters(value)}
        />
        <FinancesActiveFilters
          state={state}
          onRemove={(key) => void setFilters({ [key]: null })}
          onClearAll={() => void clearFilters()}
        />
      </div>

      {isError && <p className="text-muted-foreground text-sm">{t("loadError")}</p>}

      {!data && !isError && (
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </div>
      )}

      {data && days.length === 0 && (
        <div className="rounded-lg border">
          <EmptyState
            icon={ReceiptText}
            title={t("table.emptyTitle")}
            description={t("table.emptyDescription")}
          />
        </div>
      )}

      {data && days.length > 0 && (
        <div className={cn("space-y-4 transition-opacity", isStale && "opacity-60")}>
          <div className="sm:hidden">
            <FinancesMovementsCards days={days} onSelect={openMovement} />
          </div>
          <div className="hidden sm:block">
            <FinancesMovementsTable days={days} onSelect={openMovement} />
          </div>
          <Pagination
            className="print:hidden"
            page={data.page}
            pageSize={data.pageSize}
            totalCount={data.totalCount}
            pageSizes={FINANCE_PAGE_SIZES}
            onPageChange={(page) => void setState({ page: page > 1 ? page : null })}
            onPageSizeChange={(pageSize) =>
              void setState({
                pageSize: FINANCE_PAGE_SIZES.find((size) => size === pageSize) ?? null,
                page: null,
              })
            }
          />
        </div>
      )}
    </div>
  );
};
