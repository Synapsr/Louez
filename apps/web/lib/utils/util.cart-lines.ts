import type { PricingKind, StockKind } from "@louez/types";
import type { SeasonalPricingConfig, StockQuantityLimit } from "@louez/utils";
import type { StorefrontCartResolveInput, StorefrontCartResolveOutput } from "@louez/validations";

import { type CartPricingTier, calculateCartItemPrice } from "@/lib/utils/cart-pricing";
import {
  clampCartLineQuantityToAvailableMaximum,
  clampRequiredAccessoryLineQuantity,
  getCartLineAvailableMaximumQuantity,
  getRequiredAccessoryLineMinimumQuantity,
  reconcileRequiredAccessoryLineQuantity,
  reconcileSharedCartLineQuantities,
  type RequiredAccessoryCartInput,
} from "@/lib/utils/cart-required-accessories";
import type { PricingMode } from "@/lib/utils/duration";
import type { CartLineInput } from "@/lib/utils/util.cart-line-input";
import {
  type DisplayableSavings,
  getDisplayableSavings,
} from "@/lib/utils/util.discount-visibility";

/** Why the last server resolution refused a cart line. */
export type CartLineUnavailableReason =
  | "product_unavailable"
  | "insufficient_stock"
  | "required_accessory_unavailable";

/** One rental window for the whole cart. */
export interface CartPeriod {
  startDate: string;
  endDate: string;
}

/**
 * What the customer asked for: a product, a quantity, a variant selection and
 * an optional parent. The pricing fields are the snapshot the caller knew at
 * add time; the server resolution overrides them on every displayed line.
 */
export interface CartLineIntent {
  lineId: string;
  selectionSignature: string;
  productId: string;
  productName: string;
  productImage: string | null;
  price: number;
  deposit: number;
  quantity: number;
  maxQuantity: StockQuantityLimit;
  pricingKind: PricingKind;
  stockKind?: StockKind;
  pricingTiers?: CartPricingTier[];
  basePeriodMinutes?: number | null;
  enforceStrictTiers?: boolean;
  productPricingMode?: PricingMode | null;
  selectedAttributes?: Record<string, string>;
  resolvedCombinationKey?: string;
  resolvedAttributes?: Record<string, string>;
  seasonalPricings?: SeasonalPricingConfig[];
  /** Set on a line auto-added with its parent product; it follows the parent. */
  parentLineId?: string;
  /** Units of this accessory required per unit of the parent line. */
  requiredQuantity?: number;
}

/** A displayed cart line: the intent completed by the server resolution. */
export interface CartItem extends CartLineIntent {
  unavailableReason?: CartLineUnavailableReason;
  startDate: string;
  endDate: string;
  pricingMode: PricingMode;
}

export type CartResolutionLine = StorefrontCartResolveOutput["lines"][number];

/**
 * What `addCartLine` receives: a line minus what the cart assigns itself.
 * The pricing mode is optional because the cart applies its own to every line.
 */
export type AddCartLineInput = Omit<CartLineInput, "pricingMode"> & {
  pricingMode?: PricingMode;
};

export interface CartSummary {
  /** Units across every line, required accessories included. */
  count: number;
  subtotal: number;
  originalSubtotal: number;
  totalSavings: number;
  deposit: number;
  /** Deposit excluded: it is a hold, not a payment. */
  total: number;
  displayableSavings: DisplayableSavings;
}

const DEFAULT_SIGNATURE = "__default";

const normalizeSignatureValue = (value: string): string => value.trim().replace(/\s+/g, " ");

/** Identity of a variant selection: `productId + signature` names a line. */
export const buildSelectionSignature = (
  selectedAttributes: Record<string, string> | undefined,
): string => {
  const entries = Object.entries(selectedAttributes ?? {})
    .map(([key, value]) => [key.trim().toLowerCase(), normalizeSignatureValue(value)] as const)
    .filter(([key, value]) => Boolean(key) && Boolean(value))
    .sort((a, b) => a[0].localeCompare(b[0], "en"));

  if (entries.length === 0) {
    return DEFAULT_SIGNATURE;
  }

  return entries.map(([key, value]) => `${key}:${value}`).join("|");
};

export const createCartLineId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `line_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

/** Tomorrow to the day after, midnight local: the period of a dateless add. */
export const getDefaultCartPeriod = (now = new Date()): CartPeriod => {
  const start = new Date(now);
  start.setDate(start.getDate() + 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setDate(end.getDate() + 2);
  end.setHours(0, 0, 0, 0);

  return { startDate: start.toISOString(), endDate: end.toISOString() };
};

/**
 * A child line whose parent is gone (older cart, hand-edited storage) would be
 * locked forever: it can neither be removed on its own nor follow a parent.
 * Freeing it keeps the cart usable.
 */
export const detachOrphanRequiredLines = <T extends CartLineIntent>(lines: T[]): T[] => {
  const lineIds = new Set(lines.map((line) => line.lineId));

  return lines.map((line) =>
    line.parentLineId && !lineIds.has(line.parentLineId)
      ? { ...line, parentLineId: undefined, requiredQuantity: undefined }
      : line,
  );
};

/** Realigns required lines while retaining units added by the customer. */
const syncRequiredLineQuantities = (
  lines: CartLineIntent[],
  parentLineId: string,
  nextParentQuantity: number,
): CartLineIntent[] =>
  lines.map((line) =>
    line.parentLineId === parentLineId
      ? {
          ...line,
          quantity: reconcileRequiredAccessoryLineQuantity(line, {
            nextParentQuantity,
            nextRequiredQuantity: Math.max(1, line.requiredQuantity ?? 1),
          }),
        }
      : line,
  );

/**
 * Attaches the required accessories of a parent line, creating a child line
 * per accessory or refreshing the one already attached. Free-standing lines of
 * the same accessory are left untouched: they belong to the customer.
 */
const attachRequiredAccessoryLines = (
  lines: CartLineIntent[],
  parentLineId: string,
  parentQuantity: number,
  requiredAccessories: RequiredAccessoryCartInput[],
): CartLineIntent[] => {
  if (requiredAccessories.length === 0) {
    return lines;
  }

  const nextLines = [...lines];

  for (const accessory of requiredAccessories) {
    const existingIndex = nextLines.findIndex(
      (line) => line.parentLineId === parentLineId && line.productId === accessory.productId,
    );

    if (existingIndex >= 0) {
      const existing = nextLines[existingIndex];
      nextLines[existingIndex] = {
        ...existing,
        productName: accessory.productName,
        productImage: accessory.productImage,
        price: accessory.price,
        deposit: accessory.deposit,
        maxQuantity: accessory.maxQuantity,
        requiredQuantity: accessory.requiredQuantity,
        quantity: reconcileRequiredAccessoryLineQuantity(
          { ...existing, maxQuantity: accessory.maxQuantity },
          {
            nextParentQuantity: parentQuantity,
            nextRequiredQuantity: accessory.requiredQuantity,
          },
        ),
      };
      continue;
    }

    nextLines.push({
      lineId: createCartLineId(),
      selectionSignature: DEFAULT_SIGNATURE,
      productId: accessory.productId,
      productName: accessory.productName,
      productImage: accessory.productImage,
      price: accessory.price,
      deposit: accessory.deposit,
      quantity: getRequiredAccessoryLineMinimumQuantity(accessory, parentQuantity),
      maxQuantity: accessory.maxQuantity,
      pricingKind: accessory.pricingKind,
      pricingTiers: accessory.pricingTiers,
      basePeriodMinutes: accessory.basePeriodMinutes,
      productPricingMode: accessory.productPricingMode,
      parentLineId,
      requiredQuantity: accessory.requiredQuantity,
    });
  }

  return nextLines;
};

/**
 * Adds a line. Same product + same selection merges into the existing
 * free-standing line, capped at what is available; a new line is dropped
 * when nothing is left for it. Required accessories follow the parent.
 */
export const addCartLine = (lines: CartLineIntent[], input: AddCartLineInput): CartLineIntent[] => {
  const { requiredAccessories = [], ...lineInput } = input;
  const selectionSignature = buildSelectionSignature(input.selectedAttributes);
  const pricingKind = lineInput.pricingKind ?? "duration";

  const existingIndex = lines.findIndex(
    (line) =>
      line.productId === input.productId &&
      line.selectionSignature === selectionSignature &&
      !line.parentLineId,
  );

  if (existingIndex >= 0) {
    const updated = [...lines];
    const existing = updated[existingIndex];
    const requestedQuantity = existing.quantity + input.quantity;
    const mergedQuantity =
      input.maxQuantity === null
        ? requestedQuantity
        : Math.min(requestedQuantity, input.maxQuantity);
    updated[existingIndex] = {
      ...existing,
      ...lineInput,
      pricingKind,
      selectionSignature,
      quantity: mergedQuantity,
      parentLineId: existing.parentLineId,
      requiredQuantity: existing.requiredQuantity,
    };
    updated[existingIndex] = {
      ...updated[existingIndex],
      quantity: clampCartLineQuantityToAvailableMaximum(updated, updated[existingIndex]),
    };

    return reconcileSharedCartLineQuantities(
      attachRequiredAccessoryLines(
        updated,
        existing.lineId,
        updated[existingIndex].quantity,
        requiredAccessories,
      ),
    );
  }

  const newLine: CartLineIntent = {
    ...lineInput,
    pricingKind,
    lineId: createCartLineId(),
    selectionSignature,
  };
  const updated = [...lines, newLine];
  const clampedQuantity = clampCartLineQuantityToAvailableMaximum(updated, newLine);
  if (clampedQuantity === 0) {
    return lines;
  }
  updated[updated.length - 1] = { ...newLine, quantity: clampedQuantity };

  return reconcileSharedCartLineQuantities(
    attachRequiredAccessoryLines(updated, newLine.lineId, clampedQuantity, requiredAccessories),
  );
};

export interface RemoveCartLineResult {
  lines: CartLineIntent[];
  /** The line and its required accessories, in cart order, for an undo. */
  removed: CartLineIntent[];
}

/** A required accessory only leaves the cart with its parent. */
export const removeCartLine = (lines: CartLineIntent[], lineId: string): RemoveCartLineResult => {
  const target = lines.find((line) => line.lineId === lineId);
  if (!target || target.parentLineId) {
    return { lines, removed: [] };
  }

  const isRemoved = (line: CartLineIntent) =>
    line.lineId === lineId || line.parentLineId === lineId;

  return {
    lines: lines.filter((line) => !isRemoved(line)),
    removed: lines.filter(isRemoved),
  };
};

/** Removes every free-standing line of a product, children included. */
export const removeCartLinesByProduct = (
  lines: CartLineIntent[],
  productId: string,
): CartLineIntent[] => {
  const removedLineIds = new Set(
    lines
      .filter((line) => line.productId === productId && !line.parentLineId)
      .map((line) => line.lineId),
  );

  return lines.filter(
    (line) =>
      !removedLineIds.has(line.lineId) &&
      !(line.parentLineId && removedLineIds.has(line.parentLineId)),
  );
};

/** Puts removed lines back (undo); lines already present are not duplicated. */
export const restoreCartLines = (
  lines: CartLineIntent[],
  removed: CartLineIntent[],
): CartLineIntent[] => {
  const present = new Set(lines.map((line) => line.lineId));
  const missing = removed.filter((line) => !present.has(line.lineId));
  if (missing.length === 0) {
    return lines;
  }

  return reconcileSharedCartLineQuantities([...lines, ...missing]);
};

/**
 * Sets a line's quantity. A parent line at 0 leaves with its accessories; a
 * required accessory stays between its minimum and what is available.
 */
export const setCartLineQuantity = (
  lines: CartLineIntent[],
  lineId: string,
  quantity: number,
): CartLineIntent[] => {
  const target = lines.find((line) => line.lineId === lineId);
  if (!target) {
    return lines;
  }

  if (target.parentLineId) {
    const parent = lines.find((line) => line.lineId === target.parentLineId);
    if (!parent) {
      return lines;
    }

    const clampedQuantity = clampRequiredAccessoryLineQuantity(
      {
        ...target,
        maxQuantity: getCartLineAvailableMaximumQuantity(lines, target),
      },
      { parentQuantity: parent.quantity, requestedQuantity: quantity },
    );

    return reconcileSharedCartLineQuantities(
      lines.map((line) => (line.lineId === lineId ? { ...line, quantity: clampedQuantity } : line)),
    );
  }

  if (quantity <= 0) {
    return removeCartLine(lines, lineId).lines;
  }

  const requestedQuantity = Math.max(1, quantity);
  const maximumQuantity = getCartLineAvailableMaximumQuantity(lines, target);
  const nextQuantity =
    maximumQuantity === null
      ? requestedQuantity
      : Math.min(requestedQuantity, Math.max(1, maximumQuantity));
  const updated = lines.map((line) =>
    line.lineId === lineId ? { ...line, quantity: nextQuantity } : line,
  );

  return reconcileSharedCartLineQuantities(
    syncRequiredLineQuantities(updated, lineId, nextQuantity),
  );
};

/** The resolve request for the current intent; one period for every line. */
export const buildCartResolveInput = (
  lines: CartLineIntent[],
  period: CartPeriod,
): StorefrontCartResolveInput => ({
  lines: lines.map((line) => ({
    lineId: line.lineId,
    parentLineId: line.parentLineId,
    productId: line.productId,
    quantity: line.quantity,
    startDate: period.startDate,
    endDate: period.endDate,
    selectedAttributes: line.selectedAttributes,
  })),
});

const applyResolvedLine = (
  line: CartLineIntent,
  resolved: CartResolutionLine | undefined,
  lines: CartLineIntent[],
): Omit<CartItem, "startDate" | "endDate" | "pricingMode"> => {
  if (!resolved) {
    return line;
  }

  if (resolved.status === "unavailable") {
    return {
      ...line,
      unavailableReason: resolved.reason,
      ...(resolved.stockKind ? { stockKind: resolved.stockKind } : {}),
      ...(typeof resolved.maxQuantity === "number" ? { maxQuantity: resolved.maxQuantity } : {}),
    };
  }

  // The store owns the requirement: a link dropped server-side unlocks the
  // line here instead of leaving the customer with a stuck child.
  const stillRequired = Boolean(resolved.required && line.parentLineId);
  const nextLine = {
    ...line,
    productName: resolved.productName,
    productImage: resolved.productImage,
    price: resolved.price,
    deposit: resolved.deposit,
    maxQuantity: resolved.maxQuantity,
    pricingKind: resolved.pricingKind,
    stockKind: resolved.stockKind,
    productPricingMode: resolved.productPricingMode,
    basePeriodMinutes: resolved.basePeriodMinutes,
    enforceStrictTiers: resolved.enforceStrictTiers,
    pricingTiers: resolved.pricingTiers,
    seasonalPricings: resolved.seasonalPricings,
    parentLineId: stillRequired ? line.parentLineId : undefined,
    requiredQuantity: stillRequired
      ? (resolved.requiredQuantity ?? line.requiredQuantity)
      : undefined,
    unavailableReason: undefined,
  };

  if (!stillRequired) {
    return nextLine;
  }

  const parent = lines.find((candidate) => candidate.lineId === line.parentLineId);
  if (!parent) {
    return nextLine;
  }

  return {
    ...nextLine,
    quantity: reconcileRequiredAccessoryLineQuantity(nextLine, {
      nextParentQuantity: parent.quantity,
      nextRequiredQuantity: Math.max(1, nextLine.requiredQuantity ?? 1),
    }),
  };
};

export interface DeriveCartItemsParams {
  lines: CartLineIntent[];
  resolution: StorefrontCartResolveOutput | undefined;
  period: CartPeriod | null;
  pricingMode: PricingMode;
}

/**
 * The displayed lines: intent completed by the last resolution. Lines the
 * resolution does not know yet (a fresh add, a stale response) keep their
 * snapshot, so nothing flickers while the request is in flight.
 */
export const deriveCartItems = ({
  lines,
  resolution,
  period,
  pricingMode,
}: DeriveCartItemsParams): CartItem[] => {
  const resolvedByLineId = new Map((resolution?.lines ?? []).map((line) => [line.lineId, line]));
  const effectivePeriod = period ?? getDefaultCartPeriod();

  const items = lines.map(
    (line): CartItem => ({
      ...applyResolvedLine(line, resolvedByLineId.get(line.lineId), lines),
      startDate: effectivePeriod.startDate,
      endDate: effectivePeriod.endDate,
      pricingMode,
    }),
  );

  return reconcileSharedCartLineQuantities(items);
};

export const summarizeCart = (
  items: CartItem[],
  period: CartPeriod | null,
  maxDiscountPercent: number | null | undefined,
): CartSummary => {
  const startDate = period?.startDate ?? null;
  const endDate = period?.endDate ?? null;
  const prices = items.map((item) => calculateCartItemPrice(item, startDate, endDate));
  const subtotal = prices.reduce((sum, price) => sum + price.subtotal, 0);
  const originalSubtotal = prices.reduce((sum, price) => sum + price.originalSubtotal, 0);
  const deposit = items.reduce((sum, item) => sum + item.deposit * item.quantity, 0);

  return {
    count: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal,
    originalSubtotal,
    totalSavings: originalSubtotal - subtotal,
    deposit,
    total: subtotal,
    displayableSavings: getDisplayableSavings(prices, maxDiscountPercent),
  };
};

export const hasUnavailableCartLines = (items: CartItem[]): boolean =>
  items.some((item) => Boolean(item.unavailableReason));
