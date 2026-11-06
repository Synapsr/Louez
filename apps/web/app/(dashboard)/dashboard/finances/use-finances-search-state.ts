"use client";

import { useCallback } from "react";

import { useQueryStates } from "nuqs";

import { financeSearchParams } from "./finances.constants";
import type { FinanceSearchState } from "./util.finances";

type FinanceSearchPatch = Partial<{
  [Key in keyof FinanceSearchState]: FinanceSearchState[Key] | null;
}>;

/**
 * URL state of the Finances screen. Updates stay shallow: the queries refetch on
 * their own, the server page is only there for the first paint.
 */
export const useFinancesSearchState = () => {
  const [state, setState] = useQueryStates(financeSearchParams, { history: "push" });

  /** Any change of what is listed starts again from the first page. */
  const setFilters = useCallback(
    (patch: FinanceSearchPatch, options?: { history: "push" | "replace" }) =>
      setState({ ...patch, page: null }, options),
    [setState],
  );

  const clearFilters = useCallback(
    () =>
      setState({
        direction: null,
        method: null,
        nature: null,
        status: null,
        min: null,
        max: null,
        q: null,
        page: null,
      }),
    [setState],
  );

  return { state, setState, setFilters, clearFilters };
};
