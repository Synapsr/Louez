'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { format, addDays } from 'date-fns'
import { fr } from 'date-fns/locale'
import { CalendarIcon, ArrowRight, Clock, Check, AlertCircle, Globe } from 'lucide-react'

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
import {
  formatDurationFromMinutes,
  validateMinRentalDurationMinutes,
} from '@/lib/utils/rental-duration'
import type { BusinessHours } from '@louez/types'
import { buildDateTimeRange, ensureSelectedTime, useRentalDateCore } from '@/components/storefront/date-picker/core/use-rental-date-core'
import {
  getNextAvailableDate,
} from '@/lib/utils/business-hours'

interface HeroDatePickerProps {
  storeSlug: string
  pricingMode: PricingMode
  businessHours?: BusinessHours
  advanceNotice?: number
  minRentalMinutes?: number
  timezone?: string
}

type ActiveField = 'startDate' | 'startTime' | 'endDate' | 'endTime' | null

export function HeroDatePicker({
  storeSlug,
  pricingMode,
  businessHours,
  advanceNotice = 0,
  minRentalMinutes = 0,
  timezone,
}: HeroDatePickerProps) {
  const t = useTranslations('storefront.dateSelection')
  const tBusinessHours = useTranslations('storefront.dateSelection.businessHours')
  const router = useRouter()
  const searchParams = useSearchParams()
  const { setGlobalDates, setPricingMode, globalStartDate, globalEndDate } = useCart()
  const { getUrl } = useStorefrontUrl(storeSlug)

  const isTransitioningRef = useRef(false)
  // Track if end date was auto-set (to allow re-clicking same date in calendar)
  const endDateAutoSetRef = useRef(false)

  const [startDate, setStartDate] = useState<Date | undefined>(() => {
    const urlStart = searchParams.get('startDate')
    if (urlStart) return new Date(urlStart)
    if (globalStartDate) return new Date(globalStartDate)
    return undefined
  })

  const [endDate, setEndDate] = useState<Date | undefined>(() => {
    const urlEnd = searchParams.get('endDate')
    if (urlEnd) return new Date(urlEnd)
    if (globalEndDate) return new Date(globalEndDate)
    return undefined
  })

  const [startTime, setStartTime] = useState<string>('09:00')
  const [endTime, setEndTime] = useState<string>('18:00')
  const [activeField, setActiveField] = useState<ActiveField>(null)

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

  const navigateToRental = useCallback((start: Date, end: Date) => {
    setGlobalDates(start.toISOString(), end.toISOString())
    const params = new URLSearchParams()
    params.set('startDate', start.toISOString())
    params.set('endDate', end.toISOString())
    router.push(`${getUrl('/rental')}?${params.toString()}`)
  }, [router, setGlobalDates, getUrl])

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
      setActiveField('startTime')
      isTransitioningRef.current = false
    }, 250)
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
      setActiveField('endDate')
      isTransitioningRef.current = false
    }, 250)
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
      setActiveField('endTime')
      isTransitioningRef.current = false
    }, 250)
  }

  const handleEndTimeSelect = (time: string) => {
    setEndTime(time)
    setEndTimeOpen(false)
    setActiveField(null)

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
    if (open) setActiveField('startDate')
  }

  const handleStartTimeOpenChange = (open: boolean) => {
    if (isTransitioningRef.current) return
    // If no start date selected, redirect to date picker
    if (open && !startDate) {
      setStartDateOpen(true)
      setActiveField('startDate')
      return
    }
    setStartTimeOpen(open)
    if (open) setActiveField('startTime')
  }

  const handleEndDateOpenChange = (open: boolean) => {
    if (isTransitioningRef.current) return
    // If no start date selected, redirect to start date picker
    if (open && !startDate) {
      setStartDateOpen(true)
      setActiveField('startDate')
      return
    }
    setEndDateOpen(open)
    if (open) {
      setActiveField('endDate')
    } else {
      // Reset hide selection when closing picker
      setHideEndDateSelection(false)
    }
  }

  const handleEndTimeOpenChange = (open: boolean) => {
    if (isTransitioningRef.current) return
    // If no end date selected, redirect to the appropriate date picker
    if (open && !endDate) {
      if (!startDate) {
        setStartDateOpen(true)
        setActiveField('startDate')
      } else {
        setEndDateOpen(true)
        setActiveField('endDate')
      }
      return
    }
    setEndTimeOpen(open)
    if (open) setActiveField('endTime')
  }

  const canSubmit = useMemo(() => {
    if (!startDate || !endDate || !startTime || !endTime) return false
    // For same day, ensure end time is after start time
    if (isSameDay && endTime <= startTime) return false
    // Validate minimum rental duration
    if (minRentalMinutes > 0) {
      const { start: fullStart, end: fullEnd } = buildDateTimeRange({
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        startTime,
        endTime,
        timezone,
      })
      if (!validateMinRentalDurationMinutes(fullStart, fullEnd, minRentalMinutes).valid) return false
    }
    return true
  }, [startDate, endDate, startTime, endTime, isSameDay, minRentalMinutes, timezone])

  const timezoneCity = useMemo(() => {
    if (!timezone) return null
    const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (browserTimezone === timezone) return null
    const city = timezone.split('/').pop()?.replace(/_/g, ' ')
    return city || timezone
  }, [timezone])

  const durationWarning = useMemo(() => {
    if (!startDate || !endDate || !startTime || !endTime) return null
    if (minRentalMinutes <= 0) return null
    const { start: fullStart, end: fullEnd } = buildDateTimeRange({
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      startTime,
      endTime,
      timezone,
    })
    const check = validateMinRentalDurationMinutes(fullStart, fullEnd, minRentalMinutes)
    if (check.valid) return null
    return t('minDurationWarning', {
      duration: formatDurationFromMinutes(minRentalMinutes),
    })
  }, [startDate, endDate, startTime, endTime, minRentalMinutes, timezone, t])

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
                  "w-full flex items-center justify-between px-3 py-2 rounded-md text-left transition-colors text-sm",
                  isSelected
                    ? "bg-primary text-primary-foreground"
                    : isDisabled
                      ? "text-muted-foreground/40 cursor-not-allowed"
                      : "hover:bg-muted"
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
    <div className="w-full max-w-2xl">
      {/* Responsive layout - stacked on mobile, horizontal on desktop */}
      <div className="bg-background/95 backdrop-blur-md rounded-2xl border shadow-2xl p-4 md:p-5">
        <div className="flex flex-col gap-3 md:gap-4">
          {/* Date/Time inputs row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Start Date/Time */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block">
                {t('startLabel')}
              </label>
              <div className="flex rounded-xl border bg-background overflow-hidden h-12">
                <Popover open={startDateOpen} onOpenChange={handleStartDateOpenChange}>
                  <PopoverTrigger render={<button
                      className={cn(
                        "flex-1 flex items-center gap-2 px-3 text-left hover:bg-muted/50 transition-colors min-w-0",
                        !startDate && "text-muted-foreground"
                      )}
                    />}>
                      <CalendarIcon className="h-4 w-4 shrink-0 text-primary" />
                      <span className="font-medium text-sm truncate">
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
                  <PopoverTrigger render={<button className="flex items-center gap-1.5 px-3 hover:bg-muted/50 transition-colors shrink-0" />}>
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium text-sm">{startTime}</span>
                  </PopoverTrigger>
                  <PopoverContent className="w-40 p-0" align="start">
                    <TimeSelector value={startTime} onSelect={handleStartTimeSelect} slots={startTimeSlots} />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* End Date/Time */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block">
                {t('endLabel')}
              </label>
              <div className="flex rounded-xl border bg-background overflow-hidden h-12">
                <Popover open={endDateOpen} onOpenChange={handleEndDateOpenChange}>
                  <PopoverTrigger render={<button
                      className={cn(
                        "flex-1 flex items-center gap-2 px-3 text-left hover:bg-muted/50 transition-colors min-w-0",
                        !endDate && "text-muted-foreground"
                      )}
                    />}>
                      <CalendarIcon className="h-4 w-4 shrink-0 text-primary" />
                      <span className="font-medium text-sm truncate">
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
                  <PopoverTrigger render={<button className="flex items-center gap-1.5 px-3 hover:bg-muted/50 transition-colors shrink-0" />}>
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium text-sm">{endTime}</span>
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
            </div>
          </div>

          {/* Duration warning */}
          {durationWarning && (
            <p className="text-sm text-destructive text-center">{durationWarning}</p>
          )}

          {/* Search Button - full width */}
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            size="lg"
            className="w-full h-12 text-base font-semibold"
          >
            {t('viewAvailability')}
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>

          {/* Timezone notice */}
          {timezoneCity && (
            <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <Globe className="h-3.5 w-3.5 shrink-0" />
              <span>{t('timezoneNotice', { city: timezoneCity })}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
