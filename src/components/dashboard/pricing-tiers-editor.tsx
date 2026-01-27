'use client'

import { useState, useMemo } from 'react'
import { Plus, Trash2, TrendingDown, Info } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import { cn, formatCurrency } from '@/lib/utils'
import type { PricingMode, PricingTier } from '@/types'
import {
  calculateRentalPrice,
  getUnitLabel,
  formatDuration,
} from '@/lib/pricing'

interface PricingTierInput {
  id?: string
  minDuration: number
  discountPercent: number
}

interface PricingTiersEditorProps {
  basePrice: number
  pricingMode: PricingMode
  tiers: PricingTierInput[]
  onChange: (tiers: PricingTierInput[]) => void
  disabled?: boolean
}

export function PricingTiersEditor({
  basePrice,
  pricingMode,
  tiers,
  onChange,
  disabled = false,
}: PricingTiersEditorProps) {
  const t = useTranslations('dashboard.products.form.pricingTiers')
  const [isEnabled, setIsEnabled] = useState(tiers.length > 0)
  const [editingPrices, setEditingPrices] = useState<Record<number, string>>({})
  const [editingTotals, setEditingTotals] = useState<Record<number, string>>({})

  const unitLabel = getUnitLabel(pricingMode, 'plural')
  const unitLabelSingular = getUnitLabel(pricingMode, 'singular')

  // Preview durations based on pricing mode
  const previewDurations = useMemo(() => {
    switch (pricingMode) {
      case 'hour':
        return [1, 2, 4, 8, 24]
      case 'week':
        return [1, 2, 4, 8, 12]
      case 'day':
      default:
        return [1, 3, 7, 14, 30]
    }
  }, [pricingMode])

  // Calculate previews
  const previews = useMemo(() => {
    if (basePrice <= 0) return []

    const pricing = {
      basePrice,
      deposit: 0,
      pricingMode,
      tiers: tiers.map((t, i) => ({
        ...t,
        id: t.id || `temp-${i}`,
        displayOrder: i,
      })) as PricingTier[],
    }

    return previewDurations.map((duration) => {
      const result = calculateRentalPrice(pricing, duration, 1)
      return {
        duration,
        label: formatDuration(duration, pricingMode),
        total: result.subtotal,
        pricePerUnit: result.effectivePricePerUnit,
        savings: result.savings,
        discountPercent: result.discountPercent,
      }
    })
  }, [basePrice, pricingMode, tiers, previewDurations])

  const handleToggle = (enabled: boolean) => {
    setIsEnabled(enabled)
    if (!enabled) {
      onChange([])
    } else if (tiers.length === 0) {
      // Add a default tier when enabling
      const defaultMinDuration = pricingMode === 'hour' ? 4 : pricingMode === 'week' ? 2 : 3
      onChange([{ minDuration: defaultMinDuration, discountPercent: 10 }])
    }
  }

  const addTier = () => {
    // Find a sensible default for the new tier
    const existingDurations = tiers.map((t) => t.minDuration)
    const maxExisting = Math.max(0, ...existingDurations)
    const maxDiscount = Math.max(0, ...tiers.map((t) => t.discountPercent))

    let newMinDuration: number
    if (pricingMode === 'hour') {
      newMinDuration = maxExisting > 0 ? maxExisting * 2 : 4
    } else if (pricingMode === 'week') {
      newMinDuration = maxExisting > 0 ? maxExisting + 2 : 2
    } else {
      newMinDuration = maxExisting > 0 ? maxExisting + 4 : 7
    }

    const newDiscount = Math.min(99, maxDiscount + 10)

    onChange([...tiers, { minDuration: newMinDuration, discountPercent: newDiscount }])
  }

  const removeTier = (index: number) => {
    const newTiers = tiers.filter((_, i) => i !== index)
    onChange(newTiers)
    if (newTiers.length === 0) {
      setIsEnabled(false)
    }
  }

  const updateTier = (
    index: number,
    field: 'minDuration' | 'discountPercent',
    value: number
  ) => {
    const newTiers = [...tiers]
    newTiers[index] = { ...newTiers[index], [field]: value }
    onChange(newTiers)
  }

  // Check for duplicate durations
  const hasDuplicates = useMemo(() => {
    const durations = tiers.map((t) => t.minDuration)
    return new Set(durations).size !== durations.length
  }, [tiers])

  return (
    <div className="space-y-6">
      {/* Toggle */}
      <div className="flex items-center justify-between rounded-lg border p-4">
        <div className="space-y-0.5">
          <Label htmlFor="pricing-tiers-toggle" className="text-base font-medium">
            {t('enableTiers')}
          </Label>
          <p className="text-sm text-muted-foreground">
            {t('enableTiersDescription')}
          </p>
        </div>
        <Switch
          id="pricing-tiers-toggle"
          checked={isEnabled}
          onCheckedChange={handleToggle}
          disabled={disabled}
        />
      </div>

      {isEnabled && (
        <>
          {/* Tiers Editor */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{t('tiersTitle')}</span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addTier}
                disabled={disabled || tiers.length >= 5}
              >
                <Plus className="mr-2 h-4 w-4" />
                {t('addTier')}
              </Button>
            </div>

            {hasDuplicates && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {t('duplicateDurationError')}
              </div>
            )}

            <div className="space-y-3">
              {tiers
                .slice()
                .sort((a, b) => a.minDuration - b.minDuration)
                .map((tier, sortedIndex) => {
                  // Find original index for update/remove
                  const originalIndex = tiers.findIndex(
                    (t) =>
                      t.minDuration === tier.minDuration &&
                      t.discountPercent === tier.discountPercent
                  )

                  return (
                    <div
                      key={originalIndex}
                      className="flex items-start gap-3 rounded-lg border bg-card p-4"
                    >
                      <div
                        className={cn(
                          'flex-1 grid gap-x-4 gap-y-3',
                          basePrice > 0
                            ? 'grid-cols-2 sm:grid-cols-4'
                            : 'grid-cols-2'
                        )}
                      >
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">
                            {t('fromDuration')}
                          </Label>
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              min={1}
                              max={999}
                              value={tier.minDuration}
                              onChange={(e) =>
                                updateTier(
                                  originalIndex,
                                  'minDuration',
                                  Math.max(1, parseInt(e.target.value) || 1)
                                )
                              }
                              className="w-20"
                              disabled={disabled}
                            />
                            <span className="text-sm text-muted-foreground">
                              {unitLabel}
                            </span>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">
                            {t('discount')}
                          </Label>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground">-</span>
                            <Input
                              type="number"
                              min={1}
                              max={99}
                              value={tier.discountPercent}
                              onChange={(e) =>
                                updateTier(
                                  originalIndex,
                                  'discountPercent',
                                  Math.min(99, Math.max(1, parseInt(e.target.value) || 1))
                                )
                              }
                              className="w-20"
                              disabled={disabled}
                            />
                            <span className="text-sm text-muted-foreground">%</span>
                          </div>
                        </div>

                        {/* Column 3: Target unit price */}
                        {basePrice > 0 && (
                          <div className="space-y-2">
                            <Label className="text-xs text-muted-foreground">
                              {t('targetPrice')}
                            </Label>
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                step={0.01}
                                min={0.01}
                                value={
                                  editingPrices[originalIndex] ??
                                  parseFloat(
                                    (
                                      basePrice *
                                      (1 - tier.discountPercent / 100)
                                    ).toFixed(2)
                                  )
                                }
                                onFocus={(e) =>
                                  setEditingPrices((prev) => ({
                                    ...prev,
                                    [originalIndex]: e.target.value,
                                  }))
                                }
                                onChange={(e) => {
                                  const raw = e.target.value
                                  setEditingPrices((prev) => ({
                                    ...prev,
                                    [originalIndex]: raw,
                                  }))
                                  const targetPrice = parseFloat(raw)
                                  if (
                                    !isNaN(targetPrice) &&
                                    targetPrice > 0 &&
                                    targetPrice < basePrice
                                  ) {
                                    const discount =
                                      Math.round(
                                        ((basePrice - targetPrice) / basePrice) *
                                          100 *
                                          1e6
                                      ) / 1e6
                                    updateTier(
                                      originalIndex,
                                      'discountPercent',
                                      Math.min(99, Math.max(1, discount))
                                    )
                                  }
                                }}
                                onBlur={() =>
                                  setEditingPrices((prev) => {
                                    const next = { ...prev }
                                    delete next[originalIndex]
                                    return next
                                  })
                                }
                                className="w-24"
                                disabled={disabled}
                                aria-label={t('targetPrice')}
                              />
                              <span className="text-sm text-muted-foreground whitespace-nowrap">
                                /{getUnitLabel(pricingMode, 'short')}
                              </span>
                            </div>
                          </div>
                        )}

                        {/* Column 4: Total cost */}
                        {basePrice > 0 && (
                          <div className="space-y-2">
                            <Label className="text-xs text-muted-foreground">
                              {t('tierTotal')}
                            </Label>
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                step={0.01}
                                min={0.01}
                                value={
                                  editingTotals[originalIndex] ??
                                  parseFloat(
                                    (
                                      basePrice *
                                      (1 - tier.discountPercent / 100) *
                                      tier.minDuration
                                    ).toFixed(2)
                                  )
                                }
                                onFocus={(e) =>
                                  setEditingTotals((prev) => ({
                                    ...prev,
                                    [originalIndex]: e.target.value,
                                  }))
                                }
                                onChange={(e) => {
                                  const raw = e.target.value
                                  setEditingTotals((prev) => ({
                                    ...prev,
                                    [originalIndex]: raw,
                                  }))
                                  const totalCost = parseFloat(raw)
                                  if (
                                    !isNaN(totalCost) &&
                                    totalCost > 0 &&
                                    tier.minDuration > 0
                                  ) {
                                    const pricePerUnit =
                                      totalCost / tier.minDuration
                                    if (pricePerUnit < basePrice) {
                                      const discount =
                                        Math.round(
                                          ((basePrice - pricePerUnit) /
                                            basePrice) *
                                            100 *
                                            1e6
                                        ) / 1e6
                                      updateTier(
                                        originalIndex,
                                        'discountPercent',
                                        Math.min(99, Math.max(1, discount))
                                      )
                                    }
                                  }
                                }}
                                onBlur={() =>
                                  setEditingTotals((prev) => {
                                    const next = { ...prev }
                                    delete next[originalIndex]
                                    return next
                                  })
                                }
                                className="w-24"
                                disabled={disabled}
                                aria-label={t('tierTotal')}
                              />
                            </div>
                            <p className="text-xs text-muted-foreground tabular-nums">
                              {t('insteadOf')}{' '}
                              {formatCurrency(basePrice * tier.minDuration)}
                            </p>
                          </div>
                        )}
                      </div>

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeTier(originalIndex)}
                        disabled={disabled}
                        className="mt-6 shrink-0 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )
                })}

              {tiers.length === 0 && (
                <div className="rounded-lg border border-dashed p-6 text-center">
                  <p className="text-sm text-muted-foreground">
                    {t('noTiers')}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addTier}
                    className="mt-3"
                    disabled={disabled}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    {t('addFirstTier')}
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Preview Table */}
          {basePrice > 0 && tiers.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">{t('preview')}</CardTitle>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{t('previewTooltip')}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <CardDescription>{t('previewDescription')}</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('duration')}</TableHead>
                      <TableHead className="text-right">{t('pricePerUnit')}</TableHead>
                      <TableHead className="text-right">{t('total')}</TableHead>
                      <TableHead className="text-right">{t('savings')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previews.map((preview) => (
                      <TableRow
                        key={preview.duration}
                        className={preview.discountPercent ? 'bg-green-50/50 dark:bg-green-950/20' : ''}
                      >
                        <TableCell className="font-medium">
                          {preview.label}
                          {preview.discountPercent && (
                            <Badge
                              variant="secondary"
                              className="ml-2 bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                            >
                              -{preview.discountPercent}%
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(preview.pricePerUnit)}/{getUnitLabel(pricingMode, 'short')}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(preview.total)}
                        </TableCell>
                        <TableCell className="text-right">
                          {preview.savings > 0 ? (
                            <span className="text-green-600 dark:text-green-400">
                              -{formatCurrency(preview.savings)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
