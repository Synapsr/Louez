'use client'

import {
  createContext,
  useContext,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react'

// Types for tracking
type PageType = 'home' | 'catalog' | 'product' | 'cart' | 'checkout' | 'confirmation' | 'account'
type DeviceType = 'mobile' | 'tablet' | 'desktop'
type EventType =
  | 'add_to_cart'
  | 'remove_from_cart'
  | 'update_quantity'
  | 'checkout_started'
  | 'checkout_completed'
  | 'checkout_abandoned'
  | 'payment_initiated'
  | 'payment_completed'
  | 'payment_failed'
  | 'login_requested'
  | 'login_completed'

interface PageViewData {
  page: PageType
  productId?: string
  categoryId?: string
}

interface EventData {
  eventType: EventType
  metadata?: Record<string, unknown>
  customerId?: string
}

interface AnalyticsContextValue {
  trackPageView: (data: PageViewData) => void
  trackEvent: (data: EventData) => void
  sessionId: string | null
}

const AnalyticsContext = createContext<AnalyticsContextValue | undefined>(undefined)

const SESSION_STORAGE_KEY = 'louez_analytics_session'

// Detect device type from user agent
function getDeviceType(): DeviceType {
  if (typeof window === 'undefined') return 'desktop'

  const ua = navigator.userAgent.toLowerCase()
  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
    return 'tablet'
  }
  if (/mobile|android|iphone|ipod|blackberry|opera mini|iemobile/i.test(ua)) {
    return 'mobile'
  }
  return 'desktop'
}

// Generate UUID v4
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// Get or create session ID
function getSessionId(): string {
  if (typeof window === 'undefined') return ''

  let sessionId = sessionStorage.getItem(SESSION_STORAGE_KEY)
  if (!sessionId) {
    sessionId = generateUUID()
    sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId)
  }
  return sessionId
}

interface AnalyticsProviderProps {
  children: ReactNode
  storeSlug: string
  enabled?: boolean
}

export function AnalyticsProvider({
  children,
  storeSlug,
  enabled = true
}: AnalyticsProviderProps) {
  const sessionIdRef = useRef<string | null>(null)
  const deviceRef = useRef<DeviceType>('desktop')

  // Initialize session and device on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionIdRef.current = getSessionId()
      deviceRef.current = getDeviceType()
    }
  }, [])

  // Track page view
  const trackPageView = useCallback((data: PageViewData) => {
    if (!enabled || !sessionIdRef.current) return

    const payload = {
      type: 'page_view' as const,
      storeSlug,
      sessionId: sessionIdRef.current,
      page: data.page,
      productId: data.productId,
      categoryId: data.categoryId,
      referrer: typeof document !== 'undefined' ? document.referrer?.slice(0, 500) : undefined,
      device: deviceRef.current,
    }

    // Use sendBeacon for non-blocking requests (fire-and-forget)
    // Must wrap in Blob with content-type for sendBeacon to send as JSON
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
      navigator.sendBeacon('/api/track', blob)
    } else {
      // Fallback to fetch for older browsers
      fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {
        // Silently ignore errors - analytics should never break the app
      })
    }
  }, [enabled, storeSlug])

  // Track event
  const trackEvent = useCallback((data: EventData) => {
    if (!enabled || !sessionIdRef.current) return

    const payload = {
      type: 'event' as const,
      storeSlug,
      sessionId: sessionIdRef.current,
      customerId: data.customerId,
      eventType: data.eventType,
      metadata: data.metadata,
    }

    // Use sendBeacon for non-blocking requests
    // Must wrap in Blob with content-type for sendBeacon to send as JSON
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
      navigator.sendBeacon('/api/track', blob)
    } else {
      fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {
        // Silently ignore errors
      })
    }
  }, [enabled, storeSlug])

  const value: AnalyticsContextValue = {
    trackPageView,
    trackEvent,
    sessionId: sessionIdRef.current,
  }

  return (
    <AnalyticsContext.Provider value={value}>
      {children}
    </AnalyticsContext.Provider>
  )
}

export function useAnalytics() {
  const context = useContext(AnalyticsContext)
  if (context === undefined) {
    // Return no-op functions if used outside provider (dashboard, etc.)
    return {
      trackPageView: () => {},
      trackEvent: () => {},
      sessionId: null,
    }
  }
  return context
}
