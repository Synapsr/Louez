'use client'

import { useTranslations } from 'next-intl'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@louez/ui'

import { TulipAssurancePanel } from './tulip-assurance-panel'

export function IntegrationsTabs() {
  const t = useTranslations('dashboard.settings')

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{t('integrations')}</h2>
        <p className="text-muted-foreground">{t('integrationsPage.description')}</p>
      </div>

      <Tabs defaultValue="assurance" className="space-y-6">
        <TabsList variant="underline">
          <TabsTrigger value="assurance">
            {t('integrationsTabs.assurance')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="assurance" className="space-y-6">
          <TulipAssurancePanel />
        </TabsContent>
      </Tabs>
    </div>
  )
}
