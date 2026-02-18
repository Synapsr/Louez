import type { ComponentType } from 'react'

import type { StoreSettings } from '@louez/types'

export type IntegrationCategory = string
export type IntegrationLifecycleStatus = 'stable' | 'beta' | 'coming_soon'

export interface IntegrationResourceLink {
  labelKey: string
  url: string
}

export interface IntegrationManifest {
  id: string
  category: IntegrationCategory
  nameKey: string
  descriptionKey: string
  logoPath: string
  galleryPaths: string[]
  providerName: string
  pricingLabel: string
  resourceLinks: IntegrationResourceLink[]
  featureKeys: string[]
  aboutKey: string
  websiteUrl: string
  status: IntegrationLifecycleStatus
}

export interface IntegrationRuntimeStatus {
  enabled: boolean
  connected: boolean
  configured: boolean
  connectionIssue: string | null
}

export interface IntegrationAdapter {
  getStatus: (
    settings: StoreSettings | null | undefined,
  ) => IntegrationRuntimeStatus
  setEnabled: (
    settings: StoreSettings | null | undefined,
    enabled: boolean,
  ) => StoreSettings
  getConfigurationPanel?: () => ComponentType
}

export interface RegisteredIntegration {
  manifest: IntegrationManifest
  adapter: IntegrationAdapter
}

export interface IntegrationCatalogItem {
  id: string
  category: string
  nameKey: string
  descriptionKey: string
  logoPath: string
  status: IntegrationLifecycleStatus
  providerName: string
  enabled: boolean
  connected: boolean
  configured: boolean
  connectionIssue: string | null
}

export interface IntegrationDetail extends IntegrationCatalogItem {
  galleryPaths: string[]
  pricingLabel: string
  resourceLinks: IntegrationResourceLink[]
  featureKeys: string[]
  aboutKey: string
  websiteUrl: string
}

export interface IntegrationCategorySummary {
  id: string
  count: number
  integrationIds: string[]
}
