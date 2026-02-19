import { getCurrentStore } from '@/lib/store-context'
import { redirect } from 'next/navigation'

import { getStoreLimits, getStorePlan } from '@/lib/plan-limits'
import { CustomersPageContent } from './customers-page-content'

export default async function CustomersPage() {
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const [limits, plan] = await Promise.all([
    getStoreLimits(store.id),
    getStorePlan(store.id),
  ])

  return (
    <CustomersPageContent
      limits={limits.customers}
      planSlug={plan.slug}
      initialTotalCount={limits.customers.current}
    />
  )
}
