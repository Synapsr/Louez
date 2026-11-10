"use client";

import { AgentBundlesField } from "./agent-bundles-field";
import { AgentConfirmField } from "./agent-confirm-field";
import { AgentPresetField } from "./agent-preset-field";
import { AgentStoresField } from "./agent-stores-field";
import type { AgentBundle, AgentTerms } from "./util.agent-terms";

interface AgentTermsFieldsProps {
  stores: ReadonlyArray<{ id: string; name: string; role: "owner" | "member" }>;
  /** The tool bundles offered to this agent. */
  offeredBundles: readonly AgentBundle[];
  value: AgentTerms;
  onChange: (terms: AgentTerms) => void;
  disabled?: boolean;
}

/** What a connection is granted: its stores, its rights, the confirmation, the tools it lists. */
export const AgentTermsFields = ({
  stores,
  offeredBundles,
  value,
  onChange,
  disabled,
}: AgentTermsFieldsProps) => (
  <div className="space-y-6">
    <AgentStoresField
      stores={stores}
      value={value.stores}
      onChange={(next) => onChange({ ...value, stores: next })}
      disabled={disabled}
    />
    <AgentPresetField
      value={value.preset}
      onChange={(preset) => onChange({ ...value, preset })}
      disabled={disabled}
    />
    <AgentConfirmField
      value={value.confirmSensitive}
      onChange={(confirmSensitive) => onChange({ ...value, confirmSensitive })}
      disabled={disabled}
    />
    <AgentBundlesField
      offered={offeredBundles}
      value={value.bundles}
      onChange={(bundles) => onChange({ ...value, bundles })}
      disabled={disabled}
    />
  </div>
);
