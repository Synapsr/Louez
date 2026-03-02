'use client'

import { useState } from 'react'

import { format } from 'date-fns'
import { fr, enUS } from 'date-fns/locale'
import {
  CalendarRange,
  Check,
  ChevronsUpDown,
  Home,
  Loader2,
  Plus,
} from 'lucide-react'
import { useTranslations, useLocale } from 'next-intl'

import { cn, formatCurrency } from '@louez/utils'
import {
  Badge,
  Button,
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
  Separator,
} from '@louez/ui'

import type { SeasonalPricingData } from '../types'

interface PricingPeriodSelectorProps {
  selectedPeriodId: string | null
  seasonalPricings: SeasonalPricingData[]
  basePriceValue: string | undefined
  onSelectPeriod: (id: string | null) => void
  onAddPeriod: () => void
  isLoading: boolean
}

function computePriceDiffPercent(
  basePrice: string | undefined,
  seasonalPrice: string
): { percent: number; isHigher: boolean } | null {
  const base = parseFloat(basePrice || '0')
  const seasonal = parseFloat(seasonalPrice || '0')
  if (!base || !seasonal || base === seasonal) return null
  const percent = Math.round(((seasonal - base) / base) * 100)
  return { percent: Math.abs(percent), isHigher: seasonal > base }
}

function formatDateRange(startDate: string, endDate: string, locale: Locale): string {
  const start = new Date(startDate + 'T00:00:00')
  const end = new Date(endDate + 'T00:00:00')
  return `${format(start, 'd MMM yyyy', { locale })} → ${format(end, 'd MMM yyyy', { locale })}`
}

type Locale = typeof fr

export function PricingPeriodSelector({
  selectedPeriodId,
  seasonalPricings,
  basePriceValue,
  onSelectPeriod,
  onAddPeriod,
  isLoading,
}: PricingPeriodSelectorProps) {
  const t = useTranslations('dashboard.products.form')
  const locale = useLocale()
  const calendarLocale = locale === 'fr' ? fr : enUS
  const [open, setOpen] = useState(false)

  const selectedPeriod = selectedPeriodId
    ? seasonalPricings.find((sp) => sp.id === selectedPeriodId)
    : null

  const triggerLabel = selectedPeriod ? selectedPeriod.name : t('basePricing')

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={isLoading}
          />
        }
      >
        {isLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : selectedPeriod ? (
          <CalendarRange className="h-3.5 w-3.5" />
        ) : (
          <Home className="h-3.5 w-3.5" />
        )}
        <span className="max-w-[160px] truncate">{triggerLabel}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="p-1">
          {/* Base pricing option */}
          <PopoverClose
            render={
              <button
                className={cn(
                  'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent',
                  !selectedPeriodId && 'bg-accent'
                )}
                onClick={() => {
                  onSelectPeriod(null)
                  setOpen(false)
                }}
              />
            }
          >
            <Home className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 text-left font-medium">
              {t('basePricing')}
            </span>
            {!selectedPeriodId && (
              <Check className="h-4 w-4 shrink-0 text-primary" />
            )}
          </PopoverClose>

          {/* Seasonal periods */}
          {seasonalPricings.length > 0 && (
            <>
              <Separator className="my-1" />
              {seasonalPricings.map((sp) => {
                const diff = computePriceDiffPercent(basePriceValue, sp.price)
                const isSelected = selectedPeriodId === sp.id
                return (
                  <PopoverClose
                    key={sp.id}
                    render={
                      <button
                        className={cn(
                          'flex w-full items-start gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent',
                          isSelected && 'bg-accent'
                        )}
                        onClick={() => {
                          onSelectPeriod(sp.id)
                          setOpen(false)
                        }}
                      />
                    }
                  >
                    <CalendarRange className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="flex-1 text-left">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{sp.name}</span>
                        {diff && (
                          <Badge
                            variant={diff.isHigher ? 'destructive' : 'default'}
                            className={cn(
                              'text-[10px] px-1.5 py-0',
                              !diff.isHigher &&
                                'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                            )}
                          >
                            {diff.isHigher ? '+' : '-'}
                            {diff.percent}%
                          </Badge>
                        )}
                      </div>
                      <p className="text-muted-foreground text-xs mt-0.5">
                        {formatDateRange(sp.startDate, sp.endDate, calendarLocale)}
                      </p>
                    </div>
                    {isSelected && (
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    )}
                  </PopoverClose>
                )
              })}
            </>
          )}

          {/* Add period action */}
          <Separator className="my-1" />
          <PopoverClose
            render={
              <button
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-primary transition-colors hover:bg-accent"
                onClick={() => {
                  onAddPeriod()
                  setOpen(false)
                }}
              />
            }
          >
            <Plus className="h-4 w-4 shrink-0" />
            <span className="font-medium">{t('addSeasonalPeriod')}</span>
          </PopoverClose>
        </div>
      </PopoverContent>
    </Popover>
  )
}
