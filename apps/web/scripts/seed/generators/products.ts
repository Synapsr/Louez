/**
 * Products Generator
 *
 * Generates categories, products, pricing tiers, accessories, and product units.
 */
import type { StoreConfig } from '../config';
import {
  UNIT_DOWNTIME_DISTRIBUTION,
  UNIT_LIFECYCLE_DISTRIBUTION,
  UNIT_NOTES_TEMPLATES,
  getProductsForSpecialty,
} from '../data/product-templates';
import {
  chance,
  generateId,
  generateUnitIdentifier,
  logProgress,
  pickRandom,
  pickRandomMultiple,
  randomInt,
  weightedRandom,
} from '../utils';

export interface GeneratedCategory {
  id: string;
  storeId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface GeneratedProduct {
  id: string;
  storeId: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  images: string[];
  price: string;
  deposit: string;
  pricingMode: 'hour' | 'day' | 'week';
  videoUrl: string | null;
  taxSettings: { inheritFromStore: boolean; customRate?: number } | null;
  enforceStrictTiers: boolean;
  quantity: number;
  trackUnits: boolean;
  displayOrder: number;
  status: 'draft' | 'active' | 'archived';
  createdAt: Date;
  updatedAt: Date;
}

export interface GeneratedPricingTier {
  id: string;
  productId: string;
  minDuration: number;
  discountPercent: string;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface GeneratedProductAccessory {
  id: string;
  productId: string;
  accessoryId: string;
  displayOrder: number;
  createdAt: Date;
}

export interface GeneratedProductUnit {
  id: string;
  productId: string;
  identifier: string;
  notes: string | null;
  lifecycleStatus: 'active' | 'retired';
  retiredAt: Date | null;
  retirementReason: 'sold' | 'lost' | 'broken' | 'other' | null;
  retirementNote: string | null;
  purchasePrice: string | null;
  purchasedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GeneratedProductUnitDowntime {
  id: string;
  productUnitId: string;
  storeId: string;
  reason: 'maintenance' | 'repair' | 'other';
  startsAt: Date;
  endsAt: Date | null;
  note: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GeneratedProductUnitEvent {
  id: string;
  productUnitId: string;
  storeId: string;
  type:
    | 'created'
    | 'downtime_declared'
    | 'downtime_updated'
    | 'downtime_closed'
    | 'downtime_deleted'
    | 'retired'
    | 'reinstated'
    | 'assigned'
    | 'unassigned'
    | 'updated';
  actorUserId: string | null;
  payload: Record<string, unknown> | null;
  createdAt: Date;
}

export interface ProductsGeneratorResult {
  categories: GeneratedCategory[];
  products: GeneratedProduct[];
  pricingTiers: GeneratedPricingTier[];
  accessories: GeneratedProductAccessory[];
  productUnits: GeneratedProductUnit[];
  productUnitDowntimes: GeneratedProductUnitDowntime[];
  productUnitEvents: GeneratedProductUnitEvent[];
  /** Map from original template name to product ID */
  productIdMap: Map<string, string>;
  /** Map from category name to category ID */
  categoryIdMap: Map<string, string>;
  /** Accessory product IDs for linking */
  accessoryProductIds: string[];
}

/**
 * Generate placeholder image URL from picsum
 */
function generatePlaceholderImage(
  seed: number,
  width = 800,
  height = 600,
): string {
  return `https://picsum.photos/seed/${seed}/${width}/${height}`;
}

/**
 * Generate product images
 */
function generateProductImages(productIndex: number, count = 3): string[] {
  const images: string[] = [];
  for (let i = 0; i < count; i++) {
    // Use product index + image index as seed for consistent images
    images.push(generatePlaceholderImage(productIndex * 10 + i));
  }
  return images;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const RETIREMENT_REASONS: Array<'sold' | 'lost' | 'broken' | 'other'> = [
  'sold',
  'lost',
  'broken',
  'other',
];

function createProductUnitEvent(
  storeId: string,
  unit: GeneratedProductUnit,
  type: GeneratedProductUnitEvent['type'],
  createdAt: Date,
  payload: Record<string, unknown> | null = null,
): GeneratedProductUnitEvent {
  return {
    id: generateId(),
    productUnitId: unit.id,
    storeId,
    type,
    actorUserId: null,
    payload,
    createdAt,
  };
}

function createDowntimeForUnit(
  storeId: string,
  unit: GeneratedProductUnit,
  reason: GeneratedProductUnitDowntime['reason'],
  startsAt: Date,
  endsAt: Date | null,
  note: string,
): {
  downtime: GeneratedProductUnitDowntime;
  events: GeneratedProductUnitEvent[];
} {
  const downtime: GeneratedProductUnitDowntime = {
    id: generateId(),
    productUnitId: unit.id,
    storeId,
    reason,
    startsAt,
    endsAt,
    note,
    createdByUserId: null,
    createdAt: startsAt,
    updatedAt: endsAt || startsAt,
  };

  const events = [
    createProductUnitEvent(storeId, unit, 'downtime_declared', startsAt, {
      downtimeId: downtime.id,
      reason,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt?.toISOString() ?? null,
    }),
  ];

  if (endsAt) {
    events.push(
      createProductUnitEvent(storeId, unit, 'downtime_closed', endsAt, {
        downtimeId: downtime.id,
        reason,
        endsAt: endsAt.toISOString(),
      }),
    );
  }

  return { downtime, events };
}

/**
 * Generate all products data for a store
 */
export function generateProducts(
  storeId: string,
  storeConfig: StoreConfig,
  now: Date,
): ProductsGeneratorResult {
  const { categories: categoryTemplates, products: productTemplates } =
    getProductsForSpecialty(storeConfig.specialty);

  const categories: GeneratedCategory[] = [];
  const products: GeneratedProduct[] = [];
  const pricingTiers: GeneratedPricingTier[] = [];
  const accessories: GeneratedProductAccessory[] = [];
  const productUnits: GeneratedProductUnit[] = [];
  const productUnitDowntimes: GeneratedProductUnitDowntime[] = [];
  const productUnitEvents: GeneratedProductUnitEvent[] = [];
  const productIdMap = new Map<string, string>();
  const categoryIdMap = new Map<string, string>();
  const accessoryProductIds: string[] = [];

  // Generate categories
  for (const template of categoryTemplates) {
    const categoryId = generateId();
    categoryIdMap.set(template.name, categoryId);

    categories.push({
      id: categoryId,
      storeId,
      name: template.name,
      description: template.description,
      imageUrl: generatePlaceholderImage(categories.length + 100, 600, 400),
      order: template.order,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Determine which products to use based on productCount
  let selectedTemplates = productTemplates;
  if (productTemplates.length > storeConfig.productCount) {
    // Prioritize active products, then include some draft/archived
    const activeTemplates = productTemplates.filter(
      (p) => p.status === 'active',
    );
    const otherTemplates = productTemplates.filter(
      (p) => p.status !== 'active',
    );

    const activeCount = Math.min(
      activeTemplates.length,
      Math.floor(storeConfig.productCount * 0.9),
    );
    const otherCount = storeConfig.productCount - activeCount;

    selectedTemplates = [
      ...pickRandomMultiple(activeTemplates, activeCount),
      ...pickRandomMultiple(otherTemplates, otherCount),
    ];
  }

  // Generate products
  for (let i = 0; i < selectedTemplates.length; i++) {
    const template = selectedTemplates[i];
    const productId = generateId();
    productIdMap.set(template.name, productId);

    // Track accessory products
    if (
      template.category.toLowerCase().includes('accessoire') ||
      template.category.toLowerCase().includes('protection') ||
      template.category.toLowerCase().includes('sécurité')
    ) {
      accessoryProductIds.push(productId);
    }

    const categoryId = categoryIdMap.get(template.category) ?? null;

    // Determine if this product should track units
    const shouldTrackUnits =
      storeConfig.trackUnits && (template.trackUnits ?? false);

    // Generate pricing mode (always explicit at product level)
    let pricingMode: 'hour' | 'day' | 'week' = storeConfig.pricingMode;
    if (chance(0.2)) {
      // 20% of products override the store default mode
      const modes: ('hour' | 'day' | 'week')[] = ['hour', 'day', 'week'];
      pricingMode = pickRandom(
        modes.filter((m) => m !== storeConfig.pricingMode),
      );
    }

    // Generate tax settings (most inherit, some override)
    let taxSettings: { inheritFromStore: boolean; customRate?: number } | null =
      null;
    if (storeConfig.taxEnabled && chance(0.1)) {
      // 10% of products have custom tax
      taxSettings = {
        inheritFromStore: false,
        customRate: pickRandom([5.5, 10, 20]), // French VAT rates
      };
    }

    const createdAt = new Date(
      now.getTime() - randomInt(30, 180) * 24 * 60 * 60 * 1000,
    );

    products.push({
      id: productId,
      storeId,
      categoryId,
      name: template.name,
      description: template.description,
      images: generateProductImages(i),
      price: template.price.toFixed(2),
      deposit: template.deposit.toFixed(2),
      pricingMode,
      videoUrl: chance(0.05)
        ? 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
        : null,
      taxSettings,
      enforceStrictTiers: chance(0.1), // 10% use strict tier mode
      quantity: template.quantity,
      trackUnits: shouldTrackUnits,
      displayOrder: i,
      status: template.status,
      createdAt,
      updatedAt: now,
    });

    // Generate pricing tiers
    if (template.pricingTiers && template.pricingTiers.length > 0) {
      for (let j = 0; j < template.pricingTiers.length; j++) {
        const tier = template.pricingTiers[j];
        pricingTiers.push({
          id: generateId(),
          productId,
          minDuration: tier.minDuration ?? 1,
          discountPercent: tier.discountPercent.toFixed(6),
          displayOrder: j,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    // Generate product units if tracking is enabled
    if (
      shouldTrackUnits &&
      template.quantity > 0 &&
      template.status === 'active'
    ) {
      const unitPrefix =
        template.unitPrefix ?? template.name.substring(0, 3).toUpperCase();

      for (let u = 0; u < template.quantity; u++) {
        const lifecycleStatus = weightedRandom([
          {
            item: 'active' as const,
            weight: UNIT_LIFECYCLE_DISTRIBUTION.active,
          },
          {
            item: 'retired' as const,
            weight: UNIT_LIFECYCLE_DISTRIBUTION.retired,
          },
        ]);

        const notes = chance(0.6) ? pickRandom(UNIT_NOTES_TEMPLATES) : null;
        const unitCreatedAt = new Date(
          createdAt.getTime() + randomInt(0, 7) * DAY_MS,
        );
        const purchasedAt = chance(0.7)
          ? new Date(unitCreatedAt.getTime() - randomInt(7, 90) * DAY_MS)
          : null;
        const retirementReason =
          lifecycleStatus === 'retired' ? pickRandom(RETIREMENT_REASONS) : null;
        const retiredAt =
          lifecycleStatus === 'retired'
            ? new Date(now.getTime() - randomInt(3, 60) * DAY_MS)
            : null;
        const unit: GeneratedProductUnit = {
          id: generateId(),
          productId,
          identifier: generateUnitIdentifier(unitPrefix, u),
          notes,
          lifecycleStatus,
          retiredAt,
          retirementReason,
          retirementNote: retirementReason
            ? `Demo inventory retirement: ${retirementReason}`
            : null,
          purchasePrice: purchasedAt
            ? (template.deposit * (0.6 + randomInt(0, 80) / 100)).toFixed(2)
            : null,
          purchasedAt,
          createdAt: unitCreatedAt,
          updatedAt: retiredAt || now,
        };

        productUnits.push(unit);
        productUnitEvents.push(
          createProductUnitEvent(storeId, unit, 'created', unitCreatedAt, {
            identifier: unit.identifier,
          }),
        );

        if (retiredAt && retirementReason) {
          productUnitEvents.push(
            createProductUnitEvent(storeId, unit, 'retired', retiredAt, {
              reason: retirementReason,
            }),
          );
          continue;
        }

        const downtimeKind = weightedRandom([
          { item: 'none' as const, weight: UNIT_DOWNTIME_DISTRIBUTION.none },
          {
            item: 'pastMaintenance' as const,
            weight: UNIT_DOWNTIME_DISTRIBUTION.pastMaintenance,
          },
          {
            item: 'openMaintenance' as const,
            weight: UNIT_DOWNTIME_DISTRIBUTION.openMaintenance,
          },
          {
            item: 'openRepair' as const,
            weight: UNIT_DOWNTIME_DISTRIBUTION.openRepair,
          },
        ]);

        if (downtimeKind !== 'none') {
          const isPast = downtimeKind === 'pastMaintenance';
          const startsAt = isPast
            ? new Date(now.getTime() - randomInt(14, 60) * DAY_MS)
            : new Date(now.getTime() - randomInt(1, 7) * DAY_MS);
          const endsAt = isPast
            ? new Date(startsAt.getTime() + randomInt(1, 5) * DAY_MS)
            : null;
          const reason =
            downtimeKind === 'openRepair' ? 'repair' : 'maintenance';
          const { downtime, events } = createDowntimeForUnit(
            storeId,
            unit,
            reason,
            startsAt,
            endsAt,
            isPast
              ? 'Demo past maintenance downtime'
              : `Demo open-ended ${reason} downtime`,
          );

          productUnitDowntimes.push(downtime);
          productUnitEvents.push(...events);
        }
      }
    }

    logProgress(
      i + 1,
      selectedTemplates.length,
      `Products for ${storeConfig.name}`,
    );
  }

  if (productUnits.length > 0) {
    const unitsWithDowntime = new Set(
      productUnitDowntimes.map((downtime) => downtime.productUnitId),
    );
    let activeUnits = productUnits.filter(
      (unit) => unit.lifecycleStatus === 'active',
    );
    let unitsWithoutDowntime = activeUnits.filter(
      (unit) => !unitsWithDowntime.has(unit.id),
    );

    if (!productUnits.some((unit) => unit.lifecycleStatus === 'retired')) {
      const unit = productUnits[productUnits.length - 1];
      if (unit) {
        const retirementReason = 'other';
        const retiredAt = new Date(now.getTime() - 2 * DAY_MS);
        unit.lifecycleStatus = 'retired';
        unit.retiredAt = retiredAt;
        unit.retirementReason = retirementReason;
        unit.retirementNote = 'Demo inventory retirement';
        unit.updatedAt = retiredAt;
        productUnitEvents.push(
          createProductUnitEvent(storeId, unit, 'retired', retiredAt, {
            reason: retirementReason,
          }),
        );
      }
    }

    activeUnits = productUnits.filter(
      (unit) => unit.lifecycleStatus === 'active',
    );
    unitsWithoutDowntime = activeUnits.filter(
      (unit) => !unitsWithDowntime.has(unit.id),
    );

    const ensureDowntime = (
      kind: 'past' | 'open',
      unit: GeneratedProductUnit | undefined,
    ) => {
      if (!unit || unit.lifecycleStatus !== 'active') return;

      const startsAt =
        kind === 'past'
          ? new Date(now.getTime() - 21 * DAY_MS)
          : new Date(now.getTime() - 2 * DAY_MS);
      const endsAt =
        kind === 'past' ? new Date(now.getTime() - 18 * DAY_MS) : null;
      const reason = kind === 'past' ? 'maintenance' : 'repair';
      const { downtime, events } = createDowntimeForUnit(
        storeId,
        unit,
        reason,
        startsAt,
        endsAt,
        kind === 'past'
          ? 'Demo guaranteed past downtime'
          : 'Demo guaranteed open-ended downtime',
      );
      productUnitDowntimes.push(downtime);
      productUnitEvents.push(...events);
      unitsWithDowntime.add(unit.id);
    };

    if (!productUnitDowntimes.some((downtime) => downtime.endsAt !== null)) {
      ensureDowntime('past', unitsWithoutDowntime[0] || activeUnits[0]);
    }

    if (!productUnitDowntimes.some((downtime) => downtime.endsAt === null)) {
      ensureDowntime(
        'open',
        unitsWithoutDowntime[1] ||
          unitsWithoutDowntime[0] ||
          activeUnits[1] ||
          activeUnits[0],
      );
    }

    const activeCountByProduct = new Map<string, number>();
    for (const unit of productUnits) {
      if (unit.lifecycleStatus !== 'active') continue;
      activeCountByProduct.set(
        unit.productId,
        (activeCountByProduct.get(unit.productId) || 0) + 1,
      );
    }

    for (const product of products) {
      if (!product.trackUnits) continue;
      product.quantity = activeCountByProduct.get(product.id) || 0;
    }
  }

  // Generate product accessories relationships
  // Link main products (bikes) to accessory products
  const mainProducts = products.filter(
    (p) =>
      p.status === 'active' &&
      !accessoryProductIds.includes(p.id) &&
      parseFloat(p.price) >= 10, // Main products are typically more expensive
  );

  for (const mainProduct of mainProducts) {
    // Each main product gets 1-3 accessories
    const numAccessories = randomInt(
      1,
      Math.min(3, accessoryProductIds.length),
    );
    const selectedAccessories = pickRandomMultiple(
      accessoryProductIds,
      numAccessories,
    );

    for (let i = 0; i < selectedAccessories.length; i++) {
      accessories.push({
        id: generateId(),
        productId: mainProduct.id,
        accessoryId: selectedAccessories[i],
        displayOrder: i,
        createdAt: now,
      });
    }
  }

  return {
    categories,
    products,
    pricingTiers,
    accessories,
    productUnits,
    productUnitDowntimes,
    productUnitEvents,
    productIdMap,
    categoryIdMap,
    accessoryProductIds,
  };
}
