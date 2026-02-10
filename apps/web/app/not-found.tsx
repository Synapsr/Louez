import Link from 'next/link'
import { FileQuestion, Home, ArrowLeft } from 'lucide-react'
import { Button } from '@louez/ui'
import { getTranslations } from 'next-intl/server'

export default async function NotFound() {
  const t = await getTranslations('errors')

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="text-center max-w-md">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-muted">
          <FileQuestion className="h-10 w-10 text-muted-foreground" />
        </div>
        <h1 className="text-4xl font-bold tracking-tight mb-2">404</h1>
        <h2 className="text-xl font-semibold mb-4">{t('notFound')}</h2>
        <p className="text-muted-foreground mb-8">
          {t('notFoundDescription')}
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button variant="default" render={<Link href="/" />}>
              <Home className="mr-2 h-4 w-4" />
              {t('goHome')}
          </Button>
          <Button variant="outline" render={<Link href="javascript:history.back()" />}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t('goBack')}
          </Button>
        </div>
      </div>
    </div>
  )
}
