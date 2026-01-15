'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { format, addDays, setHours, setMinutes } from 'date-fns'
import { fr } from 'date-fns/locale'
import { CalendarIcon, Clock, Check, AlertCircle, ArrowRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useCart } from '@/contexts/cart-context'
import { useStorefrontUrl } from '@/hooks/use-storefront-url'
import { getMinStartDate, type PricingMode } from '@/lib/utils/duration'
import type { BusinessHours } from '@/types/store'
import {
  isDateAvailable,
  getAvailableTimeSlots,
  generateTimeSlots,
} from '@/lib/utils/business-hours'

interface DatePickerModalProps {
  storeSlug: string
  pricingMode: PricingMode
  businessHours?: BusinessHours
  advanceNotice?: number
  isOpen: boolean
  onClose: () => void
  initialStartDate?: string
  initialEndDate?: string
}

const defaultTimeSlots = generateTimeSlots('07:00', '21:00', 30)

export function DatePickerModal({
  storeSlug,
  pricingMode,
  businessHours,
  advanceNotice = 0,
  isOpen,
  onClose,
  initialStartDate,
  initialEndDate,
}: DatePickerModalProps) {
  const t = useTranslations('storefront.dateSelection')
  const tBusinessHours = useTranslations('storefront.dateSelection.businessHours')
  const router = useRouter()
  const { setGlobalDates, setPricingMode } = useCart()
  const { getUrl } = useStorefrontUrl(storeSlug)

  // Parse initial dates
  const parseInitialDate = (dateStr?: string) => {
    if (!dateStr) return undefined
    const date = new Date(dateStr)
    return isNaN(date.getTime()) ? undefined : date
  }

  const parseInitialTime = (dateStr?: string): string => {
    if (!dateStr) return '09:00'
    const date = new Date(dateStr)
    if (isNaN(date.getTime())) return '09:00'
    return format(date, 'HH:mm')
  }

  const [startDate, setStartDate] = useState<Date | undefined>(() =>
    parseInitialDate(initialStartDate)
  )
  const [endDate, setEndDate] = useState<Date | undefined>(() =>
    parseInitialDate(initialEndDate)
  )
  const [startTime, setStartTime] = useState<string>(() =>
    parseInitialTime(initialStartDate)
  )
  const [endTime, setEndTime] = useState<string>(() =>
    parseInitialTime(initialEndDate)
  )

  // Reset when modal opens with new initial values
  useEffect(() => {
    if (isOpen) {
      setStartDate(parseInitialDate(initialStartDate))
      setEndDate(parseInitialDate(initialEndDate))
      setStartTime(parseInitialTime(initialStartDate))
      setEndTime(parseInitialTime(initialEndDate))
    }
  }, [isOpen, initialStartDate, initialEndDate])

  const minDate = useMemo(() => getMinStartDate(advanceNotice), [advanceNotice])

  const startTimeSlots = useMemo(() => {
    if (!startDate) return defaultTimeSlots
    return getAvailableTimeSlots(startDate, businessHours, 30)
  }, [startDate, businessHours])

  const endTimeSlots = useMemo(() => {
    if (!endDate) return defaultTimeSlots
    return getAvailableTimeSlots(endDate, businessHours, 30)
  }, [endDate, businessHours])

  const isDateDisabled = useCallback(
    (date: Date): boolean => {
      if (date < minDate) return true
      if (!businessHours?.enabled) return false
      const availability = isDateAvailable(date, businessHours)
      return !availability.available
    },
    [businessHours, minDate]
  )

  useEffect(() => {
    setPricingMode(pricingMode)
  }, [pricingMode, setPricingMode])

  useEffect(() => {
    if (startDate && startTimeSlots.length > 0 && !startTimeSlots.includes(startTime)) {
      setStartTime(startTimeSlots[0])
    }
  }, [startDate, startTimeSlots, startTime])

  useEffect(() => {
    if (endDate && endTimeSlots.length > 0 && !endTimeSlots.includes(endTime)) {
      setEndTime(endTimeSlots[endTimeSlots.length - 1] || endTimeSlots[0])
    }
  }, [endDate, endTimeSlots, endTime])

  const handleStartDateSelect = (date: Date | undefined) => {
    if (!date) return
    setStartDate(date)

    if (!endDate || date >= endDate) {
      setEndDate(addDays(date, 1))
    }
  }

  const handleEndDateSelect = (date: Date | undefined) => {
    if (!date) return
    setEndDate(date)
  }

  const canSubmit = startDate && endDate && startTime && endTime

  const handleSubmit = () => {
    if (!canSubmit) return

    const [startH, startM] = startTime.split(':').map(Number)
    const finalStart = setMinutes(setHours(startDate!, startH), startM)
    const [endH, endM] = endTime.split(':').map(Number)
    const finalEnd = setMinutes(setHours(endDate!, endH), endM)

    setGlobalDates(finalStart.toISOString(), finalEnd.toISOString())
    const params = new URLSearchParams()
    params.set('startDate', finalStart.toISOString())
    params.set('endDate', finalEnd.toISOString())
    router.push(`${getUrl('/rental')}?${params.toString()}`)
    onClose()
  }

  const TimeSelector = ({
    value,
    onSelect,
    slots,
    disabledBefore,
  }: {
    value: string
    onSelect: (time: string) => void
    slots: string[]
    disabledBefore?: string
  }) => (
    <ScrollArea className="h-56">
      <div className="p-1">
        {slots.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            <AlertCircle className="h-5 w-5 mx-auto mb-2" />
            {tBusinessHours('storeClosed')}
          </div>
        ) : (
          slots.map((time) => {
            const isDisabled = disabledBefore ? time <= disabledBefore : false
            const isSelected = value === time

            return (
              <button
                key={time}
                onClick={() => !isDisabled && onSelect(time)}
                disabled={isDisabled}
                className={cn(
                  'w-full flex items-center justify-between px-3 py-2 rounded-md text-left transition-colors text-sm',
                  isSelected
                    ? 'bg-primary text-primary-foreground'
                    : isDisabled
                      ? 'text-muted-foreground/40 cursor-not-allowed'
                      : 'hover:bg-muted'
                )}
              >
                <span className="font-medium">{time}</span>
                {isSelected && <Check className="h-3.5 w-3.5" />}
              </button>
            )
          })
        )}
      </div>
    </ScrollArea>
  )

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('modifyDates')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 pt-4">
          {/* Start Date/Time */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">
              {t('startLabel')}
            </label>
            <div className="flex rounded-xl border bg-background overflow-hidden h-12">
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    className={cn(
                      'flex-1 flex items-center gap-2 px-4 text-left hover:bg-muted/50 transition-colors min-w-0',
                      !startDate && 'text-muted-foreground'
                    )}
                  >
                    <CalendarIcon className="h-4 w-4 shrink-0 text-primary" />
                    <span className="font-medium text-sm truncate">
                      {startDate
                        ? format(startDate, 'EEEE d MMMM yyyy', { locale: fr })
                        : t('startDate')}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={startDate}
                    onSelect={handleStartDateSelect}
                    disabled={isDateDisabled}
                    locale={fr}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>

              <div className="w-px bg-border my-2" />

              <Popover>
                <PopoverTrigger asChild>
                  <button className="flex items-center gap-1.5 px-4 hover:bg-muted/50 transition-colors shrink-0">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-sm">{startTime}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-40 p-0" align="end">
                  <TimeSelector
                    value={startTime}
                    onSelect={setStartTime}
                    slots={startTimeSlots}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* End Date/Time */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">
              {t('endLabel')}
            </label>
            <div className="flex rounded-xl border bg-background overflow-hidden h-12">
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    className={cn(
                      'flex-1 flex items-center gap-2 px-4 text-left hover:bg-muted/50 transition-colors min-w-0',
                      !endDate && 'text-muted-foreground'
                    )}
                  >
                    <CalendarIcon className="h-4 w-4 shrink-0 text-primary" />
                    <span className="font-medium text-sm truncate">
                      {endDate
                        ? format(endDate, 'EEEE d MMMM yyyy', { locale: fr })
                        : t('endDate')}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={endDate}
                    onSelect={handleEndDateSelect}
                    disabled={(date) =>
                      isDateDisabled(date) || (startDate ? date < startDate : false)
                    }
                    locale={fr}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>

              <div className="w-px bg-border my-2" />

              <Popover>
                <PopoverTrigger asChild>
                  <button className="flex items-center gap-1.5 px-4 hover:bg-muted/50 transition-colors shrink-0">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-sm">{endTime}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-40 p-0" align="end">
                  <TimeSelector
                    value={endTime}
                    onSelect={setEndTime}
                    slots={endTimeSlots}
                    disabledBefore={
                      startDate && endDate && startDate.toDateString() === endDate.toDateString()
                        ? startTime
                        : undefined
                    }
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Submit Button */}
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            size="lg"
            className="w-full"
          >
            {t('applyDates')}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
