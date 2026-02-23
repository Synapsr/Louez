import type { StoreSettings } from '@louez/types'

import { getTulipSettings } from '@/lib/integrations/tulip/settings'
import type {
  IntegrationAdapter,
  IntegrationRuntimeStatus,
} from '@/lib/integrations/registry/types'

import { TulipConfigurationPanel } from './tulip-configuration-panel'

function getTulipRuntimeStatus(
  settings: StoreSettings | null | undefined,
): IntegrationRuntimeStatus {
  const tulipSettings = getTulipSettings(settings)
  const legacyConnected = tulipSettings.enabled

  return {
    enabled: tulipSettings.enabled,
    connected: legacyConnected,
    configured: legacyConnected,
    connectionIssue: null,
  }
}

export const tulipIntegrationAdapter: IntegrationAdapter = {
  getStatus: getTulipRuntimeStatus,
  setEnabled: (settings) => settings || {
    reservationMode: 'payment',
    advanceNoticeMinutes: 1440,
  },
  getConfigurationPanel: () => TulipConfigurationPanel,
}
