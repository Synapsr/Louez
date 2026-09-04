#!/usr/bin/env tsx
/**
 * Louez Demo Store Seed — "Ar Mor Location"
 *
 * DEVELOPMENT ONLY. Creates a single, hand-curated store that looks like a
 * real business: coherent catalog, seasonal pricing, tracked inventory, a
 * year of reservation history with realistic seasonality, and a "today" that
 * has ongoing rentals, pickups and returns due — so demo recordings show a
 * living dashboard instead of an empty one.
 *
 * Usage:
 *   pnpm --filter @louez/web db:seed:demo --email=you@example.com
 *   pnpm --filter @louez/web db:seed:demo -e you@example.com --months=12 --yes
 *   pnpm --filter @louez/web db:seed:demo -e you@example.com --reset
 */
import 'dotenv/config';

import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/mysql2';
import { createPool } from 'mysql2/promise';
import { nanoid } from 'nanoid';

import * as schema from '@louez/db';
import { buildCombinationKey, calculateRateBasedPrice } from '@louez/utils';
import type {
  BusinessHours,
  CustomerNotificationSettings,
  EmailSettings,
  NotificationSettings,
  StoreSettings,
  StoreTheme,
} from '@louez/types';

import {
  DEMO_CATEGORIES,
  DEMO_CGV,
  DEMO_INSPECTION_TEMPLATES,
  DEMO_LEGAL_NOTICE,
  DEMO_LOCATIONS,
  DEMO_PRODUCTS,
  DEMO_PROMO_CODES,
  DEMO_STORE,
  DEMO_VARIANT_DEFINITIONS,
  type DemoProduct,
  type DemoRate,
} from './catalog';
import { resolveProductImages } from './images';
import {
  CUSTOMER_NOTES,
  DEMO_BUSINESS_CUSTOMERS,
  DEMO_PENDING_INVITATIONS,
  DEMO_TEAM,
  FIRST_NAMES,
  FOREIGN_CUSTOMERS,
  LAST_NAMES,
  LOCAL_TOWNS,
  STREET_NAMES,
  VISITOR_TOWNS,
} from './people';
import { colors, logError, logInfo, logSection, logSuccess } from '../utils';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDB = ReturnType<typeof drizzle<any>>;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY_MS = 24 * HOUR;
const DAY_MIN = 1440;

// ---------------------------------------------------------------------------
// Deterministic randomness — a demo store should look the same on every run
// ---------------------------------------------------------------------------

let rngState = 0x9e3779b9;

function seedRng(seed: number): void {
  rngState = seed >>> 0;
}

function random(): number {
  rngState |= 0;
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function randomInt(min: number, max: number): number {
  return Math.floor(random() * (max - min + 1)) + min;
}

function chance(p: number): boolean {
  return random() < p;
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}

function pickWeighted<T>(items: Array<{ item: T; weight: number }>): T {
  const total = items.reduce((sum, entry) => sum + entry.weight, 0);
  let r = random() * total;
  for (const entry of items) {
    r -= entry.weight;
    if (r <= 0) return entry.item;
  }
  return items[items.length - 1].item;
}

function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function id(): string {
  // nanoid() is not seeded, but ids never need to be reproducible.
  return nanoid();
}

// ---------------------------------------------------------------------------
// Date helpers (store timezone is Europe/Paris; the seed runs in local time,
// which is what the dashboard renders for a French store)
// ---------------------------------------------------------------------------

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function atTime(date: Date, hours: number, minutes = 0): Date {
  const d = new Date(date);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MINUTE);
}

/**
 * Next calendar day at 00:00. Adding 24 h in milliseconds breaks across the
 * October DST change and yields the same local day twice, which collides with
 * the unique (store, date) index on daily_stats.
 */
function nextDay(date: Date): Date {
  const d = startOfDay(date);
  d.setDate(d.getDate() + 1);
  return d;
}

function toDateOnly(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function money(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface DemoSeedOptions {
  email: string;
  months: number;
  reservations: number;
  customers: number;
  seed: number;
  reset: boolean;
  skipConfirmation: boolean;
}

function parseCliOptions(): DemoSeedOptions {
  const { values } = parseArgs({
    options: {
      email: { type: 'string', short: 'e' },
      months: { type: 'string', short: 'm' },
      reservations: { type: 'string', short: 'r' },
      customers: { type: 'string', short: 'c' },
      seed: { type: 'string', short: 's' },
      reset: { type: 'boolean', default: false },
      yes: { type: 'boolean', short: 'y', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
    allowPositionals: true,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  if (!values.email) {
    logError('--email is required (owner of the demo store)');
    printHelp();
    process.exit(1);
  }

  return {
    email: values.email,
    months: values.months ? Number.parseInt(values.months, 10) : 12,
    reservations: values.reservations
      ? Number.parseInt(values.reservations, 10)
      : 700,
    customers: values.customers ? Number.parseInt(values.customers, 10) : 180,
    seed: values.seed ? Number.parseInt(values.seed, 10) : 20260729,
    reset: values.reset ?? false,
    skipConfirmation: values.yes ?? false,
  };
}

function printHelp(): void {
  console.log(`
${colors.bold}Louez — Demo Store Seed${colors.reset}
${colors.yellow}Development database only (port 6984)${colors.reset}

Creates the "${DEMO_STORE.name}" demo store (slug: ${DEMO_STORE.slug}) with a
curated catalog, tracked inventory, a year of reservations and analytics.

${colors.bold}Usage:${colors.reset}
  pnpm --filter @louez/web db:seed:demo --email=<EMAIL> [options]

${colors.bold}Options:${colors.reset}
  --email, -e         Owner account (created if missing)   [required]
  --months, -m        Months of history to generate        [12]
  --reservations, -r  Approximate reservation count        [400]
  --customers, -c     Approximate customer count           [180]
  --seed, -s          PRNG seed (same seed = same data)    [20260729]
  --reset             Delete an existing demo store first
  --yes, -y           Skip the confirmation prompt
`);
}

function validateEnvironment(): void {
  if (process.env.NODE_ENV === 'production') {
    logError('The demo seed cannot run with NODE_ENV=production.');
    process.exit(1);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    logError('DATABASE_URL is not set.');
    process.exit(1);
  }
  if (url.includes(':6053')) {
    logError('Production database detected (port 6053). Refusing to run.');
    process.exit(1);
  }
}

async function confirm(options: DemoSeedOptions): Promise<boolean> {
  if (options.skipConfirmation) return true;
  const readline = await import('node:readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const masked = (process.env.DATABASE_URL ?? '').replace(/:([^:@]+)@/, ':****@');
  console.log('');
  console.log(`  Store:        ${colors.bold}${DEMO_STORE.name}${colors.reset} (${DEMO_STORE.slug})`);
  console.log(`  Owner:        ${options.email}`);
  console.log(`  Database:     ${masked}`);
  console.log(`  History:      ${options.months} months`);
  console.log(`  Volume:       ~${DEMO_PRODUCTS.length} products, ~${options.customers} customers, ~${options.reservations} reservations`);
  console.log(`  Reset first:  ${options.reset ? 'yes' : 'no'}`);
  console.log('');
  return new Promise((resolve) => {
    rl.question(`${colors.yellow}Continue? (y/N): ${colors.reset}`, (answer) => {
      rl.close();
      resolve(['y', 'yes'].includes(answer.trim().toLowerCase()));
    });
  });
}

// ---------------------------------------------------------------------------
// Bulk insert
// ---------------------------------------------------------------------------

const BATCH_SIZE = 200;

async function insertAll<T>(
  db: DrizzleDB,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any,
  rows: T[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    await db.insert(table).values(rows.slice(i, i + BATCH_SIZE));
  }
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

/**
 * Delete every row belonging to a store, child tables first. The schema only
 * declares a handful of real foreign keys, so ordering is done explicitly
 * rather than relying on cascades.
 */
const WIPE_STATEMENTS = (storeId: string): string[] => {
  const s = `'${storeId}'`;
  const reservationIds = `SELECT id FROM reservations WHERE store_id = ${s}`;
  const itemIds = `SELECT id FROM reservation_items WHERE reservation_id IN (${reservationIds})`;
  const productIds = `SELECT id FROM products WHERE store_id = ${s}`;
  const inspectionIds = `SELECT id FROM inspections WHERE store_id = ${s}`;
  const inspectionItemIds = `SELECT id FROM inspection_items WHERE inspection_id IN (${inspectionIds})`;
  const templateIds = `SELECT id FROM inspection_templates WHERE store_id = ${s}`;
  const definitionIds = `SELECT id FROM variant_definitions WHERE store_id = ${s}`;
  const seasonalIds = `SELECT id FROM product_seasonal_pricing WHERE product_id IN (${productIds})`;

  return [
    `DELETE FROM inspection_photos WHERE inspection_item_id IN (${inspectionItemIds})`,
    `DELETE FROM inspection_field_values WHERE inspection_item_id IN (${inspectionItemIds})`,
    `DELETE FROM inspection_items WHERE inspection_id IN (${inspectionIds})`,
    `DELETE FROM inspections WHERE store_id = ${s}`,
    `DELETE FROM inspection_template_fields WHERE template_id IN (${templateIds})`,
    `DELETE FROM inspection_templates WHERE store_id = ${s}`,
    `DELETE FROM reservation_item_units WHERE reservation_item_id IN (${itemIds})`,
    `DELETE FROM reservation_calendar_events WHERE reservation_id IN (${reservationIds})`,
    `DELETE FROM reservation_activity WHERE reservation_id IN (${reservationIds})`,
    `DELETE FROM documents WHERE reservation_id IN (${reservationIds})`,
    `DELETE FROM payments WHERE reservation_id IN (${reservationIds})`,
    `DELETE FROM reservation_items WHERE reservation_id IN (${reservationIds})`,
    `DELETE FROM payment_requests WHERE store_id = ${s}`,
    `DELETE FROM review_request_logs WHERE store_id = ${s}`,
    `DELETE FROM reminder_logs WHERE store_id = ${s}`,
    `DELETE FROM email_logs WHERE store_id = ${s}`,
    `DELETE FROM sms_logs WHERE store_id = ${s}`,
    `DELETE FROM discord_logs WHERE store_id = ${s}`,
    `DELETE FROM admin_digest_logs WHERE store_id = ${s}`,
    `DELETE FROM reservations WHERE store_id = ${s}`,
    `DELETE FROM customer_sessions WHERE customer_id IN (SELECT id FROM customers WHERE store_id = ${s})`,
    `DELETE FROM customers WHERE store_id = ${s}`,
    `DELETE FROM product_unit_events WHERE store_id = ${s}`,
    `DELETE FROM product_unit_downtimes WHERE store_id = ${s}`,
    `DELETE FROM product_units WHERE product_id IN (${productIds})`,
    `DELETE FROM product_accessories WHERE product_id IN (${productIds})`,
    `DELETE FROM product_seasonal_pricing_tiers WHERE seasonal_pricing_id IN (${seasonalIds})`,
    `DELETE FROM product_seasonal_pricing WHERE product_id IN (${productIds})`,
    `DELETE FROM product_pricing_tiers WHERE product_id IN (${productIds})`,
    `DELETE FROM product_categories WHERE product_id IN (${productIds})`,
    `DELETE FROM products_tulip WHERE product_id IN (${productIds})`,
    `DELETE FROM product_stats WHERE store_id = ${s}`,
    `DELETE FROM products WHERE store_id = ${s}`,
    `DELETE FROM variant_values WHERE definition_id IN (${definitionIds})`,
    `DELETE FROM variant_definitions WHERE store_id = ${s}`,
    `DELETE FROM categories WHERE store_id = ${s}`,
    `DELETE FROM page_views WHERE store_id = ${s}`,
    `DELETE FROM storefront_events WHERE store_id = ${s}`,
    `DELETE FROM daily_stats WHERE store_id = ${s}`,
    `DELETE FROM promo_codes WHERE store_id = ${s}`,
    `DELETE FROM store_locations WHERE store_id = ${s}`,
    `DELETE FROM sms_topup_transactions WHERE store_id = ${s}`,
    `DELETE FROM sms_credits WHERE store_id = ${s}`,
    `DELETE FROM store_invitations WHERE store_id = ${s}`,
    `DELETE FROM store_members WHERE store_id = ${s}`,
    `DELETE FROM platform_fee WHERE store_id = ${s}`,
    `DELETE FROM pay_as_you_go_invoices WHERE store_id = ${s}`,
    `DELETE FROM subscriptions WHERE store_id = ${s}`,
    `DELETE FROM stores WHERE id = ${s}`,
  ];
};

// ---------------------------------------------------------------------------
// Store settings
// ---------------------------------------------------------------------------

function buildBusinessHours(): BusinessHours {
  const summer = [
    { openTime: '09:00', closeTime: '12:30' },
    { openTime: '14:00', closeTime: '19:00' },
  ];
  return {
    enabled: true,
    schedule: {
      0: { isOpen: true, ranges: [{ openTime: '09:30', closeTime: '12:30' }] },
      1: { isOpen: true, ranges: summer },
      2: { isOpen: true, ranges: summer },
      3: { isOpen: true, ranges: summer },
      4: { isOpen: true, ranges: summer },
      5: { isOpen: true, ranges: summer },
      6: { isOpen: true, ranges: [{ openTime: '09:00', closeTime: '19:00' }] },
    },
    closurePeriods: [
      {
        id: id(),
        name: 'Fermeture annuelle',
        startDate: '2026-11-16',
        endDate: '2026-12-06',
        reason: 'Entretien de la flotte et congés',
      },
      {
        id: id(),
        name: 'Jour de l’An',
        startDate: '2027-01-01',
        endDate: '2027-01-01',
        reason: 'Jour férié',
      },
    ],
  };
}

function buildStoreSettings(): StoreSettings {
  return {
    reservationMode: 'payment',
    minRentalMinutes: 240,
    maxRentalMinutes: null,
    advanceNoticeMinutes: 120,
    turnoverBufferMinutes: 45,
    requireCustomerAddress: true,
    pendingBlocksAvailability: true,
    onlinePaymentDepositPercentage: 30,
    country: 'FR',
    timezone: 'Europe/Paris',
    currency: 'EUR',
    tax: {
      enabled: true,
      defaultRate: 20,
      displayMode: 'inclusive',
      taxLabel: 'TVA',
      taxNumber: DEMO_STORE.vatNumber,
    },
    billingAddress: { useSameAsStore: true },
    businessHours: buildBusinessHours(),
    delivery: {
      enabled: true,
      multiLocationEnabled: true,
      mode: 'optional',
      pricePerKm: 1.2,
      minimumFee: 12,
      maximumDistance: 40,
      freeDeliveryThreshold: 300,
      minimumOrderAmountForDelivery: 40,
    },
    inspection: {
      enabled: true,
      mode: 'recommended',
      requireCustomerSignature: true,
      autoGeneratePdf: true,
      maxPhotosPerItem: 10,
    },
    integrationData: {},
  };
}

function buildStoreTheme(): StoreTheme {
  return {
    mode: 'light',
    primaryColor: DEMO_STORE.primaryColor,
    heroImages: [
      'https://picsum.photos/seed/armor-hero-1/1920/600',
      'https://picsum.photos/seed/armor-hero-2/1920/600',
    ],
    maxDiscountPercent: 40,
  };
}

function buildEmailSettings(): EmailSettings {
  return {
    confirmationEnabled: true,
    reminderPickupEnabled: true,
    reminderReturnEnabled: true,
    replyToEmail: 'contact@armor-location.bzh',
    defaultSignature:
      'Gwenaëlle et toute l’équipe d’Ar Mor Location\n14 quai d’Aiguillon, 29900 Concarneau\n02 98 97 41 62',
    confirmationContent: {
      subject: 'Votre location Ar Mor est confirmée 🚲',
      greeting: 'Bonjour {name},',
      message:
        'Votre matériel est réservé. Présentez-vous au 14 quai d’Aiguillon 10 minutes avant l’heure de retrait, avec une pièce d’identité. En cas de météo dégradée pour une location nautique, on vous appelle la veille.',
    },
    pickupReminderContent: {
      subject: 'Départ demain — votre location Ar Mor',
      greeting: 'Bonjour {name},',
      message:
        'Petit rappel : votre location commence demain. Pensez à prévoir un coupe-vent, la brise se lève souvent l’après-midi sur la baie.',
    },
  };
}

function buildNotificationSettings(): NotificationSettings {
  const on = { email: true, sms: false, discord: false, push: true };
  const emailOnly = { email: true, sms: false, discord: false, push: false };
  const off = { email: false, sms: false, discord: false, push: false };
  return {
    reservation_new: on,
    reservation_confirmed: emailOnly,
    reservation_rejected: emailOnly,
    reservation_cancelled: { email: true, sms: false, discord: false, push: true },
    reservation_picked_up: off,
    reservation_completed: off,
    reservation_reminder_pickup: { email: true, sms: false, discord: false, push: true },
    reservation_reminder_return: emailOnly,
    payment_received: emailOnly,
    payment_failed: on,
    reminderSettings: {
      pickupReminderHours: 24,
      returnReminderHours: 12,
      mode: 'daily_digest',
      digestHour: 8,
    },
  };
}

function buildCustomerNotificationSettings(): CustomerNotificationSettings {
  const emailOnly = { enabled: true, email: true, sms: false };
  const emailAndSms = { enabled: true, email: true, sms: true };
  return {
    customer_request_received: emailOnly,
    customer_request_accepted: emailOnly,
    customer_request_rejected: emailOnly,
    customer_reservation_confirmed: emailAndSms,
    customer_reminder_pickup: emailAndSms,
    customer_reminder_return: emailOnly,
    customer_payment_requested: emailOnly,
    customer_deposit_authorization_requested: emailOnly,
    customer_quote_sent: emailOnly,
    customer_quote_accepted: emailOnly,
    templates: {
      customer_reminder_pickup: {
        smsMessage:
          'Ar Mor Location : votre matériel vous attend demain à {time}. 14 quai d’Aiguillon, Concarneau. 02 98 97 41 62',
      },
    },
    reminderSettings: { pickupReminderHours: 24, returnReminderHours: 12 },
  };
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

interface ResolvedProduct {
  spec: DemoProduct;
  id: string;
  categoryId: string;
  images: string[];
  /** Effective active stock (unit count when tracked) */
  capacity: number;
  unitIds: string[];
  unitById: Map<string, { id: string; identifier: string; attributes: Record<string, string> | null; combinationKey: string }>;
}

/** Season multiplier that applies to a rental starting on `date`. */
function seasonMultiplier(spec: DemoProduct, date: Date): number {
  if (!spec.seasons?.length) return 1;
  const monthDay = `${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
  for (const season of spec.seasons) {
    if (monthDay >= season.startMonthDay && monthDay <= season.endMonthDay) {
      return season.multiplier;
    }
  }
  return 1;
}

function ratesFor(spec: DemoProduct, multiplier: number): DemoRate[] {
  if (multiplier === 1) return spec.rates;
  return spec.rates.map((rate) => ({
    period: rate.period,
    price: Math.round(rate.price * multiplier),
  }));
}

function priceFor(
  spec: DemoProduct,
  start: Date,
  durationMinutes: number,
  quantity: number,
) {
  const multiplier = seasonMultiplier(spec, start);
  return calculateRateBasedPrice(
    {
      basePrice: Math.round(spec.price * multiplier * 100) / 100,
      basePeriodMinutes: spec.basePeriodMinutes,
      deposit: spec.deposit,
      rates: ratesFor(spec, multiplier).map((rate, index) => ({
        id: `${spec.key}-${rate.period}`,
        price: rate.price,
        period: rate.period,
        displayOrder: index,
      })),
      enforceStrictTiers: spec.enforceStrictTiers,
    },
    durationMinutes,
    quantity,
  );
}

// ---------------------------------------------------------------------------
// Availability bookkeeping
// ---------------------------------------------------------------------------

interface Booking {
  start: number;
  end: number;
  quantity: number;
}

const TURNOVER_BUFFER_MS = 45 * MINUTE;

class AvailabilityLedger {
  private byProduct = new Map<string, Booking[]>();
  private byUnit = new Map<string, Booking[]>();

  private overlaps(bookings: Booking[], start: number, end: number): Booking[] {
    return bookings.filter(
      (b) => start < b.end + TURNOVER_BUFFER_MS && end + TURNOVER_BUFFER_MS > b.start,
    );
  }

  productAvailable(
    productId: string,
    start: number,
    end: number,
    quantity: number,
    capacity: number,
  ): boolean {
    const booked = this.overlaps(this.byProduct.get(productId) ?? [], start, end).reduce(
      (sum, b) => sum + b.quantity,
      0,
    );
    return booked + quantity <= capacity;
  }

  bookProduct(productId: string, start: number, end: number, quantity: number): void {
    const list = this.byProduct.get(productId) ?? [];
    list.push({ start, end, quantity });
    this.byProduct.set(productId, list);
  }

  /**
   * Pick `count` units that are free over the window, or null if impossible.
   * Least-used units come first so the fleet rotates the way a shop rotates
   * it, instead of hammering the first unit of every product.
   */
  pickUnits(unitIds: string[], start: number, end: number, count: number): string[] | null {
    const free = unitIds.filter(
      (unitId) => this.overlaps(this.byUnit.get(unitId) ?? [], start, end).length === 0,
    );
    if (free.length < count) return null;
    return free
      .sort((a, b) => (this.byUnit.get(a)?.length ?? 0) - (this.byUnit.get(b)?.length ?? 0))
      .slice(0, count);
  }

  bookUnit(unitId: string, start: number, end: number): void {
    const list = this.byUnit.get(unitId) ?? [];
    list.push({ start, end, quantity: 1 });
    this.byUnit.set(unitId, list);
  }

  /** Block a unit for maintenance so it is never booked during that window. */
  blockUnit(unitId: string, start: number, end: number): void {
    this.bookUnit(unitId, start, end);
  }
}

// ---------------------------------------------------------------------------
// Seasonality
// ---------------------------------------------------------------------------

/** Relative rental demand per month for a seaside shop in southern Brittany. */
const MONTH_WEIGHTS = [
  0.3, // Jan
  0.35, // Feb
  0.6, // Mar
  1.3, // Apr
  1.6, // May
  2.2, // Jun
  3.6, // Jul
  3.6, // Aug
  1.6, // Sep
  0.8, // Oct
  0.4, // Nov
  0.35, // Dec
];

// ---------------------------------------------------------------------------
// Cart profiles
// ---------------------------------------------------------------------------

type CartProfile = 'famille' | 'couple' | 'solo' | 'nautique' | 'itinerance' | 'pro';

const PROFILE_WEIGHTS: Array<{ item: CartProfile; weight: number }> = [
  { item: 'couple', weight: 30 },
  { item: 'famille', weight: 24 },
  { item: 'solo', weight: 18 },
  { item: 'nautique', weight: 16 },
  { item: 'itinerance', weight: 8 },
  { item: 'pro', weight: 4 },
];

const CUSTOMER_MESSAGES = [
  'Bonjour, nous arrivons vers 10h par le train, est-ce que le retrait est possible un peu plus tôt ?',
  'Merci de prévoir deux casques adultes et un casque enfant.',
  'Nous sommes hébergés au camping des Prés Verts, une livraison est-elle possible ?',
  'Je fais 1m58, merci de prévoir une petite taille.',
  'Est-ce que les vélos sont équipés de porte-bagages ? Nous partons pour trois jours.',
  'Bonjour, nous souhaitons partir vers les Glénan, quel est le meilleur créneau de marée ?',
  'Prévoir un siège bébé (enfant de 2 ans, 13 kg).',
  'Retour possible en fin de journée le dimanche ?',
  null,
  null,
  null,
  null,
];

const INTERNAL_NOTES = [
  'Client habituel, empreinte déjà enregistrée.',
  'Prévenu pour la météo, rappel la veille.',
  'A demandé une facture au nom de la société.',
  'Vérifier la pression des pneus au départ, chemins caillouteux annoncés.',
  'Groupe hébergé au camping — livraison Ronan.',
  'Batterie chargée à 100 % la veille au soir.',
  null,
  null,
  null,
  null,
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('');
  console.log(`${colors.cyan}${colors.bold}╔══════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.cyan}${colors.bold}║   LOUEZ — DEMO STORE SEED  ·  ${DEMO_STORE.name.padEnd(30)}║${colors.reset}`);
  console.log(`${colors.cyan}${colors.bold}╚══════════════════════════════════════════════════════════════╝${colors.reset}`);

  validateEnvironment();
  const options = parseCliOptions();
  seedRng(options.seed);

  if (!(await confirm(options))) {
    logInfo('Cancelled.');
    process.exit(0);
  }

  const pool = createPool(process.env.DATABASE_URL!);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = drizzle(pool as any, { schema, mode: 'default' }) as DrizzleDB;

  const now = new Date();
  const historyStart = startOfDay(addDays(now, -options.months * 30));
  const futureEnd = startOfDay(addDays(now, 75));

  try {
    // ---------------------------------------------------------------- owner
    logSection('Owner');
    const existingUser = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, options.email))
      .limit(1);

    let ownerId: string;
    if (existingUser.length > 0) {
      ownerId = existingUser[0].id;
      logInfo(`Using existing account ${options.email}`);
    } else {
      ownerId = id();
      await db.insert(schema.users).values({
        id: ownerId,
        email: options.email,
        name: 'Gwenaëlle Le Bris',
        emailVerified: true,
        createdAt: addDays(now, -420),
        updatedAt: now,
      });
      logSuccess(`Created account ${options.email}`);
    }

    // ---------------------------------------------------------------- reset
    const existingStore = await db
      .select({ id: schema.stores.id })
      .from(schema.stores)
      .where(eq(schema.stores.slug, DEMO_STORE.slug))
      .limit(1);

    if (existingStore.length > 0) {
      if (!options.reset) {
        logError(
          `A store with slug "${DEMO_STORE.slug}" already exists. Re-run with --reset to replace it.`,
        );
        process.exit(1);
      }
      logSection('Reset');
      for (const statement of WIPE_STATEMENTS(existingStore[0].id)) {
        await pool.query(statement);
      }
      logSuccess('Previous demo store deleted');
    }

    // ---------------------------------------------------------------- store
    logSection('Store');
    const storeId = id();
    const storeCreatedAt = addDays(now, -options.months * 30 - 60);

    await db.insert(schema.stores).values({
      id: storeId,
      userId: ownerId,
      name: DEMO_STORE.name,
      slug: DEMO_STORE.slug,
      description: DEMO_STORE.description,
      email: DEMO_STORE.email,
      phone: DEMO_STORE.phone,
      ownerPhone: DEMO_STORE.ownerPhone,
      address: DEMO_STORE.address,
      latitude: DEMO_STORE.latitude,
      longitude: DEMO_STORE.longitude,
      settings: buildStoreSettings(),
      theme: buildStoreTheme(),
      cgv: DEMO_CGV,
      legalNotice: DEMO_LEGAL_NOTICE,
      includeCgvInContract: true,
      // Demo history contains synthetic Stripe references, but the Store itself
      // must not claim that it can create real Checkout sessions.
      stripeAccountId: null,
      stripeOnboardingComplete: false,
      stripeChargesEnabled: false,
      emailSettings: buildEmailSettings(),
      notificationSettings: buildNotificationSettings(),
      customerNotificationSettings: buildCustomerNotificationSettings(),
      reviewBoosterSettings: {
        enabled: true,
        googlePlaceId: 'ChIJdemo_ar_mor_location_concarneau',
        googlePlaceName: 'Ar Mor Location',
        googlePlaceAddress: "14 quai d'Aiguillon, 29900 Concarneau",
        googleRating: 4.8,
        googleReviewCount: 217,
        displayReviewsOnStorefront: true,
        showReviewPromptInPortal: true,
        autoSendThankYouEmail: true,
        autoSendThankYouSms: false,
        emailDelayHours: 24,
        smsDelayHours: 48,
      },
      aiAdvisorSettings: {
        enabled: true,
        mode: 'recommended',
        displayName: 'Conseiller Ar Mor',
        welcomeMessage:
          'Bonjour ! Dites-moi ce que vous voulez faire (balade en famille, itinérance, sortie paddle…) et je vous propose le bon matériel.',
        storeContext: [
          "Boutique de location de vélos et de matériel nautique à Concarneau, ouverte toute l'année.",
          'Toujours demander la taille (ou la fourchette de taille) des personnes avant de proposer un vélo.',
          'Le matériel nautique ne se loue pas si le vent dépasse 15 nœuds : le rappeler et proposer une alternative à vélo.',
          'La livraison est possible dans un rayon de 40 km, gratuite à partir de 300 € de location.',
          'Ne jamais confirmer une location de wingfoil sans validation humaine.',
          'Les habitants du Finistère bénéficient du code LOCAL29 (-15 %) sur présentation d’un justificatif.',
        ].join('\n'),
      },
      icsToken: nanoid(32),
      referralCode: 'ARMOR29DEMO',
      onboardingCompleted: true,
      createdAt: storeCreatedAt,
      updatedAt: now,
    });
    logSuccess(`Store created — ${DEMO_STORE.name} (${storeId})`);

    await db.insert(schema.subscriptions).values({
      id: id(),
      storeId,
      planSlug: 'ultra',
      billingMode: 'subscription',
      status: 'active',
      stripeSubscriptionId: `sub_demo_${nanoid(16)}`,
      stripeCustomerId: `cus_demo_${nanoid(16)}`,
      currentPeriodEnd: addDays(now, 18),
      cancelAtPeriodEnd: false,
      freeReservationsGranted: 0,
      createdAt: storeCreatedAt,
      updatedAt: now,
    });

    await db.insert(schema.smsCredits).values({
      id: id(),
      storeId,
      balance: 372,
      totalPurchased: 1500,
      totalUsed: 1128,
      createdAt: storeCreatedAt,
      updatedAt: now,
    });

    await db.insert(schema.smsTopupTransactions).values([
      {
        id: id(),
        storeId,
        quantity: 500,
        unitPriceCents: 7,
        totalAmountCents: 3500,
        currency: 'eur',
        status: 'completed',
        stripePaymentIntentId: `pi_demo_${nanoid(16)}`,
        completedAt: addDays(now, -212),
        createdAt: addDays(now, -212),
      },
      {
        id: id(),
        storeId,
        quantity: 1000,
        unitPriceCents: 7,
        totalAmountCents: 7000,
        currency: 'eur',
        status: 'completed',
        stripePaymentIntentId: `pi_demo_${nanoid(16)}`,
        completedAt: addDays(now, -41),
        createdAt: addDays(now, -41),
      },
    ]);

    await insertAll(
      db,
      schema.storeLocations,
      DEMO_LOCATIONS.map((location) => ({
        id: id(),
        storeId,
        name: location.name,
        address: location.address,
        city: location.city,
        postalCode: location.postalCode,
        country: 'FR',
        latitude: location.latitude,
        longitude: location.longitude,
        isActive: location.isActive,
        createdAt: storeCreatedAt,
        updatedAt: now,
      })),
    );
    logSuccess(`${DEMO_LOCATIONS.length} pickup locations`);

    await insertAll(
      db,
      schema.promoCodes,
      DEMO_PROMO_CODES.map((promo) => ({
        id: id(),
        storeId,
        code: promo.code,
        description: promo.description,
        type: promo.type,
        value: money(promo.value),
        minimumAmount: promo.minimumAmount ? money(promo.minimumAmount) : null,
        maxUsageCount: promo.maxUsageCount,
        currentUsageCount: promo.currentUsageCount,
        startsAt: addDays(now, -promo.startsAtDaysAgo),
        expiresAt:
          promo.expiresInDays === null ? null : addDays(now, promo.expiresInDays),
        isActive: promo.isActive,
        createdAt: addDays(now, -promo.startsAtDaysAgo),
        updatedAt: now,
      })),
    );
    logSuccess(`${DEMO_PROMO_CODES.length} promo codes`);

    // ----------------------------------------------------------------- team
    logSection('Team');
    const teamUserIds: string[] = [];
    const staffUsers: Array<{ id: string; name: string }> = [];

    for (const member of DEMO_TEAM) {
      let userId: string;
      if (member.role === 'owner') {
        userId = ownerId;
      } else {
        const existing = await db
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(eq(schema.users.email, member.email))
          .limit(1);
        if (existing.length > 0) {
          userId = existing[0].id;
        } else {
          userId = id();
          await db.insert(schema.users).values({
            id: userId,
            email: member.email,
            name: `${member.firstName} ${member.lastName}`,
            emailVerified: true,
            createdAt: addDays(storeCreatedAt, randomInt(0, 120)),
            updatedAt: now,
          });
        }
      }
      teamUserIds.push(userId);
      staffUsers.push({ id: userId, name: `${member.firstName} ${member.lastName}` });

      await db.insert(schema.storeMembers).values({
        id: id(),
        storeId,
        userId,
        role: member.role,
        addedBy: member.role === 'owner' ? null : ownerId,
        createdAt: addDays(storeCreatedAt, member.role === 'owner' ? 0 : randomInt(10, 200)),
        updatedAt: now,
      });
    }

    await insertAll(
      db,
      schema.storeInvitations,
      DEMO_PENDING_INVITATIONS.map((invitation) => ({
        id: id(),
        storeId,
        email: invitation.email,
        role: invitation.role,
        token: nanoid(48),
        status: 'pending' as const,
        invitedBy: ownerId,
        expiresAt: addDays(now, 6),
        createdAt: addDays(now, -1),
      })),
    );
    logSuccess(`${DEMO_TEAM.length} members, ${DEMO_PENDING_INVITATIONS.length} pending invitations`);

    // ------------------------------------------------------------- catalog
    logSection('Catalog');
    const categoryIdByName = new Map<string, string>();
    await insertAll(
      db,
      schema.categories,
      DEMO_CATEGORIES.map((category) => {
        const categoryId = id();
        categoryIdByName.set(category.name, categoryId);
        return {
          id: categoryId,
          storeId,
          name: category.name,
          description: category.description,
          imageUrl: null,
          order: category.order,
          createdAt: storeCreatedAt,
          updatedAt: now,
        };
      }),
    );
    logSuccess(`${DEMO_CATEGORIES.length} categories`);

    // Variant definitions (store-level shared axes)
    const variantValueRows: Array<typeof schema.variantValues.$inferInsert> = [];
    await insertAll(
      db,
      schema.variantDefinitions,
      DEMO_VARIANT_DEFINITIONS.map((definition, index) => {
        const definitionId = id();
        for (const value of definition.values) {
          variantValueRows.push({
            id: id(),
            definitionId,
            label: value.label,
            colorHex: 'colorHex' in value ? (value.colorHex as string) : null,
            position: value.position,
            createdAt: storeCreatedAt,
          });
        }
        return {
          id: definitionId,
          storeId,
          key: definition.key,
          label: definition.label,
          kind: definition.kind,
          isActive: true,
          position: index,
          createdAt: storeCreatedAt,
          updatedAt: now,
        };
      }),
    );
    await insertAll(db, schema.variantValues, variantValueRows);
    logSuccess(
      `${DEMO_VARIANT_DEFINITIONS.length} variant axes, ${variantValueRows.length} values`,
    );

    // Products
    const productRows: Array<typeof schema.products.$inferInsert> = [];
    const productCategoryRows: Array<typeof schema.productCategories.$inferInsert> = [];
    const tierRows: Array<typeof schema.productPricingTiers.$inferInsert> = [];
    const seasonRows: Array<typeof schema.productSeasonalPricing.$inferInsert> = [];
    const seasonTierRows: Array<typeof schema.productSeasonalPricingTiers.$inferInsert> = [];
    const unitRows: Array<typeof schema.productUnits.$inferInsert> = [];
    const unitEventRows: Array<typeof schema.productUnitEvents.$inferInsert> = [];
    const downtimeRows: Array<typeof schema.productUnitDowntimes.$inferInsert> = [];

    const resolved = new Map<string, ResolvedProduct>();
    const ledger = new AvailabilityLedger();
    const seasonYears = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];

    DEMO_PRODUCTS.forEach((spec, index) => {
      const productId = id();
      const categoryId = categoryIdByName.get(spec.category)!;
      const images = resolveProductImages(spec);
      const createdAt = addDays(storeCreatedAt, randomInt(0, 90));

      const unitIds: string[] = [];
      const unitById = new Map<string, {
        id: string;
        identifier: string;
        attributes: Record<string, string> | null;
        combinationKey: string;
      }>();

      if (spec.trackUnits && spec.units) {
        let sequence = 1;
        for (const group of spec.units) {
          for (let i = 0; i < group.count; i++) {
            const unitId = id();
            const attributes = group.attributes ?? null;
            const combinationKey = buildCombinationKey(spec.axes ?? null, attributes);
            const suffix = group.attributes?.taille ? `-${group.attributes.taille}` : '';
            const identifier = `${spec.unitPrefix ?? spec.key.toUpperCase()}${suffix}-${`${sequence}`.padStart(2, '0')}`;
            sequence += 1;

            const purchasedAt = addDays(createdAt, -randomInt(10, 400));
            const purchasePrice = spec.unitPurchasePrice
              ? spec.unitPurchasePrice * (0.9 + random() * 0.2)
              : null;

            // A couple of units in every fleet are out of service, which is
            // what an inventory page should actually show.
            const retired = index % 5 === 0 && i === group.count - 1 && group.count > 2;
            const retiredAt = retired ? addDays(now, -randomInt(20, 200)) : null;

            unitRows.push({
              id: unitId,
              productId,
              identifier,
              notes: pick([
                null,
                'Batterie remplacée en 2026.',
                'Rayure sur le cadre côté droit (constatée à l’achat).',
                'Pneus neufs Marathon Plus.',
                'Selle confort montée à la demande des clients.',
                'Révision complète effectuée en atelier.',
              ]),
              images: [],
              attributes,
              combinationKey,
              lifecycleStatus: retired ? 'retired' : 'active',
              retiredAt,
              retirementReason: retired ? pick(['sold', 'broken', 'other'] as const) : null,
              retirementNote: retired
                ? pick([
                    'Revendu en fin de saison, remplacé par un modèle 2026.',
                    'Cadre fissuré après une chute, non réparable.',
                    'Sorti du parc de location, gardé comme vélo d’atelier.',
                  ])
                : null,
              purchasePrice: purchasePrice ? money(purchasePrice) : null,
              purchasedAt,
              createdAt,
              updatedAt: retiredAt ?? now,
            });

            unitEventRows.push({
              id: id(),
              productUnitId: unitId,
              identifierSnapshot: identifier,
              storeId,
              type: 'created',
              actorUserId: pick(teamUserIds),
              payload: { identifier },
              createdAt,
            });

            if (retiredAt) {
              unitEventRows.push({
                id: id(),
                productUnitId: unitId,
                identifierSnapshot: identifier,
                storeId,
                type: 'retired',
                actorUserId: pick(teamUserIds),
                payload: { reason: 'end_of_life' },
                createdAt: retiredAt,
              });
              continue;
            }

            unitIds.push(unitId);
            unitById.set(unitId, { id: unitId, identifier, attributes, combinationKey });

            // Maintenance history: past closed downtimes + a few open ones.
            if (chance(0.35)) {
              const startsAt = addDays(now, -randomInt(30, 300));
              const endsAt = addDays(startsAt, randomInt(1, 6));
              const downtimeId = id();
              downtimeRows.push({
                id: downtimeId,
                productUnitId: unitId,
                storeId,
                reason: pick(['maintenance', 'repair'] as const),
                startsAt,
                endsAt,
                note: pick([
                  'Révision complète : transmission, freins, serrages.',
                  'Changement des plaquettes de frein.',
                  'Roue arrière voilée, dévoilage atelier.',
                  'Diagnostic assistance électrique chez le concessionnaire.',
                ]),
                createdByUserId: pick(teamUserIds),
                createdAt: startsAt,
                updatedAt: endsAt,
              });
              unitEventRows.push(
                {
                  id: id(),
                  productUnitId: unitId,
                  identifierSnapshot: identifier,
                  storeId,
                  type: 'downtime_declared',
                  actorUserId: pick(teamUserIds),
                  payload: { downtimeId, startsAt: startsAt.toISOString() },
                  createdAt: startsAt,
                },
                {
                  id: id(),
                  productUnitId: unitId,
                  identifierSnapshot: identifier,
                  storeId,
                  type: 'downtime_closed',
                  actorUserId: pick(teamUserIds),
                  payload: { downtimeId, endsAt: endsAt.toISOString() },
                  createdAt: endsAt,
                },
              );
              ledger.blockUnit(unitId, startsAt.getTime(), endsAt.getTime());
            }

            if (chance(0.06)) {
              const startsAt = addDays(now, -randomInt(1, 5));
              const downtimeId = id();
              downtimeRows.push({
                id: downtimeId,
                productUnitId: unitId,
                storeId,
                reason: 'repair',
                startsAt,
                endsAt: null,
                note: pick([
                  'Immobilisé : attente de pièce (dérailleur arrière).',
                  'Batterie en test, autonomie anormalement faible.',
                  'Choc sur la fourche, contrôle sécurité avant remise en service.',
                ]),
                createdByUserId: pick(teamUserIds),
                createdAt: startsAt,
                updatedAt: startsAt,
              });
              unitEventRows.push({
                id: id(),
                productUnitId: unitId,
                identifierSnapshot: identifier,
                storeId,
                type: 'downtime_declared',
                actorUserId: pick(teamUserIds),
                payload: { downtimeId, startsAt: startsAt.toISOString() },
                createdAt: startsAt,
              });
              ledger.blockUnit(unitId, startsAt.getTime(), addDays(now, 30).getTime());
            }
          }
        }
      }

      const capacity = spec.trackUnits ? unitIds.length : spec.quantity;

      productRows.push({
        id: productId,
        storeId,
        categoryId,
        name: spec.name,
        description: spec.description,
        aiContext: spec.aiContext ?? null,
        images,
        price: money(spec.price),
        deposit: money(spec.deposit),
        basePeriodMinutes: spec.basePeriodMinutes,
        pricingMode: spec.pricingMode,
        videoUrl: null,
        taxSettings: spec.taxRate
          ? { inheritFromStore: false, customRate: spec.taxRate }
          : { inheritFromStore: true },
        enforceStrictTiers: spec.enforceStrictTiers,
        quantity: capacity,
        trackUnits: spec.trackUnits,
        bookingAttributeAxes: spec.axes ?? null,
        displayOrder: index,
        status: spec.status,
        createdAt,
        updatedAt: now,
      });

      productCategoryRows.push({
        id: id(),
        productId,
        categoryId,
        position: 0,
        createdAt,
      });

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
        for (const year of seasonYears) {
          const seasonId = id();
          seasonRows.push({
            id: seasonId,
            productId,
            name: `${season.name} ${year}`,
            startDate: `${year}-${season.startMonthDay}`,
            endDate: `${year}-${season.endMonthDay}`,
            price: money(spec.price * season.multiplier),
            createdAt,
            updatedAt: now,
          });
          ratesFor(spec, season.multiplier).forEach((rate, rateIndex) => {
            seasonTierRows.push({
              id: id(),
              seasonalPricingId: seasonId,
              minDuration: null,
              period: rate.period,
              discountPercent: null,
              price: money(rate.price),
              displayOrder: rateIndex,
              createdAt,
              updatedAt: now,
            });
          });
        }
      }

      resolved.set(spec.key, {
        spec,
        id: productId,
        categoryId,
        images,
        capacity,
        unitIds,
        unitById,
      });
    });

    await insertAll(db, schema.products, productRows);
    await insertAll(db, schema.productCategories, productCategoryRows);
    await insertAll(db, schema.productPricingTiers, tierRows);
    await insertAll(db, schema.productSeasonalPricing, seasonRows);
    await insertAll(db, schema.productSeasonalPricingTiers, seasonTierRows);
    await insertAll(db, schema.productUnits, unitRows);
    await insertAll(db, schema.productUnitEvents, unitEventRows);
    await insertAll(db, schema.productUnitDowntimes, downtimeRows);

    logSuccess(
      `${productRows.length} products, ${tierRows.length} rates, ` +
        `${seasonRows.length} seasonal prices, ${unitRows.length} units, ` +
        `${downtimeRows.length} downtimes`,
    );

    // Accessories: every rentable bike/board suggests relevant add-ons.
    const accessoryRows: Array<typeof schema.productAccessories.$inferInsert> = [];
    const accessoryKeys = DEMO_PRODUCTS.filter((p) => p.isAccessory && p.status === 'active').map(
      (p) => p.key,
    );
    const bikeAccessories = ['casque-adulte', 'antivol', 'sacoches', 'gps', 'kit-repa', 'panier'];
    const familyAccessories = ['siege-bebe', 'remorque-enfant', 'casque-enfant', 'trailgator'];
    const waterAccessories = ['combinaison'];
    const bivouacAccessories = ['sac-couchage', 'matelas', 'rechaud', 'sacoches'];

    for (const spec of DEMO_PRODUCTS) {
      if (spec.status !== 'active' || spec.isAccessory) continue;
      const target = resolved.get(spec.key)!;
      let candidates: string[];
      if (spec.category === 'Nautisme') candidates = waterAccessories;
      else if (spec.key === 'voyage' || spec.key === 'gravel') candidates = bivouacAccessories;
      else if (['cargo', 'longtail', 'kid-20', 'kid-24', 'ville'].includes(spec.key))
        candidates = [...familyAccessories, 'casque-adulte'];
      else candidates = bikeAccessories;

      const selected = shuffled(candidates.filter((key) => accessoryKeys.includes(key))).slice(
        0,
        randomInt(2, 4),
      );
      selected.forEach((key, position) => {
        const accessory = resolved.get(key);
        if (!accessory) return;
        accessoryRows.push({
          id: id(),
          productId: target.id,
          accessoryId: accessory.id,
          displayOrder: position,
          createdAt: storeCreatedAt,
        });
      });
    }
    await insertAll(db, schema.productAccessories, accessoryRows);
    logSuccess(`${accessoryRows.length} accessory links`);

    // ----------------------------------------------------- inspection setup
    const templateRows: Array<typeof schema.inspectionTemplates.$inferInsert> = [];
    const templateFieldRows: Array<typeof schema.inspectionTemplateFields.$inferInsert> = [];
    const templateByCategory = new Map<string | null, { id: string; fields: Array<{ id: string; name: string; fieldType: string; sectionName?: string }> }>();

    DEMO_INSPECTION_TEMPLATES.forEach((template, index) => {
      const templateId = id();
      const fields = template.fields.map((field, fieldIndex) => {
        const fieldId = id();
        templateFieldRows.push({
          id: fieldId,
          templateId,
          name: field.name,
          description: null,
          fieldType: field.fieldType,
          options: 'options' in field ? (field.options as string[]) : null,
          ratingMin: 1,
          ratingMax: 5,
          numberUnit: 'numberUnit' in field ? (field.numberUnit as string) : null,
          isRequired: field.isRequired,
          sectionName: field.sectionName ?? null,
          displayOrder: fieldIndex,
          createdAt: storeCreatedAt,
        });
        return {
          id: fieldId,
          name: field.name,
          fieldType: field.fieldType as string,
          sectionName: field.sectionName,
        };
      });

      templateRows.push({
        id: templateId,
        storeId,
        scope: template.scope,
        categoryId: template.category ? categoryIdByName.get(template.category)! : null,
        productId: null,
        name: template.name,
        description: template.description,
        isActive: true,
        displayOrder: index,
        createdAt: storeCreatedAt,
        updatedAt: now,
      });

      templateByCategory.set(template.category, { id: templateId, fields });
    });

    await insertAll(db, schema.inspectionTemplates, templateRows);
    await insertAll(db, schema.inspectionTemplateFields, templateFieldRows);
    logSuccess(`${templateRows.length} inspection templates, ${templateFieldRows.length} fields`);

    // -------------------------------------------------------------- customers
    logSection('Customers');
    interface SeedCustomer {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
      city: string;
      postalCode: string;
      country: string;
      isBusiness: boolean;
      createdAt: Date;
    }

    const customers: SeedCustomer[] = [];
    const customerRows: Array<typeof schema.customers.$inferInsert> = [];
    const usedEmails = new Set<string>();

    const slugifyEmail = (value: string): string =>
      value
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '.')
        .replace(/^\.|\.$/g, '');

    const pushCustomer = (customer: SeedCustomer, row: typeof schema.customers.$inferInsert) => {
      customers.push(customer);
      customerRows.push(row);
    };

    for (const business of DEMO_BUSINESS_CUSTOMERS) {
      const customerId = id();
      const createdAt = addDays(historyStart, -randomInt(0, 300));
      usedEmails.add(business.email);
      pushCustomer(
        {
          id: customerId,
          firstName: business.firstName,
          lastName: business.lastName,
          email: business.email,
          phone: `02 98 ${randomInt(10, 99)} ${randomInt(10, 99)} ${randomInt(10, 99)}`,
          city: business.city,
          postalCode: business.postalCode,
          country: 'FR',
          isBusiness: true,
          createdAt,
        },
        {
          id: customerId,
          storeId,
          customerType: 'business',
          email: business.email,
          firstName: business.firstName,
          lastName: business.lastName,
          companyName: business.companyName,
          phone: `02 98 ${randomInt(10, 99)} ${randomInt(10, 99)} ${randomInt(10, 99)}`,
          address: business.address,
          city: business.city,
          postalCode: business.postalCode,
          country: 'FR',
          notes: business.notes,
          createdAt,
          updatedAt: now,
        },
      );
    }

    for (const foreign of FOREIGN_CUSTOMERS) {
      const customerId = id();
      const createdAt = addDays(historyStart, randomInt(0, 320));
      const email = `${slugifyEmail(`${foreign.firstName} ${foreign.lastName}`)}@example.com`;
      if (usedEmails.has(email)) continue;
      usedEmails.add(email);
      pushCustomer(
        {
          id: customerId,
          firstName: foreign.firstName,
          lastName: foreign.lastName,
          email,
          phone: `+${randomInt(31, 49)} ${randomInt(100, 999)} ${randomInt(100000, 999999)}`,
          city: foreign.city,
          postalCode: foreign.postalCode,
          country: foreign.country,
          isBusiness: false,
          createdAt,
        },
        {
          id: customerId,
          storeId,
          customerType: 'individual',
          email,
          firstName: foreign.firstName,
          lastName: foreign.lastName,
          companyName: null,
          phone: `+${randomInt(31, 49)} ${randomInt(100, 999)} ${randomInt(100000, 999999)}`,
          address: `${randomInt(1, 90)} ${pick(['Hauptstraße', 'Kerkstraat', 'High Street', 'Grote Markt'])}`,
          city: foreign.city,
          postalCode: foreign.postalCode,
          country: foreign.country,
          notes: chance(0.4) ? 'Ne parle pas français, échanges en anglais.' : null,
          createdAt,
          updatedAt: now,
        },
      );
    }

    while (customers.length < options.customers) {
      const firstName = pick(FIRST_NAMES);
      const lastName = pick(LAST_NAMES);
      const isLocal = chance(0.35);
      const town = isLocal ? pick(LOCAL_TOWNS) : pick(VISITOR_TOWNS);
      const base = slugifyEmail(`${firstName}.${lastName}`);
      let email = `${base}@${pick(['gmail.com', 'orange.fr', 'free.fr', 'outlook.fr', 'wanadoo.fr', 'laposte.net'])}`;
      let attempt = 1;
      while (usedEmails.has(email)) {
        email = `${base}${attempt}@${pick(['gmail.com', 'orange.fr', 'free.fr'])}`;
        attempt += 1;
      }
      usedEmails.add(email);

      const customerId = id();
      const createdAt = addDays(historyStart, randomInt(-200, options.months * 30 - 5));
      const phone = `0${pick(['6', '7'])} ${randomInt(10, 99)} ${randomInt(10, 99)} ${randomInt(10, 99)} ${randomInt(10, 99)}`;

      pushCustomer(
        {
          id: customerId,
          firstName,
          lastName,
          email,
          phone,
          city: town.city,
          postalCode: town.postalCode,
          country: 'FR',
          isBusiness: false,
          createdAt,
        },
        {
          id: customerId,
          storeId,
          customerType: 'individual',
          email,
          firstName,
          lastName,
          companyName: null,
          phone,
          address: `${randomInt(1, 120)} ${pick(STREET_NAMES)}`,
          city: town.city,
          postalCode: town.postalCode,
          country: 'FR',
          notes: chance(0.22) ? pick(CUSTOMER_NOTES) : null,
          createdAt,
          updatedAt: now,
        },
      );
    }

    await insertAll(db, schema.customers, customerRows);
    logSuccess(
      `${customerRows.length} customers (${DEMO_BUSINESS_CUSTOMERS.length} business, ${FOREIGN_CUSTOMERS.length} foreign)`,
    );

    // ----------------------------------------------------------- reservations
    logSection('Reservations');

    const reservationRows: Array<typeof schema.reservations.$inferInsert> = [];
    const itemRows: Array<typeof schema.reservationItems.$inferInsert> = [];
    const itemUnitRows: Array<typeof schema.reservationItemUnits.$inferInsert> = [];
    const activityRows: Array<typeof schema.reservationActivity.$inferInsert> = [];
    const paymentRows: Array<typeof schema.payments.$inferInsert> = [];
    const emailLogRows: Array<typeof schema.emailLogs.$inferInsert> = [];
    const smsLogRows: Array<typeof schema.smsLogs.$inferInsert> = [];
    const reminderRows: Array<typeof schema.reminderLogs.$inferInsert> = [];
    const reviewRows: Array<typeof schema.reviewRequestLogs.$inferInsert> = [];
    const inspectionRows: Array<typeof schema.inspections.$inferInsert> = [];
    const inspectionItemRows: Array<typeof schema.inspectionItems.$inferInsert> = [];
    const inspectionValueRows: Array<typeof schema.inspectionFieldValues.$inferInsert> = [];
    const paymentRequestRows: Array<typeof schema.paymentRequests.$inferInsert> = [];

    const numberCounters = new Map<number, number>();
    const nextNumber = (date: Date): string => {
      const year = date.getFullYear();
      const next = (numberCounters.get(year) ?? 0) + 1;
      numberCounters.set(year, next);
      return `${year}-${`${next}`.padStart(4, '0')}`;
    };

    const activeSpecs = DEMO_PRODUCTS.filter((spec) => spec.status === 'active');
    const specsByCategory = (category: string) =>
      activeSpecs.filter((spec) => spec.category === category && !spec.isAccessory);
    const bikeSpecs = specsByCategory('Vélos & VAE');
    const waterSpecs = specsByCategory('Nautisme');

    const weightedPick = (specs: DemoProduct[]): DemoProduct =>
      pickWeighted(specs.map((spec) => ({ item: spec, weight: Math.max(1, spec.popularity) })));

    const accessorySpecs = activeSpecs.filter((spec) => spec.isAccessory);

    interface PlannedItem {
      spec: DemoProduct;
      quantity: number;
    }

    function planCart(profile: CartProfile): PlannedItem[] {
      const items: PlannedItem[] = [];
      const add = (spec: DemoProduct | undefined, quantity: number) => {
        if (!spec) return;
        const existing = items.find((item) => item.spec.key === spec.key);
        if (existing) existing.quantity += quantity;
        else items.push({ spec, quantity });
      };
      const byKey = (key: string) => activeSpecs.find((spec) => spec.key === key);

      switch (profile) {
        case 'couple':
          add(weightedPick(bikeSpecs), 2);
          if (chance(0.35)) add(byKey('sacoches'), 1);
          if (chance(0.25)) add(byKey('gps'), 1);
          break;
        case 'famille': {
          add(weightedPick(bikeSpecs), 2);
          add(byKey(chance(0.5) ? 'kid-20' : 'kid-24'), randomInt(1, 2));
          if (chance(0.4)) add(byKey(chance(0.5) ? 'siege-bebe' : 'remorque-enfant'), 1);
          if (chance(0.3)) add(byKey('casque-enfant'), randomInt(1, 2));
          break;
        }
        case 'solo':
          add(weightedPick(bikeSpecs), 1);
          if (chance(0.3)) add(byKey('antivol'), 1);
          break;
        case 'nautique':
          add(weightedPick(waterSpecs), randomInt(1, 3));
          if (chance(0.5)) add(byKey('combinaison'), randomInt(1, 3));
          break;
        case 'itinerance':
          add(byKey(chance(0.6) ? 'voyage' : 'gravel'), 2);
          add(byKey('pack-bivouac'), 1);
          if (chance(0.5)) add(byKey('sacoches'), 1);
          break;
        case 'pro':
          add(byKey(chance(0.5) ? 'ville' : 'rando'), randomInt(5, 10));
          add(byKey('casque-adulte'), randomInt(4, 8));
          break;
      }

      if (items.length === 0) add(weightedPick(bikeSpecs), 1);
      if (chance(0.12)) add(pick(accessorySpecs), 1);
      return items;
    }

    function durationFor(profile: CartProfile): number {
      if (profile === 'nautique') {
        return pickWeighted([
          { item: 240, weight: 45 },
          { item: 480, weight: 30 },
          { item: DAY_MIN, weight: 18 },
          { item: 2 * DAY_MIN, weight: 7 },
        ]);
      }
      if (profile === 'itinerance') {
        return pickWeighted([
          { item: 3 * DAY_MIN, weight: 25 },
          { item: 5 * DAY_MIN, weight: 30 },
          { item: 7 * DAY_MIN, weight: 35 },
          { item: 14 * DAY_MIN, weight: 10 },
        ]);
      }
      if (profile === 'pro') {
        return pickWeighted([
          { item: DAY_MIN, weight: 40 },
          { item: 2 * DAY_MIN, weight: 30 },
          { item: 7 * DAY_MIN, weight: 30 },
        ]);
      }
      return pickWeighted([
        { item: 240, weight: 8 },
        { item: DAY_MIN, weight: 30 },
        { item: 2 * DAY_MIN, weight: 22 },
        { item: 3 * DAY_MIN, weight: 15 },
        { item: 4 * DAY_MIN, weight: 8 },
        { item: 7 * DAY_MIN, weight: 15 },
        { item: 14 * DAY_MIN, weight: 2 },
      ]);
    }

    /** Build the list of rental start days, weighted by month seasonality. */
    function buildStartDates(count: number): Date[] {
      const days: Array<{ date: Date; weight: number }> = [];
      for (
        let cursor = startOfDay(historyStart);
        cursor <= futureEnd;
        cursor = nextDay(cursor)
      ) {
        const monthWeight = MONTH_WEIGHTS[cursor.getMonth()];
        const isWeekend = cursor.getDay() === 0 || cursor.getDay() === 6;
        // Future demand tapers off — bookings further out are still sparse.
        const horizonPenalty =
          cursor.getTime() > now.getTime()
            ? Math.max(0.15, 1 - (cursor.getTime() - now.getTime()) / (60 * DAY_MS))
            : 1;
        days.push({
          date: new Date(cursor),
          weight: monthWeight * (isWeekend ? 1.5 : 1) * horizonPenalty,
        });
      }

      const total = days.reduce((sum, day) => sum + day.weight, 0);
      const dates: Date[] = [];
      for (const day of days) {
        const expected = (day.weight / total) * count;
        let n = Math.floor(expected);
        if (random() < expected - n) n += 1;
        for (let i = 0; i < n; i++) dates.push(new Date(day.date));
      }
      return dates.sort((a, b) => a.getTime() - b.getTime());
    }

    type ForcedStatus = 'pending' | 'confirmed' | 'quote';
    interface PlannedReservation {
      start: Date;
      durationMinutes: number;
      profile: CartProfile;
      forcedStatus?: ForcedStatus;
    }

    const plan: PlannedReservation[] = buildStartDates(options.reservations).map((day) => {
      const profile = pickWeighted(PROFILE_WEIGHTS);
      const durationMinutes = durationFor(profile);
      const pickupHour =
        durationMinutes <= 480 ? pick([9, 10, 14, 15]) : pick([9, 10, 11, 16, 17]);
      return {
        start: atTime(day, pickupHour, pick([0, 30])),
        durationMinutes,
        profile,
      };
    });

    /**
     * Curated "today" so a recording always finds a busy shop: rentals in
     * progress, pickups and returns due today, and requests waiting for an
     * answer. Without this the picture depends entirely on where the random
     * draw happened to land.
     */
    const today = startOfDay(now);
    const todayPlan: PlannedReservation[] = [
      // Rentals in progress, returning over the next few days
      ...Array.from({ length: 9 }, () => ({
        start: atTime(addDays(today, -randomInt(1, 4)), pick([9, 10, 14]), 0),
        durationMinutes: randomInt(3, 8) * DAY_MIN,
        profile: pickWeighted(PROFILE_WEIGHTS),
      })),
      // Returns due today (started earlier, ending this afternoon/evening)
      ...[12, 17, 18, 18, 19].map((hour) => {
        const days = randomInt(1, 5);
        return {
          start: atTime(addDays(today, -days), 9, 0),
          durationMinutes: days * DAY_MIN + (hour - 9) * 60,
          profile: pickWeighted(PROFILE_WEIGHTS),
        };
      }),
      // Pickups still to come today
      ...[15, 16, 16, 17, 18].map((hour) => ({
        start: atTime(today, hour, pick([0, 30])),
        durationMinutes: pick([DAY_MIN, 2 * DAY_MIN, 3 * DAY_MIN, 7 * DAY_MIN]),
        profile: pickWeighted(PROFILE_WEIGHTS),
        forcedStatus: 'confirmed' as const,
      })),
      // Tomorrow's departures
      ...Array.from({ length: 6 }, () => ({
        start: atTime(addDays(today, 1), pick([9, 10, 11, 14]), pick([0, 30])),
        durationMinutes: pick([DAY_MIN, 2 * DAY_MIN, 3 * DAY_MIN, 7 * DAY_MIN]),
        profile: pickWeighted(PROFILE_WEIGHTS),
        forcedStatus: 'confirmed' as const,
      })),
      // Requests waiting for an answer
      ...Array.from({ length: 6 }, () => ({
        start: atTime(addDays(today, randomInt(2, 20)), pick([9, 10, 14]), 0),
        durationMinutes: pick([DAY_MIN, 2 * DAY_MIN, 3 * DAY_MIN, 7 * DAY_MIN]),
        profile: pickWeighted(PROFILE_WEIGHTS),
        forcedStatus: 'pending' as const,
      })),
      // Open quotes for professional accounts
      ...Array.from({ length: 3 }, () => ({
        start: atTime(addDays(today, randomInt(10, 45)), 9, 0),
        durationMinutes: pick([2 * DAY_MIN, 7 * DAY_MIN]),
        profile: 'pro' as CartProfile,
        forcedStatus: 'quote' as const,
      })),
    ];

    plan.push(...todayPlan);
    plan.sort((a, b) => a.start.getTime() - b.start.getTime());

    let skipped = 0;
    const recentCustomers: SeedCustomer[] = [];

    for (const entry of plan) {
      const { profile, durationMinutes, forcedStatus } = entry;
      const start = entry.start;
      const pickupHour = start.getHours();
      const end = addMinutes(start, durationMinutes);

      // Pick the customer: business profiles use business accounts, and one
      // rental in four comes from someone who already rented before.
      let customer: SeedCustomer;
      if (profile === 'pro') {
        customer = pick(customers.filter((c) => c.isBusiness));
      } else if (recentCustomers.length > 20 && chance(0.28)) {
        customer = pick(recentCustomers);
      } else {
        const pool = customers.filter(
          (c) => !c.isBusiness && c.createdAt.getTime() <= start.getTime(),
        );
        customer = pool.length > 0 ? pick(pool) : pick(customers.filter((c) => !c.isBusiness));
      }

      const planned = planCart(profile);

      // Availability check across the whole cart before committing.
      const startMs = start.getTime();
      const endMs = end.getTime();
      const feasible = planned.every((item) => {
        const target = resolved.get(item.spec.key);
        if (!target || target.capacity === 0) return false;
        if (item.spec.trackUnits) {
          return (
            ledger.pickUnits(target.unitIds, startMs, endMs, item.quantity) !== null
          );
        }
        return ledger.productAvailable(
          target.id,
          startMs,
          endMs,
          item.quantity,
          target.capacity,
        );
      });

      if (!feasible) {
        skipped += 1;
        continue;
      }

      // ------------------------------------------------------------ status
      const isPast = endMs < now.getTime();
      const isOngoing = startMs <= now.getTime() && endMs >= now.getTime();
      let status: 'pending' | 'confirmed' | 'ongoing' | 'completed' | 'cancelled' | 'rejected' | 'quote';

      if (forcedStatus && !isPast && !isOngoing) {
        status = forcedStatus;
      } else if (isOngoing) {
        status = 'ongoing';
      } else if (isPast) {
        status = pickWeighted([
          { item: 'completed' as const, weight: 86 },
          { item: 'cancelled' as const, weight: 9 },
          { item: 'rejected' as const, weight: 3 },
          { item: 'quote' as const, weight: 2 },
        ]);
      } else {
        const daysAhead = (startMs - now.getTime()) / DAY_MS;
        status = pickWeighted([
          { item: 'confirmed' as const, weight: daysAhead < 7 ? 78 : 60 },
          { item: 'pending' as const, weight: daysAhead < 7 ? 14 : 28 },
          { item: 'quote' as const, weight: profile === 'pro' ? 18 : 6 },
          { item: 'cancelled' as const, weight: 6 },
        ]);
      }

      const blocksStock = ['pending', 'confirmed', 'ongoing', 'completed'].includes(status);

      // ------------------------------------------------------------ pricing
      const reservationId = id();
      const source = pickWeighted([
        { item: 'online' as const, weight: profile === 'pro' ? 20 : 68 },
        { item: 'manual' as const, weight: profile === 'pro' ? 65 : 26 },
        { item: 'phone' as const, weight: 15 },
      ]);

      let subtotal = 0;
      let depositTotal = 0;
      const plannedRows: Array<{
        itemId: string;
        target: ResolvedProduct;
        item: PlannedItem;
        unitIds: string[];
      }> = [];

      for (const item of planned) {
        const target = resolved.get(item.spec.key)!;
        const calculation = priceFor(item.spec, start, durationMinutes, item.quantity);
        const unitPrice = calculation.subtotal / item.quantity;
        const multiplier = seasonMultiplier(item.spec, start);
        const itemId = id();

        let assignedUnits: string[] = [];
        if (item.spec.trackUnits && blocksStock) {
          assignedUnits = ledger.pickUnits(target.unitIds, startMs, endMs, item.quantity) ?? [];
          for (const unitId of assignedUnits) ledger.bookUnit(unitId, startMs, endMs);
        } else if (blocksStock) {
          ledger.bookProduct(target.id, startMs, endMs, item.quantity);
        }

        const combination =
          assignedUnits.length > 0 ? target.unitById.get(assignedUnits[0]) : undefined;

        itemRows.push({
          id: itemId,
          reservationId,
          productId: target.id,
          isCustomItem: false,
          quantity: item.quantity,
          unitPrice: money(unitPrice),
          depositPerUnit: money(item.spec.deposit),
          totalPrice: money(calculation.subtotal),
          taxRate: '20.00',
          taxAmount: money(calculation.subtotal - calculation.subtotal / 1.2),
          priceExclTax: money(unitPrice / 1.2),
          totalExclTax: money(calculation.subtotal / 1.2),
          pricingBreakdown: {
            basePrice: Math.round(item.spec.price * multiplier * 100) / 100,
            effectivePrice: Math.round(unitPrice * 100) / 100,
            duration: Math.round(durationMinutes / item.spec.basePeriodMinutes),
            pricingMode: item.spec.pricingMode,
            discountPercent: calculation.reductionPercent,
            discountAmount: calculation.savings,
            tierApplied: calculation.appliedRate
              ? `${calculation.appliedRate.period} min`
              : null,
            durationMinutes,
            appliedPeriods: calculation.periodsUsed,
            appliedRates: calculation.plan.map((entry) => ({
              period: entry.rate.period,
              price: entry.rate.price,
              quantity: entry.quantity,
            })),
            optimizerVersion: 'v2',
            taxRate: 20,
            taxAmount: Math.round((calculation.subtotal - calculation.subtotal / 1.2) * 100) / 100,
            subtotalExclTax: Math.round((calculation.subtotal / 1.2) * 100) / 100,
            subtotalInclTax: calculation.subtotal,
            seasonalSegments:
              multiplier === 1
                ? undefined
                : [
                    {
                      seasonalPricingId: null,
                      seasonalPricingName: `Haute saison ${start.getFullYear()}`,
                      startDate: toDateOnly(start),
                      endDate: toDateOnly(end),
                      subtotal: calculation.subtotal,
                    },
                  ],
          },
          productSnapshot: {
            name: item.spec.name,
            description: item.spec.description,
            images: target.images,
            combinationKey: combination?.combinationKey ?? null,
            selectedAttributes: combination?.attributes ?? null,
          },
          combinationKey: combination?.combinationKey ?? null,
          selectedAttributes: combination?.attributes ?? null,
          createdAt: addDays(start, -randomInt(1, 30)),
        });

        for (const unitId of assignedUnits) {
          const unit = target.unitById.get(unitId)!;
          itemUnitRows.push({
            id: id(),
            reservationItemId: itemId,
            productUnitId: unitId,
            identifierSnapshot: unit.identifier,
            assignedAt: addMinutes(start, -30),
          });
        }

        plannedRows.push({ itemId, target, item, unitIds: assignedUnits });
        subtotal += calculation.subtotal;
        depositTotal += item.spec.deposit * item.quantity;
      }

      // -------------------------------------------------- delivery & promo
      const wantsDelivery = chance(profile === 'pro' ? 0.55 : 0.14);
      const distanceKm = wantsDelivery ? Math.round((3 + random() * 28) * 10) / 10 : 0;
      let deliveryFee = 0;
      if (wantsDelivery) {
        deliveryFee = subtotal >= 300 ? 0 : Math.max(12, Math.round(distanceKm * 1.2));
      }

      let discountAmount = 0;
      let promoSnapshot: { code: string; type: 'percentage' | 'fixed'; value: number } | null = null;
      if (chance(0.18)) {
        const promo = pick(DEMO_PROMO_CODES.filter((p) => p.isActive));
        if (!promo.minimumAmount || subtotal >= promo.minimumAmount) {
          discountAmount =
            promo.type === 'percentage'
              ? Math.round(subtotal * (promo.value / 100) * 100) / 100
              : Math.min(promo.value, subtotal);
          promoSnapshot = { code: promo.code, type: promo.type, value: promo.value };
        }
      }

      const totalAmount = Math.max(0, subtotal + deliveryFee - discountAmount);
      const createdAt = addDays(start, -randomInt(profile === 'pro' ? 7 : 1, 45));
      const bookedAt = createdAt < historyStart ? historyStart : createdAt;

      // --------------------------------------------------------- lifecycle
      const pickedUpAt =
        status === 'ongoing' || status === 'completed' ? addMinutes(start, randomInt(-15, 40)) : null;
      const returnedAt = status === 'completed' ? addMinutes(end, randomInt(-60, 90)) : null;

      let depositStatus: 'none' | 'pending' | 'card_saved' | 'authorized' | 'captured' | 'released' | 'failed';
      if (depositTotal === 0) depositStatus = 'none';
      else if (status === 'completed') depositStatus = chance(0.04) ? 'captured' : 'released';
      else if (status === 'ongoing') depositStatus = 'authorized';
      else if (status === 'confirmed') depositStatus = chance(0.6) ? 'card_saved' : 'pending';
      else if (status === 'cancelled' || status === 'rejected') depositStatus = 'released';
      else depositStatus = 'pending';

      const usesStoreLocation = !wantsDelivery;

      reservationRows.push({
        id: reservationId,
        storeId,
        customerId: customer.id,
        number: nextNumber(bookedAt),
        status,
        startDate: start,
        endDate: end,
        subtotalAmount: money(subtotal),
        depositAmount: money(depositTotal),
        totalAmount: money(totalAmount),
        subtotalExclTax: money(totalAmount / 1.2),
        taxAmount: money(totalAmount - totalAmount / 1.2),
        taxRate: '20.00',
        signedAt: status === 'completed' || status === 'ongoing' ? pickedUpAt : null,
        signatureIp:
          status === 'completed' || status === 'ongoing'
            ? `82.${randomInt(1, 254)}.${randomInt(1, 254)}.${randomInt(1, 254)}`
            : null,
        depositStatus,
        depositPaymentIntentId:
          depositStatus === 'authorized' || depositStatus === 'released' || depositStatus === 'captured'
            ? `pi_demo_${nanoid(16)}`
            : null,
        depositAuthorizationExpiresAt:
          depositStatus === 'authorized' ? addDays(end, 7) : null,
        stripeCustomerId: source === 'online' ? `cus_demo_${nanoid(14)}` : null,
        stripePaymentMethodId: depositStatus !== 'pending' ? `pm_demo_${nanoid(14)}` : null,
        pickedUpAt,
        returnedAt,
        customerNotes: pick(CUSTOMER_MESSAGES),
        internalNotes: pick(INTERNAL_NOTES),
        outboundMethod: wantsDelivery ? 'address' : 'store',
        returnMethod: wantsDelivery && chance(0.7) ? 'address' : 'store',
        deliveryOption: wantsDelivery ? 'delivery' : 'pickup',
        deliveryAddress: wantsDelivery ? `${randomInt(1, 60)} ${pick(STREET_NAMES)}` : null,
        deliveryCity: wantsDelivery ? customer.city : null,
        deliveryPostalCode: wantsDelivery ? customer.postalCode : null,
        deliveryCountry: wantsDelivery ? 'FR' : null,
        deliveryDistanceKm: wantsDelivery ? money(distanceKm) : null,
        deliveryFee: money(deliveryFee),
        pickupLocationId: null,
        returnLocationId: null,
        pickupLocationSnapshot: usesStoreLocation
          ? {
              type: 'primary',
              name: DEMO_STORE.name,
              address: DEMO_STORE.address,
              city: DEMO_STORE.city,
              postalCode: DEMO_STORE.postalCode,
              country: 'FR',
            }
          : null,
        returnLocationSnapshot: null,
        promoCodeId: null,
        discountAmount: money(discountAmount),
        promoCodeSnapshot: promoSnapshot,
        source,
        createdAt: bookedAt,
        updatedAt: returnedAt ?? pickedUpAt ?? bookedAt,
      });

      recentCustomers.push(customer);
      if (recentCustomers.length > 60) recentCustomers.shift();

      // ---------------------------------------------------------- activity
      const actor = () => pick(teamUserIds);
      activityRows.push({
        id: id(),
        reservationId,
        userId: source === 'online' ? null : actor(),
        activityType: 'created',
        description:
          source === 'online'
            ? 'Réservation créée depuis la boutique en ligne'
            : source === 'phone'
              ? 'Réservation prise par téléphone'
              : 'Réservation créée depuis le dashboard',
        metadata: { source },
        createdAt: bookedAt,
      });

      if (['confirmed', 'ongoing', 'completed'].includes(status)) {
        activityRows.push({
          id: id(),
          reservationId,
          userId: actor(),
          activityType: 'confirmed',
          description: null,
          metadata: null,
          createdAt: addMinutes(bookedAt, randomInt(5, 600)),
        });
      }
      if (status === 'rejected') {
        activityRows.push({
          id: id(),
          reservationId,
          userId: actor(),
          activityType: 'rejected',
          description: pick([
            'Plus de disponibilité sur la taille demandée.',
            'Conditions météo incompatibles avec une sortie nautique.',
            'Client injoignable après deux relances.',
          ]),
          metadata: null,
          createdAt: addMinutes(bookedAt, randomInt(30, 2000)),
        });
      }
      if (status === 'cancelled') {
        activityRows.push({
          id: id(),
          reservationId,
          userId: chance(0.5) ? actor() : null,
          activityType: 'cancelled',
          description: pick([
            'Annulation client — changement de programme.',
            'Annulation météo, remboursement intégral.',
            'Annulation dans les délais (plus de 48 h).',
          ]),
          metadata: null,
          createdAt: addDays(start, -randomInt(1, 10)),
        });
      }
      if (pickedUpAt) {
        activityRows.push({
          id: id(),
          reservationId,
          userId: actor(),
          activityType: 'picked_up',
          description: null,
          metadata: null,
          createdAt: pickedUpAt,
        });
      }
      if (returnedAt) {
        activityRows.push({
          id: id(),
          reservationId,
          userId: actor(),
          activityType: 'returned',
          description: chance(0.12)
            ? pick([
                'Retour avec une crevaison arrière, réparée en atelier.',
                'Matériel rendu très sableux, nettoyage complet.',
                'Retour avec 20 minutes de retard, non facturé.',
              ])
            : null,
          metadata: null,
          createdAt: returnedAt,
        });
      }

      // ---------------------------------------------------------- payments
      if (['confirmed', 'ongoing', 'completed'].includes(status) && totalAmount > 0) {
        const onlineDeposit = source === 'online' ? Math.round(totalAmount * 0.3 * 100) / 100 : 0;

        if (onlineDeposit > 0) {
          paymentRows.push({
            id: id(),
            reservationId,
            amount: money(onlineDeposit),
            type: 'rental',
            method: 'stripe',
            status: 'completed',
            stripePaymentIntentId: `pi_demo_${nanoid(16)}`,
            stripeChargeId: `ch_demo_${nanoid(16)}`,
            currency: 'EUR',
            notes: 'Acompte 30 % réglé en ligne',
            paidAt: bookedAt,
            createdAt: bookedAt,
            updatedAt: bookedAt,
          });
          activityRows.push({
            id: id(),
            reservationId,
            userId: null,
            activityType: 'payment_received',
            description: `Acompte de ${money(onlineDeposit)} € reçu`,
            metadata: { amount: onlineDeposit },
            createdAt: bookedAt,
          });
        }

        const balance = Math.round((totalAmount - onlineDeposit) * 100) / 100;
        if (balance > 0 && pickedUpAt) {
          const method = pickWeighted([
            { item: 'card' as const, weight: 55 },
            { item: 'cash' as const, weight: 25 },
            { item: 'stripe' as const, weight: 15 },
            { item: 'transfer' as const, weight: 5 },
          ]);
          paymentRows.push({
            id: id(),
            reservationId,
            amount: money(balance),
            type: 'rental',
            method,
            status: 'completed',
            stripePaymentIntentId: method === 'stripe' ? `pi_demo_${nanoid(16)}` : null,
            currency: 'EUR',
            notes: onlineDeposit > 0 ? 'Solde réglé au retrait' : 'Règlement au retrait',
            paidAt: pickedUpAt,
            createdAt: pickedUpAt,
            updatedAt: pickedUpAt,
          });
        } else if (balance > 0 && status === 'confirmed' && chance(0.25)) {
          // A payment link waiting to be paid — useful to show in demos.
          paymentRequestRows.push({
            id: id(),
            storeId,
            reservationId,
            token: nanoid(48),
            amount: money(balance),
            currency: 'EUR',
            description: 'Solde de votre location Ar Mor',
            type: 'rental',
            status: 'pending',
            expiresAt: addDays(start, 1),
            completedAt: null,
            createdAt: addDays(now, -randomInt(0, 6)),
          });
        }
      }

      if (depositStatus === 'authorized' || depositStatus === 'released' || depositStatus === 'captured') {
        const holdAt = pickedUpAt ?? addDays(start, -1);
        paymentRows.push({
          id: id(),
          reservationId,
          amount: money(depositTotal),
          type: 'deposit_hold',
          method: 'stripe',
          status:
            depositStatus === 'authorized'
              ? 'authorized'
              : depositStatus === 'captured'
                ? 'completed'
                : 'cancelled',
          stripePaymentIntentId: `pi_demo_${nanoid(16)}`,
          authorizationExpiresAt: addDays(end, 7),
          capturedAmount:
            depositStatus === 'captured' ? money(Math.round(depositTotal * 0.25)) : null,
          currency: 'EUR',
          notes:
            depositStatus === 'captured'
              ? 'Retenue partielle : remplacement d’un dérailleur.'
              : 'Empreinte bancaire de caution',
          paidAt: holdAt,
          createdAt: holdAt,
          updatedAt: returnedAt ?? holdAt,
        });
        activityRows.push({
          id: id(),
          reservationId,
          userId: null,
          activityType:
            depositStatus === 'authorized'
              ? 'deposit_authorized'
              : depositStatus === 'captured'
                ? 'deposit_captured'
                : 'deposit_released',
          description: null,
          metadata: { amount: depositTotal },
          createdAt: returnedAt ?? holdAt,
        });
      }

      // -------------------------------------------------------- notifications
      const logEmail = (templateType: string, subject: string, sentAt: Date) => {
        emailLogRows.push({
          id: id(),
          storeId,
          reservationId,
          customerId: customer.id,
          to: customer.email,
          subject,
          templateType,
          messageId: `<${nanoid(20)}@armor-location.bzh>`,
          status: chance(0.985) ? 'sent' : 'failed',
          error: null,
          sentAt,
        });
      };

      if (source === 'online') {
        logEmail('reservation_confirmation', 'Votre location Ar Mor est confirmée 🚲', bookedAt);
        logEmail('new_request_landlord', `Nouvelle réservation ${DEMO_STORE.name}`, bookedAt);
      }

      if (['confirmed', 'ongoing', 'completed'].includes(status) && start < now) {
        reminderRows.push({
          id: id(),
          reservationId,
          storeId,
          customerId: customer.id,
          type: 'pickup',
          channel: 'email',
          audience: 'customer',
          sentAt: addDays(start, -1),
        });
        logEmail('reminder_pickup', 'Départ demain — votre location Ar Mor', addDays(start, -1));

        if (chance(0.35)) {
          reminderRows.push({
            id: id(),
            reservationId,
            storeId,
            customerId: customer.id,
            type: 'pickup',
            channel: 'sms',
            audience: 'customer',
            sentAt: addDays(start, -1),
          });
          smsLogRows.push({
            id: id(),
            storeId,
            reservationId,
            customerId: customer.id,
            to: customer.phone.replace(/\s/g, ''),
            message: `Ar Mor Location : votre materiel vous attend demain a ${pickupHour}h. 14 quai d'Aiguillon, Concarneau.`,
            templateType: 'reminder_pickup',
            messageId: nanoid(24),
            status: 'sent',
            creditSource: 'topup',
            sentAt: addDays(start, -1),
          });
        }
      }

      if (status === 'completed') {
        if (end < now) {
          reminderRows.push({
            id: id(),
            reservationId,
            storeId,
            customerId: customer.id,
            type: 'return',
            channel: 'email',
            audience: 'customer',
            sentAt: addMinutes(end, -12 * 60),
          });
        }
        if (chance(0.55)) {
          reviewRows.push({
            id: id(),
            reservationId,
            storeId,
            customerId: customer.id,
            channel: 'email',
            sentAt: addDays(returnedAt!, 1),
          });
          logEmail('thank_you_review', 'Merci pour votre visite à Concarneau !', addDays(returnedAt!, 1));
        }
      }

      // --------------------------------------------------------- inspections
      const inspectableCategory = planned[0]?.spec.category ?? null;
      const template =
        templateByCategory.get(inspectableCategory) ?? templateByCategory.get(null)!;

      if (status === 'completed' && returnedAt && end > addDays(now, -120) && chance(0.55)) {
        for (const type of ['departure', 'return'] as const) {
          const inspectionId = id();
          const performedAt = type === 'departure' ? pickedUpAt! : returnedAt;
          const hasDamage = type === 'return' && chance(0.08);

          inspectionRows.push({
            id: inspectionId,
            storeId,
            reservationId,
            type,
            status: 'completed',
            templateId: template.id,
            templateSnapshot: {
              id: template.id,
              name: 'Contrôle',
              fields: template.fields.map((field) => ({
                id: field.id,
                name: field.name,
                fieldType: field.fieldType,
                isRequired: false,
                sectionName: field.sectionName,
              })),
            },
            notes:
              type === 'return' && hasDamage
                ? 'Dégât constaté au retour, devis atelier transmis au client.'
                : null,
            performedById: pick(teamUserIds),
            performedAt,
            customerSignature: null,
            signedAt: null,
            signatureIp: null,
            hasDamage,
            damageDescription: hasDamage
              ? pick([
                  'Dérailleur arrière tordu suite à une chute.',
                  'Rayure profonde sur le cadre, côté droit.',
                  'Écran de commande fissuré.',
                ])
              : null,
            estimatedDamageCost: hasDamage ? money(randomInt(45, 220)) : null,
            damagePaymentId: null,
            createdAt: performedAt,
            updatedAt: performedAt,
          });

          for (const row of plannedRows) {
            const inspectionItemId = id();
            inspectionItemRows.push({
              id: inspectionItemId,
              inspectionId,
              reservationItemId: row.itemId,
              productUnitId: row.unitIds[0] ?? null,
              productSnapshot: {
                name: row.item.spec.name,
                unitIdentifier: row.unitIds[0]
                  ? row.target.unitById.get(row.unitIds[0])?.identifier
                  : undefined,
              },
              overallCondition:
                type === 'departure'
                  ? pick(['excellent', 'good'] as const)
                  : hasDamage
                    ? 'damaged'
                    : pick(['good', 'fair'] as const),
              notes: null,
              createdAt: performedAt,
            });

            for (const field of template.fields) {
              inspectionValueRows.push({
                id: id(),
                inspectionItemId,
                templateFieldId: field.id,
                fieldSnapshot: {
                  name: field.name,
                  fieldType: field.fieldType,
                  sectionName: field.sectionName,
                },
                checkboxValue: field.fieldType === 'checkbox' ? chance(0.95) : null,
                ratingValue: field.fieldType === 'rating' ? randomInt(3, 5) : null,
                textValue:
                  field.fieldType === 'text'
                    ? chance(0.3)
                      ? pick([
                          'RAS',
                          'Léger jeu dans la direction, à surveiller.',
                          'Traces de sable, nettoyage effectué.',
                        ])
                      : null
                    : null,
                numberValue:
                  field.fieldType === 'number'
                    ? money(field.name.includes('batterie') || field.name.includes('Niveau') ? randomInt(35, 100) : randomInt(400, 4200))
                    : null,
                selectValue:
                  field.fieldType === 'select'
                    ? pick(['Neuf', 'Bon', 'Usure normale'])
                    : null,
                createdAt: performedAt,
              });
            }
          }
        }
      }
    }

    await insertAll(db, schema.reservations, reservationRows);
    await insertAll(db, schema.reservationItems, itemRows);
    await insertAll(db, schema.reservationItemUnits, itemUnitRows);
    await insertAll(db, schema.reservationActivity, activityRows);
    await insertAll(db, schema.payments, paymentRows);
    await insertAll(db, schema.paymentRequests, paymentRequestRows);
    await insertAll(db, schema.emailLogs, emailLogRows);
    await insertAll(db, schema.smsLogs, smsLogRows);
    await insertAll(db, schema.reminderLogs, reminderRows);
    await insertAll(db, schema.reviewRequestLogs, reviewRows);
    await insertAll(db, schema.inspections, inspectionRows);
    await insertAll(db, schema.inspectionItems, inspectionItemRows);
    await insertAll(db, schema.inspectionFieldValues, inspectionValueRows);

    logSuccess(
      `${reservationRows.length} reservations, ${itemRows.length} items, ` +
        `${itemUnitRows.length} unit assignments (${skipped} skipped for lack of stock)`,
    );
    logSuccess(
      `${paymentRows.length} payments, ${inspectionRows.length} inspections, ` +
        `${emailLogRows.length} emails, ${smsLogRows.length} SMS`,
    );

    // -------------------------------------------------------------- analytics
    logSection('Analytics');

    const dailyStatsRows: Array<typeof schema.dailyStats.$inferInsert> = [];
    const productStatsRows: Array<typeof schema.productStats.$inferInsert> = [];
    const pageViewRows: Array<typeof schema.pageViews.$inferInsert> = [];
    const eventRows: Array<typeof schema.storefrontEvents.$inferInsert> = [];

    const revenueByDay = new Map<string, { revenue: number; count: number }>();
    for (const reservation of reservationRows) {
      if (!['confirmed', 'ongoing', 'completed'].includes(reservation.status as string)) continue;
      const key = toDateOnly(reservation.createdAt as Date);
      const entry = revenueByDay.get(key) ?? { revenue: 0, count: 0 };
      entry.revenue += Number.parseFloat(reservation.totalAmount as string);
      entry.count += 1;
      revenueByDay.set(key, entry);
    }

    const REFERRERS = [
      'https://www.google.fr/',
      'https://www.google.com/',
      'https://www.instagram.com/',
      'https://www.facebook.com/',
      'https://maps.google.com/',
      'https://www.tripadvisor.fr/',
      'https://www.concarneau-tourisme.bzh/',
      null,
      null,
      null,
    ];
    const analyticsStart = startOfDay(addDays(now, -Math.min(options.months * 30, 400)));
    const pageViewWindowStart = startOfDay(addDays(now, -120));
    const activeProducts = [...resolved.values()].filter(
      (product) => product.spec.status === 'active',
    );

    for (let cursor = startOfDay(analyticsStart); cursor <= now; cursor = nextDay(cursor)) {
      const dayKey = toDateOnly(cursor);
      const monthWeight = MONTH_WEIGHTS[cursor.getMonth()];
      const isWeekend = cursor.getDay() === 0 || cursor.getDay() === 6;
      const traffic = Math.round(
        monthWeight * (isWeekend ? 34 : 24) * (0.7 + random() * 0.7),
      );
      const uniqueVisitors = Math.max(1, Math.round(traffic * 0.62));
      const productViews = Math.round(traffic * 0.45);
      const cartAdditions = Math.round(productViews * 0.22);
      const checkoutStarted = Math.round(cartAdditions * 0.42);
      const dayRevenue = revenueByDay.get(dayKey);
      const checkoutCompleted = Math.min(checkoutStarted, dayRevenue?.count ?? 0);

      const mobile = Math.round(uniqueVisitors * 0.61);
      const tablet = Math.round(uniqueVisitors * 0.08);

      dailyStatsRows.push({
        id: id(),
        storeId,
        date: startOfDay(cursor),
        pageViews: traffic,
        uniqueVisitors,
        productViews,
        cartAdditions,
        checkoutStarted,
        checkoutCompleted,
        reservationsCreated: dayRevenue?.count ?? 0,
        reservationsConfirmed: Math.round((dayRevenue?.count ?? 0) * 0.9),
        revenue: money(dayRevenue?.revenue ?? 0),
        averageCartValue: money(
          dayRevenue && dayRevenue.count > 0 ? dayRevenue.revenue / dayRevenue.count : 0,
        ),
        mobileVisitors: mobile,
        tabletVisitors: tablet,
        desktopVisitors: Math.max(0, uniqueVisitors - mobile - tablet),
        createdAt: startOfDay(cursor),
        updatedAt: startOfDay(cursor),
      });

      // Per-product stats for the top of the catalog only — that is what the
      // dashboard's "best sellers" panel reads.
      for (const product of activeProducts) {
        if (product.spec.popularity < 4) continue;
        const views = Math.round(
          (monthWeight * product.spec.popularity * (0.6 + random())) / 1.5,
        );
        if (views === 0) continue;
        productStatsRows.push({
          id: id(),
          storeId,
          productId: product.id,
          date: startOfDay(cursor),
          views,
          cartAdditions: Math.round(views * 0.2),
          reservations: Math.round(views * 0.06),
          revenue: money(Math.round(views * 0.06) * product.spec.price),
          createdAt: startOfDay(cursor),
          updatedAt: startOfDay(cursor),
        });
      }

      // Raw events only for the recent window, to keep the seed fast.
      if (cursor < pageViewWindowStart) continue;

      const sessions = Math.max(1, Math.round(uniqueVisitors * 0.8));
      for (let s = 0; s < sessions; s++) {
        const sessionId = crypto.randomUUID();
        const device = pickWeighted([
          { item: 'mobile' as const, weight: 61 },
          { item: 'desktop' as const, weight: 31 },
          { item: 'tablet' as const, weight: 8 },
        ]);
        const referrer = pick(REFERRERS);
        const visitAt = addMinutes(startOfDay(cursor), randomInt(8 * 60, 22 * 60));

        pageViewRows.push({
          id: id(),
          storeId,
          sessionId,
          page: 'home',
          productId: null,
          categoryId: null,
          referrer,
          device,
          createdAt: visitAt,
        });

        if (chance(0.72)) {
          pageViewRows.push({
            id: id(),
            storeId,
            sessionId,
            page: 'catalog',
            productId: null,
            categoryId: pick([...categoryIdByName.values()]),
            referrer,
            device,
            createdAt: addMinutes(visitAt, randomInt(1, 4)),
          });
        }

        if (chance(0.55)) {
          const product = pickWeighted(
            activeProducts.map((p) => ({ item: p, weight: Math.max(1, p.spec.popularity) })),
          );
          const viewedAt = addMinutes(visitAt, randomInt(2, 8));
          pageViewRows.push({
            id: id(),
            storeId,
            sessionId,
            page: 'product',
            productId: product.id,
            categoryId: product.categoryId,
            referrer,
            device,
            createdAt: viewedAt,
          });
          eventRows.push({
            id: id(),
            storeId,
            sessionId,
            customerId: null,
            eventType: 'product_view',
            metadata: { productId: product.id, name: product.spec.name },
            createdAt: viewedAt,
          });

          if (chance(0.3)) {
            eventRows.push({
              id: id(),
              storeId,
              sessionId,
              customerId: null,
              eventType: 'add_to_cart',
              metadata: { productId: product.id, quantity: randomInt(1, 2) },
              createdAt: addMinutes(viewedAt, randomInt(1, 3)),
            });

            if (chance(0.45)) {
              eventRows.push({
                id: id(),
                storeId,
                sessionId,
                customerId: null,
                eventType: 'checkout_started',
                metadata: null,
                createdAt: addMinutes(viewedAt, randomInt(4, 10)),
              });
              eventRows.push({
                id: id(),
                storeId,
                sessionId,
                customerId: null,
                eventType: chance(0.62) ? 'checkout_completed' : 'checkout_abandoned',
                metadata: null,
                createdAt: addMinutes(viewedAt, randomInt(11, 20)),
              });
            }
          }
        }
      }
    }

    await insertAll(db, schema.dailyStats, dailyStatsRows);
    await insertAll(db, schema.productStats, productStatsRows);
    await insertAll(db, schema.pageViews, pageViewRows);
    await insertAll(db, schema.storefrontEvents, eventRows);

    logSuccess(
      `${dailyStatsRows.length} daily stats, ${productStatsRows.length} product stats, ` +
        `${pageViewRows.length} page views, ${eventRows.length} storefront events`,
    );

    // ----------------------------------------------------------------- done
    console.log('');
    console.log(`${colors.green}${colors.bold}✓ Demo store ready${colors.reset}`);
    console.log('');
    console.log(`  Dashboard:  /dashboard  (sign in as ${options.email})`);
    console.log(`  Storefront: /${DEMO_STORE.slug}`);
    console.log(`  Store id:   ${storeId}`);
    console.log('');
  } catch (error) {
    console.log('');
    logError('Demo seed failed.');
    console.error(error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
