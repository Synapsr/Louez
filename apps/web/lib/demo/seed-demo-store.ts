import "server-only";

import { customAlphabet, nanoid } from "nanoid";

import * as schema from "@louez/db";
import { db, slugify } from "@louez/db";
import type { BusinessHours, StoreSettings, StoreTheme } from "@louez/types";
import { buildCombinationKey, calculateRateBasedPrice } from "@louez/utils";

import { DEMO_TIMEZONE, monthDayOf, parisDayAt, parisParts } from "./paris-time";
import {
  DEMO_EMAIL_DOMAIN,
  DEMO_FIRST_NAMES,
  DEMO_LAST_NAMES,
  DEMO_STREETS,
  DEMO_TOWNS,
  slugifyName,
} from "./people";
import type { DemoBasketLine, DemoProductSpec, DemoVertical } from "./verticals/types";

/**
 * Writes one demo store of a trade (lib/demo/verticals) for one visitor: the
 * store flagged `demo_vertical`, its catalog, invented customers, a year of
 * bookings and a « today » with departures, returns, rentals under way and a
 * request to answer. Everything is written in one transaction.
 *
 * The rows are written directly, as the dev seeds do: a demo store is never
 * billed, so its bookings carry no `billableAt` and no billing mark, and its
 * payments are recorded by hand (card, cash, cheque), never with a Stripe id.
 */

const MINUTE = 60_000;
const DAY_MS = 24 * 60 * MINUTE;
const DAY_MIN = 1440;
const TAX_RATE = 20;
const BATCH_SIZE = 200;

/** Bookings of past seasons (completed, cancelled, refused). */
const HISTORY_COUNT = 70;
/** Bookings ahead (confirmed, a few requests). */
const UPCOMING_COUNT = 24;
const CUSTOMER_COUNT = 45;
const HISTORY_DAYS = 330;
const UPCOMING_DAYS = 60;

// Store slugs are global: a random suffix gives each visitor their own store.
const slugSuffix = customAlphabet("abcdefghijkmnpqrstuvwxyz23456789", 6);

type Rng = () => number;

/** mulberry32: one generator per seeded store, never shared between requests. */
function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const randomInt = (rng: Rng, min: number, max: number) => Math.floor(rng() * (max - min + 1)) + min;
const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)]!;
const chance = (rng: Rng, p: number) => rng() < p;
function pickWeighted<T>(rng: Rng, items: ReadonlyArray<{ item: T; weight: number }>): T {
  const total = items.reduce((sum, entry) => sum + entry.weight, 0);
  let r = rng() * total;
  for (const entry of items) {
    r -= entry.weight;
    if (r <= 0) return entry.item;
  }
  return items[items.length - 1]!.item;
}

const money = (value: number) => (Math.round(value * 100) / 100).toFixed(2);
const round2 = (value: number) => Math.round(value * 100) / 100;
const addMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * MINUTE);

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

function seasonMultiplier(
  spec: DemoProductSpec,
  start: Date,
): { multiplier: number; name: string | null } {
  const monthDay = monthDayOf(start);
  for (const season of spec.seasons ?? []) {
    if (monthDay >= season.startMonthDay && monthDay <= season.endMonthDay) {
      return { multiplier: season.multiplier, name: season.name };
    }
  }
  return { multiplier: 1, name: null };
}

function priceLine(spec: DemoProductSpec, start: Date, durationMinutes: number, quantity: number) {
  const season = seasonMultiplier(spec, start);
  const basePrice = round2(spec.price * season.multiplier);
  const calculation = calculateRateBasedPrice(
    {
      basePrice,
      basePeriodMinutes: spec.basePeriodMinutes,
      deposit: spec.deposit,
      pricingKind: spec.pricingKind ?? "duration",
      rates: spec.rates.map((rate, index) => ({
        id: `${spec.key}-${rate.period}`,
        price: Math.round(rate.price * season.multiplier),
        period: rate.period,
        displayOrder: index,
      })),
      enforceStrictTiers: spec.enforceStrictTiers,
    },
    durationMinutes,
    quantity,
  );
  return { calculation, season, basePrice };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function buildBusinessHours(vertical: DemoVertical): BusinessHours {
  const schedule: BusinessHours["schedule"] = {} as BusinessHours["schedule"];
  vertical.settings.openingHours.forEach((ranges, weekday) => {
    schedule[weekday as keyof BusinessHours["schedule"]] = ranges
      ? { isOpen: true, ranges }
      : { isOpen: false, ranges: [] };
  });
  return { enabled: true, schedule, closurePeriods: [] };
}

function buildStoreSettings(vertical: DemoVertical): StoreSettings {
  return {
    reservationMode: "payment",
    minRentalMinutes: vertical.settings.minRentalMinutes,
    maxRentalMinutes: null,
    advanceNoticeMinutes: vertical.settings.advanceNoticeMinutes,
    turnoverBufferMinutes: vertical.settings.turnoverBufferMinutes,
    requireCustomerAddress: false,
    pendingBlocksAvailability: true,
    onlinePaymentDepositPercentage: vertical.settings.onlinePaymentDepositPercentage,
    country: "FR",
    timezone: DEMO_TIMEZONE,
    currency: "EUR",
    locale: "fr",
    tax: {
      enabled: true,
      defaultRate: TAX_RATE,
      displayMode: "inclusive",
      taxLabel: "TVA",
      taxNumber: vertical.store.vatNumber,
    },
    billingAddress: { useSameAsStore: true },
    businessHours: buildBusinessHours(vertical),
    delivery: {
      enabled: vertical.key !== "ski",
      multiLocationEnabled: false,
      mode: "optional",
      pricePerKm: 1.2,
      minimumFee: 25,
      maximumDistance: 40,
      freeDeliveryThreshold: 800,
      minimumOrderAmountForDelivery: 100,
    },
    inspection: {
      enabled: true,
      mode: "recommended",
      requireCustomerSignature: true,
      autoGeneratePdf: false,
      maxPhotosPerItem: 10,
    },
    integrationData: {},
  };
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

export interface SeedDemoStoreInput {
  vertical: DemoVertical;
  ownerUserId: string;
  expiresAt: Date;
  /** Made ahead for the pool (lib/demo/demo-pool.ts), not yet claimed by a visitor. */
  pooled?: boolean;
  now?: Date;
  /** Same seed, same bookings (row ids aside). */
  seed?: number;
}

export interface SeededDemoStore {
  storeId: string;
  slug: string;
}

type BookingStatus = "pending" | "confirmed" | "ongoing" | "completed" | "cancelled" | "rejected";
type BookingSource = "online" | "manual" | "phone";

interface PlannedBooking {
  status: BookingStatus;
  start: Date;
  end: Date;
  createdAt: Date;
  source: BookingSource;
  lines: DemoBasketLine[];
  /** A departure inspection on a rental under way. */
  withDepartureInspection?: boolean;
}

interface ResolvedProduct {
  spec: DemoProductSpec;
  id: string;
  units: Array<{
    id: string;
    identifier: string;
    attributes: Record<string, string> | null;
    combinationKey: string;
  }>;
}

async function insertAll<T>(
  executor: schema.Transaction,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- one helper for every table of the seed
  table: any,
  rows: T[],
): Promise<void> {
  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    await executor.insert(table).values(rows.slice(index, index + BATCH_SIZE));
  }
}

/**
 * Picks day offsets in `[from, to]` with the trade's monthly demand, or null
 * when the window has none. The weights are read once per window.
 */
function dayOffsetPicker(
  rng: Rng,
  vertical: DemoVertical,
  now: Date,
  from: number,
  to: number,
): () => number | null {
  const candidates: Array<{ item: number; weight: number }> = [];
  for (let offset = from; offset <= to; offset++) {
    const { month } = parisParts(new Date(now.getTime() + offset * DAY_MS));
    const weight = vertical.monthWeights[month - 1] ?? 0;
    if (weight > 0) candidates.push({ item: offset, weight });
  }
  return () => (candidates.length > 0 ? pickWeighted(rng, candidates) : null);
}

/**
 * `minutesAhead` from now on the quarter hour, kept within the store's day: late
 * in the evening, as close to midnight as the day allows, never in the past.
 */
function laterToday(now: Date, minutesAhead: number): Date {
  const quarter = 15 * MINUTE;
  const wanted = Math.ceil((now.getTime() + minutesAhead * MINUTE) / quarter) * quarter;
  const lastOfDay = parisDayAt(now, 1, 0).getTime() - quarter;
  return new Date(Math.max(Math.min(wanted, lastOfDay), now.getTime() + MINUTE));
}

function planBookings(rng: Rng, vertical: DemoVertical, now: Date): PlannedBooking[] {
  const basket = () =>
    pickWeighted(
      rng,
      vertical.baskets.map((entry) => ({ item: entry.lines, weight: entry.weight })),
    );
  const duration = () =>
    pickWeighted(
      rng,
      vertical.durations.map((entry) => ({ item: entry.days, weight: entry.weight })),
    );
  const source = (): BookingSource =>
    pickWeighted(rng, [
      { item: "online" as const, weight: 65 },
      { item: "manual" as const, weight: 25 },
      { item: "phone" as const, weight: 10 },
    ]);
  const featured: DemoBasketLine[] = [{ key: vertical.featuredProductKey, quantity: 2 }];
  const plans: PlannedBooking[] = [];

  const pastDay = dayOffsetPicker(rng, vertical, now, -HISTORY_DAYS, -8);
  const nextDay = dayOffsetPicker(rng, vertical, now, 3, UPCOMING_DAYS);
  for (let index = 0; index < HISTORY_COUNT; index++) {
    const offset = pastDay();
    if (offset === null) break;
    const days = duration();
    const start = parisDayAt(now, offset, 9, chance(rng, 0.5) ? 0 : 30);
    const end = addMinutes(start, days * DAY_MIN);
    if (end.getTime() > now.getTime() - DAY_MS) continue;
    const status = pickWeighted<BookingStatus>(rng, [
      { item: "completed", weight: 88 },
      { item: "cancelled", weight: 8 },
      { item: "rejected", weight: 4 },
    ]);
    plans.push({
      status,
      start,
      end,
      createdAt: addMinutes(start, -randomInt(rng, 2, 45) * DAY_MIN - randomInt(rng, 0, 600)),
      source: source(),
      lines: basket(),
    });
  }

  for (let index = 0; index < UPCOMING_COUNT; index++) {
    const offset = nextDay() ?? randomInt(rng, 3, UPCOMING_DAYS);
    const days = duration();
    const start = parisDayAt(now, offset, 9);
    plans.push({
      status: chance(rng, 0.85) ? "confirmed" : "pending",
      start,
      end: addMinutes(start, days * DAY_MIN),
      createdAt: addMinutes(now, -randomInt(rng, 1, 25) * DAY_MIN - randomInt(rng, 0, 600)),
      source: source(),
      lines: basket(),
    });
  }

  // Today: rentals under way (one with its departure inspection), departures to
  // prepare, a return, a request to answer. The dashboard is never empty.
  const ongoing: Array<{ startOffset: number; days: number; inspection: boolean }> = [
    { startOffset: -2, days: 5, inspection: true },
    { startOffset: -1, days: 3, inspection: false },
    { startOffset: -3, days: 6, inspection: true },
  ];
  for (const entry of ongoing) {
    const start = parisDayAt(now, entry.startOffset, 9);
    plans.push({
      status: "ongoing",
      start,
      end: addMinutes(start, entry.days * DAY_MIN),
      createdAt: addMinutes(start, -randomInt(rng, 3, 20) * DAY_MIN),
      source: "online",
      lines: entry.inspection ? featured : basket(),
      withDepartureInspection: entry.inspection,
    });
  }
  // Departures still ahead today, whatever the hour the visitor comes: in one
  // and in three hours, on the quarter hour.
  for (const hoursAhead of [1, 3]) {
    const start = laterToday(now, hoursAhead * 60);
    plans.push({
      status: "confirmed",
      start,
      end: addMinutes(start, duration() * DAY_MIN),
      createdAt: addMinutes(now, -randomInt(rng, 2, 12) * DAY_MIN),
      source: "online",
      lines: hoursAhead === 1 ? featured : basket(),
    });
  }
  {
    // A return still ahead today, in two hours.
    const start = parisDayAt(now, -2, 17);
    plans.push({
      status: "ongoing",
      start,
      end: laterToday(now, 120),
      createdAt: addMinutes(start, -6 * DAY_MIN),
      source: "phone",
      lines: basket(),
    });
  }
  {
    const start = parisDayAt(now, 5, 9);
    plans.push({
      status: "pending",
      start,
      end: addMinutes(start, 6 * DAY_MIN),
      createdAt: addMinutes(now, -95),
      source: "online",
      lines: basket(),
    });
  }

  return plans.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export async function seedDemoStore(input: SeedDemoStoreInput): Promise<SeededDemoStore> {
  const { vertical, ownerUserId, expiresAt } = input;
  const now = schema.toWholeSeconds(input.now ?? new Date());
  const rng = createRng(input.seed ?? 20261122);
  const id = () => nanoid();

  const storeId = id();
  const slug = `${vertical.store.slugBase}-${slugSuffix()}`;
  const storeCreatedAt = new Date(now.getTime() - 400 * DAY_MS);

  await db.transaction(async (tx) => {
    // ------------------------------------------------------------ store
    const theme: StoreTheme = {
      mode: "light",
      primaryColor: vertical.store.primaryColor,
      heroImages: vertical.store.heroImages,
    };
    await tx.insert(schema.stores).values({
      id: storeId,
      userId: ownerUserId,
      name: vertical.store.name,
      slug,
      description: vertical.store.description,
      tagline: vertical.store.tagline,
      email: vertical.store.email,
      phone: vertical.store.phone,
      address: `${vertical.store.address}, ${vertical.store.postalCode} ${vertical.store.city}`,
      latitude: vertical.store.latitude,
      longitude: vertical.store.longitude,
      settings: buildStoreSettings(vertical),
      theme,
      cgv: vertical.cgv,
      legalNotice:
        "<h2>Mentions légales</h2><p>Boutique de démonstration créée par Louez. Entreprise, adresse et personnes sont fictives.</p>",
      includeCgvInContract: true,
      stripeAccountId: null,
      stripeOnboardingComplete: false,
      stripeChargesEnabled: false,
      emailSettings: {
        confirmationEnabled: true,
        reminderPickupEnabled: true,
        reminderReturnEnabled: true,
        replyToEmail: null,
      },
      reviewBoosterSettings: null,
      aiAdvisorSettings: null,
      aiPhoneSettings: null,
      discordWebhookUrl: null,
      ownerPhone: null,
      icsToken: null,
      referralCode: null,
      signupOrigin: null,
      demoVertical: vertical.key,
      demoExpiresAt: expiresAt,
      // A pooled store waits for its visitor; a store made for one is theirs at once.
      demoClaimedAt: input.pooled ? null : now,
      onboardingCompleted: true,
      createdAt: storeCreatedAt,
      updatedAt: now,
    });

    await tx.insert(schema.storeMembers).values({
      id: id(),
      storeId,
      userId: ownerUserId,
      role: "owner",
      addedBy: null,
      createdAt: storeCreatedAt,
      updatedAt: now,
    });

    // Every feature of the product is visible: the Ultra plan, with nothing
    // at Stripe behind it.
    await tx.insert(schema.subscriptions).values({
      id: id(),
      storeId,
      planSlug: "ultra",
      billingMode: "subscription",
      status: "active",
      stripeSubscriptionId: null,
      stripeCustomerId: null,
      currentPeriodEnd: expiresAt,
      cancelAtPeriodEnd: false,
      freeReservationsGranted: 0,
      createdAt: storeCreatedAt,
      updatedAt: now,
    });

    // ------------------------------------------------------------ catalog
    const categoryIdByName = new Map<string, string>();
    await insertAll(
      tx,
      schema.categories,
      vertical.categories.map((category, order) => {
        const categoryId = id();
        categoryIdByName.set(category.name, categoryId);
        return {
          id: categoryId,
          storeId,
          name: category.name,
          slug: slugify(category.name),
          description: category.description,
          imageUrl: null,
          order,
          createdAt: storeCreatedAt,
          updatedAt: now,
        };
      }),
    );

    const variantValues: Array<typeof schema.variantValues.$inferInsert> = [];
    await insertAll(
      tx,
      schema.variantDefinitions,
      vertical.variantDefinitions.map((definition, position) => {
        const definitionId = id();
        definition.values.forEach((label, valuePosition) => {
          variantValues.push({
            id: id(),
            definitionId,
            label,
            colorHex: null,
            position: valuePosition,
            createdAt: storeCreatedAt,
          });
        });
        return {
          id: definitionId,
          storeId,
          key: definition.key,
          label: definition.label,
          kind: definition.kind,
          isActive: true,
          position,
          createdAt: storeCreatedAt,
          updatedAt: now,
        };
      }),
    );
    await insertAll(tx, schema.variantValues, variantValues);

    const productRows: Array<typeof schema.products.$inferInsert> = [];
    const productCategoryRows: Array<typeof schema.productCategories.$inferInsert> = [];
    const tierRows: Array<typeof schema.productPricingTiers.$inferInsert> = [];
    const seasonRows: Array<typeof schema.productSeasonalPricing.$inferInsert> = [];
    const seasonTierRows: Array<typeof schema.productSeasonalPricingTiers.$inferInsert> = [];
    const unitRows: Array<typeof schema.productUnits.$inferInsert> = [];
    const unitEventRows: Array<typeof schema.productUnitEvents.$inferInsert> = [];
    const resolved = new Map<string, ResolvedProduct>();
    const { year } = parisParts(now);
    const seasonYears = [year, year + 1];
    const today = `${year}-${monthDayOf(now)}`;
    const usedSlugs = new Set<string>();

    vertical.products.forEach((spec, displayOrder) => {
      const productId = id();
      const categoryId = categoryIdByName.get(spec.category) ?? null;
      const createdAt = new Date(storeCreatedAt.getTime() + randomInt(rng, 0, 60) * DAY_MS);
      const units: ResolvedProduct["units"] = [];

      if (spec.trackUnits) {
        let sequence = 1;
        for (const group of spec.units ?? []) {
          for (let index = 0; index < group.count; index++) {
            const unitId = id();
            const attributes = group.attributes ?? null;
            const combinationKey = buildCombinationKey(spec.axes ?? null, attributes);
            const suffix = attributes
              ? `-${Object.values(attributes)[0]!.replace(/\s+cm$/, "")}`
              : "";
            const identifier = `${spec.unitPrefix ?? spec.key.toUpperCase()}${suffix}-${String(sequence).padStart(2, "0")}`;
            sequence += 1;
            unitRows.push({
              id: unitId,
              productId,
              identifier,
              notes: null,
              images: [],
              attributes,
              combinationKey,
              lifecycleStatus: "active",
              purchasePrice: spec.unitPurchasePrice ? money(spec.unitPurchasePrice) : null,
              purchasedAt: createdAt,
              createdAt,
              updatedAt: now,
            });
            unitEventRows.push({
              id: id(),
              productUnitId: unitId,
              identifierSnapshot: identifier,
              storeId,
              type: "created",
              actorUserId: ownerUserId,
              payload: { identifier },
              createdAt,
            });
            units.push({ id: unitId, identifier, attributes, combinationKey });
          }
        }
      }

      let productSlug = slugify(spec.name);
      while (usedSlugs.has(productSlug)) productSlug = `${productSlug}-${usedSlugs.size}`;
      usedSlugs.add(productSlug);

      productRows.push({
        id: productId,
        storeId,
        categoryId,
        name: spec.name,
        slug: productSlug,
        description: spec.description,
        aiContext: spec.aiContext ?? null,
        images: spec.images,
        price: money(spec.price),
        deposit: money(spec.deposit),
        basePeriodMinutes: spec.basePeriodMinutes,
        pricingMode: spec.pricingMode,
        pricingKind: spec.pricingKind ?? "duration",
        taxSettings: { inheritFromStore: true },
        enforceStrictTiers: spec.enforceStrictTiers,
        quantity: spec.trackUnits ? units.length : spec.quantity,
        trackUnits: spec.trackUnits,
        bookingAttributeAxes: spec.axes ?? null,
        displayOrder,
        status: "active",
        createdAt,
        updatedAt: now,
      });
      if (categoryId) {
        productCategoryRows.push({ id: id(), productId, categoryId, position: 0, createdAt });
      }
      spec.rates.forEach((rate, rateIndex) => {
        tierRows.push({
          id: id(),
          productId,
          minDuration: null,
          period: rate.period,
          discountPercent: null,
          price: money(rate.price),
          displayOrder: rateIndex,
          createdAt,
          updatedAt: now,
        });
      });
      for (const season of spec.seasons ?? []) {
        for (const seasonYear of seasonYears) {
          // Only the periods still to come: the product page lists every one.
          if (`${seasonYear}-${season.endMonthDay}` < today) continue;
          const seasonId = id();
          seasonRows.push({
            id: seasonId,
            productId,
            name: `${season.name} ${seasonYear}`,
            startDate: `${seasonYear}-${season.startMonthDay}`,
            endDate: `${seasonYear}-${season.endMonthDay}`,
            price: money(spec.price * season.multiplier),
            createdAt,
            updatedAt: now,
          });
          spec.rates.forEach((rate, rateIndex) => {
            seasonTierRows.push({
              id: id(),
              seasonalPricingId: seasonId,
              minDuration: null,
              period: rate.period,
              discountPercent: null,
              price: money(Math.round(rate.price * season.multiplier)),
              displayOrder: rateIndex,
              createdAt,
              updatedAt: now,
            });
          });
        }
      }
      resolved.set(spec.key, { spec, id: productId, units });
    });

    await insertAll(tx, schema.products, productRows);
    await insertAll(tx, schema.productCategories, productCategoryRows);
    await insertAll(tx, schema.productPricingTiers, tierRows);
    await insertAll(tx, schema.productSeasonalPricing, seasonRows);
    await insertAll(tx, schema.productSeasonalPricingTiers, seasonTierRows);
    await insertAll(tx, schema.productUnits, unitRows);
    await insertAll(tx, schema.productUnitEvents, unitEventRows);

    const accessoryRows: Array<typeof schema.productAccessories.$inferInsert> = [];
    for (const spec of vertical.products) {
      const target = resolved.get(spec.key)!;
      (spec.accessories ?? []).forEach((key, displayOrder) => {
        const accessory = resolved.get(key);
        if (!accessory || accessory.id === target.id) return;
        accessoryRows.push({
          id: id(),
          productId: target.id,
          accessoryId: accessory.id,
          displayOrder,
          createdAt: storeCreatedAt,
        });
      });
    }
    await insertAll(tx, schema.productAccessories, accessoryRows);

    await insertAll(
      tx,
      schema.promoCodes,
      vertical.promoCodes.map((promo) => ({
        id: id(),
        storeId,
        code: promo.code,
        description: promo.description,
        type: promo.type,
        value: money(promo.value),
        minimumAmount: promo.minimumAmount === null ? null : money(promo.minimumAmount),
        maxUsageCount: null,
        currentUsageCount: promo.currentUsageCount,
        startsAt: new Date(now.getTime() - 60 * DAY_MS),
        expiresAt: null,
        isActive: true,
        createdAt: new Date(now.getTime() - 60 * DAY_MS),
        updatedAt: now,
      })),
    );

    // ------------------------------------------------------------ inspection template
    const templateId = id();
    const templateFields = vertical.inspectionFields.map((field, displayOrder) => ({
      id: id(),
      templateId,
      name: field.name,
      description: null,
      fieldType: field.fieldType,
      options: field.options ?? null,
      ratingMin: 1,
      ratingMax: 5,
      numberUnit: field.numberUnit ?? null,
      isRequired: field.isRequired,
      sectionName: field.sectionName ?? null,
      displayOrder,
      createdAt: storeCreatedAt,
    }));
    await tx.insert(schema.inspectionTemplates).values({
      id: templateId,
      storeId,
      scope: "store",
      categoryId: null,
      productId: null,
      name: "Contrôle du matériel",
      description: "Points vérifiés au départ et au retour.",
      isActive: true,
      displayOrder: 0,
      createdAt: storeCreatedAt,
      updatedAt: now,
    });
    await insertAll(tx, schema.inspectionTemplateFields, templateFields);

    // ------------------------------------------------------------ customers
    const towns = vertical.towns ?? DEMO_TOWNS;
    const customerRows: Array<typeof schema.customers.$inferInsert> = [];
    const usedEmails = new Set<string>();
    while (customerRows.length < CUSTOMER_COUNT) {
      const firstName = pick(rng, DEMO_FIRST_NAMES);
      const lastName = pick(rng, DEMO_LAST_NAMES);
      const email = `${slugifyName(`${firstName} ${lastName}`)}@${DEMO_EMAIL_DOMAIN}`;
      if (usedEmails.has(email)) continue;
      usedEmails.add(email);
      const town = pick(rng, towns);
      const createdAt = new Date(now.getTime() - randomInt(rng, 10, 380) * DAY_MS);
      customerRows.push({
        id: id(),
        storeId,
        customerType: "individual",
        email,
        firstName,
        lastName,
        phone: `06 39 98 ${String(randomInt(rng, 10, 99))} ${String(randomInt(rng, 10, 99))}`,
        address: `${randomInt(rng, 1, 80)} ${pick(rng, DEMO_STREETS)}`,
        city: town.city,
        postalCode: town.postalCode,
        country: "FR",
        notes: null,
        createdAt,
        updatedAt: now,
      });
    }
    await insertAll(tx, schema.customers, customerRows);

    // ------------------------------------------------------------ bookings
    const reservationRows: Array<typeof schema.reservations.$inferInsert> = [];
    const itemRows: Array<typeof schema.reservationItems.$inferInsert> = [];
    const itemUnitRows: Array<typeof schema.reservationItemUnits.$inferInsert> = [];
    const activityRows: Array<typeof schema.reservationActivity.$inferInsert> = [];
    const paymentRows: Array<typeof schema.payments.$inferInsert> = [];
    const inspectionRows: Array<typeof schema.inspections.$inferInsert> = [];
    const inspectionItemRows: Array<typeof schema.inspectionItems.$inferInsert> = [];
    const inspectionValueRows: Array<typeof schema.inspectionFieldValues.$inferInsert> = [];

    const bufferMs = vertical.settings.turnoverBufferMinutes * MINUTE;
    const unitBookings = new Map<string, Array<[number, number]>>();
    const unitFree = (unitId: string, start: number, end: number) =>
      (unitBookings.get(unitId) ?? []).every(
        ([from, to]) => end + bufferMs <= from || start >= to + bufferMs,
      );
    const bookUnit = (unitId: string, start: number, end: number) => {
      const list = unitBookings.get(unitId) ?? [];
      list.push([start, end]);
      unitBookings.set(unitId, list);
    };

    const numberCounters = new Map<string, number>();
    const nextNumber = (date: Date) => {
      const { year: y, month } = parisParts(date);
      const prefix = `R${String(y).slice(-2)}${String(month).padStart(2, "0")}-`;
      const next = (numberCounters.get(prefix) ?? 0) + 1;
      numberCounters.set(prefix, next);
      return `${prefix}${String(1000 + next * 7).padStart(4, "0")}`;
    };

    const storeSnapshot = {
      type: "primary" as const,
      name: vertical.store.name,
      address: vertical.store.address,
      city: vertical.store.city,
      postalCode: vertical.store.postalCode,
      country: "FR",
    };

    for (const plan of planBookings(rng, vertical, now)) {
      const reservationId = id();
      const customer = pick(rng, customerRows);
      const startMs = plan.start.getTime();
      const endMs = plan.end.getTime();
      const durationMinutes = Math.round((endMs - startMs) / MINUTE);
      const holdsStock = ["confirmed", "ongoing", "completed"].includes(plan.status);

      let subtotal = 0;
      let depositTotal = 0;
      const planned: Array<{
        itemId: string;
        product: ResolvedProduct;
        unitIds: string[];
        quantity: number;
      }> = [];

      for (const line of plan.lines) {
        const product = resolved.get(line.key);
        if (!product) continue;
        let quantity = line.quantity;
        let unitIds: string[] = [];
        if (product.spec.trackUnits) {
          const free = product.units.filter((unit) => unitFree(unit.id, startMs, endMs));
          quantity = Math.min(quantity, free.length);
          if (quantity === 0) continue;
          if (holdsStock) {
            unitIds = free.slice(0, quantity).map((unit) => unit.id);
            for (const unitId of unitIds) bookUnit(unitId, startMs, endMs);
          }
        }

        const { calculation, season, basePrice } = priceLine(
          product.spec,
          plan.start,
          durationMinutes,
          quantity,
        );
        const lineTotal = round2(calculation.subtotal);
        const unitPrice = round2(lineTotal / quantity);
        const combination = product.units.find((unit) => unit.id === unitIds[0]);
        const itemId = id();
        itemRows.push({
          id: itemId,
          reservationId,
          productId: product.id,
          isCustomItem: false,
          quantity,
          unitPrice: money(unitPrice),
          depositPerUnit: money(product.spec.deposit),
          totalPrice: money(lineTotal),
          taxRate: money(TAX_RATE),
          taxAmount: money(lineTotal - lineTotal / 1.2),
          priceExclTax: money(unitPrice / 1.2),
          totalExclTax: money(lineTotal / 1.2),
          pricingBreakdown: {
            basePrice,
            effectivePrice: unitPrice,
            duration: Math.max(1, Math.round(durationMinutes / product.spec.basePeriodMinutes)),
            pricingMode: product.spec.pricingMode,
            discountPercent: calculation.reductionPercent,
            discountAmount: calculation.savings,
            tierApplied: calculation.appliedRate ? `${calculation.appliedRate.period} min` : null,
            durationMinutes,
            appliedPeriods: calculation.periodsUsed,
            appliedRates: calculation.plan.map((entry) => ({
              period: entry.rate.period,
              price: entry.rate.price,
              quantity: entry.quantity,
            })),
            optimizerVersion: "v2",
            taxRate: TAX_RATE,
            taxAmount: round2(lineTotal - lineTotal / 1.2),
            subtotalExclTax: round2(lineTotal / 1.2),
            subtotalInclTax: lineTotal,
            seasonalSegments: season.name
              ? [
                  {
                    seasonalPricingId: null,
                    seasonalPricingName: season.name,
                    startDate: plan.start.toISOString().slice(0, 10),
                    endDate: plan.end.toISOString().slice(0, 10),
                    subtotal: lineTotal,
                  },
                ]
              : undefined,
          },
          productSnapshot: {
            name: product.spec.name,
            description: product.spec.description,
            images: product.spec.images,
            combinationKey: combination?.combinationKey ?? null,
            selectedAttributes: combination?.attributes ?? null,
          },
          combinationKey: combination?.combinationKey ?? null,
          selectedAttributes: combination?.attributes ?? null,
          createdAt: plan.createdAt,
        });
        for (const unitId of unitIds) {
          const unit = product.units.find((candidate) => candidate.id === unitId)!;
          itemUnitRows.push({
            id: id(),
            reservationItemId: itemId,
            productUnitId: unitId,
            identifierSnapshot: unit.identifier,
            assignedAt: addMinutes(plan.start, -60),
          });
        }
        planned.push({ itemId, product, unitIds, quantity });
        subtotal += lineTotal;
        depositTotal += product.spec.deposit * quantity;
      }
      if (planned.length === 0) continue;

      const delivered = vertical.key === "evenementiel" && chance(rng, 0.6);
      const deliveryFee = delivered ? 45 : 0;
      const total = round2(subtotal + deliveryFee);
      const pickedUpAt =
        plan.status === "ongoing" || plan.status === "completed"
          ? addMinutes(plan.start, randomInt(rng, -10, 35))
          : null;
      const returnedAt =
        plan.status === "completed" ? addMinutes(plan.end, randomInt(rng, -90, 30)) : null;

      reservationRows.push({
        id: reservationId,
        storeId,
        customerId: customer.id!,
        locale: "fr",
        number: nextNumber(plan.createdAt),
        status: plan.status,
        startDate: plan.start,
        endDate: plan.end,
        subtotalAmount: money(subtotal),
        depositAmount: money(depositTotal),
        totalAmount: money(total),
        subtotalExclTax: money(total / 1.2),
        taxAmount: money(total - total / 1.2),
        taxRate: money(TAX_RATE),
        taxDisplayMode: "inclusive",
        signedAt: pickedUpAt,
        signatureMethod: null,
        contractValidatedAt: holdsStock ? plan.createdAt : null,
        depositStatus: "pending",
        pickedUpAt,
        returnedAt,
        // A demo store is never billed.
        billableAt: null,
        currency: "EUR",
        customerNotes: chance(rng, 0.35) ? pick(rng, vertical.customerNotes) : null,
        internalNotes: chance(rng, 0.25) ? pick(rng, vertical.internalNotes) : null,
        outboundMethod: delivered ? "address" : "store",
        returnMethod: delivered ? "address" : "store",
        deliveryOption: delivered ? "delivery" : "pickup",
        deliveryAddress: delivered ? customer.address : null,
        deliveryCity: delivered ? customer.city : null,
        deliveryPostalCode: delivered ? customer.postalCode : null,
        deliveryCountry: delivered ? "FR" : null,
        deliveryFee: money(deliveryFee),
        pickupLocationSnapshot: delivered ? null : storeSnapshot,
        discountAmount: "0.00",
        source: plan.source,
        createdAt: plan.createdAt,
        updatedAt: returnedAt ?? pickedUpAt ?? plan.createdAt,
      });

      activityRows.push({
        id: id(),
        reservationId,
        userId: plan.source === "online" ? null : ownerUserId,
        activityType: "created",
        description:
          plan.source === "online"
            ? "Réservation créée depuis la boutique en ligne"
            : plan.source === "phone"
              ? "Réservation prise par téléphone"
              : "Réservation créée depuis le tableau de bord",
        metadata: { source: plan.source },
        createdAt: plan.createdAt,
      });
      if (holdsStock) {
        activityRows.push({
          id: id(),
          reservationId,
          userId: plan.source === "online" ? null : ownerUserId,
          activityType: "confirmed",
          description: null,
          metadata: null,
          createdAt: addMinutes(plan.createdAt, randomInt(rng, 1, 120)),
        });
      }
      if (plan.status === "cancelled" || plan.status === "rejected") {
        activityRows.push({
          id: id(),
          reservationId,
          userId: ownerUserId,
          activityType: plan.status,
          description:
            plan.status === "cancelled"
              ? "Annulation du client, changement de programme."
              : "Plus de matériel disponible à ces dates.",
          metadata: null,
          createdAt: addMinutes(plan.createdAt, randomInt(rng, 60, 2000)),
        });
      }
      if (pickedUpAt) {
        activityRows.push({
          id: id(),
          reservationId,
          userId: ownerUserId,
          activityType: "picked_up",
          description: null,
          metadata: null,
          createdAt: pickedUpAt,
        });
      }
      if (returnedAt) {
        activityRows.push({
          id: id(),
          reservationId,
          userId: ownerUserId,
          activityType: "returned",
          description: null,
          metadata: null,
          createdAt: returnedAt,
        });
      }

      // ------------------------------------------------ payments, by hand only
      if (holdsStock && total > 0) {
        const onlineShare =
          plan.source === "online"
            ? round2((total * vertical.settings.onlinePaymentDepositPercentage) / 100)
            : 0;
        if (onlineShare > 0) {
          paymentRows.push({
            id: id(),
            reservationId,
            amount: money(onlineShare),
            type: "rental",
            method: "card",
            status: "completed",
            currency: "EUR",
            notes: "Réglé en ligne à la réservation",
            paidAt: plan.createdAt,
            createdAt: plan.createdAt,
            updatedAt: plan.createdAt,
          });
          activityRows.push({
            id: id(),
            reservationId,
            userId: null,
            activityType: "payment_received",
            description: `Paiement de ${money(onlineShare)} € reçu`,
            metadata: { amount: onlineShare },
            createdAt: plan.createdAt,
          });
        }
        const balance = round2(total - onlineShare);
        if (balance > 0 && pickedUpAt) {
          const method = pickWeighted(rng, [
            { item: "card" as const, weight: 60 },
            { item: "cash" as const, weight: 25 },
            { item: "transfer" as const, weight: 15 },
          ]);
          paymentRows.push({
            id: id(),
            reservationId,
            amount: money(balance),
            type: "rental",
            method,
            status: "completed",
            currency: "EUR",
            notes: onlineShare > 0 ? "Solde réglé au retrait" : "Réglé au retrait",
            paidAt: pickedUpAt,
            createdAt: pickedUpAt,
            updatedAt: pickedUpAt,
          });
        }
      }
      if (pickedUpAt && depositTotal > 0) {
        const method = chance(rng, 0.6) ? ("check" as const) : ("card" as const);
        paymentRows.push({
          id: id(),
          reservationId,
          amount: money(depositTotal),
          type: "deposit",
          method,
          status: "completed",
          currency: "EUR",
          notes:
            method === "check"
              ? "Caution par chèque, non encaissée"
              : "Caution par carte au comptoir",
          paidAt: pickedUpAt,
          createdAt: pickedUpAt,
          updatedAt: pickedUpAt,
        });
        if (returnedAt) {
          paymentRows.push({
            id: id(),
            reservationId,
            amount: money(depositTotal),
            type: "deposit_return",
            method,
            status: "completed",
            currency: "EUR",
            notes: "Caution restituée au retour",
            paidAt: returnedAt,
            createdAt: returnedAt,
            updatedAt: returnedAt,
          });
        }
      }

      // ------------------------------------------------ inspections
      const inspectionTypes: Array<"departure" | "return"> =
        plan.status === "completed" && chance(rng, 0.35)
          ? ["departure", "return"]
          : plan.withDepartureInspection && pickedUpAt
            ? ["departure"]
            : [];
      for (const type of inspectionTypes) {
        const inspectionId = id();
        const performedAt = type === "departure" ? pickedUpAt! : returnedAt!;
        inspectionRows.push({
          id: inspectionId,
          storeId,
          reservationId,
          type,
          status: "completed",
          templateId,
          templateSnapshot: {
            id: templateId,
            name: "Contrôle du matériel",
            fields: templateFields.map((field) => ({
              id: field.id,
              name: field.name,
              fieldType: field.fieldType,
              isRequired: field.isRequired,
              sectionName: field.sectionName ?? undefined,
            })),
          },
          notes: null,
          performedById: ownerUserId,
          performedAt,
          hasDamage: false,
          createdAt: performedAt,
          updatedAt: performedAt,
        });
        for (const row of planned) {
          const inspectionItemId = id();
          const unitId = row.unitIds[0] ?? null;
          inspectionItemRows.push({
            id: inspectionItemId,
            inspectionId,
            reservationItemId: row.itemId,
            productUnitId: unitId,
            productSnapshot: {
              name: row.product.spec.name,
              unitIdentifier: row.product.units.find((unit) => unit.id === unitId)?.identifier,
            },
            overallCondition: pick(rng, ["excellent", "good"] as const),
            notes: null,
            createdAt: performedAt,
          });
          for (const field of templateFields) {
            inspectionValueRows.push({
              id: id(),
              inspectionItemId,
              templateFieldId: field.id,
              fieldSnapshot: {
                name: field.name,
                fieldType: field.fieldType,
                sectionName: field.sectionName ?? undefined,
              },
              checkboxValue: field.fieldType === "checkbox" ? true : null,
              ratingValue: field.fieldType === "rating" ? randomInt(rng, 4, 5) : null,
              textValue: field.fieldType === "text" ? (chance(rng, 0.3) ? "RAS" : null) : null,
              numberValue:
                field.fieldType === "number"
                  ? money(field.numberUnit === "%" ? randomInt(rng, 60, 100) : randomInt(rng, 3, 8))
                  : null,
              selectValue:
                field.fieldType === "select" ? pick(rng, field.options ?? ["Bon"]) : null,
              createdAt: performedAt,
            });
          }
        }
      }
    }

    await insertAll(tx, schema.reservations, reservationRows);
    await insertAll(tx, schema.reservationItems, itemRows);
    await insertAll(tx, schema.reservationItemUnits, itemUnitRows);
    await insertAll(tx, schema.reservationActivity, activityRows);
    await insertAll(tx, schema.payments, paymentRows);
    await insertAll(tx, schema.inspections, inspectionRows);
    await insertAll(tx, schema.inspectionItems, inspectionItemRows);
    await insertAll(tx, schema.inspectionFieldValues, inspectionValueRows);
  });

  return { storeId, slug };
}
