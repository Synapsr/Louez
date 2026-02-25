'use client'

import { useTranslations } from 'next-intl'
import { Layers, Check } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@louez/ui'
import { Badge } from '@louez/ui'
import { formatCurrency } from '@louez/utils'
import { useStoreCurrency, useStoreMaxDiscountPercent } from '@/contexts/store-context'
import type { PricingMode } from '@louez/types'
import {
  calculateEffectivePrice,
  sortTiersByDuration,
  getUnitLabel,
} from '@louez/utils'

interface PricingTier {
  id: string
  minDuration: number | null
  discountPercent: string | number | null
  period?: number | null
  price?: string | null
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
  const maxDiscountPercentSetting = useStoreMaxDiscountPercent()

  if (!tiers.length) return null

  const sortedTiers = sortTiersByDuration(
    tiers.map((tier) => ({
      ...tier,
      minDuration: tier.minDuration ?? 1,
      discountPercent:
        typeof tier.discountPercent === 'string'
          ? parseFloat(tier.discountPercent ?? '0')
          : (tier.discountPercent ?? 0),
    })),
  )
  const unitLabel = getUnitLabel(pricingMode, 'plural')
  const unitLabelShort = getUnitLabel(pricingMode, 'short')

  // Find which tier is currently applied
  const appliedTierIndex = currentDuration
    ? sortedTiers.reduce((acc, tier, index) => {
        const tierDiscount =
          typeof tier.discountPercent === 'string'
            ? parseFloat(tier.discountPercent ?? '0')
            : tier.discountPercent
        return currentDuration >= tier.minDuration ? index : acc
      }, -1)
    : -1

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
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
                ? parseFloat(tier.discountPercent ?? '0')
                : (tier.discountPercent ?? 0)
            const effectivePrice = calculateEffectivePrice(basePrice, {
              id: tier.id,
              minDuration: tier.minDuration ?? 1,
              discountPercent,
              displayOrder: tier.displayOrder ?? index,
            })

            const isApplied = index === appliedTierIndex

            return (
              <div
                key={tier.id}
                className={`flex items-center justify-between py-2 px-3 rounded-lg transition-colors ${
                  isApplied
                    ? 'bg-primary/10 border border-primary/20'
                    : 'hover:bg-muted/50'
                }`}
              >
                <div className="flex items-center gap-2">
                  {isApplied && (
                    <Check className="h-4 w-4 text-primary" />
                  )}
                  <span className={`text-sm ${isApplied ? 'font-medium' : ''}`}>
                    {tier.minDuration}+ {unitLabel}
                  </span>
                  {(maxDiscountPercentSetting == null || discountPercent <= maxDiscountPercentSetting) && (
                    <Badge
                      variant="secondary"
                      className={`text-xs ${
                        isApplied
                          ? 'bg-primary/15 text-primary'
                          : 'bg-muted'
                      }`}
                    >
                      -{Math.floor(discountPercent)}%
                    </Badge>
                  )}
                </div>
                <span className={`font-medium ${isApplied ? 'text-primary' : ''}`}>
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

  const sortedTiers = sortTiersByDuration(
    tiers.map((tier) => ({
      ...tier,
      minDuration: tier.minDuration ?? 1,
      discountPercent:
        typeof tier.discountPercent === 'string'
          ? parseFloat(tier.discountPercent ?? '0')
          : (tier.discountPercent ?? 0),
    })),
  )
  const unitLabelShort = getUnitLabel(pricingMode, 'short')

  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {sortedTiers.slice(0, 3).map((tier, index) => {
        const discountPercent =
          typeof tier.discountPercent === 'string'
            ? parseFloat(tier.discountPercent ?? '0')
            : (tier.discountPercent ?? 0)
        const effectivePrice = calculateEffectivePrice(basePrice, {
          id: tier.id,
          minDuration: tier.minDuration ?? 1,
          discountPercent,
          displayOrder: tier.displayOrder ?? index,
        })

        return (
          <Badge
            key={tier.id}
            variant="outline"
            className="text-xs font-normal"
          >
            {(tier.minDuration ?? 1)}+ → {formatCurrency(effectivePrice, currency)}/{unitLabelShort}
          </Badge>
        )
      })}
    </div>
  )
}
