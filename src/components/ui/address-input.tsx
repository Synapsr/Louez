'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { MapPin, Loader2, X, Search } from 'lucide-react'
import { useDebouncedCallback } from 'use-debounce'

import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { AddressMapModal } from '@/components/ui/address-map-modal'

interface AddressResult {
  label: string
  housenumber?: string
  street?: string
  postcode?: string
  city?: string
  context?: string
  latitude: number
  longitude: number
}

interface AddressInputProps {
  value?: string
  displayAddress?: string
  additionalInfo?: string
  latitude?: number | null
  longitude?: number | null
  onChange: (
    address: string,
    latitude: number | null,
    longitude: number | null,
    displayAddress?: string,
    additionalInfo?: string
  ) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function AddressInput({
  value = '',
  displayAddress = '',
  additionalInfo = '',
  latitude,
  longitude,
  onChange,
  placeholder,
  disabled,
  className,
}: AddressInputProps) {
  const t = useTranslations('common.addressInput')
  const [inputValue, setInputValue] = useState(value)
  const [suggestions, setSuggestions] = useState<AddressResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Sync with external value
  useEffect(() => {
    setInputValue(displayAddress || value)
  }, [value, displayAddress])

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const searchAddresses = useCallback(async (query: string) => {
    if (query.length < 3) {
      setSuggestions([])
      return
    }

    setIsLoading(true)
    try {
      // Use French government's address API (free, no API key required)
      const response = await fetch(
        `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&limit=5`
      )
      const data = await response.json()

      const results: AddressResult[] = data.features.map((feature: {
        properties: {
          label: string
          housenumber?: string
          street?: string
          postcode?: string
          city?: string
          context?: string
        }
        geometry: {
          coordinates: [number, number]
        }
      }) => ({
        label: feature.properties.label,
        housenumber: feature.properties.housenumber,
        street: feature.properties.street,
        postcode: feature.properties.postcode,
        city: feature.properties.city,
        context: feature.properties.context,
        longitude: feature.geometry.coordinates[0],
        latitude: feature.geometry.coordinates[1],
      }))

      setSuggestions(results)
      setIsOpen(results.length > 0)
      setSelectedIndex(-1)
    } catch (error) {
      console.error('Address search error:', error)
      setSuggestions([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  const debouncedSearch = useDebouncedCallback(searchAddresses, 300)

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setInputValue(newValue)
    debouncedSearch(newValue)

    // If user types manually, clear coordinates
    if (newValue !== value) {
      onChange(newValue, null, null, newValue, '')
    }
  }

  const handleSelect = (result: AddressResult) => {
    setInputValue(result.label)
    onChange(result.label, result.latitude, result.longitude, result.label, '')
    setSuggestions([])
    setIsOpen(false)
    inputRef.current?.blur()
  }

  const handleClear = () => {
    setInputValue('')
    onChange('', null, null, '', '')
    setSuggestions([])
    setIsOpen(false)
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex((prev) =>
          prev < suggestions.length - 1 ? prev + 1 : prev
        )
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1))
        break
      case 'Enter':
        e.preventDefault()
        if (selectedIndex >= 0 && suggestions[selectedIndex]) {
          handleSelect(suggestions[selectedIndex])
        }
        break
      case 'Escape':
        setIsOpen(false)
        setSelectedIndex(-1)
        break
    }
  }

  const handleModalSave = (data: {
    address: string
    displayAddress: string
    additionalInfo: string
    latitude: number | null
    longitude: number | null
  }) => {
    setInputValue(data.displayAddress || data.address)
    onChange(
      data.address,
      data.latitude,
      data.longitude,
      data.displayAddress,
      data.additionalInfo
    )
  }

  const hasCoordinates = latitude !== null && latitude !== undefined &&
                        longitude !== null && longitude !== undefined

  return (
    <>
      <div ref={containerRef} className={cn('relative', className)}>
        <div className="relative">
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => suggestions.length > 0 && setIsOpen(true)}
            placeholder={placeholder || t('placeholder')}
            disabled={disabled}
            className={cn(
              'pl-9',
              hasCoordinates ? 'pr-[4.5rem]' : inputValue ? 'pr-10' : 'pr-3'
            )}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            data-form-type="other"
            data-lpignore="true"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
            {isLoading && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
            {hasCoordinates && !isLoading && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-primary hover:text-primary hover:bg-primary/10"
                onClick={() => setIsModalOpen(true)}
                title={t('editLocation')}
              >
                <MapPin className="h-4 w-4" />
              </Button>
            )}
            {inputValue && !isLoading && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={handleClear}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Suggestions dropdown */}
        {isOpen && suggestions.length > 0 && (
          <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover p-1 shadow-md">
            {suggestions.map((result, index) => (
              <button
                key={`${result.latitude}-${result.longitude}`}
                type="button"
                onClick={() => handleSelect(result)}
                className={cn(
                  'flex w-full items-start gap-2 rounded-sm px-2 py-2 text-left text-sm transition-colors',
                  index === selectedIndex
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-accent hover:text-accent-foreground'
                )}
              >
                <Search className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{result.label}</p>
                  {result.context && (
                    <p className="text-xs text-muted-foreground truncate">
                      {result.context}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Address detail modal */}
      <AddressMapModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        address={value}
        displayAddress={displayAddress || value}
        additionalInfo={additionalInfo}
        latitude={latitude ?? null}
        longitude={longitude ?? null}
        onSave={handleModalSave}
      />
    </>
  )
}
