import type { RegisteredIntegration } from '@/lib/integrations/registry/types';

import { googleCalendarIntegrationAdapter } from './google-calendar/adapter';
import { googleCalendarIntegrationManifest } from './google-calendar/manifest';
import { icsCalendarIntegrationAdapter } from './ics-calendar/adapter';
import { icsCalendarIntegrationManifest } from './ics-calendar/manifest';
import { superPdpIntegrationAdapter } from './superpdp/adapter';
import { superPdpIntegrationManifest } from './superpdp/manifest';
import { tulipIntegrationAdapter } from './tulip/adapter';
import { tulipIntegrationManifest } from './tulip/manifest';

export const providerIntegrations: RegisteredIntegration[] = [
  {
    manifest: googleCalendarIntegrationManifest,
    adapter: googleCalendarIntegrationAdapter,
  },
  {
    manifest: icsCalendarIntegrationManifest,
    adapter: icsCalendarIntegrationAdapter,
  },
  {
    manifest: tulipIntegrationManifest,
    adapter: tulipIntegrationAdapter,
  },
  {
    manifest: superPdpIntegrationManifest,
    adapter: superPdpIntegrationAdapter,
  },
];
