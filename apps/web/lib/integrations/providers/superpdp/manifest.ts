import type { IntegrationManifest } from "@/lib/integrations/registry/types";

export const superPdpIntegrationManifest: IntegrationManifest = {
  id: "superpdp",
  category: "payments",
  nameKey: "dashboard.settings.integrationsHub.providers.superpdp.name",
  descriptionKey: "dashboard.settings.integrationsHub.providers.superpdp.description",
  logoPath: "/integrations/superpdp/logo.svg",
  galleryPaths: [],
  providerName: "Super PDP",
  pricingLabel: "Included",
  resourceLinks: [
    {
      labelKey: "dashboard.settings.integrationsHub.providers.superpdp.resources.website",
      url: "https://www.superpdp.tech/",
    },
  ],
  featureKeys: [
    "dashboard.settings.integrationsHub.providers.superpdp.features.send",
    "dashboard.settings.integrationsHub.providers.superpdp.features.receive",
    "dashboard.settings.integrationsHub.providers.superpdp.features.lifecycle",
  ],
  aboutKey: "dashboard.settings.integrationsHub.providers.superpdp.about",
  websiteUrl: "https://www.superpdp.tech/",
  status: "beta",
};
