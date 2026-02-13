import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@louez/ui'
import { Mail } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

export default async function VerifyRequestPage() {
  const t = await getTranslations('auth')
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <Mail className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">{t('verifyRequest.title')}</CardTitle>
          <CardDescription>
            {t('verifyRequest.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t('verifyRequest.checkSpam')}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
