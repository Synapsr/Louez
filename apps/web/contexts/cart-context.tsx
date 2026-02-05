'use client'

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react'
import { calculateDuration, type PricingMode } from '@/lib/utils/duration'
import {
  calculateRentalPrice,
  findApplicableTier,
  type PricingTier,
  type ProductPricing,
} from '@/lib/pricing'

interface CartItemPricingTier {
  id: string
  minDuration: number
  discountPercent: number
}

export interface CartItem {
  productId: string
  productName: string
  productImage: string | null
  price: number  // Base price
  deposit: number
  quantity: number
  maxQuantity: number
  // Pricing tiers for this product
  pricingTiers?: CartItemPricingTier[]
  // Product-specific pricing mode (null = use store default)
  productPricingMode?: PricingMode | null
  // Legacy fields for backwards compatibility
  startDate: string
  endDate: string
  pricingMode: PricingMode
}

interface CartPricingSummary {
  subtotal: number
  originalSubtotal: number
  totalSavings: number
  deposit: number
  total: number
}

interface CartContextValue {
  items: CartItem[]
  storeSlug: string | null
  // Global dates for all items
  globalStartDate: string | null
  globalEndDate: string | null
  pricingMode: PricingMode
  addItem: (item: Omit<CartItem, 'startDate' | 'endDate'>, storeSlug: string) => void
  removeItem: (productId: string) => void
  updateItemQuantity: (productId: string, quantity: number) => void
  updateItemDates: (productId: string, startDate: string, endDate: string) => void
  setGlobalDates: (startDate: string, endDate: string) => void
  setPricingMode: (mode: PricingMode) => void
  clearCart: () => void
  getItemCount: () => number
  getSubtotal: () => number
  getTotalDeposit: () => number
  getTotal: () => number
  getDuration: () => number
  getCartItemByProductId: (productId: string) => CartItem | undefined
  isProductInCart: (productId: string) => boolean
  // New: tiered pricing helpers
  getTotalSavings: () => number
  getOriginalSubtotal: () => number
  getPricingSummary: () => CartPricingSummary
}

const CartContext = createContext<CartContextValue | undefined>(undefined)

const CART_STORAGE_KEY = 'louez_cart'

interface StoredCart {
  storeSlug: string | null
  items: CartItem[]
  globalStartDate: string | null
  globalEndDate: string | null
  pricingMode: PricingMode
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([])
  const [storeSlug, setStoreSlug] = useState<string | null>(null)
  const [globalStartDate, setGlobalStartDate] = useState<string | null>(null)
  const [globalEndDate, setGlobalEndDate] = useState<string | null>(null)
  const [pricingMode, setPricingModeState] = useState<PricingMode>('day')
  const [isInitialized, setIsInitialized] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(CART_STORAGE_KEY)
        if (stored) {
          const parsed: StoredCart = JSON.parse(stored)
          setItems(parsed.items || [])
          setStoreSlug(parsed.storeSlug || null)
          setGlobalStartDate(parsed.globalStartDate || null)
          setGlobalEndDate(parsed.globalEndDate || null)
          setPricingModeState(parsed.pricingMode || 'day')
        }
      } catch {
        // Invalid data, start fresh
      }
      setIsInitialized(true)
    }
  }, [])

  useEffect(() => {
    if (isInitialized && typeof window !== 'undefined') {
      const cart: StoredCart = {
        storeSlug,
        items,
        globalStartDate,
        globalEndDate,
        pricingMode,
      }
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart))
    }
  }, [items, storeSlug, globalStartDate, globalEndDate, pricingMode, isInitialized])

  const setGlobalDates = useCallback((startDate: string, endDate: string) => {
    setGlobalStartDate(startDate)
    setGlobalEndDate(endDate)
    // Update all items with new dates
    setItems((currentItems) =>
      currentItems.map((item) => ({
        ...item,
        startDate,
        endDate,
      }))
    )
  }, [])

  const setPricingMode = useCallback((mode: PricingMode) => {
    setPricingModeState(mode)
    // Update all items with new pricing mode
    setItems((currentItems) =>
      currentItems.map((item) => ({
        ...item,
        pricingMode: mode,
      }))
    )
  }, [])

  const addItem = useCallback(
    (item: Omit<CartItem, 'startDate' | 'endDate'>, newStoreSlug: string) => {
      // If no global dates set, use default dates (tomorrow to day after)
      const startDate =
        globalStartDate ||
        (() => {
          const d = new Date()
          d.setDate(d.getDate() + 1)
          d.setHours(0, 0, 0, 0)
          return d.toISOString()
        })()
      const endDate =
        globalEndDate ||
        (() => {
          const d = new Date()
          d.setDate(d.getDate() + 2)
          d.setHours(0, 0, 0, 0)
          return d.toISOString()
        })()

      const fullItem: CartItem = {
        ...item,
        startDate,
        endDate,
      }

      setStoreSlug((currentSlug) => {
        if (currentSlug && currentSlug !== newStoreSlug) {
          // Different store, clear cart and add new item
          setItems([fullItem])
          setGlobalStartDate(startDate)
          setGlobalEndDate(endDate)
          return newStoreSlug
        }

        setItems((currentItems) => {
          const existingIndex = currentItems.findIndex(
            (i) => i.productId === item.productId
          )

          if (existingIndex >= 0) {
            // Product already exists: REPLACE quantity (not add)
            // Use updateItemQuantity if you want to increment
            const updated = [...currentItems]
            const existing = updated[existingIndex]
            updated[existingIndex] = {
              ...existing,
              quantity: Math.min(item.quantity, existing.maxQuantity),
            }
            return updated
          }

          return [...currentItems, fullItem]
        })

        // Set global dates if not set
        if (!globalStartDate) setGlobalStartDate(startDate)
        if (!globalEndDate) setGlobalEndDate(endDate)

        return currentSlug || newStoreSlug
      })
    },
    [globalStartDate, globalEndDate]
  )

  const removeItem = useCallback((productId: string) => {
    setItems((currentItems) =>
      currentItems.filter((item) => item.productId !== productId)
    )
  }, [])

  const updateItemQuantity = useCallback((productId: string, quantity: number) => {
    if (quantity <= 0) {
      removeItem(productId)
      return
    }
    setItems((currentItems) =>
      currentItems.map((item) =>
        item.productId === productId
          ? { ...item, quantity: Math.min(Math.max(1, quantity), item.maxQuantity) }
          : item
      )
    )
  }, [removeItem])

  const updateItemDates = useCallback(
    (productId: string, startDate: string, endDate: string) => {
      // In the new model, we update global dates instead
      setGlobalDates(startDate, endDate)
    },
    [setGlobalDates]
  )

  const clearCart = useCallback(() => {
    setItems([])
    setStoreSlug(null)
    setGlobalStartDate(null)
    setGlobalEndDate(null)
  }, [])

  const getItemCount = useCallback(() => {
    return items.reduce((sum, item) => sum + item.quantity, 0)
  }, [items])

  const getDuration = useCallback(() => {
    if (!globalStartDate || !globalEndDate) return 1
    return calculateDuration(globalStartDate, globalEndDate, pricingMode)
  }, [globalStartDate, globalEndDate, pricingMode])

  // Calculate subtotal with tiered pricing
  const getSubtotal = useCallback(() => {
    const duration = getDuration()
    return items.reduce((sum, item) => {
      // Get effective pricing mode for this item
      const itemPricingMode = item.productPricingMode || pricingMode

      // If item has pricing tiers, use tiered calculation
      if (item.pricingTiers && item.pricingTiers.length > 0) {
        const pricing: ProductPricing = {
          basePrice: item.price,
          deposit: item.deposit,
          pricingMode: itemPricingMode,
          tiers: item.pricingTiers.map((t, i) => ({
            ...t,
            displayOrder: i,
          })),
        }
        const result = calculateRentalPrice(pricing, duration, item.quantity)
        return sum + result.subtotal
      }

      // Otherwise use simple calculation
      return sum + item.price * item.quantity * duration
    }, 0)
  }, [items, getDuration, pricingMode])

  // Calculate original subtotal (without discounts)
  const getOriginalSubtotal = useCallback(() => {
    const duration = getDuration()
    return items.reduce((sum, item) => {
      return sum + item.price * item.quantity * duration
    }, 0)
  }, [items, getDuration])

  // Calculate total savings from tiered pricing
  const getTotalSavings = useCallback(() => {
    return getOriginalSubtotal() - getSubtotal()
  }, [getOriginalSubtotal, getSubtotal])

  const getTotalDeposit = useCallback(() => {
    return items.reduce((sum, item) => sum + item.deposit * item.quantity, 0)
  }, [items])

  const getTotal = useCallback(() => {
    // Deposit is NOT included in total - it's just a hold/authorization, not a payment
    return getSubtotal()
  }, [getSubtotal])

  // Get complete pricing summary
  const getPricingSummary = useCallback((): CartPricingSummary => {
    const subtotal = getSubtotal()
    const originalSubtotal = getOriginalSubtotal()
    const deposit = getTotalDeposit()
    return {
      subtotal,
      originalSubtotal,
      totalSavings: originalSubtotal - subtotal,
      deposit,
      total: subtotal + deposit,
    }
  }, [getSubtotal, getOriginalSubtotal, getTotalDeposit])

  const getCartItemByProductId = useCallback(
    (productId: string) => {
      return items.find((item) => item.productId === productId)
    },
    [items]
  )

  const isProductInCart = useCallback(
    (productId: string) => {
      return items.some((item) => item.productId === productId)
    },
    [items]
  )

  return (
    <CartContext.Provider
      value={{
        items,
        storeSlug,
        globalStartDate,
        globalEndDate,
        pricingMode,
        addItem,
        removeItem,
        updateItemQuantity,
        updateItemDates,
        setGlobalDates,
        setPricingMode,
        clearCart,
        getItemCount,
        getSubtotal,
        getTotalDeposit,
        getTotal,
        getDuration,
        getCartItemByProductId,
        isProductInCart,
        getTotalSavings,
        getOriginalSubtotal,
        getPricingSummary,
      }}
    >
      {children}
    </CartContext.Provider>
  )
}

export function useCart() {
  const context = useContext(CartContext)
  if (context === undefined) {
    throw new Error('useCart must be used within a CartProvider')
  }
  return context
}
