'use client'

import * as React from 'react'
import { format, isSameDay, addDays } from 'date-fns'
import { fr, enUS } from 'date-fns/locale'
import { CalendarIcon, Clock, ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslations, useLocale } from 'next-intl'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Label } from '@/components/ui/label'

interface RentalDatePickerProps {
  startDate: Date | undefined
  endDate: Date | undefined
  onStartDateChange: (date: Date | undefined) => void
  onEndDateChange: (date: Date | undefined) => void
  pricingMode: 'day' | 'hour' | 'week'
  minDate?: Date
  className?: string
  translations?: {
    startDate: string
    endDate: string
    select: string
    selectTime: string
  }
}

// Time slots for hourly pricing
const TIME_SLOTS = [
  '08:00', '08:30', '09:00', '09:30', '10:00', '10:30',
  '11:00', '11:30', '12:00', '12:30', '13:00', '13:30',
  '14:00', '14:30', '15:00', '15:30', '16:00', '16:30',
  '17:00', '17:30', '18:00', '18:30', '19:00', '19:30', '20:00'
]

function TimeSelector({
  value,
  onChange,
  disabled,
  label,
}: {
  value?: string
  onChange: (time: string) => void
  disabled?: boolean
  label: string
}) {
  return (
    <div className="mt-3 border-t pt-3">
      <div className="flex items-center gap-2 mb-2">
        <Clock className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="grid grid-cols-5 gap-1 max-h-32 overflow-y-auto">
        {TIME_SLOTS.map((time) => (
          <Button
            key={time}
            variant={value === time ? 'default' : 'outline'}
            size="sm"
            className="text-xs h-7"
            onClick={() => onChange(time)}
            disabled={disabled}
          >
            {time}
          </Button>
        ))}
      </div>
    </div>
  )
}

export function RentalDatePicker({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  pricingMode,
  minDate = new Date(),
  className,
  translations: translationsProp,
}: RentalDatePickerProps) {
  const t = useTranslations('storefront.datePicker')
  const locale = useLocale()
  const dateLocale = locale === 'fr' ? fr : enUS

  const [startPopoverOpen, setStartPopoverOpen] = React.useState(false)
  const [endPopoverOpen, setEndPopoverOpen] = React.useState(false)

  const translations = translationsProp || {
    startDate: t('startDate'),
    endDate: t('endDate'),
    select: t('select'),
    selectTime: t('selectTime'),
  }

  const showTime = pricingMode === 'hour'

  // Get current time from date
  const getTimeFromDate = (date?: Date): string | undefined => {
    if (!date) return undefined
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
  }

  // Apply time to date
  const applyTimeToDate = (date: Date, time: string): Date => {
    const [hours, minutes] = time.split(':').map(Number)
    const newDate = new Date(date)
    newDate.setHours(hours, minutes, 0, 0)
    return newDate
  }

  // Handle start date selection
  const handleStartDateSelect = (date: Date | undefined) => {
    if (!date) {
      onStartDateChange(undefined)
      return
    }

    // Apply default time if hourly pricing
    if (showTime) {
      const currentTime = getTimeFromDate(startDate) || '09:00'
      date = applyTimeToDate(date, currentTime)
    } else {
      date.setHours(0, 0, 0, 0)
    }

    onStartDateChange(date)

    // Clear end date if it's before start date
    if (endDate && date > endDate) {
      onEndDateChange(undefined)
    }

    // If not hourly pricing, close popover after selection
    if (!showTime) {
      setStartPopoverOpen(false)
    }
  }

  // Handle end date selection
  const handleEndDateSelect = (date: Date | undefined) => {
    if (!date) {
      onEndDateChange(undefined)
      return
    }

    // Apply default time if hourly pricing
    if (showTime) {
      const currentTime = getTimeFromDate(endDate) || '18:00'
      date = applyTimeToDate(date, currentTime)
    } else {
      date.setHours(23, 59, 59, 999)
    }

    onEndDateChange(date)

    // If not hourly pricing, close popover after selection
    if (!showTime) {
      setEndPopoverOpen(false)
    }
  }

  // Handle start time change
  const handleStartTimeChange = (time: string) => {
    if (!startDate) return
    const newDate = applyTimeToDate(startDate, time)
    onStartDateChange(newDate)
  }

  // Handle end time change
  const handleEndTimeChange = (time: string) => {
    if (!endDate) return
    const newDate = applyTimeToDate(endDate, time)
    onEndDateChange(newDate)
  }

  // Format date for display
  const formatDateDisplay = (date: Date | undefined): string => {
    if (!date) return translations.select
    if (showTime) {
      const timeFormat = locale === 'fr' ? "d MMM 'à' HH:mm" : "d MMM 'at' HH:mm"
      return format(date, timeFormat, { locale: dateLocale })
    }
    return format(date, 'd MMMM yyyy', { locale: dateLocale })
  }

  // Use minDate prop for date validation (supports advance notice)
  const effectiveMinDate = React.useMemo(() => {
    const min = new Date(minDate)
    min.setHours(0, 0, 0, 0)
    return min
  }, [minDate])

  return (
    <div className={cn('grid sm:grid-cols-2 gap-4', className)}>
      {/* Start Date */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">{translations.startDate}</Label>
        <Popover open={startPopoverOpen} onOpenChange={setStartPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                'w-full justify-start text-left font-normal h-11',
                !startDate && 'text-muted-foreground'
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4 flex-shrink-0" />
              <span className="truncate">{formatDateDisplay(startDate)}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={startDate}
              onSelect={handleStartDateSelect}
              disabled={(date) => date < effectiveMinDate}
              locale={fr}
            />
            {showTime && (
              <div className="px-3 pb-3">
                <TimeSelector
                  value={getTimeFromDate(startDate)}
                  onChange={handleStartTimeChange}
                  disabled={!startDate}
                  label={translations.selectTime}
                />
                <Button
                  className="w-full mt-3"
                  size="sm"
                  onClick={() => setStartPopoverOpen(false)}
                  disabled={!startDate}
                >
                  Confirmer
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>

      {/* End Date */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">{translations.endDate}</Label>
        <Popover open={endPopoverOpen} onOpenChange={setEndPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                'w-full justify-start text-left font-normal h-11',
                !endDate && 'text-muted-foreground'
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4 flex-shrink-0" />
              <span className="truncate">{formatDateDisplay(endDate)}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={endDate}
              onSelect={handleEndDateSelect}
              disabled={(date) =>
                date < effectiveMinDate || (startDate ? date < startDate : false)
              }
              locale={fr}
            />
            {showTime && (
              <div className="px-3 pb-3">
                <TimeSelector
                  value={getTimeFromDate(endDate)}
                  onChange={handleEndTimeChange}
                  disabled={!endDate}
                  label={translations.selectTime}
                />
                <Button
                  className="w-full mt-3"
                  size="sm"
                  onClick={() => setEndPopoverOpen(false)}
                  disabled={!endDate}
                >
                  Confirmer
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}

// Quick date buttons for common rental durations
export function QuickDateButtons({
  onSelect,
  pricingMode,
  className,
}: {
  onSelect: (start: Date, end: Date) => void
  pricingMode: 'day' | 'hour' | 'week'
  className?: string
}) {
  const getQuickOptions = () => {
    const now = new Date()

    if (pricingMode === 'hour') {
      // For hourly: 2h, 4h, 8h (full day)
      return [
        {
          label: '2h',
          getRange: () => {
            const start = new Date()
            start.setMinutes(Math.ceil(start.getMinutes() / 30) * 30, 0, 0)
            const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
            return { start, end }
          },
        },
        {
          label: '4h',
          getRange: () => {
            const start = new Date()
            start.setMinutes(Math.ceil(start.getMinutes() / 30) * 30, 0, 0)
            const end = new Date(start.getTime() + 4 * 60 * 60 * 1000)
            return { start, end }
          },
        },
        {
          label: 'Journée',
          getRange: () => {
            const start = new Date()
            start.setHours(9, 0, 0, 0)
            if (start < new Date()) {
              start.setDate(start.getDate() + 1)
            }
            const end = new Date(start)
            end.setHours(18, 0, 0, 0)
            return { start, end }
          },
        },
      ]
    }

    if (pricingMode === 'week') {
      // For weekly: 1 week, 2 weeks, 1 month
      return [
        {
          label: '1 sem.',
          getRange: () => ({
            start: now,
            end: addDays(now, 7),
          }),
        },
        {
          label: '2 sem.',
          getRange: () => ({
            start: now,
            end: addDays(now, 14),
          }),
        },
        {
          label: '1 mois',
          getRange: () => ({
            start: now,
            end: addDays(now, 30),
          }),
        },
      ]
    }

    // For daily: Weekend, 1 week, 2 weeks
    return [
      {
        label: 'Week-end',
        getRange: () => {
          const start = new Date()
          const dayOfWeek = start.getDay()
          const daysUntilFriday = dayOfWeek <= 5 ? 5 - dayOfWeek : 6
          start.setDate(start.getDate() + daysUntilFriday)
          const end = new Date(start)
          end.setDate(end.getDate() + 2)
          return { start, end }
        },
      },
      {
        label: '1 sem.',
        getRange: () => ({
          start: now,
          end: addDays(now, 7),
        }),
      },
      {
        label: '2 sem.',
        getRange: () => ({
          start: now,
          end: addDays(now, 14),
        }),
      },
    ]
  }

  const options = getQuickOptions()

  return (
    <div className={cn('flex gap-2 flex-wrap', className)}>
      {options.map((option) => (
        <Button
          key={option.label}
          variant="outline"
          size="sm"
          onClick={() => {
            const { start, end } = option.getRange()
            onSelect(start, end)
          }}
        >
          {option.label}
        </Button>
      ))}
    </div>
  )
}
