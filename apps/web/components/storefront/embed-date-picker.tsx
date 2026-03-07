'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { format, addDays } from 'date-fns'
import { fr } from 'date-fns/locale'
import {
  CalendarIcon,
  ArrowRight,
  Clock,
  AlertCircle,
  Globe,
  CheckCircle,
  Shield,
  MapPin,
  ChevronLeft,
} from 'lucide-react'

import { Button, Calendar } from '@louez/ui'
import { cn } from '@louez/utils'
import { type PricingMode } from '@/lib/utils/duration'
import {
  formatDurationFromMinutes,
  validateMinRentalDurationMinutes,
} from '@/lib/utils/rental-duration'
import type { BusinessHours } from '@louez/types'
import {
  buildDateTimeRange,
  ensureSelectedTime,
  useRentalDateCore,
} from '@/components/storefront/date-picker/core/use-rental-date-core'
import { getNextAvailableDate } from '@/lib/utils/business-hours'

// ─── Types ────────────────────────────────────────────────────────────────────

interface EmbedDatePickerProps {
  rentalUrl: string
  pricingMode: PricingMode
  businessHours?: BusinessHours
  advanceNotice?: number
  minRentalMinutes?: number
  timezone?: string
}

type Step = 'idle' | 'startDate' | 'startTime' | 'endDate' | 'endTime'

// ─── Constants ────────────────────────────────────────────────────────────────

const STEPS: Exclude<Step, 'idle'>[] = ['startDate', 'startTime', 'endDate', 'endTime']

/**
 * CSS overrides for the shared Calendar component to fit inside an iframe.
 *
 * The default Calendar uses `aspect-square` on day cells, making them as tall
 * as they are wide (~48px in a 340px-wide embed). This causes the calendar
 * to be ~440px tall — far too much for an embeddable widget.
 *
 * These overrides produce compact rectangular cells (28px tall) and tighter
 * spacing, bringing the calendar to ~230px — comfortably fitting without scroll.
 */
const COMPACT_CALENDAR_CLASSES = cn(
  // Calendar root defaults to `w-fit`; force it to fill the container
  '[&_[data-slot=calendar]]:!w-full',
  // Remove square aspect ratio from day <td> cells
  '[&_.rdp-day]:!aspect-auto',
  // Day buttons: compact fixed height, remove square/min-size constraints
  '[&_.rdp-day_[data-slot=button]]:!aspect-auto',
  '[&_.rdp-day_[data-slot=button]]:!h-7',
  '[&_.rdp-day_[data-slot=button]]:!min-h-0',
  '[&_.rdp-day_[data-slot=button]]:!min-w-0',
  '[&_.rdp-day_[data-slot=button]]:!text-xs',
  // Minimal row spacing (default: mt-2 = 8px)
  '[&_.rdp-week]:!mt-px',
  // Smaller weekday header text
  '[&_.rdp-weekday]:!text-[0.65rem]',
  // Shorter month caption
  '[&_.rdp-month_caption]:!h-5',
)

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * Responsive grid of time slot buttons.
 * Adapts column count to iframe viewport width:
 *   - <340px  → 4 columns
 *   - 340px+  → 5 columns
 *   - 440px+  → 6 columns
 *
 * Since the iframe IS the viewport, standard media queries work correctly.
 */
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
      <div className="flex flex-col items-center justify-center gap-1 py-6 text-muted-foreground">
        <AlertCircle className="h-4 w-4" />
        <span className="text-[11px]">{emptyMessage}</span>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-4 min-[340px]:grid-cols-5 min-[440px]:grid-cols-6 gap-1">
      {slots.map((time) => {
        const isDisabled = disabledBefore ? time <= disabledBefore : false
        const isSelected = value === time

        return (
          <button
            key={time}
            type="button"
            onClick={() => onSelect(time)}
            disabled={isDisabled}
            className={cn(
              'py-1.5 rounded-md text-[11px] font-medium transition-colors',
              isSelected
                ? 'bg-primary text-primary-foreground shadow-sm'
                : isDisabled
                  ? 'text-muted-foreground/30 cursor-not-allowed'
                  : 'bg-muted/50 hover:bg-muted text-foreground',
            )}
          >
            {time}
          </button>
        )
      })}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

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
  const tBusinessHours = useTranslations(
    'storefront.dateSelection.businessHours',
  )

  // ── State ─────────────────────────────────────────────────────────────────

  const [step, setStep] = useState<Step>('idle')
  const [startDate, setStartDate] = useState<Date | undefined>()
  const [endDate, setEndDate] = useState<Date | undefined>()
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('18:00')
  const [submitError, setSubmitError] = useState<string | null>(null)

  // When true, the end-date calendar won't highlight the auto-set date,
  // so the user feels free to pick any date instead of confirming the default.
  const endDateAutoSetRef = useRef(false)

  // ── Business logic ────────────────────────────────────────────────────────

  const { isSameDay, startTimeSlots, endTimeSlots, isDateDisabled } =
    useRentalDateCore({
      startDate,
      endDate,
      startTime,
      endTime,
      businessHours,
      advanceNotice,
      timezone,
    })

  // Clear submit error whenever the user changes any value
  useEffect(() => {
    setSubmitError(null)
  }, [startDate, endDate, startTime, endTime])

  // Keep selected times in sync with available slots after date changes
  useEffect(() => {
    if (startDate && startTimeSlots.length > 0) {
      setStartTime((prev) =>
        ensureSelectedTime(prev, startTimeSlots, 'first'),
      )
    }
  }, [startDate, startTimeSlots])

  useEffect(() => {
    if (endDate && endTimeSlots.length > 0) {
      setEndTime((prev) => ensureSelectedTime(prev, endTimeSlots, 'last'))
    }
  }, [endDate, endTimeSlots])

  // ── Iframe auto-resize ────────────────────────────────────────────────────
  // Reports content height to the parent page via postMessage so the host
  // script can resize the iframe to match (no scrolling inside the iframe).

  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const observer = new ResizeObserver(() => {
      // Use documentElement.scrollHeight to account for page-level padding
      // (the embed page wraps this component in a div with p-2)
      const height = document.documentElement.scrollHeight
      window.parent.postMessage({ type: 'louez-embed-resize', height }, '*')
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // ── Navigation helpers ────────────────────────────────────────────────────

  const openRentalPage = useCallback(
    (start: Date, end: Date) => {
      const params = new URLSearchParams()
      params.set('startDate', start.toISOString())
      params.set('endDate', end.toISOString())
      window.open(`${rentalUrl}?${params.toString()}`, '_blank', 'noopener')
    },
    [rentalUrl],
  )

  // ── Step handlers ─────────────────────────────────────────────────────────
  // Flow: idle → startDate → startTime → endDate → endTime → redirect
  // The back button always returns to idle (overview) where the user can
  // click any field to re-edit it.

  const handleFieldClick = (field: Step) => {
    // Guide the user to the correct prerequisite step
    if (field === 'startTime' && !startDate) {
      setStep('startDate')
      return
    }
    if ((field === 'endDate' || field === 'endTime') && !startDate) {
      setStep('startDate')
      return
    }
    if (field === 'endTime' && !endDate) {
      setStep('endDate')
      return
    }
    // Toggle: clicking the active field returns to idle
    setStep((prev) => (prev === field ? 'idle' : field))
  }

  const handleStartDateSelect = (date: Date | undefined) => {
    if (!date) return
    setStartDate(date)

    // Auto-set end date if needed
    if (!endDate || date >= endDate) {
      if (pricingMode === 'hour') {
        setEndDate(date)
      } else {
        const nextDay = addDays(date, 1)
        const nextAvailable = getNextAvailableDate(
          nextDay,
          businessHours,
          365,
          timezone,
        )
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

    // Auto-submit after the last step
    const { start, end } = buildDateTimeRange({
      startDate: startDate!,
      endDate: endDate!,
      startTime,
      endTime: time,
      timezone,
    })
    openRentalPage(start, end)
  }

  // ── Validation ────────────────────────────────────────────────────────────

  const validationError = useMemo(() => {
    if (!startDate) return tEmbed('errors.selectStartDate')
    if (!endDate) return tEmbed('errors.selectEndDate')
    if (isSameDay && endTime <= startTime)
      return tEmbed('errors.endTimeAfterStart')

    if (minRentalMinutes > 0) {
      const { start, end } = buildDateTimeRange({
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        startTime,
        endTime,
        timezone,
      })
      if (!validateMinRentalDurationMinutes(start, end, minRentalMinutes).valid)
        return t('minDurationWarning', {
          duration: formatDurationFromMinutes(minRentalMinutes),
        })
    }

    return null
  }, [
    startDate,
    endDate,
    startTime,
    endTime,
    isSameDay,
    minRentalMinutes,
    timezone,
    t,
    tEmbed,
  ])

  const timezoneCity = useMemo(() => {
    if (!timezone) return null
    const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (browserTimezone === timezone) return null
    const city = timezone.split('/').pop()?.replace(/_/g, ' ')
    return city || timezone
  }, [timezone])

  const handleSubmit = () => {
    if (validationError) {
      setSubmitError(validationError)
      // Guide the user to the first incomplete step
      if (!startDate) setStep('startDate')
      else if (!endDate) setStep('endDate')
      return
    }

    const { start, end } = buildDateTimeRange({
      startDate: startDate!,
      endDate: endDate!,
      startTime,
      endTime,
      timezone,
    })
    openRentalPage(start, end)
  }

  // ── Derived values for step header ────────────────────────────────────────

  const isDateStep = step === 'startDate' || step === 'endDate'
  const isStartStep = step === 'startDate' || step === 'startTime'
  const stepLabel = isStartStep ? t('startLabel') : t('endLabel')
  const StepIcon = isDateStep ? CalendarIcon : Clock
  const currentStepIndex =
    step !== 'idle' ? STEPS.indexOf(step as Exclude<Step, 'idle'>) + 1 : 0

  // Show the selected date as context when choosing a time slot
  const stepContext = useMemo(() => {
    if (step === 'startTime' && startDate)
      return format(startDate, 'd MMM', { locale: fr })
    if (step === 'endTime' && endDate)
      return format(endDate, 'd MMM', { locale: fr })
    return null
  }, [step, startDate, endDate])

  const hasDates = startDate && endDate

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="w-full" ref={containerRef}>
      <div className="bg-background rounded-2xl border border-border/50 shadow-lg overflow-hidden p-3">
        {step === 'idle' ? (
          /* ── Idle view: summary + CTA ── */
          <div className="flex flex-col gap-2">
            <h2 className="text-[13px] font-semibold text-center tracking-tight">
              {tEmbed('title')}
            </h2>

            {/* Date/time fields — 2 compound fields side by side */}
            <div className="grid grid-cols-2 gap-2">
              <DateTimeField
                label={t('startLabel')}
                date={startDate}
                time={startTime}
                datePlaceholder={t('startDate')}
                isFilled={!!startDate}
                onDateClick={() => handleFieldClick('startDate')}
                onTimeClick={() => handleFieldClick('startTime')}
              />
              <DateTimeField
                label={t('endLabel')}
                date={endDate}
                time={endTime}
                datePlaceholder={t('endDate')}
                isFilled={!!endDate}
                onDateClick={() => handleFieldClick('endDate')}
                onTimeClick={() => handleFieldClick('endTime')}
              />
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
                hasDates && 'shadow-md',
              )}
            >
              {tEmbed('cta')}
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>

            {/* Trust badges */}
            <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground/70">
              <span className="inline-flex items-center gap-0.5">
                <CheckCircle className="h-2.5 w-2.5 text-primary/60" />
                {tHero('instantConfirmation')}
              </span>
              <span className="text-border">·</span>
              <span className="inline-flex items-center gap-0.5">
                <Shield className="h-2.5 w-2.5 text-primary/60" />
                {tHero('securePayment')}
              </span>
              <span className="text-border">·</span>
              <span className="inline-flex items-center gap-0.5">
                <MapPin className="h-2.5 w-2.5 text-primary/60" />
                {tHero('localPickup')}
              </span>
            </div>

            {timezoneCity && (
              <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground/60">
                <Globe className="h-2.5 w-2.5 shrink-0" />
                <span>{t('timezoneNotice', { city: timezoneCity })}</span>
              </div>
            )}
          </div>
        ) : (
          /* ── Step view: calendar or time grid ── */
          <div className="flex flex-col gap-1.5">
            {/* Step header: back button, icon, label, context, progress */}
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setStep('idle')}
                className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                <StepIcon className="h-3 w-3 text-primary" />
                <span className="text-[11px] font-semibold text-foreground">
                  {stepLabel}
                </span>
                {stepContext && (
                  <span className="text-[10px] text-muted-foreground">
                    · {stepContext}
                  </span>
                )}
              </button>
              <div className="flex gap-0.5">
                {STEPS.map((_, i) => (
                  <div
                    key={i}
                    className={cn(
                      'h-1 w-1 rounded-full transition-colors',
                      i + 1 === currentStepIndex
                        ? 'bg-primary'
                        : i + 1 < currentStepIndex
                          ? 'bg-primary/40'
                          : 'bg-muted-foreground/20',
                    )}
                  />
                ))}
              </div>
            </div>

            {/* Calendar (date steps) */}
            {isDateStep && (
              <div className={COMPACT_CALENDAR_CLASSES}>
                <Calendar
                  className="w-full p-0 [--cell-size:1.25rem]"
                  mode="single"
                  selected={
                    step === 'startDate'
                      ? startDate
                      : endDateAutoSetRef.current
                        ? undefined
                        : endDate
                  }
                  defaultMonth={step === 'endDate' ? endDate : undefined}
                  onSelect={
                    step === 'startDate'
                      ? handleStartDateSelect
                      : handleEndDateSelect
                  }
                  disabled={
                    step === 'startDate'
                      ? isDateDisabled
                      : (date) =>
                          isDateDisabled(date) ||
                          (startDate ? date < startDate : false)
                  }
                  locale={fr}
                  autoFocus
                />
              </div>
            )}

            {/* Time slots (time steps) */}
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

// ─── Idle view field component ────────────────────────────────────────────────

/**
 * A compound date+time field for the idle view.
 * Shows date on the left (expandable) and time on the right, separated by a divider.
 *
 * Visual states:
 * - Empty: dashed border, muted text — invites interaction
 * - Filled: primary accent border/bg, bold text — confirms selection
 */
function DateTimeField({
  label,
  date,
  time,
  datePlaceholder,
  isFilled,
  onDateClick,
  onTimeClick,
}: {
  label: string
  date: Date | undefined
  time: string
  datePlaceholder: string
  isFilled: boolean
  onDateClick: () => void
  onTimeClick: () => void
}) {
  return (
    <div>
      <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
        {label}
      </label>
      <div
        className={cn(
          'flex rounded-xl overflow-hidden h-10 transition-all duration-200',
          isFilled
            ? 'border border-primary/25 bg-primary/[0.03] shadow-sm'
            : 'border border-dashed border-muted-foreground/25 hover:border-muted-foreground/40',
        )}
      >
        {/* Date section */}
        <button
          type="button"
          onClick={onDateClick}
          className={cn(
            'flex-1 flex items-center gap-1.5 px-2.5 text-left min-w-0',
            isFilled ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span
            className={cn('text-xs truncate', isFilled && 'font-medium')}
          >
            {date ? format(date, 'd MMM', { locale: fr }) : datePlaceholder}
          </span>
        </button>

        <div className="w-px bg-border/50 my-2" />

        {/* Time section */}
        <button
          type="button"
          onClick={onTimeClick}
          className="flex items-center gap-1 px-2 shrink-0"
        >
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          <span
            className={cn(
              'text-xs',
              isFilled
                ? 'text-foreground font-medium'
                : 'text-muted-foreground',
            )}
          >
            {time}
          </span>
        </button>
      </div>
    </div>
  )
}
