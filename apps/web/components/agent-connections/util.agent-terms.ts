import type {
  agentBundleSchema,
  agentPresetSchema,
  agentStoresSchema,
} from "@louez/api/contracts/agent-connections";
import type { z } from "zod";

export type AgentBundle = z.infer<typeof agentBundleSchema>;
export type AgentPreset = z.infer<typeof agentPresetSchema>;
export type AgentStores = z.infer<typeof agentStoresSchema>;

/** What a connection is granted, as the consent page and the editor hold it. */
export interface AgentTerms {
  stores: AgentStores;
  preset: AgentPreset;
  confirmSensitive: boolean;
  bundles: AgentBundle[];
}

/** Bundles in the order they are shown; `daily` first, the default. */
export const AGENT_BUNDLES: readonly AgentBundle[] = [
  "daily",
  "catalog",
  "settings",
  "integrations",
  "team",
  "billing",
];

export const AGENT_PRESETS: readonly AgentPreset[] = ["read", "write"];

/**
 * The terms the consent page starts from: what was granted before, else
 * every current store (listed one by one, so a store created later is not
 * included unless the user says so), read and write, confirmation on, the
 * day's operations.
 */
export const defaultAgentTerms = (
  storeIds: readonly string[],
  current: AgentTerms | null,
): AgentTerms =>
  current ?? {
    stores: { all: false, ids: [...storeIds] },
    preset: "write",
    confirmSensitive: true,
    bundles: ["daily"],
  };

export const withStore = (stores: AgentStores, id: string, checked: boolean): AgentStores => {
  if (stores.all) return stores;
  const ids = checked ? [...new Set([...stores.ids, id])] : stores.ids.filter((one) => one !== id);
  return { all: false, ids };
};

export const withBundle = (
  bundles: readonly AgentBundle[],
  bundle: AgentBundle,
  checked: boolean,
): AgentBundle[] =>
  AGENT_BUNDLES.filter((one) => (one === bundle ? checked : bundles.includes(one)));

/** Whether the terms can be saved: at least one store and one bundle. */
export const isAgentTermsComplete = (terms: AgentTerms): boolean =>
  (terms.stores.all || terms.stores.ids.length > 0) && terms.bundles.length > 0;
