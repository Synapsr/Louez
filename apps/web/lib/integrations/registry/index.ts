import type { StoreSettings } from '@louez/types'

import { providerIntegrations } from '@/lib/integrations/providers'
import type {
  IntegrationCatalogItem,
  IntegrationCategorySummary,
  IntegrationDetail,
  RegisteredIntegration,
} from '@/lib/integrations/registry/types'

const integrationMap = new Map(
  providerIntegrations.map((entry) => [entry.manifest.id, entry] as const),
)

function toCatalogItem(
  entry: RegisteredIntegration,
  settings: StoreSettings | null | undefined,
): IntegrationCatalogItem {
  const runtime = entry.adapter.getStatus(settings)

  return {
    id: entry.manifest.id,
    category: entry.manifest.category,
    nameKey: entry.manifest.nameKey,
    descriptionKey: entry.manifest.descriptionKey,
    logoPath: entry.manifest.logoPath,
    status: entry.manifest.status,
    providerName: entry.manifest.providerName,
    enabled: runtime.enabled,
    connected: runtime.connected,
    configured: runtime.configured,
    connectionIssue: runtime.connectionIssue,
  }
}

export function listIntegrations(
  settings: StoreSettings | null | undefined,
): IntegrationCatalogItem[] {
  return providerIntegrations
    .map((entry) => toCatalogItem(entry, settings))
    .sort((a, b) => a.id.localeCompare(b.id))
}

export function listCategories(
  settings: StoreSettings | null | undefined,
): IntegrationCategorySummary[] {
  const catalog = listIntegrations(settings)

  const grouped = new Map<string, IntegrationCategorySummary>()
  for (const item of catalog) {
    const current = grouped.get(item.category)
    if (!current) {
      grouped.set(item.category, {
        id: item.category,
        count: 1,
        integrationIds: [item.id],
      })
      continue
    }

    current.count += 1
    current.integrationIds.push(item.id)
  }

  return [...grouped.values()]
    .filter((category) => category.count > 0)
    .sort((a, b) => a.id.localeCompare(b.id))
}

export function listByCategory(
  settings: StoreSettings | null | undefined,
  category: string,
): IntegrationCatalogItem[] {
  return listIntegrations(settings).filter((item) => item.category === category)
}

export function getIntegration(
  integrationId: string,
): RegisteredIntegration | null {
  return integrationMap.get(integrationId) ?? null
}

export function getIntegrationDetail(
  settings: StoreSettings | null | undefined,
  integrationId: string,
): IntegrationDetail | null {
  const entry = getIntegration(integrationId)
  if (!entry) {
    return null
  }

  const catalogItem = toCatalogItem(entry, settings)

  return {
    ...catalogItem,
    galleryPaths: entry.manifest.galleryPaths,
    pricingLabel: entry.manifest.pricingLabel,
    resourceLinks: entry.manifest.resourceLinks,
    featureKeys: entry.manifest.featureKeys,
    aboutKey: entry.manifest.aboutKey,
    websiteUrl: entry.manifest.websiteUrl,
  }
}
