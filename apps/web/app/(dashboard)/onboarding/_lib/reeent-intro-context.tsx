"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

import { type ReeentIntroStatus, reeentIntroSchema } from "@louez/validations";

export interface ReeentIntroCohort {
  /** Launch-cohort seats still available, live from the marketplace channel. */
  remaining: number;
  total: number;
}

/** What the onboarding layout hands the shell so this step can be explained. */
export interface ReeentIntroSeed {
  cohort: ReeentIntroCohort;
  initialStatus: ReeentIntroStatus | null;
  /** Where the walkthrough resumes — past the explanations once acknowledged. */
  initialPhase: number;
}

interface ReeentIntroContextValue {
  cohort: ReeentIntroCohort;
  status: ReeentIntroStatus | null;
  selectStatus: (value: unknown) => void;
  /** 0..n-1 walk through the explanations, n is the pro/particulier question. */
  phase: number;
  goToPhase: (next: number) => void;
}

const ReeentIntroContext = createContext<ReeentIntroContextValue | null>(null);

/**
 * The reeent education step walks through its explanations before it asks its
 * only question, and the right column tracks that progress. Both columns are
 * rendered by different owners — the step and the shell — so the phase and the
 * answer live here, next to the cohort count the layout already fetched.
 */
export function ReeentIntroProvider({
  children,
  cohort,
  initialStatus,
  initialPhase,
}: ReeentIntroSeed & { children: React.ReactNode }) {
  const [status, setStatus] = useState<ReeentIntroStatus | null>(initialStatus);
  const [phase, setPhase] = useState(initialPhase);

  // Base UI hands the radio value back untyped, so the schema is the gate.
  const selectStatus = useCallback((value: unknown) => {
    const parsed = reeentIntroSchema.shape.status.safeParse(value);
    if (parsed.success) {
      setStatus(parsed.data);
    }
  }, []);

  const goToPhase = useCallback((next: number) => {
    setPhase(Math.max(0, next));
  }, []);

  const value = useMemo(
    () => ({ cohort, status, selectStatus, phase, goToPhase }),
    [cohort, status, selectStatus, phase, goToPhase],
  );

  return <ReeentIntroContext.Provider value={value}>{children}</ReeentIntroContext.Provider>;
}

export function useReeentIntro() {
  const context = useContext(ReeentIntroContext);
  if (!context) {
    throw new Error("useReeentIntro must be used within ReeentIntroProvider");
  }
  return context;
}
