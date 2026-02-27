'use client'

import { useEffect, useState, useTransition } from 'react'

import { CalendarIcon } from 'lucide-react'
import { format } from 'date-fns'
import { fr, enUS } from 'date-fns/locale'
import { useTranslations, useLocale } from 'next-intl'

import { cn } from '@louez/utils'
import {
  Button,
  Calendar,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@louez/ui'

import {
  createSeasonalPricing,
  updateSeasonalPricing,
} from '../seasonal-actions'
import type { PriceDurationValue, RateTierInput, SeasonalPricingData } from '../types'

interface SeasonalPeriodFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  productId: string
  editingData?: { id: string; name: string; startDate: string; endDate: string } | null
  /** Base pricing to pre-fill when creating a new period */
  basePriceDuration: PriceDurationValue | undefined
  baseRateTiers: RateTierInput[]
  /** Called after a new period is created */
  onCreated: (newPeriod: SeasonalPricingData) => void
  /** Called after an existing period's metadata is updated */
  onUpdated: (id: string, name: string, startDate: string, endDate: string) => void
}

function formatDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function SeasonalPeriodFormDialog({
  open,
  onOpenChange,
  productId,
  editingData,
  basePriceDuration,
  baseRateTiers,
  onCreated,
  onUpdated,
}: SeasonalPeriodFormDialogProps) {
  const t = useTranslations('dashboard.products.form')
  const locale = useLocale()
  const calendarLocale = locale === 'fr' ? fr : enUS
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const isEditing = !!editingData

  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState<Date | undefined>()
  const [endDate, setEndDate] = useState<Date | undefined>()

  // Reset form when opening
  useEffect(() => {
    if (!open) return

    if (editingData) {
      setName(editingData.name)
      setStartDate(new Date(editingData.startDate + 'T00:00:00'))
      setEndDate(new Date(editingData.endDate + 'T00:00:00'))
    } else {
      setName('')
      setStartDate(undefined)
      setEndDate(undefined)
    }
    setError(null)
  }, [open, editingData])

  const handleSave = () => {
    if (!name.trim() || !startDate || !endDate) {
      setError(t('seasonFieldsRequired'))
      return
    }

    const startStr = formatDateStr(startDate)
    const endStr = formatDateStr(endDate)

    if (startStr >= endStr) {
      setError(t('seasonDateError'))
      return
    }

    startTransition(async () => {
      setError(null)

      if (isEditing && editingData) {
        // For editing metadata, we call onUpdated which will handle the server action
        // with the current pricing data included
        onUpdated(editingData.id, name.trim(), startStr, endStr)
        onOpenChange(false)
      } else {
        // Creating: pre-fill with base pricing
        const basePrice = basePriceDuration?.price?.replace(',', '.') || '0'
        const payload = {
          productId,
          name: name.trim(),
          startDate: startStr,
          endDate: endStr,
          price: basePrice,
          rateTiers: baseRateTiers.map((tier) => ({
            price: tier.price.replace(',', '.'),
            duration: tier.duration,
            unit: tier.unit,
          })),
        }

        const result = await createSeasonalPricing(payload)

        if (result && 'error' in result) {
          setError(t(result.error as any) || result.error || null)
          return
        }

        if (result && 'id' in result) {
          // Build the SeasonalPricingData to return
          const newPeriod: SeasonalPricingData = {
            id: result.id,
            name: name.trim(),
            startDate: startStr,
            endDate: endStr,
            price: basePrice,
            tiers: baseRateTiers.map((tier, index) => ({
              id: '',
              period: tier.duration * (tier.unit === 'week' ? 10080 : tier.unit === 'day' ? 1440 : tier.unit === 'hour' ? 60 : 1),
              price: tier.price.replace(',', '.'),
              minDuration: null,
              discountPercent: null,
              displayOrder: index,
            })),
          }
          onCreated(newPeriod)
          onOpenChange(false)
        }
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? t('editPeriodTitle') : t('createPeriodTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('seasonalPeriodDescription')}
          </DialogDescription>
        </DialogHeader>

        <DialogPanel>
          <div className="space-y-4">
            {/* Name */}
            <div className="space-y-2">
              <Label>{t('seasonName')}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('seasonNamePlaceholder')}
                disabled={isPending}
              />
            </div>

            {/* Date range */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t('seasonStartDate')}</Label>
                <Popover>
                  <PopoverTrigger
                    render={
                      <Button
                        variant="outline"
                        className={cn(
                          'w-full justify-start text-left font-normal',
                          !startDate && 'text-muted-foreground'
                        )}
                        disabled={isPending}
                      />
                    }
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {startDate
                      ? format(startDate, 'd MMM yyyy', { locale: calendarLocale })
                      : t('selectDate')}
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={startDate}
                      onSelect={setStartDate}
                      locale={calendarLocale}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label>{t('seasonEndDate')}</Label>
                <Popover>
                  <PopoverTrigger
                    render={
                      <Button
                        variant="outline"
                        className={cn(
                          'w-full justify-start text-left font-normal',
                          !endDate && 'text-muted-foreground'
                        )}
                        disabled={isPending}
                      />
                    }
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {endDate
                      ? format(endDate, 'd MMM yyyy', { locale: calendarLocale })
                      : t('selectDate')}
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={endDate}
                      onSelect={setEndDate}
                      disabled={(date) =>
                        startDate ? date <= startDate : false
                      }
                      locale={calendarLocale}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Error */}
            {error && (
              <p className="text-destructive text-sm font-medium">{error}</p>
            )}
          </div>
        </DialogPanel>

        <DialogFooter variant="bare">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {t('cancel')}
          </Button>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending
              ? t('saving')
              : isEditing
                ? t('saveChanges')
                : t('addSeasonalPeriod')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
