"use client";

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { useStore, useStoreMaxDiscountPercent } from "@/contexts/store-context";
import { useDebounce } from "@/hooks/use-debounce";
import { cartQueries } from "@/lib/queries/cart.queries";
import { type PricingMode, calculateDuration } from "@/lib/utils/duration";
import {
  type AddCartLineInput,
  type CartItem,
  type CartLineIntent,
  type CartPeriod,
  type CartSummary,
  addCartLine,
  buildCartResolveInput,
  deriveCartItems,
  getDefaultCartPeriod,
  hasUnavailableCartLines,
  removeCartLine,
  removeCartLinesByProduct,
  restoreCartLines,
  setCartLineQuantity,
  summarizeCart,
} from "@/lib/utils/util.cart-lines";
import { readCartFromStorage, writeCartToStorage } from "@/lib/utils/util.cart-storage";
import type { DisplayableSavings } from "@/lib/utils/util.discount-visibility";

export type {
  CartItem,
  CartLineIntent,
  CartLineUnavailableReason,
  CartPeriod,
  CartSummary,
} from "@/lib/utils/util.cart-lines";

/** Typing after the last intent change before the cart is resolved. */
const RESOLVE_DEBOUNCE_MS = 250;

/** What `addItem` receives; the period is optional and applies to the whole cart. */
export type AddCartItemInput = AddCartLineInput & {
  startDate?: string;
  endDate?: string;
};

export interface AddCartItemOptions {
  startDate?: string;
  endDate?: string;
  /** Ignored: the provider is already scoped to one store. Kept for old callers. */
  storeSlug?: string;
}

export type CartResolutionStatus = "idle" | "loading" | "ready" | "error";

export interface CartState {
  items: CartItem[];
  /** True while a resolution request is in flight (first or refresh). */
  isResolving: boolean;
  resolutionStatus: CartResolutionStatus;
  hasUnavailableLines: boolean;
  summary: CartSummary;
  storeSlug: string | null;
  period: CartPeriod | null;
  globalStartDate: string | null;
  globalEndDate: string | null;
  pricingMode: PricingMode;
}

export interface CartActions {
  addItem: (item: AddCartItemInput, storeSlugOrOptions?: string | AddCartItemOptions) => void;
  /** Returns the removed lines (parent + required accessories) for an undo. */
  removeItemByLineId: (lineId: string) => CartLineIntent[];
  restoreLines: (lines: CartLineIntent[]) => void;
  updateItemQuantityByLineId: (lineId: string, quantity: number) => void;
  setPeriod: (startDate: string, endDate: string) => void;
  /** Alias of `setPeriod` for callers not migrated yet. */
  setGlobalDates: (startDate: string, endDate: string) => void;
  setPricingMode: (mode: PricingMode) => void;
  clearCart: () => void;
  // Product-level helpers kept for callers not migrated yet.
  removeItem: (productId: string) => void;
  updateItemQuantity: (productId: string, quantity: number) => void;
  updateItemDates: (productId: string, startDate: string, endDate: string) => void;
}

interface CartPricingSummary {
  subtotal: number;
  originalSubtotal: number;
  totalSavings: number;
  deposit: number;
  total: number;
}

/** Getters computed from the state; kept so existing consumers read the same names. */
export interface CartGetters {
  getCartLinesByProductId: (productId: string) => CartItem[];
  getProductQuantityInCart: (productId: string) => number;
  getItemCount: () => number;
  getSubtotal: () => number;
  getTotalDeposit: () => number;
  getTotal: () => number;
  getDuration: () => number;
  getCartItemByProductId: (productId: string) => CartItem | undefined;
  isProductInCart: (productId: string) => boolean;
  getTotalSavings: () => number;
  getOriginalSubtotal: () => number;
  /** Savings the store is willing to advertise, per its discount display cap. */
  getDisplayableSavings: () => DisplayableSavings;
  getPricingSummary: () => CartPricingSummary;
}

export type CartContextValue = CartState & CartActions & CartGetters;

export interface CartDrawerState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  setOpen: (open: boolean) => void;
}

const CartStateContext = createContext<CartState | undefined>(undefined);
const CartActionsContext = createContext<CartActions | undefined>(undefined);
const CartDrawerContext = createContext<CartDrawerState | undefined>(undefined);

const EMPTY_SUMMARY: CartSummary = {
  count: 0,
  subtotal: 0,
  originalSubtotal: 0,
  totalSavings: 0,
  deposit: 0,
  total: 0,
  displayableSavings: { savings: 0, originalSubtotal: 0 },
};

const getBrowserStorage = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

const resolveRequestedPeriod = (
  item: AddCartItemInput,
  options: AddCartItemOptions,
): CartPeriod | null => {
  const startDate = options.startDate ?? item.startDate;
  const endDate = options.endDate ?? item.endDate;
  return startDate && endDate ? { startDate, endDate } : null;
};

const buildGetters = (state: CartState): CartGetters => {
  const { items, summary, period } = state;

  return {
    getCartLinesByProductId: (productId) => items.filter((item) => item.productId === productId),
    getProductQuantityInCart: (productId) =>
      items
        .filter((item) => item.productId === productId)
        .reduce((sum, item) => sum + item.quantity, 0),
    getItemCount: () => summary.count,
    getSubtotal: () => summary.subtotal,
    getTotalDeposit: () => summary.deposit,
    getTotal: () => summary.total,
    getDuration: () => {
      const first = items[0];
      if (!first || !period) {
        return 1;
      }
      return calculateDuration(
        period.startDate,
        period.endDate,
        first.productPricingMode || first.pricingMode || "day",
      );
    },
    getCartItemByProductId: (productId) => items.find((item) => item.productId === productId),
    isProductInCart: (productId) => items.some((item) => item.productId === productId),
    getTotalSavings: () => summary.totalSavings,
    getOriginalSubtotal: () => summary.originalSubtotal,
    getDisplayableSavings: () => summary.displayableSavings,
    getPricingSummary: () => ({
      subtotal: summary.subtotal,
      originalSubtotal: summary.originalSubtotal,
      totalSavings: summary.totalSavings,
      deposit: summary.deposit,
      total: summary.subtotal + summary.deposit,
    }),
  };
};

/**
 * Holds the customer's intent (lines + one period) and derives what is shown
 * from the server resolution. Storage is scoped per store; the legacy shared
 * key is migrated once and removed.
 */
export const CartProvider = ({ children }: { children: ReactNode }) => {
  const { storeSlug } = useStore();
  const maxDiscountPercent = useStoreMaxDiscountPercent();

  const [lines, setLines] = useState<CartLineIntent[]>([]);
  const [period, setPeriodState] = useState<CartPeriod | null>(null);
  const [pricingMode, setPricingModeState] = useState<PricingMode>("day");
  const [isHydrated, setIsHydrated] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Read once per store, after mount: the server never sees the storage.
  useEffect(() => {
    const storage = getBrowserStorage();
    if (storage) {
      const restored = readCartFromStorage(storage, storeSlug);
      setLines(restored.lines);
      setPeriodState(restored.period);
      setPricingModeState(restored.pricingMode);
    }
    setIsHydrated(true);
  }, [storeSlug]);

  useEffect(() => {
    const storage = getBrowserStorage();
    if (!isHydrated || !storage) {
      return;
    }
    writeCartToStorage(storage, storeSlug, { lines, period, pricingMode });
  }, [isHydrated, lines, period, pricingMode, storeSlug]);

  const linesRef = useRef(lines);
  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

  const resolveInput = useMemo(
    () => buildCartResolveInput(lines, period ?? getDefaultCartPeriod()),
    [lines, period],
  );
  const debouncedInput = useDebounce(resolveInput, RESOLVE_DEBOUNCE_MS);

  const {
    data: resolution,
    isFetching,
    isError,
  } = useQuery({
    ...cartQueries.resolve(debouncedInput),
    enabled: isHydrated && debouncedInput.lines.length > 0,
    placeholderData: keepPreviousData,
  });

  const items = useMemo(
    () => deriveCartItems({ lines, resolution, period, pricingMode }),
    [lines, resolution, period, pricingMode],
  );

  const summary = useMemo(
    () => (items.length === 0 ? EMPTY_SUMMARY : summarizeCart(items, period, maxDiscountPercent)),
    [items, period, maxDiscountPercent],
  );

  const resolutionStatus = useMemo((): CartResolutionStatus => {
    if (lines.length === 0) {
      return "idle";
    }
    if (isError) {
      return "error";
    }
    return resolution ? "ready" : "loading";
  }, [lines.length, isError, resolution]);

  const state = useMemo(
    (): CartState => ({
      items,
      isResolving: isFetching,
      resolutionStatus,
      hasUnavailableLines: hasUnavailableCartLines(items),
      summary,
      storeSlug,
      period,
      globalStartDate: period?.startDate ?? null,
      globalEndDate: period?.endDate ?? null,
      pricingMode,
    }),
    [items, isFetching, resolutionStatus, summary, storeSlug, period, pricingMode],
  );

  const setPeriod = useCallback((startDate: string, endDate: string) => {
    setPeriodState({ startDate, endDate });
  }, []);

  const addItem = useCallback<CartActions["addItem"]>((item, storeSlugOrOptions) => {
    const options = typeof storeSlugOrOptions === "string" ? {} : (storeSlugOrOptions ?? {});
    const requestedPeriod = resolveRequestedPeriod(item, options);
    const { startDate: _start, endDate: _end, ...lineInput } = item;

    setPeriodState((current) => requestedPeriod ?? current ?? getDefaultCartPeriod());
    setLines((current) => addCartLine(current, lineInput));
  }, []);

  const removeItemByLineId = useCallback((lineId: string) => {
    const result = removeCartLine(linesRef.current, lineId);
    if (result.removed.length > 0) {
      setLines(result.lines);
    }
    return result.removed;
  }, []);

  const restoreLines = useCallback((removed: CartLineIntent[]) => {
    setLines((current) => restoreCartLines(current, removed));
  }, []);

  const updateItemQuantityByLineId = useCallback((lineId: string, quantity: number) => {
    setLines((current) => setCartLineQuantity(current, lineId, quantity));
  }, []);

  const removeItem = useCallback((productId: string) => {
    setLines((current) => removeCartLinesByProduct(current, productId));
  }, []);

  const updateItemQuantity = useCallback(
    (productId: string, quantity: number) => {
      const first = linesRef.current.find((line) => line.productId === productId);
      if (first) {
        updateItemQuantityByLineId(first.lineId, quantity);
      }
    },
    [updateItemQuantityByLineId],
  );

  const updateItemDates = useCallback(
    (_productId: string, startDate: string, endDate: string) => {
      setPeriod(startDate, endDate);
    },
    [setPeriod],
  );

  const clearCart = useCallback(() => {
    setLines([]);
    setPeriodState(null);
  }, []);

  const actions = useMemo(
    (): CartActions => ({
      addItem,
      removeItemByLineId,
      restoreLines,
      updateItemQuantityByLineId,
      setPeriod,
      setGlobalDates: setPeriod,
      setPricingMode: setPricingModeState,
      clearCart,
      removeItem,
      updateItemQuantity,
      updateItemDates,
    }),
    [
      addItem,
      removeItemByLineId,
      restoreLines,
      updateItemQuantityByLineId,
      setPeriod,
      clearCart,
      removeItem,
      updateItemQuantity,
      updateItemDates,
    ],
  );

  const drawer = useMemo(
    (): CartDrawerState => ({
      isOpen: isDrawerOpen,
      open: () => setIsDrawerOpen(true),
      close: () => setIsDrawerOpen(false),
      toggle: () => setIsDrawerOpen((current) => !current),
      setOpen: setIsDrawerOpen,
    }),
    [isDrawerOpen],
  );

  return (
    <CartStateContext.Provider value={state}>
      <CartActionsContext.Provider value={actions}>
        <CartDrawerContext.Provider value={drawer}>{children}</CartDrawerContext.Provider>
      </CartActionsContext.Provider>
    </CartStateContext.Provider>
  );
};

export const useCartState = (): CartState => {
  const context = useContext(CartStateContext);
  if (context === undefined) {
    throw new Error("useCartState must be used within a CartProvider");
  }
  return context;
};

export const useCartActions = (): CartActions => {
  const context = useContext(CartActionsContext);
  if (context === undefined) {
    throw new Error("useCartActions must be used within a CartProvider");
  }
  return context;
};

/** Open/close state of the global cart drawer, for product pages and the header. */
export const useCartDrawer = (): CartDrawerState => {
  const context = useContext(CartDrawerContext);
  if (context === undefined) {
    throw new Error("useCartDrawer must be used within a CartProvider");
  }
  return context;
};

/** State, actions and getters in one object, as before the split. */
export const useCart = (): CartContextValue => {
  const state = useCartState();
  const actions = useCartActions();

  return useMemo(() => ({ ...state, ...actions, ...buildGetters(state) }), [state, actions]);
};
