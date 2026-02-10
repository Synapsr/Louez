'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Loader2, MapPin, Navigation, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useDebouncedCallback } from 'use-debounce';

import type { AddressSuggestion } from '@louez/types';
import {
  Dialog,
  DialogContent,
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
import { cn } from '@louez/utils';

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

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<unknown>(null);
  const markerRef = useRef<unknown>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

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
        !searchContainerRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Initialize map
  useEffect(() => {
    if (!open) return;

    // Load Leaflet CSS
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      link.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
      link.crossOrigin = '';
      document.head.appendChild(link);
    }

    const loadLeaflet = async () => {
      if (typeof window !== 'undefined' && !window.L) {
        await new Promise<void>((resolve) => {
          const script = document.createElement('script');
          script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
          script.integrity =
            'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
          script.crossOrigin = '';
          script.onload = () => resolve();
          document.head.appendChild(script);
        });
      }

      // Small delay to ensure DOM is ready
      setTimeout(initMap, 100);
    };

    const initMap = () => {
      if (!mapRef.current || !window.L) return;

      // Destroy existing map
      if (mapInstanceRef.current) {
        (mapInstanceRef.current as { remove: () => void }).remove();
        mapInstanceRef.current = null;
        markerRef.current = null;
      }

      const L = window.L as typeof import('leaflet');

      // Default to Paris if no coordinates
      const lat = latitude ?? 48.8566;
      const lng = longitude ?? 2.3522;
      const hasCoords = latitude !== null && longitude !== null;

      const map = L.map(mapRef.current, {
        zoomControl: true,
      }).setView([lat, lng], hasCoords ? 16 : 5);

      // Add CartoDB Positron tiles (cleaner, simpler style)
      L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
          subdomains: 'abcd',
          maxZoom: 20,
        },
      ).addTo(map);

      // Custom draggable marker with explicit colors
      const customIcon = L.divIcon({
        className: 'custom-marker-draggable',
        html: `<div style="
          background-color: #2563eb;
          width: 36px;
          height: 36px;
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 3px 12px rgba(0,0,0,0.3);
          border: 2px solid white;
          cursor: grab;
        ">
          <svg style="transform: rotate(45deg); width: 16px; height: 16px;" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="1">
            <circle cx="12" cy="10" r="3"/>
          </svg>
        </div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 36],
      });

      if (hasCoords) {
        const marker = L.marker([lat, lng], {
          icon: customIcon,
          draggable: true,
        }).addTo(map);

        marker.on('dragend', () => {
          const pos = marker.getLatLng();
          setLatitude(pos.lat);
          setLongitude(pos.lng);
        });

        markerRef.current = marker;
      }

      // Click on map to place/move marker
      map.on('click', (e: { latlng: { lat: number; lng: number } }) => {
        const { lat, lng } = e.latlng;
        setLatitude(lat);
        setLongitude(lng);

        if (markerRef.current) {
          (
            markerRef.current as {
              setLatLng: (latlng: [number, number]) => void;
            }
          ).setLatLng([lat, lng]);
        } else {
          const marker = L.marker([lat, lng], {
            icon: customIcon,
            draggable: true,
          }).addTo(map);

          marker.on('dragend', () => {
            const pos = marker.getLatLng();
            setLatitude(pos.lat);
            setLongitude(pos.lng);
          });

          markerRef.current = marker;
        }
      });

      mapInstanceRef.current = map;
    };

    loadLeaflet();

    return () => {
      if (mapInstanceRef.current) {
        (mapInstanceRef.current as { remove: () => void }).remove();
        mapInstanceRef.current = null;
        markerRef.current = null;
      }
    };
  }, [open, initialLatitude, initialLongitude]);

  // Update marker when coordinates change from search
  useEffect(() => {
    if (
      !mapInstanceRef.current ||
      !window.L ||
      latitude === null ||
      longitude === null
    )
      return;

    const L = window.L as typeof import('leaflet');
    const map = mapInstanceRef.current as {
      setView: (latlng: [number, number], zoom: number) => void;
    };

    // Center map on new coordinates
    map.setView([latitude, longitude], 16);

    // Update or create marker
    if (markerRef.current) {
      (
        markerRef.current as { setLatLng: (latlng: [number, number]) => void }
      ).setLatLng([latitude, longitude]);
    } else {
      const customIcon = L.divIcon({
        className: 'custom-marker-draggable',
        html: `<div style="
          background-color: #2563eb;
          width: 36px;
          height: 36px;
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 3px 12px rgba(0,0,0,0.3);
          border: 2px solid white;
          cursor: grab;
        ">
          <svg style="transform: rotate(45deg); width: 16px; height: 16px;" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="1">
            <circle cx="12" cy="10" r="3"/>
          </svg>
        </div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 36],
      });

      const marker = L.marker([latitude, longitude], {
        icon: customIcon,
        draggable: true,
      }).addTo(mapInstanceRef.current as import('leaflet').Map);

      marker.on('dragend', () => {
        const pos = marker.getLatLng();
        setLatitude(pos.lat);
        setLongitude(pos.lng);
      });

      markerRef.current = marker;
    }
  }, [latitude, longitude]);

  // Search addresses
  const searchAddresses = useCallback(async (query: string) => {
    if (query.length < 3) {
      setSuggestions([]);
      return;
    }

    setIsSearching(true);
    try {
      const response = await fetch(
        `/api/address/autocomplete?query=${encodeURIComponent(query)}`,
      );
      const data = await response.json();
      setSuggestions(data.suggestions || []);
      setShowSuggestions((data.suggestions || []).length > 0);
    } catch (error) {
      console.error('Address search error:', error);
      setSuggestions([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  const debouncedSearch = useDebouncedCallback(searchAddresses, 300);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    debouncedSearch(value);
  };

  const handleSelectSuggestion = async (suggestion: AddressSuggestion) => {
    setIsSearching(true);
    try {
      const response = await fetch(
        `/api/address/details?placeId=${encodeURIComponent(suggestion.placeId)}`,
      );
      const data = await response.json();

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-[700px]">
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

              {/* Suggestions dropdown */}
              {showSuggestions && suggestions.length > 0 && (
                <div className="bg-popover absolute z-50 mt-1 w-full rounded-md border p-1 shadow-md">
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
                </div>
              )}
            </div>

            {/* Map */}
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{t('mapLabel')}</Label>
              <p className="text-muted-foreground text-xs">{t('mapHint')}</p>
              <div
                ref={mapRef}
                className="bg-muted h-[250px] rounded-lg border"
                style={{ zIndex: 0 }}
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
      </DialogContent>
    </Dialog>
  );
}

// Type declaration for Leaflet on window
declare global {
  interface Window {
    L?: typeof import('leaflet');
  }
}
