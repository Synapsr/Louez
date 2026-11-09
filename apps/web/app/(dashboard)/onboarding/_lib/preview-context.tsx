"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useTheme } from "next-themes";

export interface OnboardingPreviewState {
  storeName: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string;
  theme: "light" | "dark";
  reservationMode: "request" | "payment";
  /** ISO 4217 code of the store's prices, shown on the preview's products. */
  currency: string;
  userName: string;
  userImage: string | null;
  userSeed: string;
}

const DEFAULT_PREVIEW: OnboardingPreviewState = {
  storeName: "",
  slug: "",
  logoUrl: null,
  primaryColor: "#0066FF",
  theme: "light",
  reservationMode: "payment",
  currency: "EUR",
  userName: "",
  userImage: null,
  userSeed: "louez",
};

interface OnboardingPreviewContextValue {
  preview: OnboardingPreviewState;
  updatePreview: (patch: Partial<OnboardingPreviewState>) => void;
}

const OnboardingPreviewContext = createContext<OnboardingPreviewContextValue | null>(null);

export function OnboardingPreviewProvider({
  children,
  initial,
}: {
  children: React.ReactNode;
  initial?: Partial<OnboardingPreviewState>;
}) {
  const { resolvedTheme } = useTheme();
  const hasAppliedUserTheme = useRef(Boolean(initial?.theme));
  const [preview, setPreview] = useState({ ...DEFAULT_PREVIEW, ...initial });

  useEffect(() => {
    if (hasAppliedUserTheme.current || !resolvedTheme) return;

    setPreview((current) => ({
      ...current,
      theme: resolvedTheme === "dark" ? "dark" : "light",
    }));
    hasAppliedUserTheme.current = true;
  }, [resolvedTheme]);

  const updatePreview = useCallback((patch: Partial<OnboardingPreviewState>) => {
    setPreview((prev) => ({ ...prev, ...patch }));
  }, []);

  const value = useMemo(() => ({ preview, updatePreview }), [preview, updatePreview]);

  return (
    <OnboardingPreviewContext.Provider value={value}>{children}</OnboardingPreviewContext.Provider>
  );
}

export function useOnboardingPreview() {
  const context = useContext(OnboardingPreviewContext);
  if (!context) {
    throw new Error("useOnboardingPreview must be used within OnboardingPreviewProvider");
  }
  return context;
}
