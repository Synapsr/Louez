'use client';

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { useQuery } from '@tanstack/react-query';

import type { SeasonalPricingConfig } from '@louez/utils';

import { orpc } from '@/lib/orpc/react';
import { calculateCartItemPrice } from '@/lib/utils/cart-pricing';
import { type PricingMode, calculateDuration } from '@/lib/utils/duration';

interface CartItemPricingTier {
  id: string;
  minDuration: number;
  discountPercent: number;
  period?: number | null;
  price?: number | null;
}

export interface CartItem {
  lineId: string;
  selectionSignature: string;
  productId: string;
  productName: string;
  productImage: string | null;
  price: number; // Base price
  deposit: number;
  quantity: number;
  maxQuantity: number;
  // Pricing tiers for this product
  pricingTiers?: CartItemPricingTier[];
  // Rate-based pricing period in minutes
  basePeriodMinutes?: number | null;
  // Whether strict tier pricing is enforced
  enforceStrictTiers?: boolean;
  // Product-specific pricing mode
  productPricingMode?: PricingMode | null;
  // Booking attributes (tracked-unit advanced mode)
  selectedAttributes?: Record<string, string>;
  resolvedCombinationKey?: string;
  resolvedAttributes?: Record<string, string>;
  // Seasonal pricing overrides (per-product)
  seasonalPricings?: SeasonalPricingConfig[];
  // Legacy fields for backwards compatibility
  startDate: string;
  endDate: string;
  pricingMode: PricingMode;
}

interface CartPricingSummary {
  subtotal: number;
  originalSubtotal: number;
  totalSavings: number;
  deposit: number;
  total: number;
}

interface CartContextValue {
  items: CartItem[];
  isResolving: boolean;
  storeSlug: string | null;
  // Global dates for all items
  globalStartDate: string | null;
  globalEndDate: string | null;
  pricingMode: PricingMode;
  addItem: (
    item: Omit<
      CartItem,
      'lineId' | 'selectionSignature' | 'startDate' | 'endDate'
    >,
    storeSlug: string,
  ) => void;
  removeItemByLineId: (lineId: string) => void;
  updateItemQuantityByLineId: (lineId: string, quantity: number) => void;
  getCartLinesByProductId: (productId: string) => CartItem[];
  getProductQuantityInCart: (productId: string) => number;
  // Legacy product-level helpers (temporary compatibility)
  removeItem: (productId: string) => void;
  updateItemQuantity: (productId: string, quantity: number) => void;
  updateItemDates: (
    productId: string,
    startDate: string,
    endDate: string,
  ) => void;
  setGlobalDates: (startDate: string, endDate: string) => void;
  setPricingMode: (mode: PricingMode) => void;
  clearCart: () => void;
  getItemCount: () => number;
  getSubtotal: () => number;
  getTotalDeposit: () => number;
  getTotal: () => number;
  getDuration: () => number;
  getCartItemByProductId: (productId: string) => CartItem | undefined;
  isProductInCart: (productId: string) => boolean;
  // New: tiered pricing helpers
  getTotalSavings: () => number;
  getOriginalSubtotal: () => number;
  getPricingSummary: () => CartPricingSummary;
}

const CartContext = createContext<CartContextValue | undefined>(undefined);

const CART_STORAGE_KEY = 'louez_cart';

interface StoredCartItem {
  lineId: string;
  selectionSignature: string;
  productId: string;
  productName?: string;
  productImage?: string | null;
  quantity: number;
  selectedAttributes?: Record<string, string>;
  startDate: string;
  endDate: string;
}

interface StoredCart {
  storeSlug: string | null;
  items: StoredCartItem[];
  globalStartDate: string | null;
  globalEndDate: string | null;
  pricingMode: PricingMode;
}

function normalizeSignatureValue(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function buildSelectionSignature(
  selectedAttributes: Record<string, string> | undefined,
): string {
  const entries = Object.entries(selectedAttributes || {})
    .map(
      ([key, value]) =>
        [key.trim().toLowerCase(), normalizeSignatureValue(value)] as const,
    )
    .filter(([key, value]) => Boolean(key) && Boolean(value))
    .sort((a, b) => a[0].localeCompare(b[0], 'en'));

  if (entries.length === 0) {
    return '__default';
  }

  return entries.map(([key, value]) => `${key}:${value}`).join('|');
}

function createCartLineId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }

  return `line_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeStoredItem(
  item: Partial<CartItem> & Pick<CartItem, 'productId' | 'quantity'>,
  fallbackPricingMode: PricingMode,
): CartItem {
  const selectedAttributes = item.selectedAttributes || undefined;
  const selectionSignature =
    item.selectionSignature || buildSelectionSignature(selectedAttributes);
  const lineId = item.lineId || createCartLineId();

  return {
    productId: item.productId,
    productName: item.productName || '',
    productImage: item.productImage || null,
    price: item.price || 0,
    deposit: item.deposit || 0,
    quantity: item.quantity,
    maxQuantity: item.maxQuantity || Math.max(1, item.quantity),
    pricingTiers: item.pricingTiers,
    basePeriodMinutes: item.basePeriodMinutes,
    enforceStrictTiers: item.enforceStrictTiers,
    productPricingMode: item.productPricingMode,
    selectedAttributes,
    resolvedCombinationKey: item.resolvedCombinationKey,
    resolvedAttributes: item.resolvedAttributes,
    seasonalPricings: item.seasonalPricings,
    startDate: item.startDate || new Date().toISOString(),
    endDate: item.endDate || new Date().toISOString(),
    pricingMode: item.pricingMode || fallbackPricingMode,
    lineId,
    selectionSignature,
  };
}

function toStoredCartItem(item: CartItem): StoredCartItem {
  return {
    lineId: item.lineId,
    selectionSignature: item.selectionSignature,
    productId: item.productId,
    productName: item.productName,
    productImage: item.productImage,
    quantity: item.quantity,
    selectedAttributes: item.selectedAttributes,
    startDate: item.startDate,
    endDate: item.endDate,
  };
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [storeSlug, setStoreSlug] = useState<string | null>(null);
  const [globalStartDate, setGlobalStartDate] = useState<string | null>(null);
  const [globalEndDate, setGlobalEndDate] = useState<string | null>(null);
  const [pricingMode, setPricingModeState] = useState<PricingMode>('day');
  const [isInitialized, setIsInitialized] = useState(false);
  const cartResolveInput = useMemo(
    () => ({
      lines: items.map((item) => ({
        lineId: item.lineId,
        productId: item.productId,
        quantity: item.quantity,
        startDate: globalStartDate || item.startDate,
        endDate: globalEndDate || item.endDate,
        selectedAttributes: item.selectedAttributes,
      })),
    }),
    [items, globalStartDate, globalEndDate],
  );

  const { data: resolvedCart, isFetching: isResolving } = useQuery({
    ...orpc.storefront.cart.resolve.queryOptions({
      input: cartResolveInput,
    }),
    enabled: isInitialized && items.length > 0 && Boolean(storeSlug),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!resolvedCart) {
      return;
    }

    const resolvedByLineId = new Map(
      resolvedCart.lines.map((line) => [line.lineId, line]),
    );

    setItems((currentItems) =>
      currentItems.map((item) => {
        const resolved = resolvedByLineId.get(item.lineId);

        if (!resolved || resolved.status !== 'resolved') {
          return resolved?.status === 'unavailable' &&
            typeof resolved.maxQuantity === 'number'
            ? { ...item, maxQuantity: resolved.maxQuantity }
            : item;
        }

        return {
          ...item,
          productName: resolved.productName,
          productImage: resolved.productImage,
          price: resolved.price,
          deposit: resolved.deposit,
          maxQuantity: resolved.maxQuantity,
          pricingMode: resolved.pricingMode,
          productPricingMode: resolved.productPricingMode,
          basePeriodMinutes: resolved.basePeriodMinutes,
          enforceStrictTiers: resolved.enforceStrictTiers,
          pricingTiers: resolved.pricingTiers,
          seasonalPricings: resolved.seasonalPricings,
        };
      }),
    );
  }, [resolvedCart]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(CART_STORAGE_KEY);
        if (stored) {
          const parsed: StoredCart = JSON.parse(stored);
          const parsedPricingMode = parsed.pricingMode || 'day';
          const normalizedItems = (parsed.items || []).map((item) =>
            normalizeStoredItem(item, parsedPricingMode),
          );
          setItems(normalizedItems);
          setStoreSlug(parsed.storeSlug || null);
          setGlobalStartDate(parsed.globalStartDate || null);
          setGlobalEndDate(parsed.globalEndDate || null);
          setPricingModeState(parsedPricingMode);
        }
      } catch {
        // Invalid data, start fresh
      }
      setIsInitialized(true);
    }
  }, []);

  useEffect(() => {
    if (isInitialized && typeof window !== 'undefined') {
      const cart: StoredCart = {
        storeSlug,
        items: items.map(toStoredCartItem),
        globalStartDate,
        globalEndDate,
        pricingMode,
      };
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    }
  }, [
    items,
    storeSlug,
    globalStartDate,
    globalEndDate,
    pricingMode,
    isInitialized,
  ]);

  const setGlobalDates = useCallback((startDate: string, endDate: string) => {
    setGlobalStartDate(startDate);
    setGlobalEndDate(endDate);
    // Update all items with new dates
    setItems((currentItems) =>
      currentItems.map((item) => ({
        ...item,
        startDate,
        endDate,
      })),
    );
  }, []);

  const setPricingMode = useCallback((mode: PricingMode) => {
    setPricingModeState(mode);
    // Update all items with new pricing mode
    setItems((currentItems) =>
      currentItems.map((item) => ({
        ...item,
        pricingMode: mode,
      })),
    );
  }, []);

  const addItem = useCallback(
    (
      item: Omit<
        CartItem,
        'lineId' | 'selectionSignature' | 'startDate' | 'endDate'
      >,
      newStoreSlug: string,
    ) => {
      // If no global dates set, use default dates (tomorrow to day after)
      const startDate =
        globalStartDate ||
        (() => {
          const d = new Date();
          d.setDate(d.getDate() + 1);
          d.setHours(0, 0, 0, 0);
          return d.toISOString();
        })();
      const endDate =
        globalEndDate ||
        (() => {
          const d = new Date();
          d.setDate(d.getDate() + 2);
          d.setHours(0, 0, 0, 0);
          return d.toISOString();
        })();

      const selectionSignature = buildSelectionSignature(
        item.selectedAttributes,
      );

      const buildFullItem = (): CartItem => ({
        ...item,
        lineId: createCartLineId(),
        selectionSignature,
        startDate,
        endDate,
      });

      if (storeSlug && storeSlug !== newStoreSlug) {
        // Different store, clear cart and add new item
        setItems([buildFullItem()]);
        setStoreSlug(newStoreSlug);
        setGlobalStartDate(startDate);
        setGlobalEndDate(endDate);
        return;
      }

      setItems((currentItems) => {
        const existingIndex = currentItems.findIndex(
          (i) =>
            i.productId === item.productId &&
            i.selectionSignature === selectionSignature,
        );

        if (existingIndex >= 0) {
          // Same product + same selection: merge quantities.
          const updated = [...currentItems];
          const existing = updated[existingIndex];
          updated[existingIndex] = {
            ...existing,
            ...item,
            selectionSignature,
            quantity: Math.min(
              existing.quantity + item.quantity,
              item.maxQuantity,
            ),
            maxQuantity: item.maxQuantity,
            startDate,
            endDate,
          };
          return updated;
        }

        return [...currentItems, buildFullItem()];
      });

      if (storeSlug !== newStoreSlug) {
        setStoreSlug(newStoreSlug);
      }
      if (!globalStartDate) setGlobalStartDate(startDate);
      if (!globalEndDate) setGlobalEndDate(endDate);
    },
    [globalStartDate, globalEndDate, storeSlug],
  );

  const removeItemByLineId = useCallback((lineId: string) => {
    setItems((currentItems) =>
      currentItems.filter((item) => item.lineId !== lineId),
    );
  }, []);

  const updateItemQuantityByLineId = useCallback(
    (lineId: string, quantity: number) => {
      if (quantity <= 0) {
        removeItemByLineId(lineId);
        return;
      }

      setItems((currentItems) =>
        currentItems.map((item) =>
          item.lineId === lineId
            ? {
                ...item,
                quantity: Math.min(Math.max(1, quantity), item.maxQuantity),
              }
            : item,
        ),
      );
    },
    [removeItemByLineId],
  );

  const getCartLinesByProductId = useCallback(
    (productId: string) => {
      return items.filter((item) => item.productId === productId);
    },
    [items],
  );

  const getProductQuantityInCart = useCallback(
    (productId: string) => {
      return items
        .filter((item) => item.productId === productId)
        .reduce((sum, item) => sum + item.quantity, 0);
    },
    [items],
  );

  const removeItem = useCallback((productId: string) => {
    setItems((currentItems) =>
      currentItems.filter((item) => item.productId !== productId),
    );
  }, []);

  const updateItemQuantity = useCallback(
    (productId: string, quantity: number) => {
      const firstLine = items.find((item) => item.productId === productId);
      if (!firstLine) return;
      updateItemQuantityByLineId(firstLine.lineId, quantity);
    },
    [items, updateItemQuantityByLineId],
  );

  const updateItemDates = useCallback(
    (productId: string, startDate: string, endDate: string) => {
      // In the new model, we update global dates instead
      setGlobalDates(startDate, endDate);
    },
    [setGlobalDates],
  );

  const clearCart = useCallback(() => {
    setItems([]);
    setStoreSlug(null);
    setGlobalStartDate(null);
    setGlobalEndDate(null);
  }, []);

  const getItemCount = useCallback(() => {
    return items.reduce((sum, item) => sum + item.quantity, 0);
  }, [items]);

  const getItemDuration = useCallback(
    (item: CartItem) => {
      const start = globalStartDate || item.startDate;
      const end = globalEndDate || item.endDate;
      if (!start || !end) return 1;
      const itemPricingMode =
        item.productPricingMode || item.pricingMode || 'day';
      return calculateDuration(start, end, itemPricingMode);
    },
    [globalStartDate, globalEndDate],
  );

  const getDuration = useCallback(() => {
    if (items.length === 0) return 1;
    return getItemDuration(items[0]);
  }, [items, getItemDuration]);

  // Calculate subtotal with tiered pricing (seasonal-aware)
  const getSubtotal = useCallback(() => {
    return items.reduce((sum, item) => {
      return (
        sum +
        calculateCartItemPrice(item, globalStartDate, globalEndDate).subtotal
      );
    }, 0);
  }, [items, globalStartDate, globalEndDate]);

  // Calculate original subtotal (without discounts, seasonal-aware)
  const getOriginalSubtotal = useCallback(() => {
    return items.reduce((sum, item) => {
      return (
        sum +
        calculateCartItemPrice(item, globalStartDate, globalEndDate)
          .originalSubtotal
      );
    }, 0);
  }, [items, globalStartDate, globalEndDate]);

  // Calculate total savings from tiered pricing
  const getTotalSavings = useCallback(() => {
    return getOriginalSubtotal() - getSubtotal();
  }, [getOriginalSubtotal, getSubtotal]);

  const getTotalDeposit = useCallback(() => {
    return items.reduce((sum, item) => sum + item.deposit * item.quantity, 0);
  }, [items]);

  const getTotal = useCallback(() => {
    // Deposit is NOT included in total - it's just a hold/authorization, not a payment
    return getSubtotal();
  }, [getSubtotal]);

  // Get complete pricing summary
  const getPricingSummary = useCallback((): CartPricingSummary => {
    const subtotal = getSubtotal();
    const originalSubtotal = getOriginalSubtotal();
    const deposit = getTotalDeposit();
    return {
      subtotal,
      originalSubtotal,
      totalSavings: originalSubtotal - subtotal,
      deposit,
      total: subtotal + deposit,
    };
  }, [getSubtotal, getOriginalSubtotal, getTotalDeposit]);

  const getCartItemByProductId = useCallback(
    (productId: string) => {
      return items.find((item) => item.productId === productId);
    },
    [items],
  );

  const isProductInCart = useCallback(
    (productId: string) => {
      return items.some((item) => item.productId === productId);
    },
    [items],
  );

  return (
    <CartContext.Provider
      value={{
        items,
        isResolving,
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
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (context === undefined) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
}
