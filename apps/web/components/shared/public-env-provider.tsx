"use client";

import { createContext, useContext } from "react";

import type { PublicEnv } from "@/lib/validators/validator.public-env";

const PublicEnvContext = createContext<PublicEnv | null>(null);

let publicEnvSnapshot: PublicEnv | null = null;

export const PublicEnvProvider = ({
  children,
  config,
}: {
  children: React.ReactNode;
  config: PublicEnv;
}): React.JSX.Element => {
  // Non-React browser adapters such as the oRPC link run after the root
  // provider renders but outside a hook. Keep the same validated object
  // available to them without exposing a mutable window global.
  publicEnvSnapshot = config;

  return <PublicEnvContext.Provider value={config}>{children}</PublicEnvContext.Provider>;
};

export const usePublicEnv = (): PublicEnv => {
  const config = useContext(PublicEnvContext);

  if (!config) {
    throw new Error("usePublicEnv must be used within PublicEnvProvider");
  }

  return config;
};

export const getPublicEnvSnapshot = (): PublicEnv => {
  if (!publicEnvSnapshot) {
    throw new Error("Public runtime configuration is not initialized");
  }

  return publicEnvSnapshot;
};
