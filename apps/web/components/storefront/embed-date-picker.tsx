'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { format, addDays } from 'date-fns'
import { fr } from 'date-fns/locale'
import { CalendarIcon, ArrowRight, Clock, Check, AlertCircle, Globe, CheckCircle, Shield, MapPin } from 'lucide-react'

import { Button } from '@louez/ui'
import { Calendar } from '@louez/ui'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@louez/ui'
import { ScrollArea } from '@louez/ui'
import { cn } from '@louez/utils'
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

interface EmbedDatePickerProps {
  rentalUrl: string
  pricingMode: PricingMode
  businessHours?: BusinessHours
  advanceNotice?: number
  minRentalMinutes?: number
  timezone?: string
}

type ActiveField = 'startDate' | 'startTime' | 'endDate' | 'endTime' | null

export function EmbedDatePicker({
  rentalUrl,
  pricingMode,
  businessHours,
  advanceNotice = 0,
  minRentalMinutes = 0,
  timezone,
}: EmbedDatePickerProps) {
  const t = useTranslations('storefront.dateSelection')
  const tEmbed = useTranslations('storefront.embed')
  const tHero = useTranslations('storefront.hero')
  const tBusinessHours = useTranslations('storefront.dateSelection.businessHours')

  const isTransitioningRef = useRef(false)
  const endDateAutoSetRef = useRef(false)

  const [startDate, setStartDate] = useState<Date | undefined>(undefined)
  const [endDate, setEndDate] = useState<Date | undefined>(undefined)
  const [startTime, setStartTime] = useState<string>('09:00')
  const [endTime, setEndTime] = useState<string>('18:00')
  const [, setActiveField] = useState<ActiveField>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const [startDateOpen, setStartDateOpen] = useState(false)
  const [startTimeOpen, setStartTimeOpen] = useState(false)
  const [endDateOpen, setEndDateOpen] = useState(false)
  const [endTimeOpen, setEndTimeOpen] = useState(false)
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

  // Clear error when user changes dates
  useEffect(() => {
    setSubmitError(null)
  }, [startDate, endDate, startTime, endTime])

  // Auto-adjust times when slots change
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

  // Auto-resize: notify parent iframe of content height changes
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      const height = el.scrollHeight
      window.parent.postMessage({ type: 'louez-embed-resize', height }, '*')
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const openRentalPage = useCallback((start: Date, end: Date) => {
    const params = new URLSearchParams()
    params.set('startDate', start.toISOString())
    params.set('endDate', end.toISOString())
    const url = `${rentalUrl}?${params.toString()}`
    window.open(url, '_blank', 'noopener')
  }, [rentalUrl])

  const handleStartDateSelect = (date: Date | undefined) => {
    if (!date) return
    setStartDate(date)
    setStartDateOpen(false)

    if (!endDate || date >= endDate) {
      if (pricingMode === 'hour') {
        setEndDate(date)
      } else {
        const nextDay = addDays(date, 1)
        const nextAvailable = getNextAvailableDate(nextDay, businessHours, 365, timezone)
        setEndDate(nextAvailable ?? nextDay)
      }
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

    openRentalPage(finalStart, finalEnd)
  }

  const handleStartDateOpenChange = (open: boolean) => {
    if (isTransitioningRef.current) return
    setStartDateOpen(open)
    if (open) setActiveField('startDate')
  }

  const handleStartTimeOpenChange = (open: boolean) => {
    if (isTransitioningRef.current) return
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
    if (open && !startDate) {
      setStartDateOpen(true)
      setActiveField('startDate')
      return
    }
    setEndDateOpen(open)
    if (open) {
      setActiveField('endDate')
    } else {
      setHideEndDateSelection(false)
    }
  }

  const handleEndTimeOpenChange = (open: boolean) => {
    if (isTransitioningRef.current) return
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

  const getValidationError = useMemo(() => {
    if (!startDate) return tEmbed('errors.selectStartDate')
    if (!endDate) return tEmbed('errors.selectEndDate')
    if (isSameDay && endTime <= startTime) return tEmbed('errors.endTimeAfterStart')
    if (minRentalMinutes > 0) {
      const { start: fullStart, end: fullEnd } = buildDateTimeRange({
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        startTime,
        endTime,
        timezone,
      })
      if (!validateMinRentalDurationMinutes(fullStart, fullEnd, minRentalMinutes).valid) {
        return t('minDurationWarning', {
          duration: formatDurationFromMinutes(minRentalMinutes),
        })
      }
    }
    return null
  }, [startDate, endDate, startTime, endTime, isSameDay, minRentalMinutes, timezone, t, tEmbed])

  const canSubmit = getValidationError === null

  const timezoneCity = useMemo(() => {
    if (!timezone) return null
    const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (browserTimezone === timezone) return null
    const city = timezone.split('/').pop()?.replace(/_/g, ' ')
    return city || timezone
  }, [timezone])

  const handleSubmit = () => {
    if (!canSubmit) {
      setSubmitError(getValidationError)
      // If no start date, open the start date picker to guide the user
      if (!startDate) {
        setStartDateOpen(true)
        setActiveField('startDate')
      } else if (!endDate) {
        setEndDateOpen(true)
        setActiveField('endDate')
      }
      return
    }

    const { start: finalStart, end: finalEnd } = buildDateTimeRange({
      startDate: startDate!,
      endDate: endDate!,
      startTime,
      endTime,
      timezone,
    })
    openRentalPage(finalStart, finalEnd)
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
    <div className="w-full" ref={containerRef}>
      <div className="bg-background rounded-2xl border shadow-sm p-3">
        <div className="flex flex-col gap-2">
          {/* Title */}
          <h2 className="text-sm font-semibold text-center">
            {tEmbed('title')}
          </h2>

          {/* Date/Time inputs - always 2 columns */}
          <div className="grid grid-cols-2 gap-2">
            {/* Start Date/Time */}
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
                {t('startLabel')}
              </label>
              <div className="flex rounded-lg border bg-background overflow-hidden h-9">
                <Popover open={startDateOpen} onOpenChange={handleStartDateOpenChange}>
                  <PopoverTrigger render={<button
                      className={cn(
                        "flex-1 flex items-center gap-1.5 px-2 text-left hover:bg-muted/50 transition-colors min-w-0",
                        !startDate && "text-muted-foreground"
                      )}
                    />}>
                      <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="font-medium text-xs truncate">
                        {startDate ? format(startDate, 'd MMM', { locale: fr }) : t('startDate')}
                      </span>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start" side="bottom">
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

                <div className="w-px bg-border my-1.5" />

                <Popover open={startTimeOpen} onOpenChange={handleStartTimeOpenChange}>
                  <PopoverTrigger render={<button className="flex items-center gap-1 px-2 hover:bg-muted/50 transition-colors shrink-0" />}>
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-medium text-xs">{startTime}</span>
                  </PopoverTrigger>
                  <PopoverContent className="w-36 p-0" align="start" side="bottom">
                    <TimeSelector value={startTime} onSelect={handleStartTimeSelect} slots={startTimeSlots} />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* End Date/Time */}
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
                {t('endLabel')}
              </label>
              <div className="flex rounded-lg border bg-background overflow-hidden h-9">
                <Popover open={endDateOpen} onOpenChange={handleEndDateOpenChange}>
                  <PopoverTrigger render={<button
                      className={cn(
                        "flex-1 flex items-center gap-1.5 px-2 text-left hover:bg-muted/50 transition-colors min-w-0",
                        !endDate && "text-muted-foreground"
                      )}
                    />}>
                      <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="font-medium text-xs truncate">
                        {endDate ? format(endDate, 'd MMM', { locale: fr }) : t('endDate')}
                      </span>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end" side="bottom">
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

                <div className="w-px bg-border my-1.5" />

                <Popover open={endTimeOpen} onOpenChange={handleEndTimeOpenChange}>
                  <PopoverTrigger render={<button className="flex items-center gap-1 px-2 hover:bg-muted/50 transition-colors shrink-0" />}>
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-medium text-xs">{endTime}</span>
                  </PopoverTrigger>
                  <PopoverContent className="w-36 p-0" align="end" side="bottom">
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

          {/* Validation error */}
          {submitError && (
            <p className="text-xs text-destructive text-center flex items-center justify-center gap-1">
              <AlertCircle className="h-3 w-3 shrink-0" />
              {submitError}
            </p>
          )}

          {/* CTA Button - always clickable */}
          <Button
            onClick={handleSubmit}
            size="default"
            className="w-full h-9 text-sm font-semibold"
          >
            {tEmbed('cta')}
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>

          {/* Reassurance badges */}
          <div className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-0.5">
              <CheckCircle className="h-3 w-3 text-primary" />
              <span>{tHero('instantConfirmation')}</span>
            </div>
            <span className="text-border">·</span>
            <div className="flex items-center gap-0.5">
              <Shield className="h-3 w-3 text-primary" />
              <span>{tHero('securePayment')}</span>
            </div>
            <span className="text-border">·</span>
            <div className="flex items-center gap-0.5">
              <MapPin className="h-3 w-3 text-primary" />
              <span>{tHero('localPickup')}</span>
            </div>
          </div>

          {/* Timezone notice */}
          {timezoneCity && (
            <div className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
              <Globe className="h-3 w-3 shrink-0" />
              <span>{t('timezoneNotice', { city: timezoneCity })}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
