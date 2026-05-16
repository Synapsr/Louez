import type {
  IntegrationAdapter,
  IntegrationRuntimeStatus,
} from '@/lib/integrations/registry/types';

import { GoogleCalendarConfigurationPanel } from './google-calendar-configuration-panel';

function getGoogleCalendarRuntimeStatus(): IntegrationRuntimeStatus {
  return {
    enabled: false,
    connected: false,
    configured: false,
    connectionIssue: null,
  };
}

export const googleCalendarIntegrationAdapter: IntegrationAdapter = {
  getStatus: getGoogleCalendarRuntimeStatus,
  setEnabled: (settings) =>
    settings || {
      reservationMode: 'payment',
      advanceNoticeMinutes: 1440,
    },
  getConfigurationPanel: () => GoogleCalendarConfigurationPanel,
};
