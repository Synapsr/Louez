import type {
  IntegrationAdapter,
  IntegrationRuntimeStatus,
} from '@/lib/integrations/registry/types';

import { IcsCalendarConfigurationPanel } from './ics-calendar-configuration-panel';

function getIcsCalendarRuntimeStatus(): IntegrationRuntimeStatus {
  return {
    enabled: false,
    connected: false,
    configured: false,
    connectionIssue: null,
  };
}

export const icsCalendarIntegrationAdapter: IntegrationAdapter = {
  getStatus: getIcsCalendarRuntimeStatus,
  setEnabled: (settings) =>
    settings || {
      reservationMode: 'payment',
      advanceNoticeMinutes: 1440,
    },
  getConfigurationPanel: () => IcsCalendarConfigurationPanel,
};
