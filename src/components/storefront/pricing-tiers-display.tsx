'use client'

import { useTranslations } from 'next-intl'
import { TrendingDown, Check } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatCurrency } from '@/lib/utils'
import { useStoreCurrency } from '@/contexts/store-context'
import type { PricingMode } from '@/types'
import {
  calculateEffectivePrice,
  sortTiersByDuration,
  getUnitLabel,
} from '@/lib/pricing'

interface PricingTier {
  id: string
  minDuration: number
  discountPercent: string | number
  displayOrder: number | null
}

interface PricingTiersDisplayProps {
  basePrice: number
  pricingMode: PricingMode
  tiers: PricingTier[]
  currentDuration?: number
  className?: string
}

export function PricingTiersDisplay({
  basePrice,
  pricingMode,
  tiers,
  currentDuration,
  className = '',
}: PricingTiersDisplayProps) {
  const t = useTranslations('storefront.product.tieredPricing')
  const currency = useStoreCurrency()

  if (!tiers.length) return null

  const sortedTiers = sortTiersByDuration(tiers)
  const unitLabel = getUnitLabel(pricingMode, 'plural')
  const unitLabelShort = getUnitLabel(pricingMode, 'short')

  // Find which tier is currently applied
  const appliedTierIndex = currentDuration
    ? sortedTiers.reduce((acc, tier, index) => {
        const tierDiscount =
          typeof tier.discountPercent === 'string'
            ? parseFloat(tier.discountPercent)
            : tier.discountPercent
        return currentDuration >= tier.minDuration ? index : acc
      }, -1)
    : -1

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingDown className="h-4 w-4 text-green-600" />
          {t('ratesTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Base price */}
        <div className="flex items-center justify-between py-2 border-b">
          <span className="text-sm text-muted-foreground">
            {t('basePriceLabel')}
          </span>
          <span className="font-medium">
            {formatCurrency(basePrice, currency)}/{unitLabelShort}
          </span>
        </div>

        {/* Tiers */}
        <div className="space-y-2">
          {sortedTiers.map((tier, index) => {
            const discountPercent =
              typeof tier.discountPercent === 'string'
                ? parseFloat(tier.discountPercent)
                : tier.discountPercent
            const effectivePrice = calculateEffectivePrice(basePrice, {
              id: tier.id,
              minDuration: tier.minDuration,
              discountPercent,
              displayOrder: tier.displayOrder ?? index,
            })

            const isApplied = index === appliedTierIndex

            return (
              <div
                key={tier.id}
                className={`flex items-center justify-between py-2 px-3 rounded-lg transition-colors ${
                  isApplied
                    ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
                    : 'hover:bg-muted/50'
                }`}
              >
                <div className="flex items-center gap-2">
                  {isApplied && (
                    <Check className="h-4 w-4 text-green-600" />
                  )}
                  <span className={`text-sm ${isApplied ? 'font-medium' : ''}`}>
                    {tier.minDuration}+ {unitLabel}
                  </span>
                  <Badge
                    variant="secondary"
                    className={`text-xs ${
                      isApplied
                        ? 'bg-green-100 text-green-700 dark:bg-green-800 dark:text-green-300'
                        : 'bg-muted'
                    }`}
                  >
                    -{discountPercent}%
                  </Badge>
                </div>
                <span className={`font-medium ${isApplied ? 'text-green-700 dark:text-green-300' : ''}`}>
                  {formatCurrency(effectivePrice, currency)}/{unitLabelShort}
                </span>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Inline pricing tiers display for compact spaces
 */
export function PricingTiersInline({
  basePrice,
  pricingMode,
  tiers,
}: Omit<PricingTiersDisplayProps, 'currentDuration' | 'className'>) {
  const currency = useStoreCurrency()

  if (!tiers.length) return null

  const sortedTiers = sortTiersByDuration(tiers)
  const unitLabelShort = getUnitLabel(pricingMode, 'short')

  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {sortedTiers.slice(0, 3).map((tier, index) => {
        const discountPercent =
          typeof tier.discountPercent === 'string'
            ? parseFloat(tier.discountPercent)
            : tier.discountPercent
        const effectivePrice = calculateEffectivePrice(basePrice, {
          id: tier.id,
          minDuration: tier.minDuration,
          discountPercent,
          displayOrder: tier.displayOrder ?? index,
        })

        return (
          <Badge
            key={tier.id}
            variant="outline"
            className="text-xs font-normal"
          >
            {tier.minDuration}+ → {formatCurrency(effectivePrice, currency)}/{unitLabelShort}
          </Badge>
        )
      })}
    </div>
  )
}
