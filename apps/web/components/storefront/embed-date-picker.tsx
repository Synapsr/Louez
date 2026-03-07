'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { format, addDays } from 'date-fns'
import { fr } from 'date-fns/locale'
import { CalendarIcon, ArrowRight, Clock, AlertCircle, Globe, CheckCircle, Shield, MapPin, ChevronLeft } from 'lucide-react'

import { Button } from '@louez/ui'
import { Calendar } from '@louez/ui'
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

type Step = 'idle' | 'startDate' | 'startTime' | 'endDate' | 'endTime'

const STEP_INDEX: Record<Exclude<Step, 'idle'>, number> = {
  startDate: 1,
  startTime: 2,
  endDate: 3,
  endTime: 4,
}

function TimeGrid({
  slots,
  value,
  onSelect,
  disabledBefore,
  emptyMessage,
}: {
  slots: string[]
  value: string
  onSelect: (time: string) => void
  disabledBefore?: string
  emptyMessage: string
}) {
  if (slots.length === 0) {
    return (
      <div className="py-6 text-center text-xs text-muted-foreground">
        <AlertCircle className="h-4 w-4 mx-auto mb-1.5" />
        {emptyMessage}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-4 gap-1.5 p-1">
      {slots.map((time) => {
        const isDisabled = disabledBefore ? time <= disabledBefore : false
        const isSelected = value === time

        return (
          <button
            key={time}
            type="button"
            onClick={() => !isDisabled && onSelect(time)}
            disabled={isDisabled}
            className={cn(
              'py-2 rounded-lg text-xs font-medium transition-colors',
              isSelected
                ? 'bg-primary text-primary-foreground'
                : isDisabled
                  ? 'text-muted-foreground/30 cursor-not-allowed'
                  : 'bg-muted/50 hover:bg-muted text-foreground'
            )}
          >
            {time}
          </button>
        )
      })}
    </div>
  )
}

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

  const [step, setStep] = useState<Step>('idle')
  const [startDate, setStartDate] = useState<Date | undefined>(undefined)
  const [endDate, setEndDate] = useState<Date | undefined>(undefined)
  const [startTime, setStartTime] = useState<string>('09:00')
  const [endTime, setEndTime] = useState<string>('18:00')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const endDateAutoSetRef = useRef(false)

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
    setSubmitError(null)
  }, [startDate, endDate, startTime, endTime])

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

  // Auto-resize iframe
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

  // Step handlers
  const handleFieldClick = (field: Step) => {
    if (field === 'startTime' && !startDate) { setStep('startDate'); return }
    if ((field === 'endDate' || field === 'endTime') && !startDate) { setStep('startDate'); return }
    if (field === 'endTime' && !endDate) { setStep('endDate'); return }
    setStep((prev) => (prev === field ? 'idle' : field))
  }

  const handleStartDateSelect = (date: Date | undefined) => {
    if (!date) return
    setStartDate(date)
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
    setStep('startTime')
  }

  const handleStartTimeSelect = (time: string) => {
    setStartTime(time)
    setStep('endDate')
  }

  const handleEndDateSelect = (date: Date | undefined) => {
    if (!date) return
    setEndDate(date)
    endDateAutoSetRef.current = false
    setStep('endTime')
  }

  const handleEndTimeSelect = (time: string) => {
    setEndTime(time)
    setStep('idle')
    const { start: finalStart, end: finalEnd } = buildDateTimeRange({
      startDate: startDate!,
      endDate: endDate!,
      startTime,
      endTime: time,
      timezone,
    })
    openRentalPage(finalStart, finalEnd)
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
      if (!startDate) setStep('startDate')
      else if (!endDate) setStep('endDate')
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

  const hasDates = startDate && endDate

  // Step metadata
  const stepLabel = step === 'startDate' || step === 'startTime' ? t('startLabel') : t('endLabel')
  const StepIcon = step === 'startDate' || step === 'endDate' ? CalendarIcon : Clock
  const stepContext =
    step === 'startTime' && startDate ? format(startDate, 'd MMM', { locale: fr })
    : step === 'endTime' && endDate ? format(endDate, 'd MMM', { locale: fr })
    : null
  const currentStepIndex = step !== 'idle' ? STEP_INDEX[step] : 0

  return (
    <div className="w-full" ref={containerRef}>
      <div className="bg-background rounded-2xl border border-border/50 shadow-lg p-3.5">

        {/* ── IDLE VIEW ── */}
        {step === 'idle' ? (
          <div className="flex flex-col gap-2.5">
            <h2 className="text-[13px] font-semibold text-center tracking-tight">
              {tEmbed('title')}
            </h2>

            {/* Date/Time clickable fields */}
            <div className="grid grid-cols-2 gap-2">
              {/* Start */}
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
                  {t('startLabel')}
                </label>
                <div
                  className={cn(
                    'flex rounded-xl overflow-hidden h-10 transition-all duration-200',
                    startDate
                      ? 'border border-primary/25 bg-primary/[0.03] shadow-sm'
                      : 'border border-dashed border-muted-foreground/25 hover:border-muted-foreground/40'
                  )}
                >
                  <button
                    type="button"
                    onClick={() => handleFieldClick('startDate')}
                    className={cn(
                      'flex-1 flex items-center gap-1.5 px-2.5 text-left min-w-0',
                      startDate ? 'text-foreground' : 'text-muted-foreground'
                    )}
                  >
                    <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className={cn('text-xs truncate', startDate && 'font-medium')}>
                      {startDate ? format(startDate, 'd MMM', { locale: fr }) : t('startDate')}
                    </span>
                  </button>
                  <div className="w-px bg-border/50 my-2" />
                  <button
                    type="button"
                    onClick={() => handleFieldClick('startTime')}
                    className="flex items-center gap-1 px-2 shrink-0"
                  >
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className={cn(
                      'text-xs',
                      startDate ? 'text-foreground font-medium' : 'text-muted-foreground'
                    )}>
                      {startTime}
                    </span>
                  </button>
                </div>
              </div>

              {/* End */}
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
                  {t('endLabel')}
                </label>
                <div
                  className={cn(
                    'flex rounded-xl overflow-hidden h-10 transition-all duration-200',
                    endDate
                      ? 'border border-primary/25 bg-primary/[0.03] shadow-sm'
                      : 'border border-dashed border-muted-foreground/25 hover:border-muted-foreground/40'
                  )}
                >
                  <button
                    type="button"
                    onClick={() => handleFieldClick('endDate')}
                    className={cn(
                      'flex-1 flex items-center gap-1.5 px-2.5 text-left min-w-0',
                      endDate ? 'text-foreground' : 'text-muted-foreground'
                    )}
                  >
                    <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className={cn('text-xs truncate', endDate && 'font-medium')}>
                      {endDate ? format(endDate, 'd MMM', { locale: fr }) : t('endDate')}
                    </span>
                  </button>
                  <div className="w-px bg-border/50 my-2" />
                  <button
                    type="button"
                    onClick={() => handleFieldClick('endTime')}
                    className="flex items-center gap-1 px-2 shrink-0"
                  >
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className={cn(
                      'text-xs',
                      endDate ? 'text-foreground font-medium' : 'text-muted-foreground'
                    )}>
                      {endTime}
                    </span>
                  </button>
                </div>
              </div>
            </div>

            {submitError && (
              <p className="text-[11px] text-destructive text-center flex items-center justify-center gap-1">
                <AlertCircle className="h-3 w-3 shrink-0" />
                {submitError}
              </p>
            )}

            <Button
              onClick={handleSubmit}
              size="default"
              className={cn(
                'w-full h-10 text-sm font-semibold rounded-xl transition-all duration-200',
                hasDates && 'shadow-md'
              )}
            >
              {tEmbed('cta')}
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>

            <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground/70">
              <div className="flex items-center gap-0.5">
                <CheckCircle className="h-2.5 w-2.5 text-primary/60" />
                <span>{tHero('instantConfirmation')}</span>
              </div>
              <span className="text-border">·</span>
              <div className="flex items-center gap-0.5">
                <Shield className="h-2.5 w-2.5 text-primary/60" />
                <span>{tHero('securePayment')}</span>
              </div>
              <span className="text-border">·</span>
              <div className="flex items-center gap-0.5">
                <MapPin className="h-2.5 w-2.5 text-primary/60" />
                <span>{tHero('localPickup')}</span>
              </div>
            </div>

            {timezoneCity && (
              <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground/60">
                <Globe className="h-2.5 w-2.5 shrink-0" />
                <span>{t('timezoneNotice', { city: timezoneCity })}</span>
              </div>
            )}
          </div>
        ) : (

          /* ── STEP VIEW ── */
          <div className="flex flex-col gap-2">
            {/* Step header */}
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setStep('idle')}
                className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
                <StepIcon className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-semibold text-foreground">{stepLabel}</span>
                {stepContext && (
                  <span className="text-[11px] text-muted-foreground">· {stepContext}</span>
                )}
              </button>
              <div className="flex gap-1">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className={cn(
                      'h-1.5 w-1.5 rounded-full transition-colors',
                      i === currentStepIndex
                        ? 'bg-primary'
                        : i < currentStepIndex
                          ? 'bg-primary/40'
                          : 'bg-muted-foreground/20'
                    )}
                  />
                ))}
              </div>
            </div>

            {/* Step content */}
            {(step === 'startDate' || step === 'endDate') && (
              <div className="flex justify-center">
                <Calendar
                  mode="single"
                  selected={
                    step === 'startDate'
                      ? startDate
                      : endDateAutoSetRef.current ? undefined : endDate
                  }
                  defaultMonth={step === 'endDate' ? endDate : undefined}
                  onSelect={step === 'startDate' ? handleStartDateSelect : handleEndDateSelect}
                  disabled={
                    step === 'startDate'
                      ? isDateDisabled
                      : (date) => isDateDisabled(date) || (startDate ? date < startDate : false)
                  }
                  locale={fr}
                  autoFocus
                />
              </div>
            )}

            {step === 'startTime' && (
              <TimeGrid
                slots={startTimeSlots}
                value={startTime}
                onSelect={handleStartTimeSelect}
                emptyMessage={tBusinessHours('storeClosed')}
              />
            )}

            {step === 'endTime' && (
              <TimeGrid
                slots={endTimeSlots}
                value={endTime}
                onSelect={handleEndTimeSelect}
                disabledBefore={isSameDay ? startTime : undefined}
                emptyMessage={tBusinessHours('storeClosed')}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
