import Link from 'next/link'
import { redirect } from 'next/navigation'

import { ArrowLeft } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { getCurrentStore } from '@/lib/store-context'

import { ApiKeysPageContent } from './api-keys-page-content'

export default async function McpIntegrationPage() {
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const t = await getTranslations('dashboard.settings.api')

  return (
    <div className="space-y-6">
      <Link
        href="/dashboard/settings/integrations"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('backToIntegrations')}
      </Link>

      <div>
        <h2 className="text-lg font-semibold">MCP</h2>
        <p className="text-muted-foreground text-sm">{t('description')}</p>
      </div>

      <ApiKeysPageContent />
    </div>
  )
}
