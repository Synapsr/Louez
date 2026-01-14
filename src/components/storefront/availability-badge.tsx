'use client'

import { useTranslations } from 'next-intl'
import { Check, AlertTriangle, X, ShoppingCart } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

export type AvailabilityStatus = 'available' | 'limited' | 'unavailable' | 'in_cart'

interface AvailabilityBadgeProps {
  status: AvailabilityStatus
  availableQuantity?: number
  totalQuantity?: number
  cartQuantity?: number
  className?: string
  showIcon?: boolean
  size?: 'sm' | 'md'
}

export function AvailabilityBadge({
  status,
  availableQuantity = 0,
  totalQuantity = 0,
  cartQuantity = 0,
  className,
  showIcon = true,
  size = 'md',
}: AvailabilityBadgeProps) {
  const t = useTranslations('storefront.availability.badge')

  const config = {
    available: {
      icon: Check,
      label:
        availableQuantity > 1
          ? t('availableCount', { count: availableQuantity })
          : t('available'),
      className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    },
    limited: {
      icon: AlertTriangle,
      label: t('limited', { count: availableQuantity }),
      className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
    },
    unavailable: {
      icon: X,
      label: t('unavailable'),
      className: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    },
    in_cart: {
      icon: ShoppingCart,
      label: t('inCart'),
      className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    },
  }

  const { icon: Icon, label, className: statusClassName } = config[status]

  return (
    <Badge
      variant="secondary"
      className={cn(
        'font-medium',
        statusClassName,
        size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-xs px-2.5 py-1',
        className
      )}
    >
      {showIcon && <Icon className={cn('mr-1', size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5')} />}
      {label}
      {status === 'in_cart' && cartQuantity > 0 && ` (${cartQuantity})`}
    </Badge>
  )
}
