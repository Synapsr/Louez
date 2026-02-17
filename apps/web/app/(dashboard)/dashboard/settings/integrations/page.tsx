import { redirect } from 'next/navigation'

import { getCurrentStore } from '@/lib/store-context'

import { IntegrationsTabs } from './components/integrations-tabs'

export default async function IntegrationsPage() {
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  return <IntegrationsTabs />
}
