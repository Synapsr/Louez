import type { IntegrationManifest } from '@/lib/integrations/registry/types'

export const exampleIntegrationManifest: IntegrationManifest = {
  id: 'example',
  category: 'insurance',
  nameKey: 'dashboard.settings.integrationsHub.providers.example.name',
  descriptionKey: 'dashboard.settings.integrationsHub.providers.example.description',
  logoPath: '/integrations/example/logo.svg',
  galleryPaths: [
    '/integrations/example/screen-1.svg',
    '/integrations/example/screen-2.svg',
    '/integrations/example/screen-3.svg',
  ],
  providerName: 'Example Provider',
  pricingLabel: 'Included in plan',
  resourceLinks: [
    {
      labelKey: 'dashboard.settings.integrationsHub.providers.example.resources.website',
      url: 'https://example.com',
    },
  ],
  featureKeys: [
    'dashboard.settings.integrationsHub.providers.example.features.feature1',
  ],
  aboutKey: 'dashboard.settings.integrationsHub.providers.example.about',
  websiteUrl: 'https://example.com',
  status: 'beta',
}
