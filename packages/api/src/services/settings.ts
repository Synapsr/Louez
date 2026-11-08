import {
  db,
  lockStoreRow,
  markStore,
  markStoreReservations,
  storeLocations,
  stores,
  type Transaction,
} from "@louez/db";
import type {
  BusinessHours,
  DaySchedule,
  DeliverySettings,
  StoreSettings,
  TaxSettings,
} from "@louez/types";
import {
  beforeTaxRateBps,
  getMaxRentalMinutes,
  getMinRentalMinutes,
  getTimezoneForCountry,
  normalizeCurrency,
  hasRichTextContent,
  isSupportedCurrency,
  normalizeDaySchedule,
  WEEK_DAYS,
} from "@louez/utils";
import { sanitizeRichTextHtml } from "@louez/utils/sanitize-rich-text";
import { defaultBusinessHours } from "@louez/validations";
import { and, asc, count, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  SETTINGS_LIMITS,
  settingsErrors,
  type CreateLocationInput,
  type UpdateBusinessHoursInput,
  type UpdateCompanyInput,
  type UpdateDeliveryInput,
  type UpdateLegalInput,
  type UpdateLocationInput,
  type UpdateReservationRulesInput,
  type UpdateStoreInfoInput,
  type UpdateTaxesInput,
} from "../contracts/settings";
import { platformErrors } from "../platform/errors";
import type { ApiEvent, ApiEventStore, SettingsSection } from "../platform/ports";
import { toAppearanceView } from "./online-store";
import type { ConfirmStep } from "./products";

/**
 * The store settings an agent or the dashboard sets before a store goes
 * live: store info, company, legal texts, reservation rules, business hours,
 * delivery and pickup points, taxes.
 *
 * Every write locks the store row first (`SELECT … FOR UPDATE`, the first
 * read of its transaction), then reads the row and writes it back: the
 * `settings` JSON holds every section, so two writes of different sections
 * never lose each other's change. None of these checks read reservations, so
 * no other row is locked (DL-12).
 */

export interface SettingsActor {
  storeId: string;
  store: ApiEventStore;
  /** The app's effects, run after the commit (`ApiPorts.afterCommit`). */
  afterCommit: (event: ApiEvent) => void;
}

/** A change a preview shows: the value before and after. */
export interface SettingsChange {
  from: unknown;
  to: unknown;
}

/** What a sensitive settings write asks to confirm, under its lock. */
export interface SettingsPreview {
  summary: string;
  changes: Record<string, SettingsChange>;
}

/** The keys a store saved before it had any settings lacks. */
const SETTINGS_SEED = {
  reservationMode: "payment",
  minRentalMinutes: 60,
  maxRentalMinutes: null,
  advanceNoticeMinutes: 1440,
  turnoverBufferMinutes: 0,
} satisfies StoreSettings;

/** What the delivery page shows before delivery was ever saved. */
const DELIVERY_DEFAULTS: DeliverySettings = {
  enabled: false,
  mode: "optional",
  pricePerKm: 1.5,
  minimumFee: 10,
  maximumDistance: null,
  freeDeliveryThreshold: null,
  minimumOrderAmountForDelivery: null,
};

/** What the taxes page shows before taxes were ever saved. */
const TAX_DEFAULTS: TaxSettings = { enabled: false, defaultRate: 20, displayMode: "inclusive" };

// --- Reading ----------------------------------------------------------------

const storeColumns = {
  id: stores.id,
  name: stores.name,
  slug: stores.slug,
  description: stores.description,
  email: stores.email,
  phone: stores.phone,
  address: stores.address,
  latitude: stores.latitude,
  longitude: stores.longitude,
  onboardingCompleted: stores.onboardingCompleted,
  settings: stores.settings,
  cgv: stores.cgv,
  legalNotice: stores.legalNotice,
  includeCgvInContract: stores.includeCgvInContract,
  stripeChargesEnabled: stores.stripeChargesEnabled,
  tagline: stores.tagline,
  theme: stores.theme,
  logoUrl: stores.logoUrl,
  darkLogoUrl: stores.darkLogoUrl,
  faviconUrl: stores.faviconUrl,
  updatedAt: stores.updatedAt,
};

type StoreRow = {
  [K in keyof typeof storeColumns]: (typeof stores.$inferSelect)[K];
};

/** Locks the store row, the first read of the transaction, and returns it. */
async function lockStore(tx: Transaction, storeId: string): Promise<StoreRow> {
  if (!(await lockStoreRow(tx, storeId))) throw platformErrors.noStore();
  const [row] = await tx.select(storeColumns).from(stores).where(eq(stores.id, storeId));
  if (!row) throw platformErrors.noStore();
  return row;
}

const settingsOf = (row: Pick<StoreRow, "settings">): StoreSettings => ({
  ...SETTINGS_SEED,
  ...row.settings,
});

const toNumber = (value: string | null): number | null => (value === null ? null : Number(value));

/** A stored amount as a decimal string: two digits at least, more when it has them. */
const toDecimal = (value: number): string =>
  Math.abs(Math.round(value * 100) - value * 100) < 1e-9 ? value.toFixed(2) : String(value);

const toDecimalOrNull = (value: number | null | undefined) =>
  value === null || value === undefined ? null : toDecimal(value);

export const toStoreInfoView = (row: StoreRow) => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  description: row.description,
  email: row.email,
  phone: row.phone,
  address: row.address,
  latitude: toNumber(row.latitude),
  longitude: toNumber(row.longitude),
  online: row.onboardingCompleted === true,
});

export const toCompanyView = (settings: StoreSettings) => {
  const billing = settings.billingAddress ?? { useSameAsStore: true };
  return {
    country: settings.country ?? null,
    timezone: settings.timezone ?? null,
    currency: normalizeCurrency(settings.currency),
    billingAddress: {
      sameAsStore: billing.useSameAsStore,
      address: billing.address ?? null,
      city: billing.city ?? null,
      postalCode: billing.postalCode ?? null,
      country: billing.country ?? null,
    },
  };
};

export const toLegalView = (row: StoreRow) => ({
  cgv: row.cgv,
  legalNotice: row.legalNotice,
  includeCgvInContract: row.includeCgvInContract,
  footerNote: settingsOf(row).footerNote ?? null,
});

/** The rules as the reservation rules page shows them, defaults included. */
export const toReservationRulesView = (settings: StoreSettings) => ({
  reservationMode: settings.reservationMode,
  pendingBlocksAvailability: settings.pendingBlocksAvailability ?? true,
  onlinePaymentDepositPercentage: settings.onlinePaymentDepositPercentage ?? 100,
  minRentalMinutes: getMinRentalMinutes(settings),
  maxRentalMinutes: getMaxRentalMinutes(settings),
  advanceNoticeMinutes: settings.advanceNoticeMinutes ?? 1440,
  turnoverBufferMinutes: settings.turnoverBufferMinutes ?? 0,
  requireCustomerAddress: settings.requireCustomerAddress ?? false,
  automaticExtensions: settings.automaticExtensions ?? true,
  maxExtensionDays: settings.maxExtensionDays ?? null,
});
type ReservationRules = ReturnType<typeof toReservationRulesView>;

/**
 * The stored hours with every day in the current format. A store that never
 * saved any takes bookings at any time: `enabled` false over the default week.
 */
function storedBusinessHours(settings: StoreSettings): BusinessHours {
  const stored = settings.businessHours;
  if (!stored) return { ...defaultBusinessHours, enabled: false } as BusinessHours;
  const schedule = {} as BusinessHours["schedule"];
  for (let day = 0; day < 7; day += 1) {
    const key = day as keyof BusinessHours["schedule"];
    const value = stored.schedule?.[key] ?? defaultBusinessHours.schedule[key];
    schedule[key] = normalizeDaySchedule(value as unknown as Record<string, unknown>);
  }
  return { enabled: stored.enabled, schedule, closurePeriods: stored.closurePeriods ?? [] };
}

export const toBusinessHoursView = (settings: StoreSettings) => {
  const hours = storedBusinessHours(settings);
  return {
    enabled: hours.enabled,
    schedule: Object.fromEntries(
      WEEK_DAYS.map((name, day) => [name, hours.schedule[day as keyof BusinessHours["schedule"]]]),
    ) as Record<(typeof WEEK_DAYS)[number], DaySchedule>,
    closurePeriods: hours.closurePeriods,
  };
};

const storedDelivery = (settings: StoreSettings): DeliverySettings =>
  settings.delivery ?? DELIVERY_DEFAULTS;

export const toDeliveryView = (settings: StoreSettings) => {
  const delivery = storedDelivery(settings);
  return {
    enabled: delivery.enabled,
    mode: delivery.mode ?? "optional",
    multiLocationEnabled: delivery.multiLocationEnabled ?? false,
    pricePerKm: toDecimal(delivery.pricePerKm),
    minimumFee: toDecimal(delivery.minimumFee),
    maximumDistanceKm: delivery.maximumDistance,
    freeDeliveryThreshold: toDecimalOrNull(delivery.freeDeliveryThreshold),
    minimumOrderAmountForDelivery: toDecimalOrNull(delivery.minimumOrderAmountForDelivery),
    currency: normalizeCurrency(settings.currency),
  };
};

const storedTax = (settings: StoreSettings): TaxSettings => settings.tax ?? TAX_DEFAULTS;

export const toTaxesView = (settings: StoreSettings) => {
  const tax = storedTax(settings);
  return {
    enabled: tax.enabled,
    defaultRate: tax.defaultRate,
    displayMode: tax.displayMode,
    taxLabel: tax.taxLabel || null,
    taxNumber: tax.taxNumber || null,
  };
};

const locationColumns = {
  id: storeLocations.id,
  name: storeLocations.name,
  address: storeLocations.address,
  city: storeLocations.city,
  postalCode: storeLocations.postalCode,
  country: storeLocations.country,
  latitude: storeLocations.latitude,
  longitude: storeLocations.longitude,
  isActive: storeLocations.isActive,
};
type LocationRow = { [K in keyof typeof locationColumns]: (typeof storeLocations.$inferSelect)[K] };

export const toLocationView = (row: LocationRow) => ({
  ...row,
  latitude: toNumber(row.latitude),
  longitude: toNumber(row.longitude),
});

const legalTextSummary = (text: string | null, includeText: boolean) => ({
  // As the storefront decides whether to show it: `<p>&nbsp;</p>` shows nothing.
  set: hasRichTextContent(text),
  length: text?.length ?? 0,
  ...(includeText ? { text } : {}),
});

/** The legal texts as settings.get shows them: a summary, or the full texts too. */
export const toLegalSummaryView = (row: StoreRow, includeTexts: boolean) => ({
  cgv: legalTextSummary(row.cgv, includeTexts),
  legalNotice: legalTextSummary(row.legalNotice, includeTexts),
  includeCgvInContract: row.includeCgvInContract,
  footerNote: settingsOf(row).footerNote ?? null,
  updatedAt: row.updatedAt,
  textsIncluded: includeTexts,
});

/** Everything the settings pages show, for one store. */
export async function getSettings(storeId: string, options: { includeLegalTexts?: boolean } = {}) {
  const [row] = await db.select(storeColumns).from(stores).where(eq(stores.id, storeId)).limit(1);
  if (!row) throw platformErrors.noStore();
  const locations = await db
    .select(locationColumns)
    .from(storeLocations)
    .where(eq(storeLocations.storeId, storeId))
    // As the delivery page lists them; a store above the limit shows its first ones.
    .orderBy(desc(storeLocations.isActive), asc(storeLocations.createdAt), asc(storeLocations.id))
    .limit(SETTINGS_LIMITS.locations * 2);
  const settings = settingsOf(row);
  return {
    row,
    store: toStoreInfoView(row),
    company: toCompanyView(settings),
    legal: toLegalSummaryView(row, options.includeLegalTexts === true),
    reservationRules: toReservationRulesView(settings),
    businessHours: toBusinessHoursView(settings),
    delivery: toDeliveryView(settings),
    locations: locations.map(toLocationView),
    taxes: toTaxesView(settings),
    storefront: {
      slug: row.slug,
      tagline: row.tagline,
      locale: settings.locale ?? null,
      appearance: toAppearanceView(row),
    },
    payments: { stripeChargesEnabled: row.stripeChargesEnabled === true },
  };
}

// --- Writing helpers --------------------------------------------------------

/**
 * The section's effects, after the commit, for the store as the write locked
 * it: its slug may have changed since the request read it. An effect must
 * never fail a write that has committed.
 */
function emit(actor: SettingsActor, section: SettingsSection, slug: string) {
  try {
    actor.afterCommit({
      type: "store.settingsUpdated",
      store: { ...actor.store, slug },
      section,
    });
  } catch (error) {
    console.error("A settings effect failed after its commit:", error);
  }
}

/**
 * Editor HTML from what a caller sends: HTML is sanitised as the editor's
 * own; plain text becomes paragraphs (a blank line) and line breaks, so an
 * agent's text keeps its shape on the storefront. The sanitiser escapes the
 * text itself. Blank text is null.
 */
export function toEditorHtml(text: string | null): string | null {
  if (text === null) return null;
  const html = /<[a-z][\s\S]*>/i.test(text)
    ? text
    : text
        .trim()
        .split(/\n\s*\n/)
        .map((paragraph) => `<p>${paragraph.trim().replace(/\n/g, "<br />")}</p>`)
        .join("");
  const sanitized = sanitizeRichTextHtml(html);
  return hasRichTextContent(sanitized) ? sanitized : null;
}

/** The fields of `next` that differ from `current`, with both values. */
function diff<T extends Record<string, unknown>>(
  current: T,
  next: T,
  keys: readonly (keyof T)[],
): Record<string, SettingsChange> {
  const changes: Record<string, SettingsChange> = {};
  for (const key of keys) {
    if (JSON.stringify(current[key]) !== JSON.stringify(next[key])) {
      changes[key as string] = { from: current[key] ?? null, to: next[key] ?? null };
    }
  }
  return changes;
}

const describeChanges = (changes: Record<string, SettingsChange>) =>
  Object.entries(changes)
    .map(([key, { from, to }]) => `${key} ${JSON.stringify(from)} → ${JSON.stringify(to)}`)
    .join(", ");

/**
 * Runs a settings write under the store lock, then emits its section's
 * effects. `apply` reads the locked row
 * and returns what to write, with the preview to confirm when the change is
 * one customers see at checkout; a refused confirmation commits the new
 * preview's row (nothing else) and throws once the transaction is over.
 */
async function writeUnderLock<T>(
  actor: SettingsActor,
  section: SettingsSection,
  confirm: ConfirmStep<SettingsPreview> | undefined,
  apply: (
    row: StoreRow,
    tx: Transaction,
  ) => Promise<{ preview?: SettingsPreview | null; write: () => Promise<T> }>,
): Promise<T> {
  let refusal: Error | null = null;
  let result: T | undefined;
  let slug = actor.store.slug;
  await db.transaction(async (tx) => {
    const row = await lockStore(tx, actor.storeId);
    slug = row.slug;
    const step = await apply(row, tx);
    if (confirm && step.preview && Object.keys(step.preview.changes).length > 0) {
      refusal = await confirm(step.preview, tx);
      if (refusal) return;
    }
    result = await step.write();
  });
  if (refusal) throw refusal;
  emit(actor, section, slug);
  return result as T;
}

const updateSettingsColumn = (tx: Transaction, storeId: string, settings: StoreSettings) =>
  tx.update(stores).set({ settings, updatedAt: new Date() }).where(eq(stores.id, storeId));

const hasField = (input: Record<string, unknown>) =>
  Object.values(input).some((value) => value !== undefined);

// --- Store info -------------------------------------------------------------

/** Name, description and contact details. Not in any billing snapshot: no mark. */
export async function updateStoreInfo(actor: SettingsActor, input: UpdateStoreInfoInput) {
  if (!hasField(input)) throw settingsErrors.nothingToUpdate();
  const row = await writeUnderLock(actor, "storeInfo", undefined, async (current, tx) => ({
    write: async () => {
      const values: Partial<typeof stores.$inferInsert> = { updatedAt: new Date() };
      if (input.name !== undefined) values.name = input.name;
      if (input.description !== undefined) values.description = toEditorHtml(input.description);
      if (input.email !== undefined) values.email = input.email;
      if (input.phone !== undefined) values.phone = input.phone;
      if (input.address !== undefined) values.address = input.address;
      if (input.latitude !== undefined)
        values.latitude = input.latitude === null ? null : String(input.latitude);
      if (input.longitude !== undefined)
        values.longitude = input.longitude === null ? null : String(input.longitude);
      await tx.update(stores).set(values).where(eq(stores.id, actor.storeId));
      return {
        ...current,
        ...values,
        latitude: values.latitude !== undefined ? values.latitude : current.latitude,
        longitude: values.longitude !== undefined ? values.longitude : current.longitude,
      } as StoreRow;
    },
  }));
  return { row, store: toStoreInfoView(row) };
}

// --- Company ----------------------------------------------------------------

/**
 * Country (and so the time zone), currency and billing address. All three
 * are in the store's billing snapshot, so the store is marked; a new
 * currency also reaches the reservations with no frozen currency of their
 * own, so it marks them all (louez-billing contract Q4). A new country or
 * currency changes what customers see and pay: confirmed with a preview.
 */
export async function updateCompany(
  actor: SettingsActor,
  input: UpdateCompanyInput,
  options: { confirm?: ConfirmStep<SettingsPreview> } = {},
) {
  if (!hasField(input)) throw settingsErrors.nothingToUpdate();
  const settings = await writeUnderLock(actor, "company", options.confirm, async (row, tx) => {
    const current = settingsOf(row);
    // A currency Louez no longer takes stays only as it is, never as a new choice.
    if (
      input.currency !== undefined &&
      !isSupportedCurrency(input.currency) &&
      input.currency !== current.currency
    ) {
      throw settingsErrors.currencyNotSupported(input.currency);
    }
    const next: StoreSettings = { ...current };
    if (input.country !== undefined) {
      next.country = input.country;
      next.timezone = getTimezoneForCountry(input.country);
    }
    if (input.currency !== undefined) next.currency = input.currency;
    if (input.billingAddress !== undefined) {
      const billing = input.billingAddress;
      next.billingAddress = billing.sameAsStore
        ? { useSameAsStore: true }
        : {
            useSameAsStore: false,
            address: billing.address || undefined,
            city: billing.city || undefined,
            postalCode: billing.postalCode || undefined,
            country: billing.country,
          };
    }
    const changes = diff(
      { country: current.country, timezone: current.timezone, currency: current.currency },
      { country: next.country, timezone: next.timezone, currency: next.currency },
      ["country", "timezone", "currency"],
    );
    return {
      preview: {
        summary: `Change the store's ${describeChanges(changes)}. Prices, deposits and payments of new reservations use the new currency; dates and opening hours follow the new time zone.`,
        changes,
      },
      write: async () => {
        await updateSettingsColumn(tx, actor.storeId, next);
        await markStore(tx, actor.storeId);
        if (normalizeCurrency(next.currency) !== normalizeCurrency(current.currency)) {
          await markStoreReservations(tx, actor.storeId);
        }
        return next;
      },
    };
  });
  return toCompanyView(settings);
}

// --- Legal texts ------------------------------------------------------------

/** Terms, legal notice and footer note. Text only: no mark, no confirmation. */
export async function updateLegal(actor: SettingsActor, input: UpdateLegalInput) {
  if (!hasField(input)) throw settingsErrors.nothingToUpdate();
  const row = await writeUnderLock(actor, "legal", undefined, async (current, tx) => ({
    write: async () => {
      const values: Partial<typeof stores.$inferInsert> = { updatedAt: new Date() };
      if (input.cgv !== undefined) values.cgv = toEditorHtml(input.cgv);
      if (input.legalNotice !== undefined) values.legalNotice = toEditorHtml(input.legalNotice);
      if (input.includeCgvInContract !== undefined) {
        values.includeCgvInContract = input.includeCgvInContract;
      }
      let settings = current.settings;
      if (input.footerNote !== undefined) {
        settings = { ...settingsOf(current), footerNote: input.footerNote || null };
        values.settings = settings;
      }
      await tx.update(stores).set(values).where(eq(stores.id, actor.storeId));
      return { ...current, ...values, settings } as StoreRow;
    },
  }));
  return toLegalView(row);
}

// --- Reservation rules ------------------------------------------------------

/** Rules customers see at checkout: what they pay now, and how they book. */
const CHECKOUT_RULES = ["reservationMode", "onlinePaymentDepositPercentage"] as const;

/**
 * Booking mode, durations, notice, buffers and extensions. Payment mode needs
 * Stripe: the dashboard refuses the switch without it, and so does the API.
 * A change of mode or of the share paid online is confirmed with a preview.
 */
export async function updateReservationRules(
  actor: SettingsActor,
  input: UpdateReservationRulesInput,
  options: { confirm?: ConfirmStep<SettingsPreview> } = {},
) {
  if (!hasField(input)) throw settingsErrors.nothingToUpdate();
  const rules = await writeUnderLock(
    actor,
    "reservationRules",
    options.confirm,
    async (row, tx) => {
      const settings = settingsOf(row);
      const current = toReservationRulesView(settings);
      const next: ReservationRules = { ...current };
      for (const [key, value] of Object.entries(input)) {
        if (value !== undefined) (next as Record<string, unknown>)[key] = value;
      }
      if (next.maxRentalMinutes !== null && next.minRentalMinutes > next.maxRentalMinutes) {
        throw settingsErrors.rangeInvalid(
          "The shortest rental (minRentalMinutes) is longer than the longest one (maxRentalMinutes).",
        );
      }
      if (
        next.reservationMode === "payment" &&
        current.reservationMode !== "payment" &&
        row.stripeChargesEnabled !== true
      ) {
        throw settingsErrors.stripeRequired();
      }
      const changes = diff(current, next, CHECKOUT_RULES);
      return {
        preview: {
          summary:
            `Change how customers book: ${describeChanges(changes)}.` +
            (changes.reservationMode
              ? next.reservationMode === "payment"
                ? " New bookings are paid online at checkout."
                : " New bookings become requests the store accepts or declines; nothing is paid at checkout."
              : ""),
          changes,
        },
        write: async () => {
          await updateSettingsColumn(tx, actor.storeId, { ...settings, ...next });
          return next;
        },
      };
    },
  );
  return rules;
}

// --- Business hours ---------------------------------------------------------

/** Weekly hours and closures. Only what customers may book changes: no confirmation. */
export async function updateBusinessHours(actor: SettingsActor, input: UpdateBusinessHoursInput) {
  if (!hasField(input)) throw settingsErrors.nothingToUpdate();
  const settings = await writeUnderLock(actor, "businessHours", undefined, async (row, tx) => {
    const current = settingsOf(row);
    const hours = storedBusinessHours(current);
    const next: BusinessHours = {
      enabled: input.enabled ?? hours.enabled,
      schedule: { ...hours.schedule },
      closurePeriods: hours.closurePeriods,
    };
    WEEK_DAYS.forEach((name, day) => {
      const value = input.schedule?.[name];
      if (value) next.schedule[day as keyof BusinessHours["schedule"]] = value;
    });
    if (input.closurePeriods !== undefined) {
      next.closurePeriods = input.closurePeriods.map((period) => ({
        ...period,
        id: period.id ?? nanoid(),
      }));
    }
    return {
      write: async () => {
        const saved = { ...current, businessHours: next };
        await updateSettingsColumn(tx, actor.storeId, saved);
        return saved;
      },
    };
  });
  return toBusinessHoursView(settings);
}

// --- Delivery and pickup points ---------------------------------------------

const DELIVERY_KEYS = [
  "enabled",
  "mode",
  "multiLocationEnabled",
  "pricePerKm",
  "minimumFee",
  "maximumDistance",
  "freeDeliveryThreshold",
  "minimumOrderAmountForDelivery",
] as const satisfies readonly (keyof DeliverySettings)[];

const parseMoney = (value: string | null) => (value === null ? null : Number(value));

/**
 * Delivery to the customer's address: its mode and fees. Every field is a
 * fee or an option of the checkout, so a change is confirmed with a preview.
 * Delivery is measured from the store, so it needs the store's coordinates.
 */
export async function updateDelivery(
  actor: SettingsActor,
  input: UpdateDeliveryInput,
  options: { confirm?: ConfirmStep<SettingsPreview> } = {},
) {
  if (!hasField(input)) throw settingsErrors.nothingToUpdate();
  const settings = await writeUnderLock(actor, "delivery", options.confirm, async (row, tx) => {
    const settings = settingsOf(row);
    const stored = storedDelivery(settings);
    const current: DeliverySettings = {
      ...stored,
      mode: stored.mode ?? "optional",
      multiLocationEnabled: stored.multiLocationEnabled ?? false,
      minimumOrderAmountForDelivery: stored.minimumOrderAmountForDelivery ?? null,
    };
    const next: DeliverySettings = {
      enabled: input.enabled ?? current.enabled,
      multiLocationEnabled: input.multiLocationEnabled ?? current.multiLocationEnabled,
      mode: input.mode ?? current.mode,
      pricePerKm: input.pricePerKm !== undefined ? Number(input.pricePerKm) : current.pricePerKm,
      minimumFee: input.minimumFee !== undefined ? Number(input.minimumFee) : current.minimumFee,
      maximumDistance:
        input.maximumDistanceKm !== undefined ? input.maximumDistanceKm : current.maximumDistance,
      freeDeliveryThreshold:
        input.freeDeliveryThreshold !== undefined
          ? parseMoney(input.freeDeliveryThreshold)
          : current.freeDeliveryThreshold,
      minimumOrderAmountForDelivery:
        input.minimumOrderAmountForDelivery !== undefined
          ? parseMoney(input.minimumOrderAmountForDelivery)
          : current.minimumOrderAmountForDelivery,
    };
    if (next.enabled && (!row.latitude || !row.longitude)) {
      throw settingsErrors.coordinatesRequired();
    }
    const changes = diff(
      current as unknown as Record<string, unknown>,
      next as unknown as Record<string, unknown>,
      DELIVERY_KEYS,
    );
    return {
      preview: {
        summary: `Change the delivery customers are offered at checkout (${normalizeCurrency(settings.currency)}): ${describeChanges(changes)}.`,
        changes,
      },
      write: async () => {
        const saved = { ...settings, delivery: next };
        await updateSettingsColumn(tx, actor.storeId, saved);
        return saved;
      },
    };
  });
  return toDeliveryView(settings);
}

async function lockedLocation(tx: Transaction, storeId: string, id: string) {
  const [row] = await tx
    .select(locationColumns)
    .from(storeLocations)
    .where(and(eq(storeLocations.id, id), eq(storeLocations.storeId, storeId)))
    .limit(1);
  if (!row) throw settingsErrors.locationNotFound(id);
  return row;
}

const coordinate = (value: number | null | undefined) =>
  value === undefined ? undefined : value === null ? null : String(value);

/** A new pickup and return point. A store has `SETTINGS_LIMITS.locations` at most. */
export async function createLocation(actor: SettingsActor, input: CreateLocationInput) {
  const location = await writeUnderLock(actor, "locations", undefined, async (row, tx) => {
    const [{ total }] = await tx
      .select({ total: count() })
      .from(storeLocations)
      .where(eq(storeLocations.storeId, actor.storeId));
    if (total >= SETTINGS_LIMITS.locations) {
      throw settingsErrors.locationLimit(SETTINGS_LIMITS.locations);
    }
    return {
      write: async () => {
        const id = nanoid();
        await tx.insert(storeLocations).values({
          id,
          storeId: actor.storeId,
          name: input.name,
          address: input.address,
          city: input.city || null,
          postalCode: input.postalCode || null,
          country: input.country || settingsOf(row).country || "FR",
          latitude: coordinate(input.latitude) ?? null,
          longitude: coordinate(input.longitude) ?? null,
        });
        return lockedLocation(tx, actor.storeId, id);
      },
    };
  });
  return toLocationView(location);
}

/** Changes a pickup point. Fields left out stay as they are; null clears. */
export async function updateLocation(actor: SettingsActor, input: UpdateLocationInput) {
  const { id, ...fields } = input;
  if (!hasField(fields)) throw settingsErrors.nothingToUpdate();
  const location = await writeUnderLock(actor, "locations", undefined, async (_row, tx) => {
    await lockedLocation(tx, actor.storeId, id);
    return {
      write: async () => {
        const values: Partial<typeof storeLocations.$inferInsert> = { updatedAt: new Date() };
        if (fields.name !== undefined) values.name = fields.name;
        if (fields.address !== undefined) values.address = fields.address;
        if (fields.city !== undefined) values.city = fields.city || null;
        if (fields.postalCode !== undefined) values.postalCode = fields.postalCode || null;
        if (fields.country !== undefined) values.country = fields.country || null;
        if (fields.latitude !== undefined) values.latitude = coordinate(fields.latitude);
        if (fields.longitude !== undefined) values.longitude = coordinate(fields.longitude);
        await tx
          .update(storeLocations)
          .set(values)
          .where(and(eq(storeLocations.id, id), eq(storeLocations.storeId, actor.storeId)));
        return lockedLocation(tx, actor.storeId, id);
      },
    };
  });
  return toLocationView(location);
}

/** Shows or hides a pickup point at checkout; reservations that used it keep it. */
export async function setLocationActive(
  actor: SettingsActor,
  input: { id: string; isActive: boolean },
) {
  const location = await writeUnderLock(actor, "locations", undefined, async (_row, tx) => {
    await lockedLocation(tx, actor.storeId, input.id);
    return {
      write: async () => {
        await tx
          .update(storeLocations)
          .set({ isActive: input.isActive, updatedAt: new Date() })
          .where(and(eq(storeLocations.id, input.id), eq(storeLocations.storeId, actor.storeId)));
        return lockedLocation(tx, actor.storeId, input.id);
      },
    };
  });
  return toLocationView(location);
}

// --- Taxes ------------------------------------------------------------------

const TAX_KEYS = ["enabled", "defaultRate", "displayMode", "taxLabel", "taxNumber"] as const;

/**
 * Tax rate, display mode and the store's tax number. The billing snapshot
 * total of a reservation the dashboard wrote follows the store's tax
 * settings (contract Q6), so a change of the rate that applies marks every
 * reservation of the store. Prices customers see change: confirmed with a
 * preview.
 */
export async function updateTaxes(
  actor: SettingsActor,
  input: UpdateTaxesInput,
  options: { confirm?: ConfirmStep<SettingsPreview> } = {},
) {
  if (!hasField(input)) throw settingsErrors.nothingToUpdate();
  const settings = await writeUnderLock(actor, "taxes", options.confirm, async (row, tx) => {
    const settings = settingsOf(row);
    const stored = storedTax(settings);
    const current: TaxSettings = {
      ...stored,
      taxLabel: stored.taxLabel || undefined,
      taxNumber: stored.taxNumber || undefined,
    };
    const next: TaxSettings = {
      enabled: input.enabled ?? current.enabled,
      defaultRate: input.defaultRate ?? current.defaultRate,
      displayMode: input.displayMode ?? current.displayMode,
      taxLabel: input.taxLabel === undefined ? current.taxLabel : input.taxLabel || undefined,
      taxNumber: input.taxNumber === undefined ? current.taxNumber : input.taxNumber || undefined,
    };
    const changes = diff(
      current as unknown as Record<string, unknown>,
      next as unknown as Record<string, unknown>,
      TAX_KEYS,
    );
    return {
      preview: {
        summary: `Change the store's taxes: ${describeChanges(changes)}. Prices customers see at checkout follow the new settings.`,
        changes,
      },
      write: async () => {
        const saved = { ...settings, tax: next };
        await updateSettingsColumn(tx, actor.storeId, saved);
        if (beforeTaxRateBps(stored) !== beforeTaxRateBps(next)) {
          await markStoreReservations(tx, actor.storeId);
        }
        return saved;
      },
    };
  });
  return toTaxesView(settings);
}
