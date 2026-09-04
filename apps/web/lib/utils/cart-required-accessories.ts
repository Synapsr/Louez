import type { PricingKind, PricingMode, StockKind } from '@louez/types';
import {
  combineStockQuantityLimits,
  type StockQuantityLimit,
} from '@louez/utils';

/**
 * Minimal accessory-link shape shared by every storefront surface that can put
 * a product in the cart (product page, product modal, catalog card, rental
 * card). Each surface projects its own accessory rows, so the contract stays
 * structural: only the fields the required-accessory rules read are declared.
 */
export interface AccessoryLink {
  id: string;
  name: string;
  price: string;
  deposit: string;
  images: string[] | null;
  /** Units of this accessory currently bookable (already effective stock). */
  quantity: StockQuantityLimit;
  /** True when the accessory must be booked with its parent product. */
  required?: boolean | null;
  /** Units of this accessory required per unit of the parent product. */
  requiredQuantity?: number | null;
  pricingKind?: PricingKind | null;
  pricingMode: PricingMode | null;
  basePeriodMinutes?: number | null;
  pricingTiers?: Array<{
    id: string;
    minDuration: number | null;
    discountPercent: string | number | null;
    period?: number | null;
    price?: string | number | null;
  }>;
}

/**
 * A required accessory ready to be attached to a parent cart line. The
 * quantity is deliberately absent: the cart owns it and always keeps it at
 * `requiredQuantity x parent quantity`.
 */
export interface RequiredAccessoryCartInput {
  productId: string;
  productName: string;
  productImage: string | null;
  price: number;
  deposit: number;
  maxQuantity: StockQuantityLimit;
  /** Units required per unit of the parent line. */
  requiredQuantity: number;
  pricingKind: PricingKind;
  pricingMode: PricingMode;
  productPricingMode: PricingMode | null;
  basePeriodMinutes: number | null;
  pricingTiers?: Array<{
    id: string;
    minDuration: number;
    discountPercent: number;
    period: number | null;
    price: number | null;
  }>;
}

function toNumber(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isNaN(value) ? null : value;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Units of an accessory needed for a single unit of its parent product. */
export function getRequiredAccessoryUnitQuantity(
  accessory: Pick<AccessoryLink, 'requiredQuantity'>,
): number {
  return Math.max(1, accessory.requiredQuantity ?? 1);
}

interface RequiredAccessoryCartLineQuantity {
  maxQuantity: StockQuantityLimit;
  requiredQuantity?: number | null;
}

interface CartLineQuantity extends RequiredAccessoryCartLineQuantity {
  lineId: string;
  productId: string;
  stockKind?: StockKind | null;
  selectionSignature?: string;
  quantity: number;
  parentLineId?: string;
}

/** Minimum units the child line must carry for its current parent quantity. */
export function getRequiredAccessoryLineMinimumQuantity(
  line: Pick<RequiredAccessoryCartLineQuantity, 'requiredQuantity'>,
  parentQuantity: number,
): number {
  return getRequiredAccessoryUnitQuantity(line) * Math.max(1, parentQuantity);
}

/** Lets the customer add units while enforcing the requirement and stock cap. */
export function clampRequiredAccessoryLineQuantity(
  line: RequiredAccessoryCartLineQuantity,
  params: { parentQuantity: number; requestedQuantity: number },
): number {
  const minimumQuantity = getRequiredAccessoryLineMinimumQuantity(
    line,
    params.parentQuantity,
  );
  const requestedQuantity = Math.max(
    minimumQuantity,
    params.requestedQuantity,
  );

  return line.maxQuantity === null
    ? requestedQuantity
    : Math.min(
        requestedQuantity,
        Math.max(minimumQuantity, line.maxQuantity),
      );
}

/** Keeps the customer's selected total unless a changed requirement is higher. */
export function reconcileRequiredAccessoryLineQuantity(
  line: RequiredAccessoryCartLineQuantity & { quantity: number },
  params: {
    nextParentQuantity: number;
    nextRequiredQuantity: number;
  },
): number {
  return clampRequiredAccessoryLineQuantity(
    { ...line, requiredQuantity: params.nextRequiredQuantity },
    {
      parentQuantity: params.nextParentQuantity,
      requestedQuantity: line.quantity,
    },
  );
}

function getCartStockGroupKey(
  lines: CartLineQuantity[],
  line: Pick<
    CartLineQuantity,
    'productId' | 'selectionSignature' | 'stockKind'
  >,
): string | null {
  const productStockKind = lines.some(
    (candidate) =>
      candidate.productId === line.productId &&
      candidate.stockKind === 'consumable',
  )
    ? 'consumable'
    : (line.stockKind ??
      lines.find(
        (candidate) =>
          candidate.productId === line.productId && Boolean(candidate.stockKind),
      )?.stockKind);
  if (!productStockKind) {
    return null;
  }
  if (productStockKind === 'untracked') {
    return null;
  }

  return JSON.stringify([
    line.productId,
    productStockKind === 'consumable'
      ? '*'
      : (line.selectionSignature ?? '__default'),
  ]);
}

function getOtherSharedStockLinesQuantity(
  lines: CartLineQuantity[],
  line: CartLineQuantity,
): number {
  const stockGroupKey = getCartStockGroupKey(lines, line);
  if (!stockGroupKey) {
    return 0;
  }

  return lines.reduce(
    (total, candidate) =>
      candidate.lineId !== line.lineId &&
      getCartStockGroupKey(lines, candidate) === stockGroupKey
        ? total + candidate.quantity
        : total,
    0,
  );
}

/** Maximum this line can reach after stock allocated to sibling lines. */
export function getCartLineAvailableMaximumQuantity(
  lines: CartLineQuantity[],
  line: CartLineQuantity,
): StockQuantityLimit {
  const ownMaximum =
    line.maxQuantity === null
      ? null
      : Math.max(
          0,
          line.maxQuantity - getOtherSharedStockLinesQuantity(lines, line),
        );

  if (line.parentLineId) {
    return ownMaximum;
  }

  const requiredAccessoryMaximums = lines
    .filter((candidate) => candidate.parentLineId === line.lineId)
    .map((child) => {
      if (child.maxQuantity === null) {
        return null;
      }

      const availableAccessoryQuantity = Math.max(
        0,
        child.maxQuantity - getOtherSharedStockLinesQuantity(lines, child),
      );
      return Math.floor(
        availableAccessoryQuantity /
          getRequiredAccessoryUnitQuantity(child),
      );
    });

  return combineStockQuantityLimits(ownMaximum, ...requiredAccessoryMaximums);
}

/** Clamps one line after accounting for stock already used by sibling lines. */
export function clampCartLineQuantityToAvailableMaximum(
  lines: CartLineQuantity[],
  line: CartLineQuantity,
): number {
  const maximumQuantity = getCartLineAvailableMaximumQuantity(lines, line);
  const quantity = Math.max(0, line.quantity);

  return maximumQuantity === null
    ? quantity
    : Math.min(quantity, maximumQuantity);
}

/** Gives required lines priority, then fits free lines into remaining stock. */
export function reconcileSharedCartLineQuantities<
  T extends CartLineQuantity,
>(lines: T[]): T[] {
  const stockGroupKeys = new Set(
    lines
      .map((line) => getCartStockGroupKey(lines, line))
      .filter((key): key is string => Boolean(key)),
  );
  let reconciled = [...lines];
  const removedParentLineIds = new Set<string>();

  for (const stockGroupKey of stockGroupKeys) {
    const productLines = reconciled.filter(
      (line) =>
        getCartStockGroupKey(reconciled, line) === stockGroupKey,
    );
    // A single line has no sibling to share stock with. Its own shortfall is
    // already reported through maxQuantity, so the line stays visible with
    // its unavailable reason instead of vanishing from the cart.
    if (productLines.length < 2) {
      continue;
    }
    const stockQuantity = combineStockQuantityLimits(
      ...productLines.map((line) => line.maxQuantity),
    );
    if (stockQuantity === null) {
      continue;
    }
    const requiredQuantity = productLines
      .filter((line) => Boolean(line.parentLineId))
      .reduce((total, line) => total + line.quantity, 0);
    let remainingQuantity = Math.max(0, stockQuantity - requiredQuantity);

    reconciled = reconciled.flatMap((line) => {
      if (
        getCartStockGroupKey(reconciled, line) !== stockGroupKey ||
        line.parentLineId
      ) {
        return [line];
      }

      const quantity = Math.min(line.quantity, remainingQuantity);
      remainingQuantity -= quantity;
      if (quantity === 0) {
        removedParentLineIds.add(line.lineId);
        return [];
      }

      return quantity === line.quantity ? [line] : [{ ...line, quantity }];
    });
  }

  return reconciled.filter(
    (line) =>
      !line.parentLineId || !removedParentLineIds.has(line.parentLineId),
  );
}

export function isRequiredAccessory(
  accessory: Pick<AccessoryLink, 'required'>,
): boolean {
  return Boolean(accessory.required);
}

/** Accessories the customer must book with the parent, auto-added to the cart. */
export function selectRequiredAccessories<
  T extends Pick<AccessoryLink, 'required'>,
>(accessories: T[]): T[] {
  return accessories.filter(isRequiredAccessory);
}

/**
 * Accessories the customer may add on top — the upsell list. Required ones are
 * excluded everywhere: the cart already carries them.
 */
export function selectOptionalAccessories<
  T extends Pick<AccessoryLink, 'required'>,
>(accessories: T[]): T[] {
  return accessories.filter((accessory) => !isRequiredAccessory(accessory));
}

/**
 * Required accessories that cannot cover `parentQuantity` units of the parent.
 * A non-empty result means the parent product is not bookable at that quantity.
 */
export function findBlockingRequiredAccessories<
  T extends Pick<AccessoryLink, 'required' | 'requiredQuantity' | 'quantity'>,
>(accessories: T[], parentQuantity: number): T[] {
  const neededParents = Math.max(1, parentQuantity);
  return selectRequiredAccessories(accessories).filter(
    (accessory) =>
      accessory.quantity !== null &&
      accessory.quantity <
        getRequiredAccessoryUnitQuantity(accessory) * neededParents,
  );
}

/** Maps accessory-link projections to the cart's required-accessory input. */
export function buildRequiredAccessoryCartInputs(
  accessories: AccessoryLink[],
): RequiredAccessoryCartInput[] {
  return selectRequiredAccessories(accessories).map((accessory) => {
    const accessoryPricingMode: PricingMode = accessory.pricingMode ?? 'day';

    return {
      productId: accessory.id,
      productName: accessory.name,
      productImage: accessory.images?.[0] || null,
      price: toNumber(accessory.price) ?? 0,
      deposit: toNumber(accessory.deposit) ?? 0,
      maxQuantity:
        accessory.quantity === null
          ? null
          : Math.max(1, accessory.quantity),
      requiredQuantity: getRequiredAccessoryUnitQuantity(accessory),
      pricingKind: accessory.pricingKind ?? 'duration',
      pricingMode: accessoryPricingMode,
      productPricingMode: accessory.pricingMode,
      basePeriodMinutes: accessory.basePeriodMinutes ?? null,
      pricingTiers: accessory.pricingTiers?.map((tier) => ({
        id: tier.id,
        minDuration: tier.minDuration ?? 1,
        discountPercent: toNumber(tier.discountPercent) ?? 0,
        period: tier.period ?? null,
        price: toNumber(tier.price),
      })),
    };
  });
}

interface ParentableCartLine {
  lineId: string;
  parentLineId?: string;
}

export interface CartLineGroup<T extends ParentableCartLine> {
  line: T;
  /** Required accessory lines attached to `line`, in cart order. */
  children: T[];
}

/**
 * Groups cart lines for display: every top-level line followed by the required
 * accessory lines it owns. A child whose parent is no longer in the cart is
 * rendered as a top-level line so it can never become invisible.
 */
export function groupCartLinesByParent<T extends ParentableCartLine>(
  items: T[],
): CartLineGroup<T>[] {
  const lineIds = new Set(items.map((item) => item.lineId));
  const groups: CartLineGroup<T>[] = [];
  const groupByLineId = new Map<string, CartLineGroup<T>>();

  for (const item of items) {
    if (item.parentLineId && lineIds.has(item.parentLineId)) {
      continue;
    }
    const group: CartLineGroup<T> = { line: item, children: [] };
    groups.push(group);
    groupByLineId.set(item.lineId, group);
  }

  for (const item of items) {
    if (!item.parentLineId) {
      continue;
    }
    const group = groupByLineId.get(item.parentLineId);
    if (group) {
      group.children.push(item);
    }
  }

  return groups;
}
