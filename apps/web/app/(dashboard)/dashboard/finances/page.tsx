import { redirect } from "next/navigation";

import type { SearchParams } from "nuqs/server";

import {
  getFinanceDeposits,
  getFinanceMovements,
  getFinanceOutstanding,
  getFinanceSummary,
} from "@louez/api/services";
import { getFinanceDayKey, resolveFinanceTimezone } from "@louez/utils";

import { currentUserHasPermission, getCurrentStore } from "@/lib/store-context";

import { loadFinanceSearchParams } from "./finances.constants";
import { FinancesPageContent } from "./finances-page-content";
import { toMovementsInput, toOutstandingInput, toPeriodInput } from "./util.finances";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

interface FinancesPageProps {
  searchParams: Promise<SearchParams>;
}

export default async function FinancesPage({ searchParams }: FinancesPageProps) {
  const store = await getCurrentStore();
  if (!store) redirect("/onboarding");

  // Same parsers as the client: both sides normalise a URL the same way, so
  // the data fetched here is exactly what the first client query asks for.
  const state = await loadFinanceSearchParams(searchParams);
  const now = new Date();
  const timezone = store.settings?.timezone;
  const summaryInput = toPeriodInput(state);
  const { page, pageSize, period, from, to, ...filters } = toMovementsInput(state);
  const outstandingInput = toOutstandingInput(state);

  // Only the open tab is fetched; the others load when they are opened.
  const [summary, movements, outstanding, deposits, canExportCsv] = await Promise.all([
    getFinanceSummary({ storeId: store.id, timezone, period: summaryInput, now }),
    state.tab === "movements"
      ? getFinanceMovements({
          storeId: store.id,
          timezone,
          period: { period, from, to },
          filters,
          page,
          pageSize,
          now,
        })
      : undefined,
    state.tab === "outstanding"
      ? getFinanceOutstanding({ storeId: store.id, now, ...outstandingInput })
      : undefined,
    state.tab === "deposits" ? getFinanceDeposits({ storeId: store.id }) : undefined,
    currentUserHasPermission("manage_settings"),
  ]);

  return (
    <FinancesPageContent
      initial={{
        summaryInput,
        summary,
        movementsInput: toMovementsInput(state),
        movements,
        outstandingInput,
        outstanding,
        deposits,
      }}
      today={getFinanceDayKey(now, resolveFinanceTimezone(timezone))}
      now={now}
      canExportCsv={canExportCsv}
      stripeConnected={Boolean(store.stripeAccountId && store.stripeChargesEnabled)}
    />
  );
}
