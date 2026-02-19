'use client'

import { useEffect } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@louez/ui'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@louez/ui'
import { useTranslations } from 'next-intl'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations('errors')

  useEffect(() => {
    console.error('Dashboard error:', error)
  }, [error])

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <CardTitle>{t('generic')}</CardTitle>
          <CardDescription>
            {t('pageLoadError')}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          {process.env.NODE_ENV === 'development' && (
            <div className="w-full rounded-lg bg-muted p-3 text-xs font-mono text-muted-foreground overflow-auto">
              {error.message}
            </div>
          )}
          <Button onClick={reset} className="w-full">
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('tryAgain')}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
