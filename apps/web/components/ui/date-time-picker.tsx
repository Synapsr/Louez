'use client'

import * as React from 'react'
import { toZonedTime } from 'date-fns-tz'
import { fr, enUS } from 'date-fns/locale'
import { CalendarIcon, Clock } from 'lucide-react'
import { useTranslations, useLocale } from 'next-intl'

import { cn } from '@louez/utils'
import { Button } from '@louez/ui'
import { Calendar } from '@louez/ui'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@louez/ui'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@louez/ui'
import { Label } from '@louez/ui'
import { buildStoreDate } from '@/lib/utils/business-hours'
import { formatStoreDate } from '@/lib/utils/store-date'

interface DateTimePickerProps {
  date: Date | undefined
  setDate: (date: Date | undefined) => void
  placeholder?: string
  disabled?: boolean
  disabledDates?: (date: Date) => boolean
  showTime?: boolean
  minTime?: string // "HH:mm" format
  maxTime?: string // "HH:mm" format
  timeStep?: number // minutes
  className?: string
  timezone?: string
}

// Generate time options
function generateTimeOptions(step: number = 30, minTime?: string, maxTime?: string) {
  const options: { value: string; label: string }[] = []
  const [minHour, minMin] = minTime ? minTime.split(':').map(Number) : [0, 0]
  const [maxHour, maxMin] = maxTime ? maxTime.split(':').map(Number) : [23, 59]

  for (let hour = 0; hour < 24; hour++) {
    for (let min = 0; min < 60; min += step) {
      const totalMinutes = hour * 60 + min
      const minTotalMinutes = minHour * 60 + minMin
      const maxTotalMinutes = maxHour * 60 + maxMin

      if (totalMinutes >= minTotalMinutes && totalMinutes <= maxTotalMinutes) {
        const h = hour.toString().padStart(2, '0')
        const m = min.toString().padStart(2, '0')
        options.push({
          value: `${h}:${m}`,
          label: `${h}:${m}`,
        })
      }
    }
  }

  return options
}

export function DateTimePicker({
  date,
  setDate,
  placeholder,
  disabled = false,
  disabledDates,
  showTime = true,
  minTime = '08:00',
  maxTime = '20:00',
  timeStep = 30,
  className,
  timezone,
}: DateTimePickerProps) {
  const t = useTranslations('common.dateTimePicker')
  const locale = useLocale()
  const dateLocale = locale === 'fr' ? fr : enUS
  const resolvedTimezone = timezone?.trim() || undefined

  const [isOpen, setIsOpen] = React.useState(false)
  const timeOptions = React.useMemo(
    () => generateTimeOptions(timeStep, minTime, maxTime),
    [timeStep, minTime, maxTime]
  )

  const actualPlaceholder = placeholder || t('select')

  const getDateInPickerTimezone = React.useCallback(
    (value: Date) => {
      if (!resolvedTimezone) return value
      try {
        return toZonedTime(value, resolvedTimezone)
      } catch {
        return value
      }
    },
    [resolvedTimezone]
  )

  const getTimeFromDate = React.useCallback(
    (value: Date) => {
      return formatStoreDate(value, resolvedTimezone, 'TIME_ONLY', locale)
    },
    [locale, resolvedTimezone]
  )

  const pickerDate = React.useMemo(
    () => (date ? getDateInPickerTimezone(date) : undefined),
    [date, getDateInPickerTimezone]
  )

  const currentTime = date
    ? getTimeFromDate(date)
    : timeOptions[0]?.value || '08:00'

  const handleDateSelect = (selectedDate: Date | undefined) => {
    if (!selectedDate) {
      setDate(undefined)
      return
    }

    const time = date ? getTimeFromDate(date) : timeOptions[0]?.value || '08:00'
    setDate(buildStoreDate(selectedDate, time, resolvedTimezone))
  }

  const handleTimeChange = (time: string | null) => {
    if (!date || time === null) return

    const [hours, minutes] = time.split(':').map(Number)
    const pickerDateForTime = getDateInPickerTimezone(date)
    const normalizedTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
    setDate(buildStoreDate(pickerDateForTime, normalizedTime, resolvedTimezone))
  }

  const formatDateTime = (d: Date) => {
    if (showTime) {
      const timeFormat = locale === 'fr' ? "PPP 'à' HH:mm" : "PPP 'at' HH:mm"
      return formatStoreDate(d, resolvedTimezone, timeFormat, locale)
    }
    return formatStoreDate(d, resolvedTimezone, 'PPP', locale)
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger render={<Button
          variant="outline"
          className={cn(
            'w-full justify-start text-left font-normal',
            !date && 'text-muted-foreground',
            className
          )}
          disabled={disabled}
        />}>
          <CalendarIcon className="mr-2 h-4 w-4" />
          {date ? formatDateTime(date) : actualPlaceholder}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={pickerDate}
          onSelect={handleDateSelect}
          disabled={disabledDates}
          initialFocus
          locale={dateLocale}
        />
        {showTime && (
          <div className="border-t p-3">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <Label className="text-sm font-medium">{t('time')}</Label>
              <Select
                value={currentTime}
                onValueChange={handleTimeChange}
                disabled={!date}
              >
                <SelectTrigger className="w-24">
                  <SelectValue placeholder="--:--">
                    {currentTime}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {timeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value} label={option.label}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
        <div className="border-t p-2 flex justify-end">
          <Button
            onClick={() => setIsOpen(false)}
            disabled={!date}
          >
            {t('confirm')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// Simple date picker without time for backward compatibility
export function DatePicker({
  date,
  setDate,
  placeholder,
  disabled = false,
  disabledDates,
  className,
  timezone,
}: Omit<DateTimePickerProps, 'showTime' | 'minTime' | 'maxTime' | 'timeStep'>) {
  return (
    <DateTimePicker
      date={date}
      setDate={setDate}
      placeholder={placeholder}
      disabled={disabled}
      disabledDates={disabledDates}
      showTime={false}
      className={className}
      timezone={timezone}
    />
  )
}
