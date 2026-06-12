import type { IntegrationManifest } from '@/lib/integrations/registry/types';

export const tulipIntegrationManifest: IntegrationManifest = {
  id: 'tulip',
  category: 'insurance',
  nameKey: 'dashboard.settings.integrationsHub.providers.tulip.name',
  descriptionKey:
    'dashboard.settings.integrationsHub.providers.tulip.description',
  logoPath: '/integrations/tulip/logo.webp',
  galleryPaths: [
    '/integrations/tulip/screen-1.webp',
    '/integrations/tulip/screen-2.webp',
  ],
  providerName: 'Tulip',
  pricingLabel: 'Included in plan',
  resourceLinks: [
    {
      labelKey:
        'dashboard.settings.integrationsHub.providers.tulip.resources.website',
      url: 'https://mytulip.io/',
    },
    {
      labelKey:
        'dashboard.settings.integrationsHub.providers.tulip.resources.support',
      url: 'https://mytulip.io/contact',
    },
  ],
  featureKeys: [
    'dashboard.settings.integrationsHub.providers.tulip.features.sync',
    'dashboard.settings.integrationsHub.providers.tulip.features.checkout',
    'dashboard.settings.integrationsHub.providers.tulip.features.mapping',
  ],
  aboutKey: 'dashboard.settings.integrationsHub.providers.tulip.about',
  aboutSections: [
    {
      titleKey:
        'dashboard.settings.integrationsHub.providers.tulip.aboutSections.howItWorks.title',
      bodyKeys: [
        'dashboard.settings.integrationsHub.providers.tulip.aboutSections.howItWorks.reservation',
        'dashboard.settings.integrationsHub.providers.tulip.aboutSections.howItWorks.subscription',
        'dashboard.settings.integrationsHub.providers.tulip.aboutSections.howItWorks.claim',
      ],
    },
    {
      titleKey:
        'dashboard.settings.integrationsHub.providers.tulip.aboutSections.configure.title',
      bodyKeys: [
        'dashboard.settings.integrationsHub.providers.tulip.aboutSections.configure.contract',
        'dashboard.settings.integrationsHub.providers.tulip.aboutSections.configure.enable',
        'dashboard.settings.integrationsHub.providers.tulip.aboutSections.configure.start',
      ],
    },
    {
      titleKey:
        'dashboard.settings.integrationsHub.providers.tulip.aboutSections.about.title',
      bodyKeys: [
        'dashboard.settings.integrationsHub.providers.tulip.aboutSections.about.market',
        'dashboard.settings.integrationsHub.providers.tulip.aboutSections.about.orias',
      ],
    },
  ],
  websiteUrl: 'https://mytulip.io/',
  status: 'stable',
};
