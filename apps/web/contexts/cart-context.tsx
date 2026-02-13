'use client'

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react'
import { calculateDuration, type PricingMode } from '@/lib/utils/duration'
import {
  calculateRentalPrice,
  type ProductPricing,
} from '@louez/utils'

interface CartItemPricingTier {
  id: string
  minDuration: number
  discountPercent: number
}

export interface CartItem {
  lineId: string
  selectionSignature: string
  productId: string
  productName: string
  productImage: string | null
  price: number  // Base price
  deposit: number
  quantity: number
  maxQuantity: number
  // Pricing tiers for this product
  pricingTiers?: CartItemPricingTier[]
  // Product-specific pricing mode
  productPricingMode?: PricingMode | null
  // Booking attributes (tracked-unit advanced mode)
  selectedAttributes?: Record<string, string>
  resolvedCombinationKey?: string
  resolvedAttributes?: Record<string, string>
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
  addItem: (item: Omit<CartItem, 'lineId' | 'selectionSignature' | 'startDate' | 'endDate'>, storeSlug: string) => void
  removeItemByLineId: (lineId: string) => void
  updateItemQuantityByLineId: (lineId: string, quantity: number) => void
  getCartLinesByProductId: (productId: string) => CartItem[]
  getProductQuantityInCart: (productId: string) => number
  // Legacy product-level helpers (temporary compatibility)
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

function normalizeSignatureValue(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function buildSelectionSignature(
  selectedAttributes: Record<string, string> | undefined,
): string {
  const entries = Object.entries(selectedAttributes || {})
    .map(([key, value]) => [key.trim().toLowerCase(), normalizeSignatureValue(value)] as const)
    .filter(([key, value]) => Boolean(key) && Boolean(value))
    .sort((a, b) => a[0].localeCompare(b[0], 'en'))

  if (entries.length === 0) {
    return '__default'
  }

  return entries.map(([key, value]) => `${key}:${value}`).join('|')
}

function createCartLineId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `line_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function normalizeStoredItem(item: CartItem, fallbackPricingMode: PricingMode): CartItem {
  const selectedAttributes = item.selectedAttributes || undefined
  const selectionSignature = item.selectionSignature || buildSelectionSignature(selectedAttributes)
  const lineId = item.lineId || createCartLineId()

  return {
    ...item,
    lineId,
    selectionSignature,
    pricingMode: item.pricingMode || fallbackPricingMode,
  }
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
          const parsedPricingMode = parsed.pricingMode || 'day'
          const normalizedItems = (parsed.items || []).map((item) =>
            normalizeStoredItem(item, parsedPricingMode),
          )
          setItems(normalizedItems)
          setStoreSlug(parsed.storeSlug || null)
          setGlobalStartDate(parsed.globalStartDate || null)
          setGlobalEndDate(parsed.globalEndDate || null)
          setPricingModeState(parsedPricingMode)
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
    (
      item: Omit<CartItem, 'lineId' | 'selectionSignature' | 'startDate' | 'endDate'>,
      newStoreSlug: string,
    ) => {
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

      const selectionSignature = buildSelectionSignature(item.selectedAttributes)

      setStoreSlug((currentSlug) => {
        const buildFullItem = (): CartItem => ({
          ...item,
          lineId: createCartLineId(),
          selectionSignature,
          startDate,
          endDate,
        })

        if (currentSlug && currentSlug !== newStoreSlug) {
          // Different store, clear cart and add new item
          setItems([buildFullItem()])
          setGlobalStartDate(startDate)
          setGlobalEndDate(endDate)
          return newStoreSlug
        }

        setItems((currentItems) => {
          const existingIndex = currentItems.findIndex(
            (i) => i.productId === item.productId && i.selectionSignature === selectionSignature,
          )

          if (existingIndex >= 0) {
            // Same product + same selection: merge quantities.
            const updated = [...currentItems]
            const existing = updated[existingIndex]
            updated[existingIndex] = {
              ...existing,
              ...item,
              selectionSignature,
              quantity: Math.min(existing.quantity + item.quantity, item.maxQuantity),
              maxQuantity: item.maxQuantity,
              startDate,
              endDate,
            }
            return updated
          }

          return [...currentItems, buildFullItem()]
        })

        // Set global dates if not set
        if (!globalStartDate) setGlobalStartDate(startDate)
        if (!globalEndDate) setGlobalEndDate(endDate)

        return currentSlug || newStoreSlug
      })
    },
    [globalStartDate, globalEndDate]
  )

  const removeItemByLineId = useCallback((lineId: string) => {
    setItems((currentItems) =>
      currentItems.filter((item) => item.lineId !== lineId),
    )
  }, [])

  const updateItemQuantityByLineId = useCallback((lineId: string, quantity: number) => {
    if (quantity <= 0) {
      removeItemByLineId(lineId)
      return
    }

    setItems((currentItems) =>
      currentItems.map((item) =>
        item.lineId === lineId
          ? { ...item, quantity: Math.min(Math.max(1, quantity), item.maxQuantity) }
          : item,
      ),
    )
  }, [removeItemByLineId])

  const getCartLinesByProductId = useCallback(
    (productId: string) => {
      return items.filter((item) => item.productId === productId)
    },
    [items],
  )

  const getProductQuantityInCart = useCallback(
    (productId: string) => {
      return items
        .filter((item) => item.productId === productId)
        .reduce((sum, item) => sum + item.quantity, 0)
    },
    [items],
  )

  const removeItem = useCallback((productId: string) => {
    setItems((currentItems) =>
      currentItems.filter((item) => item.productId !== productId),
    )
  }, [])

  const updateItemQuantity = useCallback((productId: string, quantity: number) => {
    const firstLine = items.find((item) => item.productId === productId)
    if (!firstLine) return
    updateItemQuantityByLineId(firstLine.lineId, quantity)
  }, [items, updateItemQuantityByLineId])

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

  const getItemDuration = useCallback((item: CartItem) => {
    const start = globalStartDate || item.startDate
    const end = globalEndDate || item.endDate
    if (!start || !end) return 1
    const itemPricingMode = item.productPricingMode || item.pricingMode || 'day'
    return calculateDuration(start, end, itemPricingMode)
  }, [globalStartDate, globalEndDate])

  const getDuration = useCallback(() => {
    if (items.length === 0) return 1
    return getItemDuration(items[0])
  }, [items, getItemDuration])

  // Calculate subtotal with tiered pricing
  const getSubtotal = useCallback(() => {
    return items.reduce((sum, item) => {
      const itemPricingMode = item.productPricingMode || item.pricingMode || 'day'
      const itemDuration = getItemDuration(item)

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
        const result = calculateRentalPrice(pricing, itemDuration, item.quantity)
        return sum + result.subtotal
      }

      // Otherwise use simple calculation
      return sum + item.price * item.quantity * itemDuration
    }, 0)
  }, [items, getItemDuration])

  // Calculate original subtotal (without discounts)
  const getOriginalSubtotal = useCallback(() => {
    return items.reduce((sum, item) => {
      return sum + item.price * item.quantity * getItemDuration(item)
    }, 0)
  }, [items, getItemDuration])

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
        removeItemByLineId,
        updateItemQuantityByLineId,
        getCartLinesByProductId,
        getProductQuantityInCart,
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
