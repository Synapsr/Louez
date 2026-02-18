import { notFound, redirect } from 'next/navigation'

import type { StoreSettings } from '@louez/types'

import { listByCategory } from '@/lib/integrations/registry'
import { getCurrentStore } from '@/lib/store-context'

import { IntegrationsCatalogView } from '../../components/integrations-catalog-view'

interface IntegrationsCategoryPageProps {
  params: Promise<{ category: string }>
}

export default async function IntegrationsCategoryPage({
  params,
}: IntegrationsCategoryPageProps) {
  const { category } = await params
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const categoryIntegrations = listByCategory(
    (store.settings as StoreSettings | null) || null,
    category,
  )

  if (categoryIntegrations.length === 0) {
    notFound()
  }

  return <IntegrationsCatalogView category={category} />
}
