import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { RefreshCw } from 'lucide-react'

import { getCurrentStore } from '@/lib/store-context'
import { createAccountLink } from '@/lib/stripe'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

export default async function StripeRefreshPage() {
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const t = await getTranslations('dashboard.settings.payments')

  // If no Stripe account, redirect back
  if (!store.stripeAccountId) {
    redirect('/dashboard/settings/payments')
  }

  // Create new onboarding link
  let newUrl: string | null = null
  try {
    newUrl = await createAccountLink(
      store.stripeAccountId,
      `${APP_URL}/dashboard/settings/payments/callback`,
      `${APP_URL}/dashboard/settings/payments/refresh`
    )
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
          <Button asChild className="w-full">
            <Link href="/dashboard/settings/payments">
              {t('refresh.backToSettings')}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
