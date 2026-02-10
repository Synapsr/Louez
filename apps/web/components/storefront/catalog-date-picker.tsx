'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { format, addDays } from 'date-fns'
import { fr } from 'date-fns/locale'
import { CalendarIcon, ArrowRight, Clock, Check, AlertCircle } from 'lucide-react'

import { Button } from '@louez/ui'
import { Calendar } from '@louez/ui'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@louez/ui'
import { ScrollArea } from '@louez/ui'
import { cn } from '@louez/utils'
import { useCart } from '@/contexts/cart-context'
import { useStorefrontUrl } from '@/hooks/use-storefront-url'
import { type PricingMode } from '@/lib/utils/duration'
import { validateMinRentalDuration } from '@/lib/utils/rental-duration'
import type { BusinessHours } from '@louez/types'
import { buildDateTimeRange, ensureSelectedTime, useRentalDateCore } from '@/components/storefront/date-picker/core/use-rental-date-core'
import {
  getNextAvailableDate,
} from '@/lib/utils/business-hours'

interface CatalogDatePickerProps {
  storeSlug: string
  pricingMode: PricingMode
  businessHours?: BusinessHours
  advanceNotice?: number
  minRentalHours?: number
  timezone?: string
}

export function CatalogDatePicker({
  storeSlug,
  pricingMode,
  businessHours,
  advanceNotice = 0,
  minRentalHours = 0,
  timezone,
}: CatalogDatePickerProps) {
  const t = useTranslations('storefront.dateSelection')
  const tBusinessHours = useTranslations('storefront.dateSelection.businessHours')
  const router = useRouter()
  const { setGlobalDates, setPricingMode, globalStartDate, globalEndDate } = useCart()
  const { getUrl } = useStorefrontUrl(storeSlug)

  const isTransitioningRef = useRef(false)
  // Track if end date was auto-set (to allow re-clicking same date in calendar)
  const endDateAutoSetRef = useRef(false)

  const [startDate, setStartDate] = useState<Date | undefined>(() => {
    if (globalStartDate) return new Date(globalStartDate)
    return undefined
  })

  const [endDate, setEndDate] = useState<Date | undefined>(() => {
    if (globalEndDate) return new Date(globalEndDate)
    return undefined
  })

  const [startTime, setStartTime] = useState<string>('09:00')
  const [endTime, setEndTime] = useState<string>('18:00')

  const [startDateOpen, setStartDateOpen] = useState(false)
  const [startTimeOpen, setStartTimeOpen] = useState(false)
  const [endDateOpen, setEndDateOpen] = useState(false)
  const [endTimeOpen, setEndTimeOpen] = useState(false)
  // When true, don't show end date as selected (allows clicking auto-set date)
  const [hideEndDateSelection, setHideEndDateSelection] = useState(false)

  const {
    isSameDay,
    startTimeSlots,
    endTimeSlots,
    isDateDisabled,
  } = useRentalDateCore({
    startDate,
    endDate,
    startTime,
    endTime,
    businessHours,
    advanceNotice,
    timezone,
  })

  useEffect(() => {
    setPricingMode(pricingMode)
  }, [pricingMode, setPricingMode])

  useEffect(() => {
    if (startDate && startTimeSlots.length > 0) {
      setStartTime((prev) => ensureSelectedTime(prev, startTimeSlots, 'first'))
    }
  }, [startDate, startTimeSlots])

  useEffect(() => {
    if (endDate && endTimeSlots.length > 0) {
      setEndTime((prev) => ensureSelectedTime(prev, endTimeSlots, 'last'))
    }
  }, [endDate, endTimeSlots])

  const navigateToRental = useCallback(
    (start: Date, end: Date) => {
      setGlobalDates(start.toISOString(), end.toISOString())
      const params = new URLSearchParams()
      params.set('startDate', start.toISOString())
      params.set('endDate', end.toISOString())
      router.push(`${getUrl('/rental')}?${params.toString()}`)
    },
    [router, setGlobalDates, getUrl]
  )

  const handleStartDateSelect = (date: Date | undefined) => {
    if (!date) return
    setStartDate(date)
    setStartDateOpen(false)

    if (!endDate || date >= endDate) {
      // For hourly pricing: default to same day (allows same-day rentals)
      // For day/week pricing: default to next day
      if (pricingMode === 'hour') {
        setEndDate(date)
      } else {
        const nextDay = addDays(date, 1)
        const nextAvailable = getNextAvailableDate(nextDay, businessHours, 365, timezone)
        setEndDate(nextAvailable ?? nextDay)
      }
      // Mark that end date was auto-set (so we can clear selection when opening picker)
      endDateAutoSetRef.current = true
    }

    isTransitioningRef.current = true
    setTimeout(() => {
      setStartTimeOpen(true)
      isTransitioningRef.current = false
    }, 200)
  }

  const handleStartTimeSelect = (time: string) => {
    setStartTime(time)
    setStartTimeOpen(false)

    isTransitioningRef.current = true
    setTimeout(() => {
      // If end date was auto-set, hide selection so user can click any date
      if (endDateAutoSetRef.current) {
        setHideEndDateSelection(true)
      }
      setEndDateOpen(true)
      isTransitioningRef.current = false
    }, 200)
  }

  const handleEndDateSelect = (date: Date | undefined) => {
    if (!date) return
    setEndDate(date)
    setEndDateOpen(false)
    // User explicitly selected, reset flags
    endDateAutoSetRef.current = false
    setHideEndDateSelection(false)

    isTransitioningRef.current = true
    setTimeout(() => {
      setEndTimeOpen(true)
      isTransitioningRef.current = false
    }, 200)
  }

  const handleEndTimeSelect = (time: string) => {
    setEndTime(time)
    setEndTimeOpen(false)

    const { start: finalStart, end: finalEnd } = buildDateTimeRange({
      startDate: startDate!,
      endDate: endDate!,
      startTime,
      endTime: time,
      timezone,
    })

    navigateToRental(finalStart, finalEnd)
  }

  const handleStartDateOpenChange = (open: boolean) => {
    if (isTransitioningRef.current) return
    setStartDateOpen(open)
  }

  const handleStartTimeOpenChange = (open: boolean) => {
    if (isTransitioningRef.current) return
    if (open && !startDate) {
      setStartDateOpen(true)
      return
    }
    setStartTimeOpen(open)
  }

  const handleEndDateOpenChange = (open: boolean) => {
    if (isTransitioningRef.current) return
    if (open && !startDate) {
      setStartDateOpen(true)
      return
    }
    setEndDateOpen(open)
    if (!open) {
      // Reset hide selection when closing picker
      setHideEndDateSelection(false)
    }
  }

  const handleEndTimeOpenChange = (open: boolean) => {
    if (isTransitioningRef.current) return
    if (open && !endDate) {
      if (!startDate) {
        setStartDateOpen(true)
      } else {
        setEndDateOpen(true)
      }
      return
    }
    setEndTimeOpen(open)
  }

  const canSubmit = useMemo(() => {
    if (!startDate || !endDate || !startTime || !endTime) return false
    // For same day, ensure end time is after start time
    if (isSameDay && endTime <= startTime) return false
    // Validate minimum rental duration
    if (minRentalHours > 0) {
      const { start: fullStart, end: fullEnd } = buildDateTimeRange({
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        startTime,
        endTime,
        timezone,
      })
      if (!validateMinRentalDuration(fullStart, fullEnd, minRentalHours).valid) return false
    }
    return true
  }, [startDate, endDate, startTime, endTime, isSameDay, minRentalHours, timezone])

  const durationWarning = useMemo(() => {
    if (!startDate || !endDate || !startTime || !endTime) return null
    if (minRentalHours <= 0) return null
    const { start: fullStart, end: fullEnd } = buildDateTimeRange({
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      startTime,
      endTime,
      timezone,
    })
    const check = validateMinRentalDuration(fullStart, fullEnd, minRentalHours)
    if (check.valid) return null
    return t('minDurationWarning', { hours: minRentalHours })
  }, [startDate, endDate, startTime, endTime, minRentalHours, timezone, t])

  const handleSubmit = () => {
    if (!canSubmit) return

    const { start: finalStart, end: finalEnd } = buildDateTimeRange({
      startDate: startDate!,
      endDate: endDate!,
      startTime,
      endTime,
      timezone,
    })
    navigateToRental(finalStart, finalEnd)
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
    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
      {/* Start Date/Time */}
      <div className="flex rounded-lg border bg-background overflow-hidden h-10">
        <Popover open={startDateOpen} onOpenChange={handleStartDateOpenChange}>
          <PopoverTrigger render={<button
              className={cn(
                'flex items-center gap-1.5 px-3 text-left hover:bg-muted/50 transition-colors',
                !startDate && 'text-muted-foreground'
              )}
            />}>
              <CalendarIcon className="h-4 w-4 shrink-0 text-primary" />
              <span className="text-sm font-medium">
                {startDate ? format(startDate, 'd MMM', { locale: fr }) : t('startDate')}
              </span>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={startDate}
              onSelect={handleStartDateSelect}
              disabled={isDateDisabled}
              locale={fr}
              autoFocus
            />
          </PopoverContent>
        </Popover>

        <div className="w-px bg-border my-2" />

        <Popover open={startTimeOpen} onOpenChange={handleStartTimeOpenChange}>
          <PopoverTrigger render={<button className="flex items-center gap-1 px-2 hover:bg-muted/50 transition-colors" />}>
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-sm font-medium">{startTime}</span>
          </PopoverTrigger>
          <PopoverContent className="w-40 p-0" align="start">
            <TimeSelector value={startTime} onSelect={handleStartTimeSelect} slots={startTimeSlots} />
          </PopoverContent>
        </Popover>
      </div>

      <ArrowRight className="h-4 w-4 text-muted-foreground hidden sm:block shrink-0" />

      {/* End Date/Time */}
      <div className="flex rounded-lg border bg-background overflow-hidden h-10">
        <Popover open={endDateOpen} onOpenChange={handleEndDateOpenChange}>
          <PopoverTrigger render={<button
              className={cn(
                'flex items-center gap-1.5 px-3 text-left hover:bg-muted/50 transition-colors',
                !endDate && 'text-muted-foreground'
              )}
            />}>
              <CalendarIcon className="h-4 w-4 shrink-0 text-primary" />
              <span className="text-sm font-medium">
                {endDate ? format(endDate, 'd MMM', { locale: fr }) : t('endDate')}
              </span>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={hideEndDateSelection ? undefined : endDate}
              defaultMonth={endDate}
              onSelect={handleEndDateSelect}
              disabled={(date) => isDateDisabled(date) || (startDate ? date < startDate : false)}
              locale={fr}
              autoFocus
            />
          </PopoverContent>
        </Popover>

        <div className="w-px bg-border my-2" />

        <Popover open={endTimeOpen} onOpenChange={handleEndTimeOpenChange}>
          <PopoverTrigger render={<button className="flex items-center gap-1 px-2 hover:bg-muted/50 transition-colors" />}>
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-sm font-medium">{endTime}</span>
          </PopoverTrigger>
          <PopoverContent className="w-40 p-0" align="end">
            <TimeSelector
              value={endTime}
              onSelect={handleEndTimeSelect}
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

      {/* Duration warning */}
      {durationWarning && (
        <p className="text-sm text-destructive">{durationWarning}</p>
      )}

      {/* Submit Button */}
      <Button onClick={handleSubmit} disabled={!canSubmit} className="h-10 px-4">
        {t('viewAvailability')}
        <ArrowRight className="ml-1.5 h-4 w-4" />
      </Button>
    </div>
  )
}
