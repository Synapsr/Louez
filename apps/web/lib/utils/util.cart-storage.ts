import { z } from "zod";

import type { PricingMode } from "@/lib/utils/duration";
import type { CartLineIntent, CartPeriod } from "@/lib/utils/util.cart-lines";
import {
  buildSelectionSignature,
  createCartLineId,
  detachOrphanRequiredLines,
} from "@/lib/utils/util.cart-lines";

/** Key every store used before carts were scoped per store. */
export const LEGACY_CART_STORAGE_KEY = "louez_cart";

/** `louez_cart:{slug}`: one cart per store, so two shops never share a basket. */
export const getCartStorageKey = (storeSlug: string): string =>
  `${LEGACY_CART_STORAGE_KEY}:${storeSlug}`;

const pricingModeSchema = z.enum(["hour", "day", "week"]);

const storedCartLineSchema = z.object({
  lineId: z.string().min(1).optional(),
  selectionSignature: z.string().min(1).optional(),
  productId: z.string().min(1),
  productName: z.string().optional(),
  productImage: z.string().nullable().optional(),
  quantity: z.number().int().min(1),
  maxQuantity: z.number().nullable().optional(),
  pricingKind: z.enum(["duration", "fixed"]).optional(),
  stockKind: z.enum(["returnable", "consumable", "untracked"]).optional(),
  selectedAttributes: z.record(z.string(), z.string()).optional(),
  parentLineId: z.string().min(1).optional(),
  requiredQuantity: z.number().int().min(1).optional(),
});

/**
 * Both the legacy `items` shape and the scoped `lines` shape parse: the
 * migration reads the old key with the same codec.
 */
const storedCartSchema = z.object({
  storeSlug: z.string().nullable().optional(),
  lines: z.array(storedCartLineSchema).optional(),
  items: z.array(storedCartLineSchema).optional(),
  period: z.object({ startDate: z.string(), endDate: z.string() }).nullable().optional(),
  globalStartDate: z.string().nullable().optional(),
  globalEndDate: z.string().nullable().optional(),
  pricingMode: pricingModeSchema.optional(),
});

export type StoredCartLine = z.infer<typeof storedCartLineSchema>;

export interface StoredCart {
  storeSlug: string | null;
  lines: StoredCartLine[];
  period: CartPeriod | null;
  pricingMode: PricingMode;
}

/** The subset of `Storage` the codec touches; tests pass a plain map. */
export interface CartStorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

const parseStoredPeriod = (parsed: z.infer<typeof storedCartSchema>): CartPeriod | null => {
  if (parsed.period) {
    return parsed.period;
  }
  if (parsed.globalStartDate && parsed.globalEndDate) {
    return { startDate: parsed.globalStartDate, endDate: parsed.globalEndDate };
  }
  return null;
};

/** Parses a raw storage value; anything malformed yields `null` (start fresh). */
export const parseStoredCart = (raw: string | null): StoredCart | null => {
  if (!raw) {
    return null;
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }

  const result = storedCartSchema.safeParse(json);
  if (!result.success) {
    return null;
  }

  return {
    storeSlug: result.data.storeSlug ?? null,
    lines: result.data.lines ?? result.data.items ?? [],
    period: parseStoredPeriod(result.data),
    pricingMode: result.data.pricingMode ?? "day",
  };
};

/** Restores a stored line as an intent line the resolution will complete. */
export const toCartLineIntent = (line: StoredCartLine): CartLineIntent => ({
  lineId: line.lineId ?? createCartLineId(),
  selectionSignature: line.selectionSignature ?? buildSelectionSignature(line.selectedAttributes),
  productId: line.productId,
  productName: line.productName ?? "",
  productImage: line.productImage ?? null,
  price: 0,
  deposit: 0,
  quantity: line.quantity,
  maxQuantity:
    line.stockKind === "untracked" ? null : (line.maxQuantity ?? Math.max(1, line.quantity)),
  pricingKind: line.pricingKind ?? "duration",
  stockKind: line.stockKind,
  selectedAttributes: line.selectedAttributes,
  parentLineId: line.parentLineId,
  requiredQuantity: line.requiredQuantity,
});

export const toStoredCartLine = (line: CartLineIntent): StoredCartLine => ({
  lineId: line.lineId,
  selectionSignature: line.selectionSignature,
  productId: line.productId,
  productName: line.productName,
  productImage: line.productImage,
  quantity: line.quantity,
  maxQuantity: line.maxQuantity,
  pricingKind: line.pricingKind,
  stockKind: line.stockKind,
  selectedAttributes: line.selectedAttributes,
  parentLineId: line.parentLineId,
  requiredQuantity: line.requiredQuantity,
});

export interface RestoredCart {
  lines: CartLineIntent[];
  period: CartPeriod | null;
  pricingMode: PricingMode;
}

const EMPTY_RESTORED_CART: RestoredCart = {
  lines: [],
  period: null,
  pricingMode: "day",
};

/**
 * Reads the store's cart. The first visit after the key change migrates the
 * legacy `louez_cart` entry: it is kept only when it belonged to this store,
 * and removed either way so no other store inherits it.
 */
export const readCartFromStorage = (storage: CartStorageLike, storeSlug: string): RestoredCart => {
  const scopedKey = getCartStorageKey(storeSlug);
  let stored = parseStoredCart(storage.getItem(scopedKey));

  const legacyRaw = storage.getItem(LEGACY_CART_STORAGE_KEY);
  if (legacyRaw !== null) {
    storage.removeItem(LEGACY_CART_STORAGE_KEY);
    if (!stored) {
      const legacy = parseStoredCart(legacyRaw);
      if (legacy && legacy.storeSlug === storeSlug) {
        stored = legacy;
      }
    }
  }

  if (!stored) {
    return EMPTY_RESTORED_CART;
  }

  return {
    lines: detachOrphanRequiredLines(stored.lines.map(toCartLineIntent)),
    period: stored.period,
    pricingMode: stored.pricingMode,
  };
};

export const writeCartToStorage = (
  storage: CartStorageLike,
  storeSlug: string,
  cart: RestoredCart,
): void => {
  const stored: StoredCart = {
    storeSlug,
    lines: cart.lines.map(toStoredCartLine),
    period: cart.period,
    pricingMode: cart.pricingMode,
  };
  storage.setItem(getCartStorageKey(storeSlug), JSON.stringify(stored));
};
