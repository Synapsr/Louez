import { redirect } from 'next/navigation'

import { getCurrentStore } from '@/lib/store-context'

import { IntegrationsCatalogView } from './components/integrations-catalog-view'

export default async function IntegrationsPage() {
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  return <IntegrationsCatalogView />
}
