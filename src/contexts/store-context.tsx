'use client'

import { createContext, useContext, type ReactNode } from 'react'

interface StoreContextValue {
  currency: string
  storeSlug: string
  storeName: string
}

const StoreContext = createContext<StoreContextValue | undefined>(undefined)

interface StoreProviderProps {
  children: ReactNode
  currency: string
  storeSlug: string
  storeName: string
}

export function StoreProvider({
  children,
  currency,
  storeSlug,
  storeName,
}: StoreProviderProps) {
  return (
    <StoreContext.Provider value={{ currency, storeSlug, storeName }}>
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
