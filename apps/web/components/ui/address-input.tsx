'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Loader2, MapPin, Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useDebouncedCallback } from 'use-debounce';

import type { AddressSuggestion } from '@louez/types';
import { Input } from '@louez/ui';
import { Button } from '@louez/ui';
import { cn } from '@louez/utils';

import { AddressMapModal } from '@/components/ui/address-map-modal';

interface AddressInputProps {
  value?: string;
  displayAddress?: string;
  additionalInfo?: string;
  latitude?: number | null;
  longitude?: number | null;
  onChange: (
    address: string,
    latitude: number | null,
    longitude: number | null,
    displayAddress?: string,
    additionalInfo?: string,
  ) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
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
  const t = useTranslations('common.addressInput');
  const [inputValue, setInputValue] = useState(value);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync with external value
  useEffect(() => {
    setInputValue(displayAddress || value);
  }, [value, displayAddress]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const searchAddresses = useCallback(async (query: string) => {
    if (query.length < 3) {
      setSuggestions([]);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(
        `/api/address/autocomplete?query=${encodeURIComponent(query)}`,
      );
      const data = await response.json();
      setSuggestions(data.suggestions || []);
      setIsOpen((data.suggestions || []).length > 0);
      setSelectedIndex(-1);
    } catch (error) {
      console.error('Address search error:', error);
      setSuggestions([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const debouncedSearch = useDebouncedCallback(searchAddresses, 300);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    debouncedSearch(newValue);

    // If user types manually, clear coordinates
    if (newValue !== value) {
      onChange(newValue, null, null, newValue, '');
    }
  };

  const handleSelect = async (suggestion: AddressSuggestion) => {
    setIsLoading(true);
    try {
      const response = await fetch(
        `/api/address/details?placeId=${encodeURIComponent(suggestion.placeId)}`,
      );
      const data = await response.json();

      if (data.details) {
        const {
          formattedAddress,
          latitude: lat,
          longitude: lng,
        } = data.details;
        setInputValue(formattedAddress);
        onChange(formattedAddress, lat, lng, formattedAddress, '');
      } else {
        setInputValue(suggestion.description);
        onChange(
          suggestion.description,
          null,
          null,
          suggestion.description,
          '',
        );
      }
    } catch (error) {
      console.error('Error fetching address details:', error);
      setInputValue(suggestion.description);
      onChange(suggestion.description, null, null, suggestion.description, '');
    } finally {
      setSuggestions([]);
      setIsOpen(false);
      setIsLoading(false);
      inputRef.current?.blur();
    }
  };

  const handleClear = () => {
    setInputValue('');
    onChange('', null, null, '', '');
    setSuggestions([]);
    setIsOpen(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < suggestions.length - 1 ? prev + 1 : prev,
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && suggestions[selectedIndex]) {
          handleSelect(suggestions[selectedIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setSelectedIndex(-1);
        break;
    }
  };

  const handleModalSave = (data: {
    address: string;
    displayAddress: string;
    additionalInfo: string;
    latitude: number | null;
    longitude: number | null;
  }) => {
    setInputValue(data.displayAddress || data.address);
    onChange(
      data.address,
      data.latitude,
      data.longitude,
      data.displayAddress,
      data.additionalInfo,
    );
  };

  const hasCoordinates =
    latitude !== null &&
    latitude !== undefined &&
    longitude !== null &&
    longitude !== undefined;

  return (
    <>
      <div ref={containerRef} className={cn('relative', className)}>
        <div className="relative">
          <MapPin className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => suggestions.length > 0 && setIsOpen(true)}
            placeholder={placeholder || t('placeholder')}
            disabled={disabled}
            className={cn(inputValue ? 'pr-[4.5rem]' : 'pr-10')}
            autoComplete="one-time-code"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-form-type="other"
            data-lpignore="true"
          />
          <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-0.5">
            {isLoading && (
              <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
            )}
            {!isLoading && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  'h-7 w-7',
                  hasCoordinates
                    ? 'text-primary hover:text-primary hover:bg-primary/10'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                )}
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
                className="text-muted-foreground hover:text-foreground h-7 w-7"
                onClick={handleClear}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Suggestions dropdown */}
        {isOpen && suggestions.length > 0 && (
          <div className="bg-popover absolute z-50 mt-1 w-full rounded-md border p-1 shadow-md">
            {suggestions.map((suggestion, index) => (
              <button
                key={suggestion.placeId}
                type="button"
                onClick={() => handleSelect(suggestion)}
                className={cn(
                  'flex w-full items-start gap-2 rounded-sm px-2 py-2 text-left text-sm transition-colors',
                  index === selectedIndex
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-accent hover:text-accent-foreground',
                )}
              >
                <Search className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{suggestion.mainText}</p>
                  {suggestion.secondaryText && (
                    <p className="text-muted-foreground truncate text-xs">
                      {suggestion.secondaryText}
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
  );
}
