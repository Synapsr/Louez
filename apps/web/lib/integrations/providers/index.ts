import type { RegisteredIntegration } from '@/lib/integrations/registry/types'

import { tulipIntegrationAdapter } from './tulip/adapter'
import { tulipIntegrationManifest } from './tulip/manifest'

export const providerIntegrations: RegisteredIntegration[] = [
  {
    manifest: tulipIntegrationManifest,
    adapter: tulipIntegrationAdapter,
  },
]
