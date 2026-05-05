'use client'

import * as React from 'react'
import { isValid, parse } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import { enUS, fr } from 'date-fns/locale'
import { CalendarIcon, Clock } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import {
  de,
  en,
  es,
  fr as chronoFr,
  it,
  ja,
  nl,
  pt,
  ru,
  sv,
  uk,
  zh,
  type ParsedResult,
  type ParsingOption,
} from 'chrono-node'

import {
  Button,
  Calendar,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@louez/ui'
import { cn } from '@louez/utils'

import { buildStoreDate } from '@/lib/utils/business-hours'
import { formatStoreDate } from '@/lib/utils/store-date'
import { getFieldError, useFieldContext } from '@/hooks/form/form-context'

type DateSuggestion = {
  label: string
  date: Date
}

type ChronoLocale = {
  parse: (
    text: string,
    ref?: Date,
    option?: ParsingOption,
  ) => ParsedResult[]
}

const CHRONO_LOCALES: Record<string, ChronoLocale> = {
  de,
  en,
  es,
  fr: chronoFr,
  it,
  ja,
  nl,
  pt,
  ru,
  sv,
  uk,
  zh,
}

export type ReservationDatePickerControlProps = {
  value: Date | undefined
  onChange: (date: Date | undefined) => void
  label?: string
  description?: string
  placeholder?: string
  disabled?: boolean
  disabledDates?: (date: Date) => boolean
  minTime?: string
  maxTime?: string
  timeStep?: number
  timezone?: string
  className?: string
  defaultTime?: string
  autoCloseOnTimeSelect?: boolean
  onAutoClose?: () => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  error?: string
  inputClassName?: string
  id?: string
  referenceDate?: Date
}

function generateTimeOptions(step = 30, minTime = '00:00', maxTime = '23:59') {
  const options: { value: string; label: string }[] = []
  const [minHour, minMinute] = minTime.split(':').map(Number)
  const [maxHour, maxMinute] = maxTime.split(':').map(Number)
  const minTotal = minHour * 60 + minMinute
  const maxTotal = maxHour * 60 + maxMinute

  for (let hour = 0; hour < 24; hour += 1) {
    for (let minute = 0; minute < 60; minute += step) {
      const total = hour * 60 + minute
      if (total < minTotal || total > maxTotal) continue

      const value = `${hour.toString().padStart(2, '0')}:${minute
        .toString()
        .padStart(2, '0')}`
      options.push({ value, label: value })
    }
  }

  return options
}

function parseExplicitDate(value: string, referenceDate: Date) {
  const formats = [
    'dd/MM/yyyy HH:mm',
    'dd/MM/yyyy H:mm',
    'dd/MM/yyyy',
    'dd-MM-yyyy HH:mm',
    'dd-MM-yyyy H:mm',
    'dd-MM-yyyy',
    'yyyy-MM-dd HH:mm',
    'yyyy-MM-dd H:mm',
    'yyyy-MM-dd',
  ]

  for (const format of formats) {
    const parsed = parse(value, format, referenceDate)
    if (isValid(parsed)) return parsed
  }

  return undefined
}

function getChronoLocale(locale: string) {
  const language = locale.toLowerCase().split('-')[0]
  return CHRONO_LOCALES[language] ?? en
}

function normalizeNaturalDateInput(value: string, locale: string) {
  const language = locale.toLowerCase().split('-')[0]
  if (language !== 'fr') return value

  return value.replace(/\b(ajrd|auj|ajd|aujd)\b/gi, "aujourd'hui")
}

function hasTimeIntent(value: string) {
  return (
    /\b(midi|noon|minuit|midnight)\b/i.test(value) ||
    /\b\d{1,2}([:.]\d{2})?\s?(am|pm)\b/i.test(value) ||
    /\b\d{1,2}\s?(h|heure|heures)\b/i.test(value) ||
    /\b(à|a|at|um|às|alle|om|kl)\s*\d{1,2}([:.h]\d{2})?\b/i.test(value)
  )
}

function applyFallbackTime(date: Date, input: string, fallbackTime: string, timezone?: string) {
  if (hasTimeIntent(input)) return date

  return buildStoreDate(date, fallbackTime, timezone)
}

function applyParsedFallbackTime(
  result: ParsedResult,
  input: string,
  fallbackTime: string,
  timezone?: string,
) {
  if (result.start.isCertain('hour')) return result.date()

  return applyFallbackTime(result.date(), input, fallbackTime, timezone)
}

function formatSuggestionLabel(result: ParsedResult, locale: string) {
  const label = result.text.trim()
  const language = locale.toLowerCase().split('-')[0]

  if (
    language === 'fr' &&
    result.start.isCertain('hour') &&
    /\b(à|a)\s*\d{1,2}$/.test(label) &&
    !/\b\d{1,2}\s?(h|heure|heures)$/.test(label)
  ) {
    return `${label}h`
  }

  return label
}

function formatReferenceDaySuggestionLabel(value: string, locale: string) {
  const label = value.trim()
  const language = locale.toLowerCase().split('-')[0]

  if (
    language === 'fr' &&
    /\b(à|a)\s*\d{1,2}$/.test(label) &&
    !/\b\d{1,2}\s?(h|heure|heures)$/.test(label)
  ) {
    return `${label}h`
  }

  return label
}

function parseReferenceDayDate(
  value: string,
  referenceDate: Date | undefined,
  fallbackTime: string,
  timezone?: string,
) {
  if (!referenceDate) return undefined

  const match = value
    .trim()
    .match(
      /^(?:le\s+)?(\d{1,2})(?:\s*(?:à|a|at)\s*(\d{1,2})(?:(?:[:h])(\d{2}))?\s*(?:h|heure|heures)?)?$/i,
    )
  if (!match) return undefined

  const day = Number(match[1])
  const hour = match[2] ? Number(match[2]) : undefined
  const minute = match[3] ? Number(match[3]) : 0
  if (day < 1 || day > 31) return undefined
  if (hour !== undefined && (hour < 0 || hour > 23)) return undefined
  if (minute < 0 || minute > 59) return undefined

  const referenceInTimezone = timezone
    ? toZonedTime(referenceDate, timezone)
    : referenceDate
  const dateInReferenceMonth = new Date(
    referenceInTimezone.getFullYear(),
    referenceInTimezone.getMonth(),
    day,
  )
  if (dateInReferenceMonth.getMonth() !== referenceInTimezone.getMonth()) {
    return undefined
  }

  const time =
    hour === undefined
      ? fallbackTime
      : `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`

  return buildStoreDate(dateInReferenceMonth, time, timezone)
}

function parseNaturalDates(value: string, locale: string, referenceDate?: Date) {
  return getChronoLocale(locale).parse(
    normalizeNaturalDateInput(value, locale),
    referenceDate ?? new Date(),
    {
      forwardDate: true,
    },
  )
}

function getCalendarNavigationBounds(selectedDate: Date | undefined) {
  const currentYear = new Date().getFullYear()
  const selectedYear = selectedDate?.getFullYear() ?? currentYear
  const startYear = Math.min(currentYear - 5, selectedYear - 5)
  const endYear = Math.max(currentYear + 10, selectedYear + 10)

  return {
    startMonth: new Date(startYear, 0),
    endMonth: new Date(endYear, 11),
  }
}

function isBeforeToday(date: Date) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return date < today
}

function parseManualDate(
  value: string,
  fallbackTime: string,
  locale: string,
  referenceDate?: Date,
  timezone?: string,
) {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const normalized = normalizeNaturalDateInput(trimmed, locale)

  const referenceDayDate = parseReferenceDayDate(
    normalized,
    referenceDate,
    fallbackTime,
    timezone,
  )
  if (referenceDayDate) return referenceDayDate

  const explicitDate = parseExplicitDate(normalized, referenceDate ?? new Date())
  if (explicitDate) {
    const time = hasTimeIntent(normalized)
      ? formatStoreDate(explicitDate, timezone, 'TIME_ONLY')
      : fallbackTime
    return buildStoreDate(explicitDate, time, timezone)
  }

  const suggestion = parseNaturalDates(normalized, locale, referenceDate)[0]
  if (!suggestion) return undefined

  return applyParsedFallbackTime(suggestion, normalized, fallbackTime, timezone)
}

export function ReservationDatePickerControl({
  value,
  onChange,
  label,
  description,
  placeholder,
  disabled = false,
  disabledDates,
  minTime = '00:00',
  maxTime = '23:59',
  timeStep = 30,
  timezone,
  className,
  defaultTime,
  autoCloseOnTimeSelect = false,
  onAutoClose,
  open: controlledOpen,
  onOpenChange,
  error,
  inputClassName,
  id,
  referenceDate,
}: ReservationDatePickerControlProps) {
  const t = useTranslations('common.dateTimePicker')
  const locale = useLocale()
  const dateLocale = locale === 'fr' ? fr : enUS
  const resolvedTimezone = timezone?.trim() || undefined
  const [inputValue, setInputValue] = React.useState('')
  const [isFocused, setIsFocused] = React.useState(false)
  const [internalOpen, setInternalOpen] = React.useState(false)
  const isControlled = controlledOpen !== undefined
  const isOpen = isControlled ? controlledOpen : internalOpen
  const setIsOpen = React.useCallback(
    (nextOpen: boolean) => {
      if (isControlled) {
        onOpenChange?.(nextOpen)
        return
      }
      setInternalOpen(nextOpen)
    },
    [isControlled, onOpenChange],
  )

  const timeOptions = React.useMemo(
    () => generateTimeOptions(timeStep, minTime, maxTime),
    [maxTime, minTime, timeStep],
  )

  const getDateInPickerTimezone = React.useCallback(
    (date: Date) => {
      if (!resolvedTimezone) return date
      try {
        return toZonedTime(date, resolvedTimezone)
      } catch {
        return date
      }
    },
    [resolvedTimezone],
  )

  const currentTime = value
    ? formatStoreDate(value, resolvedTimezone, 'TIME_ONLY', locale)
    : timeOptions[0]?.value || '00:00'

  const findClosestTimeSlot = React.useCallback(
    (target: string) => {
      const [targetHour, targetMinute] = target.split(':').map(Number)
      const targetTotal = targetHour * 60 + targetMinute
      let closest = timeOptions[0]?.value || '00:00'
      let closestDiff = Infinity

      for (const option of timeOptions) {
        const [hour, minute] = option.value.split(':').map(Number)
        const diff = Math.abs(hour * 60 + minute - targetTotal)
        if (diff < closestDiff) {
          closest = option.value
          closestDiff = diff
        }
      }

      return closest
    },
    [timeOptions],
  )

  const fallbackTime = value
    ? currentTime
    : defaultTime
      ? findClosestTimeSlot(defaultTime)
      : timeOptions[0]?.value || '00:00'

  const suggestions = React.useMemo<DateSuggestion[]>(() => {
    const query = inputValue.trim()
    if (!query) return []

    const referenceDayDate = parseReferenceDayDate(
      normalizeNaturalDateInput(query, locale),
      referenceDate,
      fallbackTime,
      resolvedTimezone,
    )
    if (referenceDayDate) {
      return [
        {
          label: formatReferenceDaySuggestionLabel(query, locale),
          date: referenceDayDate,
        },
      ]
    }

    return parseNaturalDates(query, locale, referenceDate)
      .map((result) => ({
        label: formatSuggestionLabel(result, locale),
        date: applyParsedFallbackTime(result, query, fallbackTime, resolvedTimezone),
      }))
      .filter((suggestion) => !Number.isNaN(suggestion.date.getTime()))
      .slice(0, 4)
  }, [fallbackTime, inputValue, locale, referenceDate, resolvedTimezone])

  const pickerDate = value ? getDateInPickerTimezone(value) : undefined
  const calendarNavigationBounds = React.useMemo(
    () => getCalendarNavigationBounds(pickerDate),
    [pickerDate],
  )
  const inputId = id ?? label
  const formattedValue = React.useCallback(
    (date: Date) => {
      const format = locale === 'fr' ? "PPP 'à' HH:mm" : "PPP 'at' HH:mm"
      return formatStoreDate(date, resolvedTimezone, format, locale)
    },
    [locale, resolvedTimezone],
  )

  React.useEffect(() => {
    if (isFocused) return

    setInputValue(value ? formattedValue(value) : '')
  }, [formattedValue, isFocused, value])

  const handleDateSelect = (selectedDate: Date | undefined) => {
    if (!selectedDate) {
      onChange(undefined)
      return
    }

    onChange(buildStoreDate(selectedDate, fallbackTime, resolvedTimezone))
  }

  const handleTimeChange = (time: string | null) => {
    if (!value || time === null) return

    onChange(buildStoreDate(getDateInPickerTimezone(value), time, resolvedTimezone))

    if (autoCloseOnTimeSelect) {
      setIsOpen(false)
      onAutoClose?.()
    }
  }

  const commitInput = () => {
    const parsed = parseManualDate(
      inputValue,
      fallbackTime,
      locale,
      referenceDate,
      resolvedTimezone,
    )
    if (!parsed) return

    onChange(parsed)
    setInputValue(formattedValue(parsed))
  }

  const applySuggestion = (suggestion: DateSuggestion) => {
    const parsed = parseManualDate(
      suggestion.label,
      fallbackTime,
      locale,
      referenceDate,
      resolvedTimezone,
    )
    const nextDate = parsed ?? suggestion.date
    onChange(nextDate)
    setInputValue(formattedValue(nextDate))
    setIsFocused(false)
  }

  return (
    <div className={cn('space-y-2 min-w-0', className)}>
      {label && (
        <Label htmlFor={inputId} data-error={Boolean(error)}>
          {label}
        </Label>
      )}
      <div className="relative">
        <Input
          id={inputId}
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          onBlur={() => {
            setIsFocused(false)
            commitInput()
          }}
          onFocus={() => setIsFocused(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commitInput()
              setIsFocused(false)
            }
          }}
          placeholder={placeholder ?? t('naturalPlaceholder')}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          className={cn(
            '[&_[data-slot=input]]:pr-12 py-0.5',
            inputClassName,
          )}
          nativeInput
        />
        {isFocused && suggestions.length > 0 && (
          <div className="border-border bg-popover text-popover-foreground absolute left-0 right-0 top-[calc(100%+0.375rem)] z-30 rounded-lg border p-1 shadow-lg">
            {suggestions.map((suggestion) => (
              <button
                key={`${suggestion.label}-${suggestion.date.toISOString()}`}
                type="button"
                className="hover:bg-accent flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applySuggestion(suggestion)}
              >
                <span className="truncate">{suggestion.label}</span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {formatStoreDate(suggestion.date, resolvedTimezone, 'P HH:mm', locale)}
                </span>
              </button>
            ))}
          </div>
        )}
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 rounded-md top-1/2 z-10 size-7 -translate-y-1/2"
                disabled={disabled}
                aria-label={t('select')}
              />
            }
          >
            <CalendarIcon className="h-4 w-4" />
          </PopoverTrigger>
          <PopoverContent sideOffset={12} className="w-auto p-0 *:data-[slot=popover-viewport]:py-0 " align="end">
            <Calendar
              mode="single"
              selected={pickerDate}
              defaultMonth={pickerDate}
              captionLayout="dropdown"
              startMonth={calendarNavigationBounds.startMonth}
              endMonth={calendarNavigationBounds.endMonth}
              modifiers={{ past: isBeforeToday }}
              modifiersClassNames={{ past: 'opacity-50' }}
              onSelect={handleDateSelect}
              disabled={disabledDates}
              initialFocus
              locale={dateLocale}
            />
            <div className="border-t p-3">
              <div className="flex items-center gap-2">
                <Clock className="text-muted-foreground h-4 w-4" />
                <Label className="text-sm font-medium">{t('time')}</Label>
                <Select
                  value={currentTime}
                  onValueChange={handleTimeChange}
                  disabled={!value}
                >
                  <SelectTrigger className="w-24">
                    <SelectValue placeholder="--:--">{currentTime}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {timeOptions.map((option) => (
                      <SelectItem
                        key={option.value}
                        value={option.value}
                        label={option.label}
                      >
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {!autoCloseOnTimeSelect && (
              <div className="flex justify-end border-t p-2">
                <Button type="button" onClick={() => setIsOpen(false)} disabled={!value}>
                  {t('confirm')}
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>
      {description && <p className="text-muted-foreground text-sm">{description}</p>}
      {error && <p className="text-destructive text-sm font-medium">{error}</p>}
    </div>
  )
}

export function FormReservationDatePicker({
  onChange,
  ...props
}: Omit<ReservationDatePickerControlProps, 'value' | 'onChange' | 'error'> & {
  onChange?: (date: Date | undefined) => void
}) {
  const field = useFieldContext<Date | undefined>()
  const error = field.state.meta.errors[0]

  return (
    <ReservationDatePickerControl
      {...props}
      value={field.state.value}
      onChange={(date) => {
        field.handleChange(date)
        onChange?.(date)
      }}
      error={error ? getFieldError(error) : undefined}
    />
  )
}
