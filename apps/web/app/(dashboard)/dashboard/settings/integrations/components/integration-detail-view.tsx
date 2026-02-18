'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toastManager,
} from '@louez/ui'

import { getIntegration } from '@/lib/integrations/registry'
import type { IntegrationDetail } from '@/lib/integrations/registry/types'
import { orpc } from '@/lib/orpc/react'

type IntegrationDetailViewProps = {
  integrationId: string
}

export function IntegrationDetailView({ integrationId }: IntegrationDetailViewProps) {
  const t = useTranslations()
  const queryClient = useQueryClient()

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

  const detailQuery = useQuery(
    orpc.dashboard.integrations.getDetail.queryOptions({
      input: { integrationId },
    }),
  )

  const setEnabledMutation = useMutation(
    orpc.dashboard.integrations.setEnabled.mutationOptions({
      onSuccess: async (_, input) => {
        toastManager.add({
          type: 'success',
          title: resolveMessage(
            input.enabled
              ? 'dashboard.settings.integrationsHub.toasts.enabled'
              : 'dashboard.settings.integrationsHub.toasts.disabled',
            input.enabled ? 'Integration enabled.' : 'Integration disabled.',
          ),
        })

        await queryClient.invalidateQueries({
          queryKey: orpc.dashboard.integrations.getDetail.key({
            input: { integrationId },
          }),
        })
        await queryClient.invalidateQueries({
          queryKey: orpc.dashboard.integrations.listCatalog.key({ input: {} }),
        })
        if (integration?.category) {
          await queryClient.invalidateQueries({
            queryKey: orpc.dashboard.integrations.listCategory.key({
              input: { category: integration.category },
            }),
          })
        }
      },
      onError: () => {
        toastManager.add({
          type: 'error',
          title: resolveMessage('errors.generic', 'Something went wrong.'),
        })
      },
    }),
  )

  const integration: IntegrationDetail | null =
    detailQuery.data && !('error' in detailQuery.data)
      ? (detailQuery.data.integration as unknown as IntegrationDetail)
      : null
  const registration = useMemo(() => getIntegration(integrationId), [integrationId])
  const ConfigurationPanel = registration?.adapter.getConfigurationPanel?.()

  if (detailQuery.isLoading) {
    return (
      <p className="text-sm text-muted-foreground">
        {resolveMessage('dashboard.settings.integrationsHub.loading', 'Loading integration...')}
      </p>
    )
  }

  if (detailQuery.isError || !integration) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {resolveMessage(
              'dashboard.settings.integrationsHub.detailNotFoundTitle',
              'Integration not found',
            )}
          </CardTitle>
          <CardDescription>
            {resolveMessage(
              'dashboard.settings.integrationsHub.detailNotFoundDescription',
              'The integration could not be loaded.',
            )}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Link href="/dashboard/settings/integrations" className="text-sm text-primary">
        {resolveMessage('dashboard.settings.integrationsHub.backToCatalog', 'Back to catalog')}
      </Link>

      <Card>
        <CardContent className="grid gap-6 p-6 lg:grid-cols-[1fr_auto] lg:items-start">
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="h-14 w-14 overflow-hidden rounded-lg border bg-background p-2">
                <img
                  src={integration.logoPath}
                  alt={resolveMessage(integration.nameKey, integration.id)}
                  className="h-full w-full object-contain"
                />
              </div>
              <div>
                <h2 className="text-2xl font-bold tracking-tight">
                  {resolveMessage(integration.nameKey, integration.id)}
                </h2>
                <p className="text-muted-foreground">
                  {resolveMessage(
                    integration.descriptionKey,
                    resolveMessage(
                      'dashboard.settings.integrationsHub.fallbackDescription',
                      'Integration details are available on this page.',
                    ),
                  )}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={integration.enabled ? 'success' : 'secondary'}>
                {integration.enabled
                  ? resolveMessage(
                      'dashboard.settings.integrationsHub.statusLabels.enabled',
                      'Enabled',
                    )
                  : resolveMessage(
                      'dashboard.settings.integrationsHub.statusLabels.disabled',
                      'Disabled',
                    )}
              </Badge>
              <Badge variant={integration.connected ? 'success' : 'secondary'}>
                {integration.connected
                  ? resolveMessage(
                      'dashboard.settings.integrationsHub.statusLabels.connected',
                      'Connected',
                    )
                  : resolveMessage(
                      'dashboard.settings.integrationsHub.statusLabels.notConnected',
                      'Not connected',
                    )}
              </Badge>
              <Badge variant="outline">
                {resolveMessage(
                  `dashboard.settings.integrationsHub.lifecycle.${integration.status}`,
                  integration.status,
                )}
              </Badge>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={integration.enabled ? 'outline' : 'default'}
              disabled={setEnabledMutation.isPending}
              onClick={() => {
                setEnabledMutation.mutate({
                  integrationId,
                  enabled: !integration.enabled,
                })
              }}
            >
              {integration.enabled
                ? resolveMessage(
                    'dashboard.settings.integrationsHub.disableAction',
                    'Disable integration',
                  )
                : resolveMessage(
                    'dashboard.settings.integrationsHub.enableAction',
                    'Enable integration',
                  )}
            </Button>

            <Button
              type="button"
              variant="outline"
              render={
                <a href={integration.websiteUrl} target="_blank" rel="noreferrer" />
              }
            >
              {resolveMessage('dashboard.settings.integrationsHub.visitWebsite', 'Visit website')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Tabs defaultValue="features" className="space-y-4">
          <TabsList variant="underline">
            <TabsTrigger value="features">
              {resolveMessage('dashboard.settings.integrationsHub.tabs.features', 'Features')}
            </TabsTrigger>
            <TabsTrigger value="configuration">
              {resolveMessage(
                'dashboard.settings.integrationsHub.tabs.configuration',
                'Configuration',
              )}
            </TabsTrigger>
            <TabsTrigger value="about">
              {resolveMessage('dashboard.settings.integrationsHub.tabs.about', 'About')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="features" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>
                  {resolveMessage('dashboard.settings.integrationsHub.featuresTitle', 'What it does')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
                  {integration.featureKeys.map((featureKey: string) => (
                    <li key={featureKey}>
                      {resolveMessage(featureKey, featureKey)}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>
                  {resolveMessage('dashboard.settings.integrationsHub.galleryTitle', 'Gallery')}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                {integration.galleryPaths.map((imagePath: string) => (
                  <div
                    key={imagePath}
                    className="overflow-hidden rounded-md border bg-background"
                  >
                    <img
                      src={imagePath}
                      alt={resolveMessage(integration.nameKey, integration.id)}
                      className="h-full w-full object-cover"
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="configuration" className="space-y-4">
            {!integration.enabled ? (
              <Card>
                <CardHeader>
                  <CardTitle>
                    {resolveMessage(
                      'dashboard.settings.integrationsHub.configurationLockedTitle',
                      'Enable to configure',
                    )}
                  </CardTitle>
                  <CardDescription>
                    {resolveMessage(
                      'dashboard.settings.integrationsHub.configurationLockedDescription',
                      'You need to enable this integration before opening its configuration.',
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    type="button"
                    disabled={setEnabledMutation.isPending}
                    onClick={() => {
                      setEnabledMutation.mutate({
                        integrationId,
                        enabled: true,
                      })
                    }}
                  >
                    {resolveMessage(
                      'dashboard.settings.integrationsHub.enableAction',
                      'Enable integration',
                    )}
                  </Button>
                </CardContent>
              </Card>
            ) : ConfigurationPanel ? (
              <ConfigurationPanel />
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>
                    {resolveMessage(
                      'dashboard.settings.integrationsHub.configurationUnavailableTitle',
                      'Configuration unavailable',
                    )}
                  </CardTitle>
                  <CardDescription>
                    {resolveMessage(
                      'dashboard.settings.integrationsHub.configurationUnavailableDescription',
                      'This integration does not expose a configuration panel yet.',
                    )}
                  </CardDescription>
                </CardHeader>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="about">
            <Card>
              <CardHeader>
                <CardTitle>
                  {resolveMessage('dashboard.settings.integrationsHub.aboutTitle', 'About')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>{resolveMessage(integration.aboutKey, integration.aboutKey)}</p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>
              {resolveMessage('dashboard.settings.integrationsHub.metadataTitle', 'Integration details')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {resolveMessage('dashboard.settings.integrationsHub.metadata.provider', 'Provider')}
              </p>
              <p className="font-medium">{integration.providerName}</p>
            </div>

            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {resolveMessage('dashboard.settings.integrationsHub.metadata.pricing', 'Pricing')}
              </p>
              <p className="font-medium">{integration.pricingLabel}</p>
            </div>

            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {resolveMessage('dashboard.settings.integrationsHub.metadata.category', 'Category')}
              </p>
              <p className="font-medium">
                {resolveMessage(
                  `dashboard.settings.integrationsHub.categories.${integration.category}.name`,
                  integration.category,
                )}
              </p>
            </div>

            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {resolveMessage('dashboard.settings.integrationsHub.metadata.resources', 'Resources')}
              </p>
              <div className="mt-2 flex flex-col gap-2">
                {integration.resourceLinks.map((resource: {
                  labelKey: string
                  url: string
                }) => (
                  <a
                    key={resource.url}
                    href={resource.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary"
                  >
                    <span>{resolveMessage(resource.labelKey, resource.url)}</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
