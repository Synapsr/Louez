'use client'

import { useEffect, useRef, useState } from 'react'

interface StoreMapProps {
  latitude: number
  longitude: number
  storeName: string
  address?: string
  className?: string
  primaryColor?: string
}

// Tile layer URLs for different themes
const TILE_LAYERS = {
  light: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
}

// Helper to detect if dark mode is active (works with both next-themes and custom ThemeWrapper)
function isDarkMode(): boolean {
  if (typeof document === 'undefined') return false
  return document.documentElement.classList.contains('dark')
}

export function StoreMap({
  latitude,
  longitude,
  storeName,
  address,
  className,
  primaryColor = '#0066FF',
}: StoreMapProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<unknown>(null)
  const tileLayerRef = useRef<unknown>(null)
  const [mounted, setMounted] = useState(false)
  const [isDark, setIsDark] = useState(false)

  // Detect theme on mount and observe changes
  useEffect(() => {
    setMounted(true)
    setIsDark(isDarkMode())

    // Observe changes to the dark class on documentElement
    const observer = new MutationObserver(() => {
      setIsDark(isDarkMode())
    })

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!mounted) return

    // Dynamically load Leaflet CSS
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link')
      link.id = 'leaflet-css'
      link.rel = 'stylesheet'
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
      link.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY='
      link.crossOrigin = ''
      document.head.appendChild(link)
    }

    // Dynamically load Leaflet JS
    const loadLeaflet = async () => {
      if (typeof window !== 'undefined' && !window.L) {
        await new Promise<void>((resolve) => {
          const script = document.createElement('script')
          script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
          script.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo='
          script.crossOrigin = ''
          script.onload = () => resolve()
          document.head.appendChild(script)
        })
      }

      initMap()
    }

    const initMap = () => {
      if (!mapRef.current || !window.L) return

      // Destroy existing map if any
      if (mapInstanceRef.current) {
        (mapInstanceRef.current as { remove: () => void }).remove()
      }

      // Create map
      const L = window.L as typeof import('leaflet')
      const map = L.map(mapRef.current).setView([latitude, longitude], 15)

      // Select tile layer based on theme
      const tileConfig = isDark ? TILE_LAYERS.dark : TILE_LAYERS.light

      const tileLayer = L.tileLayer(tileConfig.url, {
        attribution: tileConfig.attribution,
        subdomains: 'abcd',
        maxZoom: 20,
      }).addTo(map)

      tileLayerRef.current = tileLayer

      // Create custom marker icon with primary color
      const customIcon = L.divIcon({
        className: 'custom-marker',
        html: `<div style="
          background-color: ${primaryColor};
          width: 36px;
          height: 36px;
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 3px 12px rgba(0,0,0,0.4);
          border: 3px solid white;
        ">
          <svg style="transform: rotate(45deg); width: 16px; height: 16px;" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="1">
            <circle cx="12" cy="10" r="3"/>
          </svg>
        </div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 36],
        popupAnchor: [0, -36],
      })

      // Add marker
      const marker = L.marker([latitude, longitude], { icon: customIcon }).addTo(map)

      // Add popup with theme-aware styling
      const popupBgColor = isDark ? '#1f2937' : '#ffffff'
      const popupTextColor = isDark ? '#f3f4f6' : '#111827'
      const popupSubTextColor = isDark ? '#9ca3af' : '#6b7280'

      const popupContent = `
        <div style="padding: 6px 2px; background: ${popupBgColor}; color: ${popupTextColor}; border-radius: 8px;">
          <strong style="font-size: 14px; font-weight: 600;">${storeName}</strong>
          ${address ? `<p style="margin: 6px 0 0; font-size: 12px; color: ${popupSubTextColor}; line-height: 1.4;">${address}</p>` : ''}
        </div>
      `
      marker.bindPopup(popupContent, {
        className: isDark ? 'dark-popup' : 'light-popup',
      })

      mapInstanceRef.current = map
    }

    loadLeaflet()

    return () => {
      if (mapInstanceRef.current) {
        (mapInstanceRef.current as { remove: () => void }).remove()
        mapInstanceRef.current = null
        tileLayerRef.current = null
      }
    }
  }, [latitude, longitude, storeName, address, primaryColor, isDark, mounted])

  // Show placeholder while mounting
  if (!mounted) {
    return (
      <div
        className={className}
        style={{
          height: '100%',
          minHeight: '300px',
          borderRadius: '0.5rem',
          backgroundColor: 'hsl(var(--muted))',
        }}
      />
    )
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
        style={{ height: '100%', minHeight: '300px', borderRadius: '0.5rem', zIndex: 0 }}
      />
    </>
  )
}

// Type declaration for Leaflet on window
declare global {
  interface Window {
    L?: typeof import('leaflet')
  }
}
