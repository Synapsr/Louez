"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

import { useStore } from "@/contexts/store-context";
import { useStorePath } from "@/hooks/use-store-path";
import { getCheckoutReturnHref } from "@/lib/utils/util.checkout-return";

const CatalogNavigationContext = createContext("/catalog");

export const CatalogNavigationProvider = ({ children }: { children: ReactNode }) => {
  const { storeId } = useStore();
  const path = useStorePath();
  const searchParams = useSearchParams();
  const storageKey = `louez:catalog-navigation:${storeId}`;
  const [remembered, setRemembered] = useState<{ key: string; href: string } | null>(null);
  const query = searchParams.toString();
  const explicitReturn = searchParams.get("returnTo");
  const current =
    path === "/catalog"
      ? `/catalog${query ? `?${query}` : ""}`
      : explicitReturn
        ? getCheckoutReturnHref(explicitReturn)
        : null;

  useEffect(() => {
    try {
      const href = current ?? getCheckoutReturnHref(sessionStorage.getItem(storageKey));
      if (current) sessionStorage.setItem(storageKey, current);
      setRemembered({ key: storageKey, href });
    } catch {
      if (current) setRemembered({ key: storageKey, href: current });
    }
  }, [current, storageKey]);

  const href = current ?? (remembered?.key === storageKey ? remembered.href : "/catalog");
  return (
    <CatalogNavigationContext.Provider value={href}>{children}</CatalogNavigationContext.Provider>
  );
};

export const useCatalogReturnHref = (): string => useContext(CatalogNavigationContext);
