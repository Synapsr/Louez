import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { getCurrentStore, hasPermission } from '@/lib/store-context'
import { createAccountLink } from '@/lib/stripe'
import { Card, CardContent, CardHeader, CardTitle } from '@louez/ui'
import { Button } from '@louez/ui'
import { WarningIcon } from '@louez/ui/icons'
import Link from 'next/link'

import { DashboardBreadcrumbLabel } from '@/components/dashboard/dashboard-breadcrumbs-context'

import { sanitizeStripeNextPath, stripeReturnUrls } from '../stripe-return'

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export default async function StripeRefreshPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  if (!hasPermission(store.role, 'manage_settings')) {
    redirect('/dashboard/settings/payments')
  }

  // Preserve the launching flow's return path across link regeneration
  const next = sanitizeStripeNextPath((await searchParams).next)

  const t = await getTranslations('dashboard.settings.payments')

  // If no Stripe account, redirect back
  if (!store.stripeAccountId) {
    redirect(next ?? '/dashboard/settings/payments')
  }

  // Create new onboarding link
  let newUrl: string | null = null
  try {
    const { returnUrl, refreshUrl } = stripeReturnUrls(next)
    newUrl = await createAccountLink(store.stripeAccountId, returnUrl, refreshUrl)
  } catch {
    // Failed to create link, show manual option
  }

  // If we got a new URL, redirect immediately
  if (newUrl) {
    redirect(newUrl)
  }

  // Otherwise show error page
  return (
    <>
      <DashboardBreadcrumbLabel label={t('refresh.title')} />
      <div className="flex min-h-[50vh] items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="flex items-center justify-center gap-2">
              <WarningIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
              {t('refresh.title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <p className="text-muted-foreground">{t('refresh.description')}</p>
            <Button render={<Link href="/dashboard/settings/payments" />} className="w-full">
                {t('refresh.backToSettings')}
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
