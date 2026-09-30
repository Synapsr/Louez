import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { listCustomerFieldDefinitions } from '@louez/api/services/customer-fields'
import { hasPermission } from '@louez/utils'
import { resolveStoreCustomerFormLayout } from '@louez/validations'

import { getCurrentStore } from '@/lib/store-context'
import { resolveDashboardCreationSource } from '@/lib/openreplay/events'
import { Button } from '@louez/ui'
import { CustomerForm } from '../customer-form'

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

interface NewCustomerPageProps {
  searchParams: Promise<{ source?: string | string[] }>
}

export default async function NewCustomerPage({
  searchParams,
}: NewCustomerPageProps) {
  const t = await getTranslations('dashboard.customers')
  const store = await getCurrentStore()
  const { source } = await searchParams
  const openReplaySource = resolveDashboardCreationSource(source)

  if (!store) {
    redirect('/onboarding')
  }

  const definitions = await listCustomerFieldDefinitions(store.id, { activeOnly: true, scope: 'customer' })

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button render={<Link href="/dashboard/customers" />} variant="ghost" size="icon">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('newCustomer')}</h1>
          <p className="text-muted-foreground">
            {t('newCustomerDescription')}
          </p>
        </div>
      </div>

      <CustomerForm
        items={resolveStoreCustomerFormLayout({
          settings: store.settings,
          scope: 'customer',
          definitions,
        })}
        canCustomize={hasPermission(store.role, 'manage_settings')}
        openReplaySource={openReplaySource}
      />
    </div>
  )
}
