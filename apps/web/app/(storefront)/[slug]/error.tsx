'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, RefreshCw, Home } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@louez/ui'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@louez/ui'

export default function StorefrontError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations('storefront.error')

  useEffect(() => {
    console.error('Storefront error:', error)
  }, [error])

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>
            {t('description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button onClick={reset} variant="default" className="w-full">
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('retry')}
          </Button>
          <Button asChild variant="outline" className="w-full">
            <Link href="/">
              <Home className="mr-2 h-4 w-4" />
              {t('backToHome')}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
