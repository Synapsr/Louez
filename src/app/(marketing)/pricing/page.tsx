import { db } from '@/lib/db'
import { subscriptionPlans } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { PricingCards } from './pricing-cards'
import { Logo } from '@/components/ui/logo'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { auth } from '@/lib/auth'
import { getTranslations } from 'next-intl/server'

export const metadata = {
  title: 'Tarifs',
  description: 'Choisissez le plan qui correspond a vos besoins',
}

export default async function PricingPage() {
  const t = await getTranslations('pricing')
  const session = await auth()

  const plans = await db.query.subscriptionPlans.findMany({
    where: eq(subscriptionPlans.isActive, true),
    orderBy: (plans, { asc }) => [asc(plans.displayOrder)],
  })

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Logo className="h-8 w-auto" />
          </Link>
          <div className="flex items-center gap-4">
            {session?.user ? (
              <Button asChild variant="ghost">
                <Link href="/dashboard">{t('backToDashboard')}</Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost">
                  <Link href="/login">{t('login')}</Link>
                </Button>
                <Button asChild>
                  <Link href="/login">{t('startFree')}</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container py-16 md:py-24">
        <div className="mx-auto max-w-4xl text-center mb-12">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl mb-4">
            {t('title')}
          </h1>
          <p className="text-xl text-muted-foreground">
            {t('subtitle')}
          </p>
        </div>

        <PricingCards plans={plans} isLoggedIn={!!session?.user} />

        {/* FAQ Section */}
        <div className="mx-auto max-w-3xl mt-24">
          <h2 className="text-2xl font-bold text-center mb-8">{t('faq.title')}</h2>
          <div className="space-y-6">
            <div>
              <h3 className="font-semibold mb-2">{t('faq.cancelAnytime.question')}</h3>
              <p className="text-muted-foreground">{t('faq.cancelAnytime.answer')}</p>
            </div>
            <div>
              <h3 className="font-semibold mb-2">{t('faq.changePlan.question')}</h3>
              <p className="text-muted-foreground">{t('faq.changePlan.answer')}</p>
            </div>
            <div>
              <h3 className="font-semibold mb-2">{t('faq.paymentMethods.question')}</h3>
              <p className="text-muted-foreground">{t('faq.paymentMethods.answer')}</p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t py-8 mt-16">
        <div className="container flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            {t('footer.copyright', { year: new Date().getFullYear() })}
          </p>
          <div className="flex gap-6">
            <Link href="/terms" className="text-sm text-muted-foreground hover:text-foreground">
              {t('footer.terms')}
            </Link>
            <Link href="/privacy" className="text-sm text-muted-foreground hover:text-foreground">
              {t('footer.privacy')}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
