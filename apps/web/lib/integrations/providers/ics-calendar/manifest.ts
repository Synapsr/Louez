import type { IntegrationManifest } from '@/lib/integrations/registry/types';

export const icsCalendarIntegrationManifest: IntegrationManifest = {
  id: 'ics-calendar',
  category: 'calendar',
  nameKey: 'dashboard.settings.integrationsHub.providers.icsCalendar.name',
  descriptionKey:
    'dashboard.settings.integrationsHub.providers.icsCalendar.description',
  logoPath: '/integrations/ics-calendar/logo.svg',
  galleryPaths: [],
  providerName: 'ICS',
  pricingLabel: 'Included in plan',
  resourceLinks: [
    {
      labelKey:
        'dashboard.settings.integrationsHub.providers.icsCalendar.resources.help',
      url: 'https://icalendar.org/',
    },
  ],
  featureKeys: [
    'dashboard.settings.integrationsHub.providers.icsCalendar.features.link',
    'dashboard.settings.integrationsHub.providers.icsCalendar.features.compatibility',
  ],
  aboutKey: 'dashboard.settings.integrationsHub.providers.icsCalendar.about',
  websiteUrl: 'https://icalendar.org/',
  status: 'stable',
};
