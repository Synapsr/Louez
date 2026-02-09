'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { format, addDays, addWeeks, addHours, startOfWeek, endOfWeek } from 'date-fns'
import { fr } from 'date-fns/locale'
import { CalendarIcon, ArrowRight, Clock, Check, AlertCircle, Globe } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

import { Button } from '@louez/ui'
import { Calendar } from '@louez/ui'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@louez/ui'
import { ScrollArea } from '@louez/ui'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@louez/ui'
import { cn } from '@louez/utils'
import { useCart } from '@/contexts/cart-context'
import { useStorefrontUrl } from '@/hooks/use-storefront-url'
import { getMinStartDate, isTimeSlotAvailable, type PricingMode } from '@/lib/utils/duration'
import type { BusinessHours } from '@louez/types'
import {
  isDateAvailable,
  getAvailableTimeSlots,
  generateTimeSlots,
  getNextAvailableDate,
  buildStoreDate,
} from '@/lib/utils/business-hours'

interface DateSelectionHeroProps {
  storeSlug: string
  pricingMode: PricingMode
  primaryColor?: string
  businessHours?: BusinessHours
  advanceNotice?: number
  timezone?: string
}

type ActiveField = 'startDate' | 'startTime' | 'endDate' | 'endTime' | null

// Default time slots when no business hours configured
const defaultTimeSlots = generateTimeSlots('07:00', '21:00', 30)

export function DateSelectionHero({
  storeSlug,
  pricingMode,
  primaryColor = '#0066FF',
  businessHours,
  advanceNotice = 0,
  timezone,
}: DateSelectionHeroProps) {
  const t = useTranslations('storefront.dateSelection')
  const tBusinessHours = useTranslations('storefront.dateSelection.businessHours')
  const router = useRouter()
  const searchParams = useSearchParams()
  const { setGlobalDates, setPricingMode, globalStartDate, globalEndDate } = useCart()
  const { getUrl } = useStorefrontUrl(storeSlug)

  // Transition lock to prevent popover conflicts
  const isTransitioningRef = useRef(false)

  // Initialize from URL params or cart context
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

  // Popover open states
  const [startDateOpen, setStartDateOpen] = useState(false)
  const [startTimeOpen, setStartTimeOpen] = useState(false)
  const [endDateOpen, setEndDateOpen] = useState(false)
  const [endTimeOpen, setEndTimeOpen] = useState(false)

  // Today for relative calculations (quick selects)
  const today = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])

  // Calculate minimum start date based on advance notice setting
  const minDate = useMemo(() => getMinStartDate(advanceNotice), [advanceNotice])

  // Business hours-aware time slots with advance notice filtering
  const startTimeSlots = useMemo(() => {
    if (!startDate) return defaultTimeSlots
    const businessHoursSlots = getAvailableTimeSlots(startDate, businessHours, 30, timezone)
    // Filter out time slots that are within the advance notice period
    return businessHoursSlots.filter(slot => isTimeSlotAvailable(startDate, slot, advanceNotice))
  }, [startDate, businessHours, advanceNotice, timezone])

  const endTimeSlots = useMemo(() => {
    if (!endDate) return defaultTimeSlots
    return getAvailableTimeSlots(endDate, businessHours, 30, timezone)
  }, [endDate, businessHours, timezone])

  // Check if a date is disabled due to business hours or advance notice
  const isDateDisabled = useCallback((date: Date): boolean => {
    if (date < minDate) return true
    if (!businessHours?.enabled) return false

    const availability = isDateAvailable(date, businessHours, timezone)
    return !availability.available
  }, [businessHours, minDate, timezone])

  // Get closure period info for a date
  const getClosurePeriodForDate = useCallback((date: Date) => {
    if (!businessHours?.enabled) return null

    const availability = isDateAvailable(date, businessHours, timezone)
    if (availability.reason === 'closure_period' && availability.closurePeriod) {
      return availability.closurePeriod
    }
    return null
  }, [businessHours, timezone])

  useEffect(() => {
    setPricingMode(pricingMode)
  }, [pricingMode, setPricingMode])

  // Update times if they're no longer available
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

  // Navigate to rental page
  const navigateToRental = useCallback((start: Date, end: Date) => {
    setGlobalDates(start.toISOString(), end.toISOString())
    const params = new URLSearchParams()
    params.set('startDate', start.toISOString())
    params.set('endDate', end.toISOString())
    router.push(`${getUrl('/rental')}?${params.toString()}`)
  }, [router, setGlobalDates, getUrl])

  // Auto-progress handlers with transition lock
  const handleStartDateSelect = (date: Date | undefined) => {
    if (!date) return
    setStartDate(date)
    setStartDateOpen(false)

    // Auto-set end date if not set or before start
    if (!endDate || date >= endDate) {
      const nextDay = addDays(date, 1)
      const nextAvailable = getNextAvailableDate(nextDay, businessHours, 365, timezone)
      setEndDate(nextAvailable ?? nextDay)
    }

    // Auto-progress to start time with lock
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

    // Auto-progress to end date with lock
    isTransitioningRef.current = true
    setTimeout(() => {
      setEndDateOpen(true)
      setActiveField('endDate')
      isTransitioningRef.current = false
    }, 250)
  }

  const handleEndDateSelect = (date: Date | undefined) => {
    if (!date) return
    setEndDate(date)
    setEndDateOpen(false)

    // Auto-progress to end time with lock
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

    // Build final dates with times and navigate
    const finalStart = buildStoreDate(startDate!, startTime, timezone)
    const finalEnd = buildStoreDate(endDate!, time, timezone)

    navigateToRental(finalStart, finalEnd)
  }

  // Popover change handlers that respect transition lock
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
    if (open) setActiveField('endDate')
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

  // Quick select handlers - always include times for pickup/dropoff
  const handleQuickSelect = (days: number) => {
    const start = addDays(today, 1)
    const end = addDays(start, days)
    const finalStart = buildStoreDate(start, '09:00', timezone)
    const finalEnd = buildStoreDate(end, '18:00', timezone)
    navigateToRental(finalStart, finalEnd)
  }

  const handleWeekendSelect = () => {
    const nextSaturday = startOfWeek(addWeeks(today, 1), { weekStartsOn: 6 })
    const nextSunday = addDays(nextSaturday, 1)
    const finalStart = buildStoreDate(nextSaturday, '09:00', timezone)
    const finalEnd = buildStoreDate(nextSunday, '18:00', timezone)
    navigateToRental(finalStart, finalEnd)
  }

  const handleNextWeekSelect = () => {
    const nextMonday = startOfWeek(addWeeks(today, 1), { weekStartsOn: 1 })
    const nextFriday = endOfWeek(nextMonday, { weekStartsOn: 1 })
    const finalStart = buildStoreDate(nextMonday, '09:00', timezone)
    const finalEnd = buildStoreDate(nextFriday, '18:00', timezone)
    navigateToRental(finalStart, finalEnd)
  }

  const handleHourQuickSelect = (hours: number) => {
    const start = new Date()
    start.setMinutes(0, 0, 0)
    start.setHours(start.getHours() + 1)
    const end = addHours(start, hours)
    navigateToRental(start, end)
  }

  // Calculate detailed duration for display (days + hours)
  const getDetailedDuration = () => {
    if (!startDate || !endDate) return null

    const start = buildStoreDate(new Date(startDate), startTime, timezone)
    const end = buildStoreDate(new Date(endDate), endTime, timezone)

    const diffMs = end.getTime() - start.getTime()
    if (diffMs <= 0) return null

    const totalMinutes = Math.floor(diffMs / (1000 * 60))
    const totalHours = Math.floor(totalMinutes / 60)
    const days = Math.floor(totalHours / 24)
    const hours = totalHours % 24

    if (pricingMode === 'hour') {
      return `${totalHours}h`
    }

    if (pricingMode === 'week') {
      const weeks = Math.ceil(days / 7)
      if (days % 7 === 0 && hours === 0) {
        return `${weeks} ${weeks > 1 ? t('durationWeeks') : t('durationWeek')}`
      }
      return `${days} ${days > 1 ? t('durationDays') : t('durationDay')}${hours > 0 ? ` ${t('and')} ${hours}h` : ''}`
    }

    // Day mode - show days and hours for optimization
    if (days === 0) {
      return `${hours}h`
    }
    if (hours === 0) {
      return `${days} ${days > 1 ? t('durationDays') : t('durationDay')}`
    }
    return `${days} ${days > 1 ? t('durationDays') : t('durationDay')} ${t('and')} ${hours}h`
  }

  const timezoneCity = useMemo(() => {
    if (!timezone) return null
    const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (browserTimezone === timezone) return null
    const city = timezone.split('/').pop()?.replace(/_/g, ' ')
    return city || timezone
  }, [timezone])

  // Check if we can submit - always require times
  const canSubmit = startDate && endDate && startTime && endTime

  // Handle manual submit - always include times
  const handleSubmit = () => {
    if (!canSubmit) return

    const finalStart = buildStoreDate(startDate!, startTime, timezone)
    const finalEnd = buildStoreDate(endDate!, endTime, timezone)
    navigateToRental(finalStart, finalEnd)
  }

  // Quick select options
  const quickSelectOptions = pricingMode === 'hour'
    ? [
        { label: t('quickSelect.today2h'), onClick: () => handleHourQuickSelect(2) },
        { label: t('quickSelect.today4h'), onClick: () => handleHourQuickSelect(4) },
        { label: t('quickSelect.halfDay'), onClick: () => handleHourQuickSelect(5) },
      ]
    : pricingMode === 'week'
      ? [
          { label: t('quickSelect.oneWeek'), onClick: () => handleQuickSelect(7) },
          { label: t('quickSelect.twoWeeks'), onClick: () => handleQuickSelect(14) },
          { label: t('quickSelect.oneMonth'), onClick: () => handleQuickSelect(30) },
        ]
      : [
          { label: t('quickSelect.thisWeekend'), onClick: handleWeekendSelect },
          { label: t('quickSelect.nextWeek'), onClick: handleNextWeekSelect },
          { label: t('quickSelect.twoWeeks'), onClick: () => handleQuickSelect(14) },
        ]

  // Progress indicator
  const steps = [
    { key: 'startDate', completed: !!startDate },
    { key: 'startTime', completed: !!startDate && !!startTime },
    { key: 'endDate', completed: !!endDate },
    { key: 'endTime', completed: !!endDate && !!endTime },
  ]

  // Time selector component - vertical scrollable list
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
    <ScrollArea className="h-64">
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
                  "w-full flex items-center justify-between px-4 py-2.5 rounded-md text-left transition-colors",
                  isSelected
                    ? "bg-primary text-primary-foreground"
                    : isDisabled
                      ? "text-muted-foreground/40 cursor-not-allowed"
                      : "hover:bg-muted"
                )}
              >
                <span className="font-medium">{time}</span>
                {isSelected && <Check className="h-4 w-4" />}
              </button>
            )
          })
        )}
      </div>
    </ScrollArea>
  )

  return (
    <div className="w-full max-w-4xl mx-auto">
      <div
        className="rounded-2xl border bg-card p-6 md:p-8 shadow-lg"
        style={{
          borderColor: `${primaryColor}20`,
          boxShadow: `0 4px 24px ${primaryColor}10`,
        }}
      >
        {/* Title */}
        <div className="text-center mb-6">
          <h2 className="text-xl md:text-2xl font-semibold flex items-center justify-center gap-2">
            <CalendarIcon className="h-6 w-6 text-primary" />
            {t('title')}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">{t('subtitle')}</p>
        </div>

        {/* Progress Indicator */}
        <div className="flex justify-center gap-2 mb-6">
          {steps.map((step, index) => (
            <div
              key={step.key}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300",
                index === 0 ? "w-8" : "w-6",
                step.completed
                  ? "bg-primary"
                  : activeField === step.key
                    ? "bg-primary/50"
                    : "bg-muted"
              )}
            />
          ))}
        </div>

        {/* Date/Time Selectors - Main Interface */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {/* Start Date/Time Column */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              {t('startLabel')}
              {startDate && startTime && (
                <Check className="h-3.5 w-3.5 text-primary" />
              )}
            </label>
            <div className={cn(
              "flex rounded-lg border-2 transition-all duration-200 overflow-hidden",
              activeField === 'startDate' || activeField === 'startTime'
                ? "border-primary shadow-sm"
                : startDate ? "border-primary/30" : "border-input"
            )}>
              {/* Start Date */}
              <Popover open={startDateOpen} onOpenChange={handleStartDateOpenChange}>
                <PopoverTrigger asChild>
                  <button
                    className={cn(
                      "flex-1 flex items-center gap-2 px-4 py-3 text-left hover:bg-muted/50 transition-colors",
                      !startDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="h-4 w-4 shrink-0" />
                    <span className="font-medium">
                      {startDate ? format(startDate, 'EEE d MMM', { locale: fr }) : t('startDate')}
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

              {/* Start Time */}
              <div className="w-px bg-border" />
              <Popover open={startTimeOpen} onOpenChange={handleStartTimeOpenChange}>
                <PopoverTrigger asChild>
                  <button
                    className={cn(
                      "flex items-center gap-2 px-4 py-3 hover:bg-muted/50 transition-colors min-w-[100px]",
                      activeField === 'startTime' && "bg-muted/30"
                    )}
                  >
                    <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="font-medium">{startTime}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-44 p-0" align="start">
                  <TimeSelector value={startTime} onSelect={handleStartTimeSelect} slots={startTimeSlots} />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* End Date/Time Column */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              {t('endLabel')}
              {endDate && endTime && (
                <Check className="h-3.5 w-3.5 text-primary" />
              )}
            </label>
            <div className={cn(
              "flex rounded-lg border-2 transition-all duration-200 overflow-hidden",
              activeField === 'endDate' || activeField === 'endTime'
                ? "border-primary shadow-sm"
                : endDate ? "border-primary/30" : "border-input"
            )}>
              {/* End Date */}
              <Popover open={endDateOpen} onOpenChange={handleEndDateOpenChange}>
                <PopoverTrigger asChild>
                  <button
                    className={cn(
                      "flex-1 flex items-center gap-2 px-4 py-3 text-left hover:bg-muted/50 transition-colors",
                      !endDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="h-4 w-4 shrink-0" />
                    <span className="font-medium">
                      {endDate ? format(endDate, 'EEE d MMM', { locale: fr }) : t('endDate')}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={endDate}
                    onSelect={handleEndDateSelect}
                    disabled={(date) => isDateDisabled(date) || (startDate ? date < startDate : false)}
                    locale={fr}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>

              {/* End Time */}
              <div className="w-px bg-border" />
              <Popover open={endTimeOpen} onOpenChange={handleEndTimeOpenChange}>
                <PopoverTrigger asChild>
                  <button
                    className={cn(
                      "flex items-center gap-2 px-4 py-3 hover:bg-muted/50 transition-colors min-w-[100px]",
                      activeField === 'endTime' && "bg-muted/30"
                    )}
                  >
                    <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="font-medium">{endTime}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-44 p-0" align="end">
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

        {/* Duration Display */}
        <AnimatePresence>
          {getDetailedDuration() && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="text-center mb-4"
            >
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium">
                <Clock className="h-4 w-4" />
                {getDetailedDuration()}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Submit Button */}
        <Button
          onClick={handleSubmit}
          disabled={!canSubmit}
          size="lg"
          className="w-full h-12 text-base group mb-6"
        >
          {t('viewAvailability')}
          <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
        </Button>

        {/* Timezone notice */}
        {timezoneCity && (
          <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground mb-6">
            <Globe className="h-3.5 w-3.5 shrink-0" />
            <span>{t('timezoneNotice', { city: timezoneCity })}</span>
          </div>
        )}

        {/* Quick Selections - Secondary */}
        <div className="border-t pt-4">
          <p className="text-xs text-muted-foreground text-center mb-3">
            {t('quickSelect.title')}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {quickSelectOptions.map((option, index) => (
              <Button
                key={index}
                variant="outline"
                size="sm"
                onClick={option.onClick}
                className="text-xs"
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
