"use client";

import { type ReactNode, createContext, useContext } from "react";

import { QuickAddDialog } from "./quick-add-dialog";
import { type QuickAddFlow, useQuickAddFlow } from "./use-quick-add";

const QuickAddContext = createContext<QuickAddFlow | null>(null);

/**
 * Holds the one quick add flow of the storefront and draws its dialog,
 * above the grids: a grid may be swapped for its skeleton while the
 * catalog fetches the dates just chosen, and the add must not go with it.
 */
export const QuickAddProvider = ({ children }: { children: ReactNode }) => {
  const flow = useQuickAddFlow();

  return (
    <QuickAddContext.Provider value={flow}>
      {children}
      <QuickAddDialog flow={flow} />
    </QuickAddContext.Provider>
  );
};

export const useQuickAdd = (): QuickAddFlow => {
  const flow = useContext(QuickAddContext);
  if (!flow) {
    throw new Error("useQuickAdd must be used within a QuickAddProvider");
  }
  return flow;
};
