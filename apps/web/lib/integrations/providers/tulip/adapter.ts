import type {
  IntegrationAdapter,
  IntegrationRuntimeStatus,
} from '@/lib/integrations/registry/types';

import { TulipConfigurationPanel } from './tulip-configuration-panel';

function getTulipRuntimeStatus(): IntegrationRuntimeStatus {
  return {
    enabled: false,
    connected: false,
    configured: false,
    connectionIssue: null,
  };
}

export const tulipIntegrationAdapter: IntegrationAdapter = {
  getStatus: getTulipRuntimeStatus,
  setEnabled: (settings) =>
    settings || {
      reservationMode: 'payment',
      advanceNoticeMinutes: 1440,
    },
  getConfigurationPanel: () => TulipConfigurationPanel,
};
