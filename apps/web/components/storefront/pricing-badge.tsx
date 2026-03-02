'use client'

import { TrendingDown } from 'lucide-react'
import { Badge } from '@louez/ui'

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
        className={`bg-primary/10 text-primary text-xs font-medium ${className}`}
      >
        <TrendingDown className="h-3 w-3" />
        -{maxDiscount}%
      </Badge>
    )
  }

  return (
    <Badge
      className={`bg-primary/10 text-primary gap-1 ${className}`}
    >
      <TrendingDown className="h-3 w-3" />
      <span>Jusqu'à -{maxDiscount}%</span>
    </Badge>
  )
}
