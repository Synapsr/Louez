import Link from 'next/link'
import { redirect } from 'next/navigation'

import { ArrowLeft, Braces } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Card, CardContent } from '@louez/ui'

import { getCurrentStore } from '@/lib/store-context'

export default async function ApiIntegrationPage() {
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const t = await getTranslations('dashboard.settings.integrationsHub')
  const tEmbed = await getTranslations('dashboard.settings.embed')

  return (
    <div className="space-y-6">
      <Link
        href="/dashboard/settings/integrations"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition"
      >
        <ArrowLeft className="h-4 w-4" />
        {tEmbed('backToIntegrations')}
      </Link>

      <div>
        <h2 className="text-lg font-semibold">API REST</h2>
        <p className="text-muted-foreground text-sm">
          {t('builtIn.api.description')}
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <div className="bg-muted mb-4 flex h-14 w-14 items-center justify-center rounded-full">
            <Braces className="text-muted-foreground h-7 w-7" />
          </div>
          <h3 className="text-lg font-medium">{t('comingSoon')}</h3>
          <p className="text-muted-foreground mt-1 max-w-sm text-sm">
            {t('builtIn.api.comingSoonDescription')}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
