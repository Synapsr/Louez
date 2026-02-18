import { setIntegrationEnabledState } from '@/lib/integrations/registry/state'
import type { IntegrationAdapter } from '@/lib/integrations/registry/types'

export const exampleIntegrationAdapter: IntegrationAdapter = {
  getStatus: () => ({
    enabled: false,
    connected: false,
    configured: false,
    connectionIssue: null,
  }),
  setEnabled: (settings, enabled) =>
    setIntegrationEnabledState(settings, 'example', enabled),
}
