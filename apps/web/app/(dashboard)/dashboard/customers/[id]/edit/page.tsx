import {
  getCustomerFieldValues,
  listCustomerFieldDefinitions,
} from '@louez/api/services/customer-fields'
import { db } from '@louez/db'
import { hasPermission } from '@louez/utils'
import { resolveStoreCustomerFormLayout } from '@louez/validations'
import { getCurrentStore } from '@/lib/store-context'
import { customers } from '@louez/db'
import { eq, and } from 'drizzle-orm'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Button } from '@louez/ui'
import { DashboardBreadcrumbLabel } from '@/components/dashboard/dashboard-breadcrumbs-context'
import { CustomerForm } from '../../customer-form'

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

interface EditCustomerPageProps {
  params: Promise<{ id: string }>
}

export default async function EditCustomerPage({ params }: EditCustomerPageProps) {
  const t = await getTranslations('dashboard.customers')
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const { id } = await params

  const customer = await db.query.customers.findFirst({
    where: and(
      eq(customers.id, id),
      eq(customers.storeId, store.id)
    ),
  })

  if (!customer) {
    notFound()
  }

  const [definitions, customFields] = await Promise.all([
    listCustomerFieldDefinitions(store.id, { activeOnly: true, scope: 'customer' }),
    getCustomerFieldValues(store.id, customer.id),
  ])

  const customerBreadcrumbLabel =
    customer.customerType === 'business' && customer.companyName
      ? customer.companyName
      : `${customer.firstName} ${customer.lastName}`.trim()

  return (
    <div className="space-y-6">
      <DashboardBreadcrumbLabel
        pathname={`/dashboard/customers/${customer.id}`}
        label={customerBreadcrumbLabel}
      />
      <DashboardBreadcrumbLabel label={t('editCustomer')} />
      <div className="flex items-center gap-4">
        <Button render={<Link href={`/dashboard/customers/${customer.id}`} />} variant="ghost" size="icon">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t('editCustomer')} - {customer.firstName} {customer.lastName}
          </h1>
          <p className="text-muted-foreground">
            {t('editCustomerDescription')}
          </p>
        </div>
      </div>

      <CustomerForm
        customer={customer}
        items={resolveStoreCustomerFormLayout({
          settings: store.settings,
          scope: 'customer',
          definitions,
        })}
        initialCustomFields={customFields}
        canCustomize={hasPermission(store.role, 'manage_settings')}
      />
    </div>
  )
}
