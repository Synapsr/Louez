import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { getCurrentStore } from '@/lib/store-context'
import { getStorefrontUrl } from '@/lib/storefront-url'
import { EmbedCodeSection } from './embed-code-section'

export default async function EmbedSettingsPage() {
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const t = await getTranslations('dashboard.settings.embed')
  const embedUrl = getStorefrontUrl(store.slug, '/embed')

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground">
        {t('description')}
      </p>

      <EmbedCodeSection embedUrl={embedUrl} storeName={store.name} />
    </div>
  )
}
