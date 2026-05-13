'use client';

import { useEffect, useRef, useState } from 'react';

interface StoreMapProps {
  latitude: number;
  longitude: number;
  storeName: string;
  address?: string;
  className?: string;
  primaryColor?: string;
  interactive?: boolean;
  showZoomControl?: boolean;
  showAttribution?: boolean;
  showRecenterControl?: boolean;
  tileTheme?: 'auto' | 'light' | 'dark';
  popupTheme?: 'auto' | 'light' | 'dark';
  directionsLabel?: string;
}

// Tile layer URLs for different themes
const TILE_LAYERS = {
  light: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
};

// Helper to detect if dark mode is active (works with both next-themes and custom ThemeWrapper)
function isDarkMode(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.classList.contains('dark');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function StoreMap({
  latitude,
  longitude,
  storeName,
  address,
  className,
  primaryColor = '#0066FF',
  interactive = true,
  showZoomControl = true,
  showAttribution = true,
  showRecenterControl = false,
  tileTheme = 'auto',
  popupTheme = 'auto',
  directionsLabel,
}: StoreMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<unknown>(null);
  const tileLayerRef = useRef<unknown>(null);
  const [mounted, setMounted] = useState(false);
  const [isDark, setIsDark] = useState(false);

  // Detect theme on mount and observe changes
  useEffect(() => {
    setMounted(true);
    setIsDark(isDarkMode());

    // Observe changes to the dark class on documentElement
    const observer = new MutationObserver(() => {
      setIsDark(isDarkMode());
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!mounted) return;

    // Dynamically load Leaflet CSS
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      link.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
      link.crossOrigin = '';
      document.head.appendChild(link);
    }

    // Dynamically load Leaflet JS
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

      initMap();
    };

    const initMap = () => {
      if (!mapRef.current || !window.L) return;

      // Destroy existing map if any
      if (mapInstanceRef.current) {
        (mapInstanceRef.current as { remove: () => void }).remove();
      }

      // Create map
      const L = window.L as typeof import('leaflet');
      const map = L.map(mapRef.current, {
        zoomControl: showZoomControl,
        attributionControl: showAttribution,
        dragging: interactive,
        scrollWheelZoom: interactive,
        doubleClickZoom: interactive,
        boxZoom: interactive,
        keyboard: interactive,
        touchZoom: interactive,
      }).setView([latitude, longitude], 14);

      // Select tile layer based on theme
      const tileConfig =
        tileTheme === 'dark'
          ? TILE_LAYERS.dark
          : tileTheme === 'light'
            ? TILE_LAYERS.light
            : isDark
              ? TILE_LAYERS.dark
              : TILE_LAYERS.light;

      const tileLayer = L.tileLayer(tileConfig.url, {
        attribution: tileConfig.attribution,
        subdomains: 'abcd',
        maxZoom: 20,
      }).addTo(map);

      tileLayerRef.current = tileLayer;

      const customIcon = L.divIcon({
        className: 'custom-marker',
        html: `<svg width="32" height="40" viewBox="0 0 32 40" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M16 0C7.163 0 0 7.163 0 16C0 24.837 16 40 16 40C16 40 32 24.837 32 16C32 7.163 24.837 0 16 0Z" fill="${primaryColor}"/>
          <circle cx="16" cy="16" r="7" fill="hsl(var(--background))"/>
        </svg>`,
        iconSize: [32, 40],
        iconAnchor: [16, 40],
        popupAnchor: [0, -44],
      });

      // Add marker
      const marker = L.marker([latitude, longitude], {
        icon: customIcon,
      }).addTo(map);

      const popupIsDark =
        popupTheme === 'dark' || (popupTheme === 'auto' && isDark);
      const directionsUrl = address
        ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`
        : null;

      const popupContent = `
        <div style="min-width:180px;">
          <p style="margin:0 0 2px;font-size:13px;font-weight:600;color:#18181b;">${escapeHtml(storeName)}</p>
          ${address ? `<p style="margin:0 0 10px;font-size:12px;line-height:1.4;color:#71717a;">${escapeHtml(address)}</p>` : ''}
          ${
            directionsUrl && directionsLabel
              ? `<a href="${directionsUrl}" target="_blank" rel="noopener noreferrer" style="display:flex;align-items:center;justify-content:center;border-radius:8px;background:${primaryColor};padding:6px 12px;font-size:12px;font-weight:600;color:hsl(var(--primary-foreground));text-decoration:none;">${escapeHtml(directionsLabel)}</a>`
              : ''
          }
        </div>
      `;
      marker.bindPopup(popupContent, {
        className: popupIsDark ? 'dark-popup' : 'light-popup',
        closeButton: false,
        offset: [0, -4],
      });

      if (showRecenterControl) {
        const recenterControl = new L.Control({ position: 'bottomright' });

        recenterControl.onAdd = () => {
          const button = L.DomUtil.create('button', '');
          button.innerHTML =
            '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>';
          button.title = 'Recenter';

          const background = isDark ? '#27272a' : 'white';
          const hoverBackground = isDark ? '#3f3f46' : '#f4f4f5';
          const color = isDark ? '#a1a1aa' : '#52525b';

          button.style.cssText = `background:${background};border:none;border-radius:8px;width:30px;height:30px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 5px rgba(0,0,0,0.15);color:${color};margin-bottom:8px;margin-right:8px;`;

          button.onmouseenter = () => {
            button.style.background = hoverBackground;
          };

          button.onmouseleave = () => {
            button.style.background = background;
          };

          L.DomEvent.disableClickPropagation(button);
          L.DomEvent.on(button, 'click', () =>
            map.flyTo([latitude, longitude], 14, { duration: 0.6 }),
          );

          return button;
        };

        recenterControl.addTo(map);
      }

      mapInstanceRef.current = map;
    };

    loadLeaflet();

    return () => {
      if (mapInstanceRef.current) {
        (mapInstanceRef.current as { remove: () => void }).remove();
        mapInstanceRef.current = null;
        tileLayerRef.current = null;
      }
    };
  }, [
    latitude,
    longitude,
    storeName,
    address,
    primaryColor,
    interactive,
    showZoomControl,
    showAttribution,
    showRecenterControl,
    tileTheme,
    popupTheme,
    directionsLabel,
    isDark,
    mounted,
  ]);

  // Show placeholder while mounting
  if (!mounted) {
    return (
      <div
        className={className}
        style={{
          height: '100%',
          minHeight: '100%',
          borderRadius: '0.5rem',
          backgroundColor: 'hsl(var(--muted))',
        }}
      />
    );
  }

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
            .leaflet-popup-content-wrapper {
              border-radius: 12px !important;
              box-shadow: 0 4px 20px rgba(0,0,0,0.15) !important;
            }
            .dark-popup .leaflet-popup-content-wrapper {
              background: #1f2937 !important;
              color: #f3f4f6 !important;
            }
            .dark-popup .leaflet-popup-tip {
              background: #1f2937 !important;
            }
            .light-popup .leaflet-popup-content-wrapper {
              background: #ffffff !important;
            }
            .light-popup .leaflet-popup-tip {
              background: #ffffff !important;
            }
            .leaflet-popup-close-button {
              color: inherit !important;
            }
            .custom-marker {
              background: transparent !important;
              border: none !important;
            }
          `,
        }}
      />
      <div
        ref={mapRef}
        className={className}
        style={{
          height: '100%',
          minHeight: '100%',
          borderRadius: '0.5rem',
          zIndex: 0,
        }}
      />
    </>
  );
}

// Type declaration for Leaflet on window
declare global {
  interface Window {
    L?: typeof import('leaflet');
  }
}
