"use client";

import { createContext, useContext, type ReactNode } from "react";

const DisabledControlsContext = createContext(false);

/** Disables controls in a read-only section, including controls rendered in portals. */
export const DisabledControlsProvider = ({
  disabled,
  children,
}: {
  disabled: boolean;
  children: ReactNode;
}) => (
  <DisabledControlsContext.Provider value={disabled}>{children}</DisabledControlsContext.Provider>
);

export const useControlsDisabled = () => useContext(DisabledControlsContext);
