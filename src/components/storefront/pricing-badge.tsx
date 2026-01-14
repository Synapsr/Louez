'use client'

import { TrendingDown } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

interface PricingBadgeProps {
  maxDiscount: number
  className?: string
  variant?: 'default' | 'compact'
}

export function PricingBadge({
  maxDiscount,
  className = '',
  variant = 'default',
}: PricingBadgeProps) {
  if (maxDiscount <= 0) return null

  if (variant === 'compact') {
    return (
      <Badge
        variant="secondary"
        className={`bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300 text-xs font-medium ${className}`}
      >
        -{maxDiscount}%
      </Badge>
    )
  }

  return (
    <Badge
      variant="secondary"
      className={`bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300 gap-1 ${className}`}
    >
      <TrendingDown className="h-3 w-3" />
      <span>Jusqu'à -{maxDiscount}%</span>
    </Badge>
  )
}
