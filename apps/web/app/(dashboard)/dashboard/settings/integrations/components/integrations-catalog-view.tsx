'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from '@louez/ui'

import type {
  IntegrationCatalogItem,
  IntegrationCategorySummary,
} from '@/lib/integrations/registry/types'
import { orpc } from '@/lib/orpc/react'

import { IntegrationCard } from './integration-card'

type IntegrationsCatalogViewProps = {
  category?: string
}

type StatusFilter = 'all' | 'enabled' | 'disabled'

export function IntegrationsCatalogView({
  category,
}: IntegrationsCatalogViewProps) {
  const t = useTranslations()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const resolveMessage = (key: string, fallback: string): string => {
    try {
      const value = t(key as never)
      if (!value || value === key) {
        return fallback
      }

      return value
    } catch {
      return fallback
    }
  }

  const catalogQuery = useQuery({
    ...orpc.dashboard.integrations.listCatalog.queryOptions({ input: {} }),
    enabled: !category,
  })

  const categoryQuery = useQuery({
    ...orpc.dashboard.integrations.listCategory.queryOptions({
      input: { category: category || '' },
    }),
    enabled: Boolean(category),
  })

  const data = category ? categoryQuery.data : catalogQuery.data
  const isLoading = category ? categoryQuery.isLoading : catalogQuery.isLoading
  const isError = category ? categoryQuery.isError : catalogQuery.isError

  const parsedData = data && !('error' in data) ? data : null
  const integrations: IntegrationCatalogItem[] = parsedData
    ? (parsedData.integrations as unknown as IntegrationCatalogItem[])
    : []
  const categories: IntegrationCategorySummary[] = parsedData
    ? (parsedData.categories as unknown as IntegrationCategorySummary[])
    : []

  const normalizedSearch = search.trim().toLowerCase()

  const filteredIntegrations = integrations.filter((item: IntegrationCatalogItem) => {
    const statusMatch =
      statusFilter === 'all' ||
      (statusFilter === 'enabled' ? item.enabled : !item.enabled)

    if (!statusMatch) {
      return false
    }

    if (!normalizedSearch) {
      return true
    }

    const name = resolveMessage(item.nameKey, item.id).toLowerCase()
    const description =
      resolveMessage(item.descriptionKey, item.descriptionKey).toLowerCase()

    return name.includes(normalizedSearch) || description.includes(normalizedSearch)
  })

  const groupedByCategory = categories
    .map((currentCategory: IntegrationCategorySummary) => {
      const items = filteredIntegrations.filter(
        (item: IntegrationCatalogItem) => item.category === currentCategory.id,
      )

      return {
        ...currentCategory,
        items,
      }
    })
    .filter((group) => group.items.length > 0)

  if (isLoading) {
    return (
      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight">
          {resolveMessage('dashboard.settings.integrationsHub.title', 'Integrations')}
        </h2>
        <p className="text-muted-foreground">
          {resolveMessage(
            'dashboard.settings.integrationsHub.loading',
            'Loading integrations...',
          )}
        </p>
      </div>
    )
  }

  if (isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {resolveMessage('dashboard.settings.integrationsHub.title', 'Integrations')}
          </CardTitle>
          <CardDescription>
            {resolveMessage(
              'dashboard.settings.integrationsHub.loadError',
              'Unable to load integrations.',
            )}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight">
          {resolveMessage('dashboard.settings.integrationsHub.title', 'Integrations')}
        </h2>
        <p className="text-muted-foreground">
          {resolveMessage(
            'dashboard.settings.integrationsHub.catalogDescription',
            'Enable and configure integrations by category.',
          )}
        </p>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative w-full md:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder={resolveMessage(
              'dashboard.settings.integrationsHub.searchPlaceholder',
              'Search integrations',
            )}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        {category && (
          <div className="flex flex-wrap gap-2">
            {(['all', 'enabled', 'disabled'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className="rounded-md border px-3 py-1.5 text-sm"
                onClick={() => setStatusFilter(value)}
              >
                <span
                  className={
                    statusFilter === value ? 'font-semibold text-foreground' : 'text-muted-foreground'
                  }
                >
                  {resolveMessage(
                    `dashboard.settings.integrationsHub.statusFilters.${value}`,
                    value,
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {!category && (
        <section className="space-y-3">
          <h3 className="text-lg font-semibold">
            {resolveMessage('dashboard.settings.integrationsHub.categoriesTitle', 'Categories')}
          </h3>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {categories.map((item: IntegrationCategorySummary) => {
              const categoryIntegrations = integrations.filter(
                (integration: IntegrationCatalogItem) =>
                  integration.category === item.id,
              )

              return (
                <Link
                  key={item.id}
                  href={`/dashboard/settings/integrations/categories/${item.id}`}
                >
                  <Card className="h-full transition hover:border-primary/40 hover:bg-muted/40">
                    <CardHeader>
                      <CardTitle>
                        {resolveMessage(
                          `dashboard.settings.integrationsHub.categories.${item.id}.name`,
                          item.id,
                        )}
                      </CardTitle>
                      <CardDescription>
                        {resolveMessage(
                          `dashboard.settings.integrationsHub.categories.${item.id}.description`,
                          '',
                        )}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        {resolveMessage(
                          'dashboard.settings.integrationsHub.categoryCount',
                          '{count} integrations',
                        ).replace('{count}', String(item.count))}
                      </p>
                      <div className="flex -space-x-2">
                        {categoryIntegrations
                          .slice(0, 4)
                          .map((integration: IntegrationCatalogItem) => (
                          <div
                            key={integration.id}
                            className="h-8 w-8 overflow-hidden rounded-full border bg-background p-1"
                          >
                            <img
                              src={integration.logoPath}
                              alt={resolveMessage(
                                integration.nameKey,
                                integration.id,
                              )}
                              className="h-full w-full object-contain"
                            />
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {category ? (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">
              {resolveMessage(
                `dashboard.settings.integrationsHub.categories.${category}.name`,
                category,
              )}
            </h3>
            <Link
              href="/dashboard/settings/integrations"
              className="text-sm text-primary"
            >
              {resolveMessage('dashboard.settings.integrationsHub.backToCatalog', 'Back to catalog')}
            </Link>
          </div>

          {filteredIntegrations.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">
                {resolveMessage(
                  'dashboard.settings.integrationsHub.emptyCategory',
                  'No integrations match your filters.',
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredIntegrations.map((item: IntegrationCatalogItem) => (
              <IntegrationCard
                key={item.id}
                href={`/dashboard/settings/integrations/${item.id}`}
                logoPath={item.logoPath}
                name={resolveMessage(item.nameKey, item.id)}
                description={resolveMessage(
                  item.descriptionKey,
                  resolveMessage(
                    'dashboard.settings.integrationsHub.fallbackDescription',
                    'Integration details are available on the detail page.',
                  ),
                )}
                enabled={item.enabled}
                connected={item.connected}
                  enabledLabel={resolveMessage(
                    'dashboard.settings.integrationsHub.statusLabels.enabled',
                    'Enabled',
                  )}
                  disabledLabel={resolveMessage(
                    'dashboard.settings.integrationsHub.statusLabels.disabled',
                    'Disabled',
                  )}
                  connectedLabel={resolveMessage(
                    'dashboard.settings.integrationsHub.statusLabels.connected',
                    'Connected',
                  )}
                  statusLabel={resolveMessage(
                    `dashboard.settings.integrationsHub.lifecycle.${item.status}`,
                    item.status,
                  )}
                />
              ))}
            </div>
          )}
        </section>
      ) : (
        groupedByCategory.map((group: IntegrationCategorySummary & {
          items: IntegrationCatalogItem[]
        }) => (
          <section key={group.id} className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">
                  {resolveMessage(
                    `dashboard.settings.integrationsHub.categories.${group.id}.name`,
                    group.id,
                  )}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {resolveMessage(
                    `dashboard.settings.integrationsHub.categories.${group.id}.description`,
                    '',
                  )}
                </p>
              </div>
              <Link
                href={`/dashboard/settings/integrations/categories/${group.id}`}
                className="text-sm text-primary"
              >
                {resolveMessage('dashboard.settings.integrationsHub.viewAll', 'View all')}
              </Link>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {group.items.slice(0, 3).map((item: IntegrationCatalogItem) => (
                <IntegrationCard
                  key={item.id}
                  href={`/dashboard/settings/integrations/${item.id}`}
                  logoPath={item.logoPath}
                  name={resolveMessage(item.nameKey, item.id)}
                  description={resolveMessage(
                    item.descriptionKey,
                    resolveMessage(
                      'dashboard.settings.integrationsHub.fallbackDescription',
                      'Integration details are available on the detail page.',
                    ),
                  )}
                  enabled={item.enabled}
                  connected={item.connected}
                  enabledLabel={resolveMessage(
                    'dashboard.settings.integrationsHub.statusLabels.enabled',
                    'Enabled',
                  )}
                  disabledLabel={resolveMessage(
                    'dashboard.settings.integrationsHub.statusLabels.disabled',
                    'Disabled',
                  )}
                  connectedLabel={resolveMessage(
                    'dashboard.settings.integrationsHub.statusLabels.connected',
                    'Connected',
                  )}
                  statusLabel={resolveMessage(
                    `dashboard.settings.integrationsHub.lifecycle.${item.status}`,
                    item.status,
                  )}
                />
              ))}
            </div>
          </section>
        ))
      )}

      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">
          {resolveMessage(
            'dashboard.settings.integrationsHub.statusLabels.enabled',
            'Enabled',
          )}
          : {integrations.filter((item: IntegrationCatalogItem) => item.enabled).length}
        </Badge>
        <Badge variant="outline">
          {resolveMessage(
            'dashboard.settings.integrationsHub.statusLabels.connected',
            'Connected',
          )}
          : {integrations.filter((item: IntegrationCatalogItem) => item.connected).length}
        </Badge>
      </div>
    </div>
  )
}
