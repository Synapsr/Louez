"use client";

import { createContext } from "react";

/** Embedders can opt out of focus management for every nested period surface. */
export const PeriodInteractionContext = createContext<{
  autoFocus: boolean;
  modal: boolean;
  dateReference?: Date;
}>({ autoFocus: true, modal: true });
