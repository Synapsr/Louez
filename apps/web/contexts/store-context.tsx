"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";

import { setStorefrontSlug } from "@/lib/orpc/client";
import { isDiscountDisplayable } from "@/lib/utils/util.discount-visibility";
import type { RentalPeriodRules } from "@/lib/utils/util.rental-period";

interface StoreContextValue {
  storeId: string;
  currency: string;
  storeSlug: string;
  storeName: string;
  timezone?: string;
  maxDiscountPercent?: number | null;
  /**
   * Prefix of every storefront link on the current host, computed on the
   * server (`getStorefrontPathPrefix`): "" on the store subdomain, in
   * standalone and preview modes; "/{slug}" on the dashboard host. Undefined
   * outside the storefront (dashboard tree), where links keep the slug.
   */
  basePath?: string;
  /** What every period picker validates against; absent outside the storefront. */
  periodRules?: RentalPeriodRules;
}

const StoreContext = createContext<StoreContextValue | undefined>(undefined);

interface StoreProviderProps {
  children: ReactNode;
  storeId: string;
  currency: string;
  storeSlug: string;
  storeName: string;
  timezone?: string;
  maxDiscountPercent?: number | null;
  basePath?: string;
  periodRules?: RentalPeriodRules;
}

export const StoreProvider = ({
  children,
  storeId,
  currency,
  storeSlug,
  storeName,
  timezone,
  maxDiscountPercent,
  basePath,
  periodRules,
}: StoreProviderProps) => {
  // Set the store slug for the ORPC client synchronously during render,
  // so it's available before any child component makes API calls.
  setStorefrontSlug(storeSlug);

  return (
    <StoreContext.Provider
      value={{
        storeId,
        currency,
        storeSlug,
        storeName,
        timezone,
        maxDiscountPercent,
        basePath,
        periodRules,
      }}
    >
      {children}
    </StoreContext.Provider>
  );
};

export const useStore = (): StoreContextValue => {
  const context = useContext(StoreContext);
  if (context === undefined) {
    throw new Error("useStore must be used within a StoreProvider");
  }
  return context;
};

// Hook pour obtenir la devise avec fallback
export const useStoreCurrency = (): string => {
  const context = useContext(StoreContext);
  return context?.currency || "EUR";
};

export const useStoreTimezone = (): string | undefined => {
  const context = useContext(StoreContext);
  return context?.timezone;
};

export const useStoreMaxDiscountPercent = (): number | null | undefined => {
  const context = useContext(StoreContext);
  return context?.maxDiscountPercent;
};

/**
 * Server-computed link prefix of the storefront, or undefined when the
 * provider did not receive one (dashboard tree, tests). Safe outside a
 * provider so shared hooks can fall back to the slugged form.
 */
/** The store's period rules; only the storefront tree provides them. */
export const useStorePeriodRules = (): RentalPeriodRules => {
  const { periodRules } = useStore();
  if (!periodRules) {
    throw new Error("useStorePeriodRules must be used within the storefront providers");
  }
  return periodRules;
};

export const useStorefrontBasePath = (): string | undefined => {
  const context = useContext(StoreContext);
  return context?.basePath;
};

/**
 * Predicate for every storefront surface that advertises a markdown: badge,
 * strikethrough, discount row, "you save" line. Bound to the store's cap so
 * callers only pass the percentage they are about to show.
 */
export const useDiscountVisibility = (): ((
  reductionPercent: number | null | undefined,
) => boolean) => {
  const maxDiscountPercent = useStoreMaxDiscountPercent();
  return useCallback(
    (reductionPercent: number | null | undefined) =>
      isDiscountDisplayable(reductionPercent, maxDiscountPercent),
    [maxDiscountPercent],
  );
};
