'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { useQueryClient } from '@tanstack/react-query';
import { Loader2, MapPin, Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { createPortal } from 'react-dom';
import { useDebouncedCallback } from 'use-debounce';

import type { AddressDetails, AddressSuggestion } from '@louez/types';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@louez/ui';
import { cn } from '@louez/utils';

import { AddressMapModal } from '@/components/ui/address-map-modal';
import {
  fetchWithinBound,
  isGivenUp,
  withinRequestBound,
} from '@/components/ui/util.address-input';

import { orpc } from '@/lib/orpc/react';

export interface AddressInputSource {
  search: (query: string) => AddressSuggestion[] | Promise<AddressSuggestion[]>;
  /** The address of a suggestion the person picked. */
  details: (placeId: string) => AddressDetails | null | Promise<AddressDetails | null>;
}

interface AddressInputProps {
  id?: string;
  name?: string;
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
  ariaInvalid?: boolean;
  showMapPicker?: boolean;
  onBlur?: () => void;
  onAddressResolved?: (details: AddressDetails) => void;
  /**
   * Whether what depends on this address needs its coordinates (a delivery
   * fee, a store's location). They come only from what the person chose: a
   * suggestion picked from the list, the map, or an address set from outside.
   * Typed text is never replaced by a best match; the field asks for a choice
   * and offers the suggestions for that text again. Off (an address kept as
   * typed), it does neither.
   */
  needsCoordinates?: boolean;
  /**
   * Whether the field says under itself that an address must be chosen. Off
   * when the form says it in its own words, as an error of its own.
   */
  showChoiceHint?: boolean;
  /** Supplied address service; when present, no remote lookup is performed. */
  source?: AddressInputSource;
  /** Whether clearing the field may return focus to the input. */
  autoFocus?: boolean;
  /**
   * Browser autofill token, such as `address-line1`. Without it, browsers and
   * password managers are kept away so they do not cover the suggestions.
   */
  autoComplete?: string;
  /**
   * Values that go with the address, such as its postal code and city: a
   * change from anywhere voids the answers still pending, as an edit does.
   */
  relatedValues?: readonly string[];
}

export const AddressInput = ({
  id,
  name,
  value = '',
  displayAddress = '',
  additionalInfo = '',
  latitude,
  longitude,
  onChange,
  placeholder,
  disabled,
  className,
  ariaInvalid,
  showMapPicker = true,
  onBlur,
  onAddressResolved,
  needsCoordinates = true,
  showChoiceHint = true,
  source,
  autoFocus = true,
  autoComplete,
  relatedValues,
}: AddressInputProps) => {
  const t = useTranslations('common.addressInput');
  const queryClient = useQueryClient();
  const [inputValue, setInputValueState] = useState(value);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  // The spinner belongs to the request that last started one: an earlier
  // request that settles later never hides it.
  const [loadingRequest, setLoadingRequest] = useState<number | null>(null);
  const isLoading = loadingRequest !== null;
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const hintId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  // A pointer press on a suggestion blurs the input before its click lands:
  // the list must still be there for it.
  const isPressingSuggestionRef = useRef(false);
  const lastRequestRef = useRef(0);
  // Every write to the field (an edit, a clear, a pick, a value or a related
  // value set from outside, the field unmounting) moves this on; an
  // answer asked before it moved on is dropped, success or failure.
  const writeGenerationRef = useRef(0);
  const pickInFlightRef = useRef<number | null>(null);
  // The text the current suggestion list answers.
  const suggestionsTextRef = useRef<string | null>(null);
  // The text the field shows, and whether it is still there: a suggestion
  // list answers one text of a mounted field.
  const inputTextRef = useRef(value);
  const unmountedRef = useRef(false);
  // Aborted with the field: its requests stop waiting, their timers cleared.
  const lifetimeRef = useRef<AbortController | null>(null);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Writes the text the field shows; the ref moves at once, before React commits. */
  const setInputValue = (text: string) => {
    inputTextRef.current = text;
    setInputValueState(text);
  };
  const emittedTextRef = useRef<string | null>(null);
  const relatedKey = JSON.stringify(relatedValues ?? []);
  const relatedKeyRef = useRef(relatedKey);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  const startLoading = () => {
    const request = ++lastRequestRef.current;
    setLoadingRequest(request);
    return request;
  };
  const stopLoading = (request: number) =>
    setLoadingRequest((current) => (current === request ? null : current));

  /** Marks a write: answers asked before it no longer apply. */
  const claimWrite = () => {
    const generation = ++writeGenerationRef.current;
    return () => writeGenerationRef.current === generation;
  };

  const emitChange: typeof onChange = (address, lat, lng, display, info) => {
    emittedTextRef.current = display || address;
    onChange(address, lat, lng, display, info);
  };

  // A text or a related value set from outside (a located address, a reset)
  // is a write too, counted as soon as it is committed.
  useLayoutEffect(() => {
    const text = displayAddress || value;
    if (text !== emittedTextRef.current) {
      emittedTextRef.current = text;
      writeGenerationRef.current += 1;
    }
  }, [value, displayAddress]);
  useLayoutEffect(() => {
    if (relatedKey !== relatedKeyRef.current) {
      relatedKeyRef.current = relatedKey;
      writeGenerationRef.current += 1;
    }
  }, [relatedKey]);
  // Once unmounted, the field waits for nothing: its pending answers are
  // void, and none of its timers is left to run.
  useEffect(() => {
    unmountedRef.current = false;
    const lifetime = new AbortController();
    lifetimeRef.current = lifetime;
    return () => {
      unmountedRef.current = true;
      writeGenerationRef.current += 1;
      lifetime.abort();
      if (blurTimerRef.current !== null) clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    inputTextRef.current = inputValue;
  }, [inputValue]);

  // Sync with external value
  useEffect(() => {
    setInputValue(displayAddress || value);
  }, [value, displayAddress]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node) &&
        (!dropdownRef.current ||
          !dropdownRef.current.contains(event.target as Node))
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Position the portal dropdown relative to the input
  useEffect(() => {
    if (!isOpen || suggestions.length === 0 || !containerRef.current) return;

    const updatePosition = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setDropdownStyle({
        position: 'fixed',
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
        zIndex: 9999,
      });
    };

    updatePosition();

    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen, suggestions.length]);

  const searchAddresses = useCallback(
    async (query: string) => {
      if (query.length < 3) {
        setSuggestions([]);
        return;
      }

      // A suggestion list answers one text: it changes the list only while
      // the field, still mounted, shows that text. A related value changing
      // does not void it: the street's suggestions are still the street's.
      const isCurrent = () => !unmountedRef.current && inputTextRef.current === query;
      const request = startLoading();
      try {
        const signal = lifetimeRef.current?.signal;
        const search = orpc.public.address.autocomplete.queryOptions({ input: { query } });
        const data = source
          ? { suggestions: await withinRequestBound(source.search(query), { signal }) }
          : await fetchWithinBound(
              queryClient,
              search.queryKey,
              () => queryClient.fetchQuery(search),
              signal,
            );
        if (!isCurrent()) return;
        suggestionsTextRef.current = query;
        setSuggestions(data.suggestions || []);
        setIsOpen((data.suggestions || []).length > 0);
        setSelectedIndex(-1);
      } catch (error) {
        if (!unmountedRef.current) console.error('Address search error:', error);
        // Failed or given up: the field is back to no list, so Enter or a
        // focus searches the text again.
        if (isCurrent()) {
          setSuggestions([]);
          setIsOpen(false);
        }
      } finally {
        stopLoading(request);
      }
    },
    [queryClient, source],
  );

  const debouncedSearch = useDebouncedCallback(searchAddresses, 300);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    claimWrite();
    setInputValue(newValue);
    debouncedSearch(newValue);

    // If user types manually, clear coordinates
    if (newValue !== value) {
      emitChange(newValue, null, null, newValue, '');
    }
  };

  const handleSelect = useCallback(
    async (suggestion: AddressSuggestion) => {
      const isCurrent = claimWrite();
      const generation = writeGenerationRef.current;
      pickInFlightRef.current = generation;
      const request = startLoading();
      const keepDescription = () => {
        setInputValue(suggestion.description);
        emitChange(
          suggestion.description,
          null,
          null,
          suggestion.description,
          '',
        );
      };
      try {
        const signal = lifetimeRef.current?.signal;
        const lookup = orpc.public.address.details.queryOptions({
          input: { placeId: suggestion.placeId },
        });
        const data = source
          ? { details: await withinRequestBound(source.details(suggestion.placeId), { signal }) }
          : await fetchWithinBound(
              queryClient,
              lookup.queryKey,
              () => queryClient.fetchQuery(lookup),
              signal,
            );

        if (!isCurrent()) return;
        if (data.details) {
          const {
            formattedAddress,
            latitude: lat,
            longitude: lng,
          } = data.details;
          setInputValue(formattedAddress);
          emitChange(formattedAddress, lat, lng, formattedAddress, '');
          onAddressResolved?.(data.details);
        } else {
          keepDescription();
        }
      } catch (error) {
        if (!unmountedRef.current || !isGivenUp(error)) {
          console.error('Error fetching address details:', error);
        }
        if (isCurrent()) keepDescription();
      } finally {
        stopLoading(request);
        if (pickInFlightRef.current === generation) {
          pickInFlightRef.current = null;
        }
        if (isCurrent()) {
          setSuggestions([]);
          setIsOpen(false);
          inputRef.current?.blur();
        }
      }
    },
    [onAddressResolved, onChange, queryClient, source],
  );

  const handleClear = () => {
    claimWrite();
    setInputValue('');
    emitChange('', null, null, '', '');
    setSuggestions([]);
    setIsOpen(false);
    if (autoFocus) inputRef.current?.focus();
  };

  const hasCoordinates =
    latitude !== null &&
    latitude !== undefined &&
    longitude !== null &&
    longitude !== undefined;
  // Text the person typed, or that was set without a place: nothing chosen yet.
  const needsChoice = needsCoordinates && inputValue.trim() !== '' && !hasCoordinates;

  /** Shows the suggestions for the text the field holds, searching them if needed. */
  const offerSuggestions = () => {
    if (pickInFlightRef.current === writeGenerationRef.current) return;
    if (suggestions.length > 0 && suggestionsTextRef.current === inputTextRef.current) {
      setIsOpen(true);
      return;
    }
    debouncedSearch.cancel();
    void searchAddresses(inputTextRef.current);
  };

  const handleFocus = () => {
    setIsFocused(true);
    if (needsChoice) offerSuggestions();
    else if (suggestions.length > 0) setIsOpen(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // The list counts as open only while it shows suggestions.
    if (!isOpen || suggestions.length === 0) {
      if (e.key === 'Enter' && needsCoordinates) {
        // Enter never sends a form from here: it shows what can be chosen.
        e.preventDefault();
        if (needsChoice) offerSuggestions();
      }
      return;
    }

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

  // Leaving the field closes its list and keeps what it holds: the text the
  // person typed is never looked up and replaced.
  const handleBlur = () => {
    onBlur?.();
    setIsFocused(false);

    if (blurTimerRef.current !== null) clearTimeout(blurTimerRef.current);
    blurTimerRef.current = setTimeout(() => {
      blurTimerRef.current = null;
      if (isPressingSuggestionRef.current) {
        isPressingSuggestionRef.current = false;
        return;
      }
      setIsOpen(false);
    }, 120);
  };

  const handleModalSave = (data: {
    address: string;
    displayAddress: string;
    additionalInfo: string;
    latitude: number | null;
    longitude: number | null;
  }) => {
    claimWrite();
    setInputValue(data.displayAddress || data.address);
    emitChange(
      data.address,
      data.latitude,
      data.longitude,
      data.displayAddress,
      data.additionalInfo,
    );
  };

  const showsChoiceHint =
    showChoiceHint && needsChoice && !disabled && !isFocused && !isLoading;

  return (
    <>
      <div ref={containerRef} className={cn('relative', className)}>
        <InputGroup>
          <InputGroupInput
            ref={inputRef}
            id={id}
            name={name}
            data-address-input={name}
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            onFocus={handleFocus}
            placeholder={placeholder || t('placeholder')}
            disabled={disabled}
            aria-invalid={ariaInvalid}
            aria-describedby={showsChoiceHint ? hintId : undefined}
            autoComplete={autoComplete ?? 'one-time-code'}
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            {...(autoComplete
              ? {}
              : { 'data-form-type': 'other', 'data-lpignore': 'true' })}
          />
          <InputGroupAddon align="inline-end" className="gap-0.5 py-1">
            {isLoading && (
              <InputGroupButton
                type="button"
                size="icon-xs"
                title={t('editLocation')}
              >
                <Loader2 className="text-muted-foreground size-4 animate-spin" />
              </InputGroupButton>
            )}
            {!isLoading && showMapPicker && (
              <InputGroupButton
                type="button"
                size="icon-xs"
                className={cn(
                  hasCoordinates
                    ? 'text-primary hover:text-primary hover:bg-primary/10'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                )}
                onClick={() => setIsModalOpen(true)}
                title={t('editLocation')}
              >
                <MapPin className="h-4 w-4" />
              </InputGroupButton>
            )}
            {inputValue && !isLoading && (
              <InputGroupButton
                type="button"
                size="icon-xs"
                className="text-muted-foreground hover:text-foreground"
                onClick={handleClear}
              >
                <X className="h-3.5 w-3.5" />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
      </div>
      {showsChoiceHint && (
        <p
          id={hintId}
          data-address-choice-hint=""
          className="text-muted-foreground text-sm"
        >
          {showMapPicker ? t('chooseFromListOrMap') : t('chooseFromList')}
        </p>
      )}

      {/* Suggestions dropdown (portal to escape overflow clipping) */}
      {isOpen &&
        suggestions.length > 0 &&
        createPortal(
          <div
            ref={dropdownRef}
            style={dropdownStyle}
            className="bg-popover rounded-md border p-1 shadow-md"
          >
            {suggestions.map((suggestion, index) => (
              <button
                key={suggestion.placeId}
                data-address-suggestion={suggestion.placeId}
                type="button"
                onMouseDown={() => {
                  isPressingSuggestionRef.current = true;
                }}
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
          </div>,
          document.body,
        )}

      {/* Address detail modal */}
      {showMapPicker && (
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
      )}
    </>
  );
};
