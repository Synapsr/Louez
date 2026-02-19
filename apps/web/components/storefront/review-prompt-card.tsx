'use client'

import { useTranslations } from 'next-intl'
import { Star, ExternalLink } from 'lucide-react'
import { Card, CardContent } from '@louez/ui'
import { Button } from '@louez/ui'

interface ReviewPromptCardProps {
  storeName: string
  reviewUrl: string
}

export function ReviewPromptCard({ storeName, reviewUrl }: ReviewPromptCardProps) {
  const t = useTranslations('storefront.account.reviewPrompt')

  return (
    <Card className="bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-950/20 dark:to-yellow-950/20 border-amber-200 dark:border-amber-800">
      <CardContent className="p-6">
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <div className="flex items-center gap-1 text-amber-500">
            {[1, 2, 3, 4, 5].map((star) => (
              <Star key={star} className="h-6 w-6 fill-current" />
            ))}
          </div>
          <div className="flex-1 text-center sm:text-left">
            <h3 className="font-semibold">{t('title')}</h3>
            <p className="text-sm text-muted-foreground">
              {t('description', { name: storeName })}
            </p>
          </div>
          <Button render={<a href={reviewUrl} target="_blank" rel="noopener noreferrer" />}>
              {t('leaveReview')}
              <ExternalLink className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
