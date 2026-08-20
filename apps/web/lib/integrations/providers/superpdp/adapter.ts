import type {
  IntegrationAdapter,
  IntegrationRuntimeStatus,
} from "@/lib/integrations/registry/types";
import { setIntegrationEnabledState } from "@/lib/integrations/registry/state";

function getSuperPdpRuntimeStatus(): IntegrationRuntimeStatus {
  return {
    enabled: false,
    connected: false,
    configured: false,
    connectionIssue: null,
  };
}

export const superPdpIntegrationAdapter: IntegrationAdapter = {
  getStatus: getSuperPdpRuntimeStatus,
  setEnabled: (settings, enabled) => setIntegrationEnabledState(settings, "superpdp", enabled),
};
