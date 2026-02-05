'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import Image from 'next/image'
import { Search, Star, Loader2, X, Building2, Check } from 'lucide-react'
import { Input } from '@louez/ui'
import { Button } from '@louez/ui'
import { cn } from '@louez/utils'
import { searchGooglePlaces, fetchGooglePlaceDetails } from './actions'
import type { PlaceSearchResult } from '@/lib/google-places'

interface GooglePlaceSearchProps {
  selectedPlace: {
    placeId: string | null
    name: string | null
    address: string | null
    rating: number | null
    reviewCount: number | null
  }
  onPlaceSelect: (place: {
    placeId: string
    name: string
    address: string
    rating: number | null
    reviewCount: number | null
  }) => void
  onPlaceClear: () => void
  disabled?: boolean
}

export function GooglePlaceSearch({
  selectedPlace,
  onPlaceSelect,
  onPlaceClear,
  disabled = false,
}: GooglePlaceSearchProps) {
  const t = useTranslations('dashboard.settings.reviewBooster')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PlaceSearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [isLoadingDetails, setIsLoadingDetails] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSearch = useCallback(async (searchQuery: string) => {
    if (searchQuery.length < 2) {
      setResults([])
      setIsOpen(false)
      return
    }

    setIsSearching(true)
    try {
      const response = await searchGooglePlaces(searchQuery)
      if (response.results) {
        setResults(response.results)
        setIsOpen(response.results.length > 0)
      }
    } catch (error) {
      console.error('Error searching places:', error)
    } finally {
      setIsSearching(false)
    }
  }, [])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setQuery(value)

    // Debounce search
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }
    debounceRef.current = setTimeout(() => {
      handleSearch(value)
    }, 300)
  }

  const handleSelectPlace = async (place: PlaceSearchResult) => {
    setIsLoadingDetails(true)
    setIsOpen(false)
    setQuery('')

    try {
      // Fetch full details including reviews
      const response = await fetchGooglePlaceDetails(place.placeId)
      if (response.details) {
        onPlaceSelect({
          placeId: response.details.placeId,
          name: response.details.name,
          address: response.details.address,
          rating: response.details.rating,
          reviewCount: response.details.reviewCount,
        })
      } else {
        // Fallback to search result data
        onPlaceSelect({
          placeId: place.placeId,
          name: place.name,
          address: place.address,
          rating: place.rating || null,
          reviewCount: place.reviewCount || null,
        })
      }
    } catch (error) {
      console.error('Error fetching place details:', error)
      // Fallback to search result data
      onPlaceSelect({
        placeId: place.placeId,
        name: place.name,
        address: place.address,
        rating: place.rating || null,
        reviewCount: place.reviewCount || null,
      })
    } finally {
      setIsLoadingDetails(false)
    }
  }

  // If a place is already selected, show the selected place card
  if (selectedPlace.placeId) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 flex-shrink-0">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h4 className="font-medium truncate">{selectedPlace.name}</h4>
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500/10 flex-shrink-0">
                  <Check className="h-3 w-3 text-green-600" />
                </div>
              </div>
              <p className="text-sm text-muted-foreground truncate">
                {selectedPlace.address}
              </p>
              {selectedPlace.rating && (
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex items-center gap-1">
                    <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                    <span className="text-sm font-medium">{selectedPlace.rating.toFixed(1)}</span>
                  </div>
                  {selectedPlace.reviewCount && (
                    <span className="text-sm text-muted-foreground">
                      ({selectedPlace.reviewCount} {t('reviews')})
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onPlaceClear}
            disabled={disabled}
            className="flex-shrink-0"
          >
            {t('changePlace')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          type="text"
          placeholder={t('searchPlaceholder')}
          value={query}
          onChange={handleInputChange}
          onFocus={() => results.length > 0 && setIsOpen(true)}
          disabled={disabled || isLoadingDetails}
          className="pl-10 pr-10"
        />
        {(isSearching || isLoadingDetails) && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
        {query && !isSearching && !isLoadingDetails && (
          <button
            type="button"
            onClick={() => {
              setQuery('')
              setResults([])
              setIsOpen(false)
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Dropdown results */}
      {isOpen && results.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-50 mt-1 w-full rounded-lg border bg-popover shadow-lg"
        >
          <ul className="py-1">
            {results.map((place) => (
              <li key={place.placeId}>
                <button
                  type="button"
                  onClick={() => handleSelectPlace(place)}
                  className="w-full px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    {place.photoUrl ? (
                      <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-muted">
                        <Image
                          src={place.photoUrl}
                          alt={place.name}
                          fill
                          className="object-cover"
                          unoptimized
                        />
                      </div>
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted flex-shrink-0">
                        <Building2 className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{place.name}</p>
                      <p className="text-sm text-muted-foreground truncate">
                        {place.address}
                      </p>
                      {place.rating && (
                        <div className="flex items-center gap-1 mt-1">
                          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                          <span className="text-xs">{place.rating.toFixed(1)}</span>
                          {place.reviewCount && (
                            <span className="text-xs text-muted-foreground">
                              ({place.reviewCount})
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* No results message */}
      {isOpen && results.length === 0 && query.length >= 2 && !isSearching && (
        <div
          ref={dropdownRef}
          className="absolute z-50 mt-1 w-full rounded-lg border bg-popover p-4 shadow-lg"
        >
          <p className="text-sm text-muted-foreground text-center">
            {t('noResults')}
          </p>
        </div>
      )}
    </div>
  )
}
