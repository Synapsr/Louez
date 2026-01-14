'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { format, addDays, setHours, setMinutes } from 'date-fns'
import { fr } from 'date-fns/locale'
import { CalendarIcon, ArrowRight, Clock, Check, AlertCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useCart } from '@/contexts/cart-context'
import type { PricingMode } from '@/lib/utils/duration'
import type { BusinessHours } from '@/types/store'
import {
  isDateAvailable,
  getAvailableTimeSlots,
  generateTimeSlots,
} from '@/lib/utils/business-hours'

interface HeroDatePickerProps {
  storeSlug: string
  pricingMode: PricingMode
  businessHours?: BusinessHours
}

type ActiveField = 'startDate' | 'startTime' | 'endDate' | 'endTime' | null

const defaultTimeSlots = generateTimeSlots('07:00', '21:00', 30)

export function HeroDatePicker({
  storeSlug,
  pricingMode,
  businessHours,
}: HeroDatePickerProps) {
  const t = useTranslations('storefront.dateSelection')
  const tBusinessHours = useTranslations('storefront.dateSelection.businessHours')
  const router = useRouter()
  const searchParams = useSearchParams()
  const { setGlobalDates, setPricingMode, globalStartDate, globalEndDate } = useCart()

  const isTransitioningRef = useRef(false)

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

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const startTimeSlots = useMemo(() => {
    if (!startDate) return defaultTimeSlots
    return getAvailableTimeSlots(startDate, businessHours, 30)
  }, [startDate, businessHours])

  const endTimeSlots = useMemo(() => {
    if (!endDate) return defaultTimeSlots
    return getAvailableTimeSlots(endDate, businessHours, 30)
  }, [endDate, businessHours])

  const isDateDisabled = useCallback((date: Date): boolean => {
    if (date < today) return true
    if (!businessHours?.enabled) return false
    const availability = isDateAvailable(date, businessHours)
    return !availability.available
  }, [businessHours, today])

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

  const navigateToRental = useCallback((start: Date, end: Date) => {
    setGlobalDates(start.toISOString(), end.toISOString())
    const params = new URLSearchParams()
    params.set('startDate', start.toISOString())
    params.set('endDate', end.toISOString())
    router.push(`/${storeSlug}/rental?${params.toString()}`)
  }, [router, setGlobalDates, storeSlug])

  const handleStartDateSelect = (date: Date | undefined) => {
    if (!date) return
    setStartDate(date)
    setStartDateOpen(false)

    if (!endDate || date >= endDate) {
      setEndDate(addDays(date, 1))
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
      setEndDateOpen(true)
      setActiveField('endDate')
      isTransitioningRef.current = false
    }, 250)
  }

  const handleEndDateSelect = (date: Date | undefined) => {
    if (!date) return
    setEndDate(date)
    setEndDateOpen(false)

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

    const start = startDate!
    const [startH, startM] = startTime.split(':').map(Number)
    const finalStart = setMinutes(setHours(start, startH), startM)

    const end = endDate!
    const [endH, endM] = time.split(':').map(Number)
    const finalEnd = setMinutes(setHours(end, endH), endM)

    navigateToRental(finalStart, finalEnd)
  }

  const handleStartDateOpenChange = (open: boolean) => {
    if (isTransitioningRef.current) return
    setStartDateOpen(open)
    if (open) setActiveField('startDate')
  }

  const handleStartTimeOpenChange = (open: boolean) => {
    if (isTransitioningRef.current) return
    setStartTimeOpen(open)
    if (open) setActiveField('startTime')
  }

  const handleEndDateOpenChange = (open: boolean) => {
    if (isTransitioningRef.current) return
    setEndDateOpen(open)
    if (open) setActiveField('endDate')
  }

  const handleEndTimeOpenChange = (open: boolean) => {
    if (isTransitioningRef.current) return
    setEndTimeOpen(open)
    if (open) setActiveField('endTime')
  }

  const canSubmit = startDate && endDate && startTime && endTime

  const handleSubmit = () => {
    if (!canSubmit) return

    const [startH, startM] = startTime.split(':').map(Number)
    const finalStart = setMinutes(setHours(startDate!, startH), startM)
    const [endH, endM] = endTime.split(':').map(Number)
    const finalEnd = setMinutes(setHours(endDate!, endH), endM)
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
                  <PopoverTrigger asChild>
                    <button
                      className={cn(
                        "flex-1 flex items-center gap-2 px-3 text-left hover:bg-muted/50 transition-colors min-w-0",
                        !startDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="h-4 w-4 shrink-0 text-primary" />
                      <span className="font-medium text-sm truncate">
                        {startDate ? format(startDate, 'd MMM', { locale: fr }) : t('startDate')}
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

                <Popover open={startTimeOpen} onOpenChange={handleStartTimeOpenChange}>
                  <PopoverTrigger asChild>
                    <button className="flex items-center gap-1.5 px-3 hover:bg-muted/50 transition-colors shrink-0">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium text-sm">{startTime}</span>
                    </button>
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
                  <PopoverTrigger asChild>
                    <button
                      className={cn(
                        "flex-1 flex items-center gap-2 px-3 text-left hover:bg-muted/50 transition-colors min-w-0",
                        !endDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="h-4 w-4 shrink-0 text-primary" />
                      <span className="font-medium text-sm truncate">
                        {endDate ? format(endDate, 'd MMM', { locale: fr }) : t('endDate')}
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

                <div className="w-px bg-border my-2" />

                <Popover open={endTimeOpen} onOpenChange={handleEndTimeOpenChange}>
                  <PopoverTrigger asChild>
                    <button className="flex items-center gap-1.5 px-3 hover:bg-muted/50 transition-colors shrink-0">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium text-sm">{endTime}</span>
                    </button>
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
        </div>
      </div>
    </div>
  )
}
