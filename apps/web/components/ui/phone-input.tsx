'use client'

import * as React from 'react'
import { cn } from '@louez/utils'
import { Input } from '@louez/ui'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@louez/ui'
import {
  COUNTRY_CODES,
  getCountriesSortedForDisplay,
  type CountryPhoneData,
} from '@/lib/sms/phone'

export interface PhoneInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value?: string
  onChange?: (value: string) => void
  defaultCountry?: string
}

/**
 * Parse a phone number to extract country and national number
 */
function parsePhoneNumber(phone: string): { country: string; nationalNumber: string } {
  if (!phone) return { country: 'FR', nationalNumber: '' }

  const cleaned = phone.replace(/\s/g, '')

  // Already has + prefix - try to detect country
  if (cleaned.startsWith('+')) {
    const digits = cleaned.slice(1)
    // Sort by code length descending to match longer codes first
    const sortedCountries = Object.entries(COUNTRY_CODES).sort(
      (a, b) => b[1].code.length - a[1].code.length
    )

    for (const [iso, data] of sortedCountries) {
      if (digits.startsWith(data.code)) {
        return {
          country: iso,
          nationalNumber: digits.slice(data.code.length),
        }
      }
    }
    // Unknown country code, return as-is with default country
    return { country: 'FR', nationalNumber: digits }
  }

  // Starts with 00 (international prefix)
  if (cleaned.startsWith('00')) {
    const digits = cleaned.slice(2)
    const sortedCountries = Object.entries(COUNTRY_CODES).sort(
      (a, b) => b[1].code.length - a[1].code.length
    )

    for (const [iso, data] of sortedCountries) {
      if (digits.startsWith(data.code)) {
        return {
          country: iso,
          nationalNumber: digits.slice(data.code.length),
        }
      }
    }
  }

  // National format - return without leading 0 if present
  const nationalNumber = cleaned.startsWith('0') ? cleaned.slice(1) : cleaned
  return { country: 'FR', nationalNumber }
}

/**
 * Format national number for display (add spaces for readability)
 */
function formatNationalNumber(number: string): string {
  // Remove non-digits
  const digits = number.replace(/\D/g, '')
  // Add space every 2 digits for readability
  return digits.replace(/(\d{2})(?=\d)/g, '$1 ').trim()
}

/**
 * PhoneInput component with country selector
 *
 * Features:
 * - Country dropdown with flags
 * - Auto-formats national numbers
 * - Outputs E.164 format (+33612345678)
 * - Handles various input formats (0612..., +33612..., 0033612...)
 */
const PhoneInput = React.forwardRef<HTMLInputElement, PhoneInputProps>(
  ({ className, value = '', onChange, defaultCountry = 'FR', disabled, ...props }, ref) => {
    const countries = React.useMemo(() => getCountriesSortedForDisplay(), [])

    // Parse initial value
    const parsed = React.useMemo(() => parsePhoneNumber(value), [value])
    const [selectedCountry, setSelectedCountry] = React.useState(parsed.country)
    const [nationalNumber, setNationalNumber] = React.useState(
      formatNationalNumber(parsed.nationalNumber)
    )

    // Update internal state when value changes externally
    React.useEffect(() => {
      const newParsed = parsePhoneNumber(value)
      setSelectedCountry(newParsed.country)
      setNationalNumber(formatNationalNumber(newParsed.nationalNumber))
    }, [value])

    const countryData = COUNTRY_CODES[selectedCountry] || COUNTRY_CODES.FR

    // Build E.164 formatted number and call onChange
    const emitChange = React.useCallback(
      (country: string, national: string) => {
        const digits = national.replace(/\D/g, '')
        if (!digits) {
          onChange?.('')
          return
        }
        const data = COUNTRY_CODES[country] || COUNTRY_CODES.FR
        onChange?.(`+${data.code}${digits}`)
      },
      [onChange]
    )

    const handleCountryChange = (iso: string | null) => {
      if (iso === null) return
      setSelectedCountry(iso)
      emitChange(iso, nationalNumber)
    }

    const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      let input = e.target.value

      // If user types leading 0, automatically remove it
      if (input.startsWith('0') && input.length > 1) {
        input = input.slice(1)
      }

      // Only allow digits and spaces
      const cleaned = input.replace(/[^\d\s]/g, '')
      const formatted = formatNationalNumber(cleaned.replace(/\s/g, ''))

      setNationalNumber(formatted)
      emitChange(selectedCountry, formatted)
    }

    return (
      <div className={cn('flex gap-2', className)}>
        <Select
          value={selectedCountry}
          onValueChange={handleCountryChange}
          disabled={disabled}
        >
          <SelectTrigger className="w-[100px] flex-shrink-0">
            <SelectValue>
              <span className="flex items-center gap-1.5">
                <span className="text-base leading-none">{countryData.flag}</span>
                <span className="text-muted-foreground">+{countryData.code}</span>
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {countries.map((country) => (
              <SelectItem key={country.iso} value={country.iso} label={`${country.flag} ${country.name} +${country.code}`}>
                <span className="flex items-center gap-2">
                  <span className="text-base leading-none">{country.flag}</span>
                  <span>{country.name}</span>
                  <span className="text-muted-foreground ml-auto">+{country.code}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          ref={ref}
          type="tel"
          inputMode="numeric"
          value={nationalNumber}
          onChange={handleNumberChange}
          disabled={disabled}
          className="flex-1"
          {...props}
        />
      </div>
    )
  }
)
PhoneInput.displayName = 'PhoneInput'

export { PhoneInput }
