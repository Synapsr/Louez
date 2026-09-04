'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';

import { Loader2, MapPin, Navigation, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useDebouncedCallback } from 'use-debounce';

import type { AddressSuggestion } from '@louez/types';
import {
  Dialog,
  DialogPopup,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from '@louez/ui';
import { Button } from '@louez/ui';
import { Input } from '@louez/ui';
import { Label } from '@louez/ui';
import { Textarea } from '@louez/ui';
import { AddressPickerMap } from '@/components/ui/address-picker-map';
import { orpc } from '@/lib/orpc/react';

interface AddressMapModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  address: string;
  displayAddress: string;
  additionalInfo: string;
  latitude: number | null;
  longitude: number | null;
  onSave: (data: {
    address: string;
    displayAddress: string;
    additionalInfo: string;
    latitude: number | null;
    longitude: number | null;
  }) => void;
}

export function AddressMapModal({
  open,
  onOpenChange,
  address: initialAddress,
  displayAddress: initialDisplayAddress,
  additionalInfo: initialAdditionalInfo,
  latitude: initialLatitude,
  longitude: initialLongitude,
  onSave,
}: AddressMapModalProps) {
  const t = useTranslations('common.addressModal');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();

  // Local state
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const [displayAddress, setDisplayAddress] = useState(
    initialDisplayAddress || initialAddress,
  );
  const [additionalInfo, setAdditionalInfo] = useState(initialAdditionalInfo);
  const [latitude, setLatitude] = useState(initialLatitude);
  const [longitude, setLongitude] = useState(initialLongitude);

  const searchContainerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setDisplayAddress(initialDisplayAddress || initialAddress);
      setAdditionalInfo(initialAdditionalInfo);
      setLatitude(initialLatitude);
      setLongitude(initialLongitude);
      setSearchQuery('');
      setSuggestions([]);
    }
  }, [
    open,
    initialAddress,
    initialDisplayAddress,
    initialAdditionalInfo,
    initialLatitude,
    initialLongitude,
  ]);

  // Close suggestions on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(event.target as Node) &&
        (!dropdownRef.current ||
          !dropdownRef.current.contains(event.target as Node))
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Position the portal dropdown relative to the search input
  useEffect(() => {
    if (!showSuggestions || suggestions.length === 0 || !searchContainerRef.current) return;

    const updatePosition = () => {
      if (!searchContainerRef.current) return;
      const rect = searchContainerRef.current.getBoundingClientRect();
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
  }, [showSuggestions, suggestions.length]);

  // Search addresses
  const searchAddresses = useCallback(async (query: string) => {
    if (query.length < 3) {
      setSuggestions([]);
      return;
    }

    setIsSearching(true);
    try {
      const data = await queryClient.fetchQuery(
        orpc.public.address.autocomplete.queryOptions({
          input: { query },
        }),
      );
      setSuggestions(data.suggestions || []);
      setShowSuggestions((data.suggestions || []).length > 0);
    } catch (error) {
      console.error('Address search error:', error);
      setSuggestions([]);
    } finally {
      setIsSearching(false);
    }
  }, [queryClient]);

  const debouncedSearch = useDebouncedCallback(searchAddresses, 300);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    debouncedSearch(value);
  };

  const handleSelectSuggestion = async (suggestion: AddressSuggestion) => {
    setIsSearching(true);
    try {
      const data = await queryClient.fetchQuery(
        orpc.public.address.details.queryOptions({
          input: { placeId: suggestion.placeId },
        }),
      );

      if (data.details) {
        setDisplayAddress(data.details.formattedAddress);
        setLatitude(data.details.latitude);
        setLongitude(data.details.longitude);
      } else {
        setDisplayAddress(suggestion.description);
      }
    } catch (error) {
      console.error('Error fetching address details:', error);
      setDisplayAddress(suggestion.description);
    } finally {
      setSearchQuery('');
      setSuggestions([]);
      setShowSuggestions(false);
      setIsSearching(false);
    }
  };

  // Reverse geocode coordinates to get the address
  const reverseGeocodeCoords = useCallback(
    async (lat: number, lng: number) => {
      try {
        const data = await queryClient.fetchQuery(
          orpc.public.address.reverseGeocode.queryOptions({
            input: { latitude: lat, longitude: lng },
          }),
        );

        if (data.details) {
          setDisplayAddress(data.details.formattedAddress);
        }
      } catch (error) {
        console.error('Reverse geocode error:', error);
      }
    },
    [queryClient],
  );

  // Ref so map event handlers always call the latest version
  const reverseGeocodeRef = useRef(reverseGeocodeCoords);
  useEffect(() => {
    reverseGeocodeRef.current = reverseGeocodeCoords;
  }, [reverseGeocodeCoords]);

  const handleCoordinatesChange = useCallback((lat: number, lng: number) => {
    setLatitude(lat);
    setLongitude(lng);
    void reverseGeocodeRef.current(lat, lng);
  }, []);

  const handleSave = () => {
    onSave({
      address: displayAddress,
      displayAddress,
      additionalInfo,
      latitude,
      longitude,
    });
    onOpenChange(false);
  };

  const hasCoordinates = latitude !== null && longitude !== null;

  return (
    <Dialog mobileVariant="dialog" open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-[700px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            {t('title')}
          </DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <DialogPanel className="">
          <div className="flex-1 space-y-4 py-4">
            {/* Search bar */}
            <div ref={searchContainerRef} className="relative">
              <Label className="text-sm font-medium">{t('searchLabel')}</Label>
              <div className="relative mt-1.5">
                <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                <Input
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder={t('searchPlaceholder')}
                  autoComplete="one-time-code"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  data-form-type="other"
                  data-lpignore="true"
                />
                {isSearching && (
                  <Loader2 className="text-muted-foreground absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin" />
                )}
              </div>

            </div>

            {/* Suggestions dropdown (portal to escape overflow clipping) */}
            {showSuggestions &&
              suggestions.length > 0 &&
              createPortal(
                <div
                  ref={dropdownRef}
                  style={dropdownStyle}
                  className="bg-popover rounded-md border p-1 shadow-md"
                >
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion.placeId}
                      type="button"
                      onClick={() => handleSelectSuggestion(suggestion)}
                      className="hover:bg-accent hover:text-accent-foreground flex w-full items-start gap-2 rounded-sm px-2 py-2 text-left text-sm transition-colors"
                    >
                      <Navigation className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">
                          {suggestion.mainText}
                        </p>
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

            {/* Map */}
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{t('mapLabel')}</Label>
              <p className="text-muted-foreground text-xs">{t('mapHint')}</p>
              <AddressPickerMap
                latitude={latitude}
                longitude={longitude}
                onCoordinatesChange={handleCoordinatesChange}
              />
              {hasCoordinates && (
                <p className="text-muted-foreground text-xs">
                  {t('coordinates')}: {latitude?.toFixed(6)},{' '}
                  {longitude?.toFixed(6)}
                </p>
              )}
            </div>

            {/* Display address */}
            <div className="space-y-1.5">
              <Label htmlFor="displayAddress" className="text-sm font-medium">
                {t('displayAddressLabel')}
              </Label>
              <p className="text-muted-foreground text-xs">
                {t('displayAddressHint')}
              </p>
              <Input
                id="displayAddress"
                value={displayAddress}
                onChange={(e) => setDisplayAddress(e.target.value)}
                placeholder={t('displayAddressPlaceholder')}
              />
            </div>

            {/* Additional info */}
            <div className="space-y-1.5">
              <Label htmlFor="additionalInfo" className="text-sm font-medium">
                {t('additionalInfoLabel')}
              </Label>
              <p className="text-muted-foreground text-xs">
                {t('additionalInfoHint')}
              </p>
              <Textarea
                id="additionalInfo"
                value={additionalInfo}
                onChange={(e) => setAdditionalInfo(e.target.value)}
                placeholder={t('additionalInfoPlaceholder')}
                rows={2}
              />
            </div>
          </div>
        </DialogPanel>
        <DialogFooter className="border-t pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {tCommon('cancel')}
          </Button>
          <Button type="button" onClick={handleSave}>
            {tCommon('save')}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
