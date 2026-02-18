import { notFound, redirect } from 'next/navigation'

import { getIntegration } from '@/lib/integrations/registry'
import { getCurrentStore } from '@/lib/store-context'

import { IntegrationDetailView } from '../components/integration-detail-view'

interface IntegrationDetailPageProps {
  params: Promise<{ integrationId: string }>
}

export default async function IntegrationDetailPage({
  params,
}: IntegrationDetailPageProps) {
  const { integrationId } = await params
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  if (!getIntegration(integrationId)) {
    notFound()
  }

  return <IntegrationDetailView integrationId={integrationId} />
}
