import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { db } from '@/lib/db'
import { stores } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { ArrowLeft, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { getCustomerSession } from '../actions'
import { LoginForm } from './login-form'
import { generateStoreMetadata } from '@/lib/seo'
import type { StoreSettings, StoreTheme } from '@/types/store'

interface LoginPageProps {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({
  params,
}: LoginPageProps): Promise<Metadata> {
  const { slug } = await params

  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, slug),
  })

  if (!store) {
    return { title: 'Boutique introuvable' }
  }

  return generateStoreMetadata(
    {
      id: store.id,
      name: store.name,
      slug: store.slug,
      settings: store.settings as StoreSettings,
      theme: store.theme as StoreTheme,
    },
    {
      title: `Connexion - ${store.name}`,
      description: `Connectez-vous à votre compte client chez ${store.name}.`,
      noIndex: true,
    }
  )
}

export default async function LoginPage({ params }: LoginPageProps) {
  const { slug } = await params
  const t = await getTranslations('storefront.account')

  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, slug),
  })

  if (!store) {
    notFound()
  }

  // Check if already logged in
  const session = await getCustomerSession(slug)
  if (session) {
    redirect('/account')
  }

  return (
    <div className="min-h-[calc(100vh-200px)] bg-gradient-to-b from-muted/30 to-background">
      <div className="container mx-auto px-4 py-8">
        {/* Back Button */}
        <div className="mb-8">
          <Button variant="ghost" size="sm" asChild className="gap-2 -ml-2 text-muted-foreground hover:text-foreground">
            <Link href="/">
              <ArrowLeft className="h-4 w-4" />
              {t('back')}
            </Link>
          </Button>
        </div>

        <div className="max-w-md mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-primary/10 mb-4">
              <ShieldCheck className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold mb-2">
              {t('accessAccount')}
            </h1>
            <p className="text-muted-foreground">
              {t('accessDescription')}
            </p>
          </div>

          {/* Login Form */}
          <LoginForm storeId={store.id} storeSlug={slug} />

          {/* Security Note */}
          <p className="text-center text-xs text-muted-foreground mt-6">
            {t('securityNote')}
          </p>
        </div>
      </div>
    </div>
  )
}
