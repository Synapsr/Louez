'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { format, addDays } from 'date-fns'
import { ArrowRight, AlertCircle, Globe, CheckCircle, Shield, MapPin } from 'lucide-react'

import { Button } from '@louez/ui'
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

function toInputDate(date: Date | undefined): string {
  return date ? format(date, 'yyyy-MM-dd') : ''
}

function fromInputDate(str: string): Date | undefined {
  return str ? new Date(str + 'T00:00:00') : undefined
}

const DEFAULT_TIME_SLOTS: string[] = (() => {
  const slots: string[] = []
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      slots.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`)
    }
  }
  return slots
})()

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

  const [startDate, setStartDate] = useState<Date | undefined>(undefined)
  const [endDate, setEndDate] = useState<Date | undefined>(undefined)
  const [startTime, setStartTime] = useState<string>('09:00')
  const [endTime, setEndTime] = useState<string>('18:00')
  const [submitError, setSubmitError] = useState<string | null>(null)

  const {
    isSameDay,
    startTimeSlots,
    endTimeSlots,
  } = useRentalDateCore({
    startDate,
    endDate,
    startTime,
    endTime,
    businessHours,
    advanceNotice,
    timezone,
  })

  // Clear error when user changes any field
  useEffect(() => {
    setSubmitError(null)
  }, [startDate, endDate, startTime, endTime])

  // Auto-adjust times when available slots change
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
      window.parent.postMessage({ type: 'louez-embed-resize', height: el.scrollHeight }, '*')
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const openRentalPage = useCallback((start: Date, end: Date) => {
    const params = new URLSearchParams()
    params.set('startDate', start.toISOString())
    params.set('endDate', end.toISOString())
    window.open(`${rentalUrl}?${params.toString()}`, '_blank', 'noopener')
  }, [rentalUrl])

  const today = format(new Date(), 'yyyy-MM-dd')

  const handleStartDateChange = (dateStr: string) => {
    const date = fromInputDate(dateStr)
    setStartDate(date)

    if (date && (!endDate || endDate <= date)) {
      if (pricingMode === 'hour') {
        setEndDate(date)
      } else {
        const nextDay = addDays(date, 1)
        const nextAvailable = getNextAvailableDate(nextDay, businessHours, 365, timezone)
        setEndDate(nextAvailable ?? nextDay)
      }
    }
  }

  const handleEndDateChange = (dateStr: string) => {
    setEndDate(fromInputDate(dateStr))
  }

  // Use business hours slots when available, default slots as fallback
  const effectiveStartSlots = startDate
    ? (startTimeSlots.length > 0 ? startTimeSlots : [])
    : DEFAULT_TIME_SLOTS
  const effectiveEndSlots = endDate
    ? (endTimeSlots.length > 0 ? endTimeSlots : [])
    : DEFAULT_TIME_SLOTS

  const startClosed = startDate && effectiveStartSlots.length === 0
  const endClosed = endDate && effectiveEndSlots.length === 0

  const getValidationError = useMemo(() => {
    if (!startDate) return tEmbed('errors.selectStartDate')
    if (!endDate) return tEmbed('errors.selectEndDate')
    if (startClosed || endClosed) return tBusinessHours('storeClosed')
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
  }, [startDate, endDate, startTime, endTime, isSameDay, startClosed, endClosed, minRentalMinutes, timezone, t, tEmbed, tBusinessHours])

  const timezoneCity = useMemo(() => {
    if (!timezone) return null
    const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (browserTimezone === timezone) return null
    const city = timezone.split('/').pop()?.replace(/_/g, ' ')
    return city || timezone
  }, [timezone])

  const handleSubmit = () => {
    if (getValidationError) {
      setSubmitError(getValidationError)
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

  return (
    <div className="w-full" ref={containerRef}>
      <div className="bg-background rounded-2xl border shadow-sm p-3">
        <div className="flex flex-col gap-2">
          {/* Title */}
          <h2 className="text-sm font-semibold text-center">
            {tEmbed('title')}
          </h2>

          {/* Date/Time inputs - native controls for iframe compatibility */}
          <div className="grid grid-cols-2 gap-2">
            {/* Start Date/Time */}
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
                {t('startLabel')}
              </label>
              <div className="flex rounded-lg border bg-background overflow-hidden h-9">
                <input
                  type="date"
                  value={toInputDate(startDate)}
                  min={today}
                  onChange={(e) => handleStartDateChange(e.target.value)}
                  className="flex-1 px-2 text-xs bg-transparent outline-none min-w-0 cursor-pointer"
                />
                <div className="w-px bg-border my-1.5" />
                <select
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  disabled={effectiveStartSlots.length === 0}
                  className="px-1 text-xs bg-transparent outline-none cursor-pointer shrink-0 disabled:opacity-50"
                >
                  {effectiveStartSlots.length === 0 ? (
                    <option disabled>--:--</option>
                  ) : (
                    effectiveStartSlots.map((slot) => (
                      <option key={slot} value={slot}>{slot}</option>
                    ))
                  )}
                </select>
              </div>
            </div>

            {/* End Date/Time */}
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
                {t('endLabel')}
              </label>
              <div className="flex rounded-lg border bg-background overflow-hidden h-9">
                <input
                  type="date"
                  value={toInputDate(endDate)}
                  min={startDate ? toInputDate(startDate) : today}
                  onChange={(e) => handleEndDateChange(e.target.value)}
                  className="flex-1 px-2 text-xs bg-transparent outline-none min-w-0 cursor-pointer"
                />
                <div className="w-px bg-border my-1.5" />
                <select
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  disabled={effectiveEndSlots.length === 0}
                  className="px-1 text-xs bg-transparent outline-none cursor-pointer shrink-0 disabled:opacity-50"
                >
                  {effectiveEndSlots.length === 0 ? (
                    <option disabled>--:--</option>
                  ) : (
                    effectiveEndSlots.map((slot) => {
                      const isDisabled = isSameDay && startTime ? slot <= startTime : false
                      return (
                        <option key={slot} value={slot} disabled={isDisabled}>{slot}</option>
                      )
                    })
                  )}
                </select>
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
