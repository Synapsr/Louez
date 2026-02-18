import type { StoreSettings } from '@louez/types'

import { getTulipSettings } from '@/lib/integrations/tulip/settings'
import { setIntegrationEnabledState } from '@/lib/integrations/registry/state'
import type {
  IntegrationAdapter,
  IntegrationRuntimeStatus,
} from '@/lib/integrations/registry/types'

import { TulipConfigurationPanel } from './tulip-configuration-panel'

function getTulipRuntimeStatus(
  settings: StoreSettings | null | undefined,
): IntegrationRuntimeStatus {
  const tulipSettings = getTulipSettings(settings)
  const legacyConnected = Boolean(
    tulipSettings.apiKeyEncrypted && tulipSettings.renterUid,
  )

  return {
    enabled: tulipSettings.enabled,
    connected: legacyConnected,
    configured: legacyConnected,
    connectionIssue: null,
  }
}

export const tulipIntegrationAdapter: IntegrationAdapter = {
  getStatus: getTulipRuntimeStatus,
  setEnabled: (settings, enabled) =>
    setIntegrationEnabledState(settings, 'tulip', enabled),
  getConfigurationPanel: () => TulipConfigurationPanel,
}
