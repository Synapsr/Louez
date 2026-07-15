import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { RefreshCw } from 'lucide-react'

import { getCurrentStore } from '@/lib/store-context'
import { createAccountLink } from '@/lib/stripe'
import { Card, CardContent, CardHeader, CardTitle } from '@louez/ui'
import { Button } from '@louez/ui'
import Link from 'next/link'

import { sanitizeStripeNextPath, stripeReturnUrls } from '../stripe-return'

export default async function StripeRefreshPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
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
    <div className="flex min-h-[50vh] items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <RefreshCw className="mx-auto h-12 w-12 text-muted-foreground" />
          <CardTitle className="mt-4">{t('refresh.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          <p className="text-muted-foreground">{t('refresh.description')}</p>
          <Button render={<Link href="/dashboard/settings/payments" />} className="w-full">
              {t('refresh.backToSettings')}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
