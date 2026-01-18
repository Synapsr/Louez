'use client'

import { useEffect } from 'react'
import { useAnalytics } from '@/contexts/analytics-context'

type PageType = 'home' | 'catalog' | 'product' | 'cart' | 'checkout' | 'confirmation' | 'account'

interface PageTrackerProps {
  page: PageType
  productId?: string
  categoryId?: string
}

export function PageTracker({ page, productId, categoryId }: PageTrackerProps) {
  const { trackPageView } = useAnalytics()

  useEffect(() => {
    trackPageView({ page, productId, categoryId })
  }, [page, productId, categoryId, trackPageView])

  return null
}
