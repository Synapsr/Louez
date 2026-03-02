'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { setStorefrontSlug } from '@/lib/orpc/client'

interface StoreContextValue {
  currency: string
  storeSlug: string
  storeName: string
  timezone?: string
  maxDiscountPercent?: number | null
}

const StoreContext = createContext<StoreContextValue | undefined>(undefined)

interface StoreProviderProps {
  children: ReactNode
  currency: string
  storeSlug: string
  storeName: string
  timezone?: string
  maxDiscountPercent?: number | null
}

export function StoreProvider({
  children,
  currency,
  storeSlug,
  storeName,
  timezone,
  maxDiscountPercent,
}: StoreProviderProps) {
  // Set the store slug for the ORPC client synchronously during render,
  // so it's available before any child component makes API calls.
  setStorefrontSlug(storeSlug)

  return (
    <StoreContext.Provider value={{ currency, storeSlug, storeName, timezone, maxDiscountPercent }}>
      {children}
    </StoreContext.Provider>
  )
}

export function useStore() {
  const context = useContext(StoreContext)
  if (context === undefined) {
    throw new Error('useStore must be used within a StoreProvider')
  }
  return context
}

// Hook pour obtenir la devise avec fallback
export function useStoreCurrency(): string {
  const context = useContext(StoreContext)
  return context?.currency || 'EUR'
}

export function useStoreTimezone(): string | undefined {
  const context = useContext(StoreContext)
  return context?.timezone
}

export function useStoreMaxDiscountPercent(): number | null | undefined {
  const context = useContext(StoreContext)
  return context?.maxDiscountPercent
}
