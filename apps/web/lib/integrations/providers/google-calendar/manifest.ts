import type { IntegrationManifest } from '@/lib/integrations/registry/types';

export const googleCalendarIntegrationManifest: IntegrationManifest = {
  id: 'google-calendar',
  category: 'calendar',
  nameKey: 'dashboard.settings.integrationsHub.providers.googleCalendar.name',
  descriptionKey:
    'dashboard.settings.integrationsHub.providers.googleCalendar.description',
  logoPath: '/integrations/google-calendar/logo.svg',
  galleryPaths: [],
  providerName: 'Google Calendar',
  pricingLabel: 'Included in plan',
  resourceLinks: [
    {
      labelKey:
        'dashboard.settings.integrationsHub.providers.googleCalendar.resources.help',
      url: 'https://support.google.com/calendar/',
    },
  ],
  featureKeys: [
    'dashboard.settings.integrationsHub.providers.googleCalendar.features.oauth',
    'dashboard.settings.integrationsHub.providers.googleCalendar.features.sync',
    'dashboard.settings.integrationsHub.providers.googleCalendar.features.retry',
  ],
  aboutKey: 'dashboard.settings.integrationsHub.providers.googleCalendar.about',
  websiteUrl: 'https://calendar.google.com/',
  status: 'beta',
};
