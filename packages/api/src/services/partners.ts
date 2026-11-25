import { randomBytes } from "node:crypto";

import {
  db,
  pageViews,
  partnerBookings,
  partnerPayouts,
  promoCodes,
  reservations,
  storePartnerSettings,
  storePartners,
  stores,
  type Transaction,
} from "@louez/db";
import { and, asc, eq, gt, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";

import {
  DEFAULT_PARTNER_ATTRIBUTION_DAYS,
  PARTNER_STATEMENT_MONTHS,
  parsePartnerCode,
  partnerAttributionDays,
  partnerCodeFromName,
  partnerErrors,
  type Partner,
  type PartnerBooking,
  type PartnerBookingOrigin,
  type PartnerCodeCheck,
  type PartnerCommissionType,
  type PartnerFields,
  type PartnerList,
  type PartnerMonthTotals,
  type PartnerPerkView,
  type PartnerSettings,
  type PartnerStatement,
  type ReservationPartner,
} from "../contracts/partners";
import { enqueueEffects } from "../platform/effects";
import { consumeRateLimit } from "../platform/rate-limit";
import {
  commissionBase,
  commissionState,
  computeCommission,
  monthOf,
  monthRange,
  monthTotals,
  recentMonths,
} from "./partner-commission";
import { resolveTimezone } from "./sales-window";

/**
 * Liens partenaires (docs/product/liens-partenaires.md): a store's partners,
 * the reservations attributed to them, their monthly statements and what the
 * store marked paid. Every read and write is scoped to one store. A write
 * that tells the partner (a booking credited, a month paid) queues its e-mail
 * in the same transaction and returns the effects' ids for the caller to
 * dispatch once committed.
 */

type PartnerRow = typeof storePartners.$inferSelect;

/** Where a read runs: the database, or the transaction of a write that reads under its lock. */
type Executor = typeof db | Transaction;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The secret of a partner's space: 32 random bytes, base64url (43 characters). */
export const newStatementToken = (): string => randomBytes(32).toString("base64url");

/** Where a partner's e-mails go: the address it set, else the store's contact for it. */
export const partnerNotifyEmail = (
  row: Pick<PartnerRow, "notifyEmail" | "contactEmail">,
): string | null => row.notifyEmail ?? row.contactEmail ?? null;

export const toPartner = (row: PartnerRow, perkCode: string | null = null): Partner => ({
  id: row.id,
  name: row.name,
  code: row.code,
  commission: { type: row.commissionType, value: Number(row.commissionValue) },
  contact: { name: row.contactName, email: row.contactEmail, phone: row.contactPhone },
  perk: row.promoCodeId && perkCode ? { promoCodeId: row.promoCodeId, code: perkCode } : null,
  notified:
    partnerNotifyEmail(row) !== null &&
    (row.notifyBookings || row.notifyPayouts || row.notifyStatements),
  archived: row.archivedAt !== null,
  createdAt: row.createdAt,
});

export interface PartnerStore {
  name: string;
  slug: string;
  currency: string;
  timezone: string;
  country: string | null;
  logoUrl: string | null;
  /** The logo for a dark background, when the store has one. */
  darkLogoUrl: string | null;
  /** The store's look, as its storefront shows it: a partner's space and poster wear it too. */
  theme: { mode: "light" | "dark"; primaryColor: string | null };
  /** The first photo of the storefront's home, for the space's banner. */
  heroImage: string | null;
  address: string | null;
}

export async function readPartnerStore(storeId: string): Promise<PartnerStore> {
  const store = await db.query.stores.findFirst({
    where: eq(stores.id, storeId),
    columns: {
      name: true,
      slug: true,
      settings: true,
      logoUrl: true,
      darkLogoUrl: true,
      theme: true,
      address: true,
    },
  });
  return {
    name: store?.name ?? "",
    slug: store?.slug ?? "",
    currency: store?.settings?.currency ?? "EUR",
    timezone: resolveTimezone(store?.settings?.timezone),
    country: store?.settings?.country ?? null,
    logoUrl: store?.logoUrl ?? null,
    darkLogoUrl: store?.darkLogoUrl ?? null,
    theme: {
      mode: store?.theme?.mode === "dark" ? "dark" : "light",
      primaryColor: store?.theme?.primaryColor ?? null,
    },
    heroImage: store?.theme?.heroImages?.[0] ?? null,
    address: store?.address ?? null,
  };
}

async function findPartner(storeId: string, partnerId: string): Promise<PartnerRow> {
  const row = await db.query.storePartners.findFirst({
    where: and(eq(storePartners.storeId, storeId), eq(storePartners.id, partnerId)),
  });
  if (!row) throw partnerErrors.notFound();
  return row;
}

/** The codes of some of the store's promo codes, by id. */
async function readPromoCodes(
  storeId: string,
  ids: readonly (string | null)[],
  executor: Executor = db,
) {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  if (wanted.length === 0) return new Map<string, string>();
  const rows = await executor
    .select({ id: promoCodes.id, code: promoCodes.code })
    .from(promoCodes)
    .where(and(eq(promoCodes.storeId, storeId), inArray(promoCodes.id, wanted)));
  return new Map(rows.map((row) => [row.id, row.code]));
}

/** A promo code a customer can use now: active, started, not expired, uses left. */
const usableNow = (now: Date) =>
  and(
    eq(promoCodes.isActive, true),
    or(isNull(promoCodes.startsAt), lt(promoCodes.startsAt, now)),
    or(isNull(promoCodes.expiresAt), gt(promoCodes.expiresAt, now)),
    or(
      isNull(promoCodes.maxUsageCount),
      sql`${promoCodes.currentUsageCount} < ${promoCodes.maxUsageCount}`,
    ),
  );

// --- Reading bookings ---------------------------------------------------------

/**
 * The attributed reservations of some partners, those whose rental ends in
 * `[start, end)` when a range is given, the earliest end first.
 */
export async function readPartnerBookings(input: {
  storeId: string;
  partnerIds: readonly string[];
  range?: { start: Date; end: Date };
  currency: string;
  now: Date;
  executor?: Executor;
}): Promise<(PartnerBooking & { partnerId: string; creditedAt: Date })[]> {
  if (input.partnerIds.length === 0) return [];
  const rows = await (input.executor ?? db)
    .select({
      partnerId: partnerBookings.partnerId,
      reservationId: reservations.id,
      number: reservations.number,
      status: reservations.status,
      startDate: reservations.startDate,
      endDate: reservations.endDate,
      subtotalAmount: reservations.subtotalAmount,
      discountAmount: reservations.discountAmount,
      tulipInsuranceAmount: reservations.tulipInsuranceAmount,
      commissionType: partnerBookings.commissionType,
      commissionValue: partnerBookings.commissionValue,
      adjustedAmount: partnerBookings.adjustedAmount,
      adjustmentNote: partnerBookings.adjustmentNote,
      origin: partnerBookings.origin,
      creditedAt: partnerBookings.createdAt,
    })
    .from(partnerBookings)
    .innerJoin(reservations, eq(reservations.id, partnerBookings.reservationId))
    .where(
      and(
        eq(partnerBookings.storeId, input.storeId),
        eq(reservations.storeId, input.storeId),
        eq(reservations.isTest, false),
        inArray(partnerBookings.partnerId, [...input.partnerIds]),
        ...(input.range
          ? [
              gte(reservations.endDate, input.range.start),
              lt(reservations.endDate, input.range.end),
            ]
          : []),
      ),
    )
    .orderBy(asc(reservations.endDate), asc(reservations.number));

  return rows.map((row) => {
    const rule = { type: row.commissionType, value: Number(row.commissionValue) };
    const base = commissionBase(row, input.currency);
    const computed = computeCommission(rule, base, input.currency);
    const adjustment =
      row.adjustedAmount === null
        ? null
        : { amount: Number(row.adjustedAmount), note: row.adjustmentNote };
    return {
      partnerId: row.partnerId,
      reservationId: row.reservationId,
      number: row.number,
      startDate: row.startDate,
      endDate: row.endDate,
      base,
      computed,
      commission: adjustment ? adjustment.amount : computed,
      adjustment,
      rule,
      state: commissionState(row.status, row.endDate, input.now),
      origin: row.origin,
      creditedAt: row.creditedAt,
    };
  });
}

/** What the store marked paid to some partners, for a month or for all of them. */
export async function readPartnerPayouts(
  storeId: string,
  partnerIds: readonly string[],
  month?: string,
  executor: Executor = db,
) {
  if (partnerIds.length === 0) return [];
  const rows = await executor
    .select({
      id: partnerPayouts.id,
      partnerId: partnerPayouts.partnerId,
      month: partnerPayouts.month,
      amount: partnerPayouts.amount,
      paidAt: partnerPayouts.paidAt,
    })
    .from(partnerPayouts)
    .where(
      and(
        eq(partnerPayouts.storeId, storeId),
        inArray(partnerPayouts.partnerId, [...partnerIds]),
        ...(month ? [eq(partnerPayouts.month, month)] : []),
      ),
    )
    .orderBy(asc(partnerPayouts.paidAt));
  return rows.map((row) => ({ ...row, amount: Number(row.amount) }));
}

/** Distinct storefront sessions that carried each partner's link over `[start, end)`. */
export async function readPartnerVisits(
  storeId: string,
  start: Date,
  end: Date,
  executor: Executor = db,
): Promise<Map<string, number>> {
  const rows = await executor
    .select({
      partnerId: pageViews.partnerId,
      visits: sql<number>`COUNT(DISTINCT ${pageViews.sessionId})`,
    })
    .from(pageViews)
    .where(
      and(
        eq(pageViews.storeId, storeId),
        isNotNull(pageViews.partnerId),
        gte(pageViews.createdAt, start),
        lt(pageViews.createdAt, end),
      ),
    )
    .groupBy(pageViews.partnerId);
  return new Map(
    rows.flatMap((row) => (row.partnerId ? [[row.partnerId, Number(row.visits) || 0]] : [])),
  );
}

// --- Settings -------------------------------------------------------------------

export async function getPartnerSettings(storeId: string): Promise<PartnerSettings> {
  const row = await db.query.storePartnerSettings.findFirst({
    where: eq(storePartnerSettings.storeId, storeId),
    columns: { attributionDays: true },
  });
  return {
    attributionDays: row
      ? partnerAttributionDays(row.attributionDays)
      : DEFAULT_PARTNER_ATTRIBUTION_DAYS,
  };
}

/** Sets how long a partner link holds, from the click to the booking. */
export async function updatePartnerSettings(
  storeId: string,
  settings: PartnerSettings,
): Promise<PartnerSettings> {
  const attributionDays = partnerAttributionDays(settings.attributionDays);
  await db
    .insert(storePartnerSettings)
    .values({ storeId, attributionDays })
    .onDuplicateKeyUpdate({ set: { attributionDays, updatedAt: new Date() } });
  return { attributionDays };
}

// --- Store reads ----------------------------------------------------------------

/** The store's partners, active first, each with its figures for a month (the current one by default). */
export async function listPartners(
  storeId: string,
  month?: string,
  now: Date = new Date(),
): Promise<Omit<PartnerList, "links">> {
  const store = await readPartnerStore(storeId);
  const selected = month ?? monthOf(now, store.timezone);
  const range = monthRange(selected, store.timezone);
  const rows = await db
    .select()
    .from(storePartners)
    .where(eq(storePartners.storeId, storeId))
    .orderBy(sql`${storePartners.archivedAt} IS NULL DESC`, asc(storePartners.name));
  const ids = rows.map((row) => row.id);
  const [bookings, payouts, visits, settings, perks, usable] = await Promise.all([
    readPartnerBookings({ storeId, partnerIds: ids, range, currency: store.currency, now }),
    readPartnerPayouts(storeId, ids, selected),
    readPartnerVisits(storeId, range.start, range.end),
    getPartnerSettings(storeId),
    readPromoCodes(
      storeId,
      rows.map((row) => row.promoCodeId),
    ),
    db
      .select({ id: promoCodes.id, code: promoCodes.code })
      .from(promoCodes)
      .where(and(eq(promoCodes.storeId, storeId), usableNow(now)))
      .orderBy(asc(promoCodes.code)),
  ]);

  return {
    currency: store.currency,
    month: selected,
    settings,
    promoCodes: usable,
    partners: rows.map((row) => ({
      ...toPartner(row, row.promoCodeId ? (perks.get(row.promoCodeId) ?? null) : null),
      totals: monthTotals(
        bookings.filter((booking) => booking.partnerId === row.id),
        payouts
          .filter((payout) => payout.partnerId === row.id)
          .reduce((sum, payout) => sum + payout.amount, 0),
        visits.get(row.id) ?? 0,
        store.currency,
      ),
    })),
  };
}

/** A partner's statement for a month: its bookings, what was paid, the link's visits. */
export async function partnerStatementFor(
  storeId: string,
  row: PartnerRow,
  store: PartnerStore,
  month: string,
  now: Date,
  executor: Executor = db,
): Promise<PartnerStatement> {
  const range = monthRange(month, store.timezone);
  const [bookings, payouts, visits, perks] = await Promise.all([
    readPartnerBookings({
      storeId,
      partnerIds: [row.id],
      range,
      currency: store.currency,
      now,
      executor,
    }),
    readPartnerPayouts(storeId, [row.id], month, executor),
    readPartnerVisits(storeId, range.start, range.end, executor),
    readPromoCodes(storeId, [row.promoCodeId], executor),
  ]);
  const paid = payouts.reduce((sum, payout) => sum + payout.amount, 0);
  return {
    partner: toPartner(row, row.promoCodeId ? (perks.get(row.promoCodeId) ?? null) : null),
    currency: store.currency,
    month,
    totals: monthTotals(bookings, paid, visits.get(row.id) ?? 0, store.currency),
    bookings: bookings.map(
      ({ partnerId: _partnerId, creditedAt: _creditedAt, ...booking }) => booking,
    ),
    payouts: payouts.map((payout) => ({
      id: payout.id,
      amount: payout.amount,
      paidAt: payout.paidAt,
    })),
  };
}

/** A partner's statement for a month (the current one by default), with the months to pick from. */
export async function getPartnerStatement(
  storeId: string,
  partnerId: string,
  month?: string,
  now: Date = new Date(),
): Promise<PartnerStatement & { months: string[] }> {
  const [row, store] = await Promise.all([
    findPartner(storeId, partnerId),
    readPartnerStore(storeId),
  ]);
  const months = recentMonths(now, store.timezone, PARTNER_STATEMENT_MONTHS);
  const selected = month ?? months[0];
  const statement = await partnerStatementFor(storeId, row, store, selected, now);
  return {
    ...statement,
    months: months.includes(selected) ? months : [selected, ...months],
  };
}

/**
 * The secret of a partner's space, for the dashboard's own action that hands
 * its link to a person who manages partners; no read of a statement gives it.
 */
export async function getPartnerSpaceToken(storeId: string, partnerId: string): Promise<string> {
  return (await findPartner(storeId, partnerId)).statementToken;
}

// --- Store writes -----------------------------------------------------------------

/** A code drawn from the name, free in the store: `les-pins`, else `les-pins-2`, `les-pins-3`… */
async function freeCode(storeId: string, name: string): Promise<string> {
  const stem = partnerCodeFromName(name) ?? "partner";
  const taken = new Set(
    (
      await db
        .select({ code: storePartners.code })
        .from(storePartners)
        .where(
          and(eq(storePartners.storeId, storeId), sql`${storePartners.code} LIKE ${`${stem}%`}`),
        )
    ).map((row) => row.code),
  );
  if (!taken.has(stem)) return stem;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${stem}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** The perk's promo code, checked to be the store's own. */
async function checkedPerk(storeId: string, promoCodeId: string | null | undefined) {
  if (!promoCodeId) return null;
  const perks = await readPromoCodes(storeId, [promoCodeId]);
  if (!perks.has(promoCodeId)) throw partnerErrors.perkNotFound();
  return promoCodeId;
}

const fieldValues = async (storeId: string, fields: PartnerFields) => ({
  name: fields.name,
  contactName: fields.contactName ?? null,
  contactEmail: fields.contactEmail ?? null,
  contactPhone: fields.contactPhone ?? null,
  commissionType: fields.commission.type,
  commissionValue: fields.commission.value.toFixed(2),
  promoCodeId: await checkedPerk(storeId, fields.promoCodeId),
});

const isDuplicateKey = (error: unknown): boolean => {
  const cause = error instanceof Error && "cause" in error ? error.cause : error;
  return (
    typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ER_DUP_ENTRY"
  );
};

async function readPartner(storeId: string, partnerId: string): Promise<Partner> {
  const row = await findPartner(storeId, partnerId);
  const perks = await readPromoCodes(storeId, [row.promoCodeId]);
  return toPartner(row, row.promoCodeId ? (perks.get(row.promoCodeId) ?? null) : null);
}

/**
 * Adds a partner. Its code is drawn from its name and never changes after: a
 * printed QR code must keep working when the partner is renamed.
 */
export async function createPartner(storeId: string, fields: PartnerFields): Promise<Partner> {
  const values = await fieldValues(storeId, fields);
  // Two creations racing for one code: the unique key refuses the second, which retries.
  for (let attempt = 0; ; attempt += 1) {
    const code = await freeCode(storeId, fields.name);
    const id = await db
      .insert(storePartners)
      .values({ storeId, code, statementToken: newStatementToken(), ...values })
      .$returningId()
      .then(([row]) => row?.id)
      .catch((error: unknown) => {
        if (attempt < 2 && isDuplicateKey(error)) return null;
        throw error;
      });
    if (id) return readPartner(storeId, id);
  }
}

/** Renames a partner or changes its contact, commission or perk; reservations already attributed keep their rule. */
export async function updatePartner(
  storeId: string,
  partnerId: string,
  fields: PartnerFields,
): Promise<Partner> {
  await findPartner(storeId, partnerId);
  await db
    .update(storePartners)
    .set({ ...(await fieldValues(storeId, fields)), updatedAt: new Date() })
    .where(and(eq(storePartners.storeId, storeId), eq(storePartners.id, partnerId)));
  return readPartner(storeId, partnerId);
}

/** Archives a partner (its link attributes nothing new) or brings it back. */
export async function setPartnerArchived(
  storeId: string,
  partnerId: string,
  archived: boolean,
): Promise<Partner> {
  const row = await findPartner(storeId, partnerId);
  if ((row.archivedAt !== null) !== archived) {
    await db
      .update(storePartners)
      .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
      .where(and(eq(storePartners.storeId, storeId), eq(storePartners.id, partnerId)));
  }
  return readPartner(storeId, partnerId);
}

/** Gives the partner's space a new secret: the old link stops working. */
export async function rotatePartnerStatementToken(
  storeId: string,
  partnerId: string,
): Promise<void> {
  await findPartner(storeId, partnerId);
  await db
    .update(storePartners)
    .set({ statementToken: newStatementToken(), updatedAt: new Date() })
    .where(and(eq(storePartners.storeId, storeId), eq(storePartners.id, partnerId)));
}

/**
 * A payout reads what is left to pay after it holds the partner's lock: under
 * READ COMMITTED each read sees the payouts committed before it, never a
 * snapshot taken earlier in the transaction.
 */
const PAYOUT_TRANSACTION = { isolationLevel: "read committed" } as const;

/**
 * Records that the store paid what is left of a month's due commissions, and
 * tells the partner. The money moves outside Louez; this is the store's own
 * note, so the statement shows what remains when a rental changes afterwards.
 *
 * One payout per intent: the partner's row is locked first, then what is left
 * is computed, checked and paid in the same transaction. A second tab, member
 * or retry waits for the lock, then finds the month settled
 * (`PARTNER_NOTHING_TO_PAY`) and queues no e-mail. A retry of the same attempt
 * sends the same idempotency key and gets the first answer back
 * (platform/operations.ts).
 */
export async function markPartnerMonthPaid(input: {
  storeId: string;
  userId: string;
  partnerId: string;
  month: string;
  now?: Date;
}): Promise<{ totals: PartnerMonthTotals; effectIds: string[] }> {
  const store = await readPartnerStore(input.storeId);
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(storePartners)
      .where(and(eq(storePartners.storeId, input.storeId), eq(storePartners.id, input.partnerId)))
      .for("update");
    if (!row) throw partnerErrors.notFound();
    const { totals } = await partnerStatementFor(input.storeId, row, store, input.month, now, tx);
    if (totals.remaining <= 0) throw partnerErrors.nothingToPay();
    const [payout] = await tx
      .insert(partnerPayouts)
      .values({
        storeId: input.storeId,
        partnerId: input.partnerId,
        month: input.month,
        amount: totals.remaining.toFixed(2),
        currency: store.currency,
        userId: input.userId,
      })
      .$returningId();
    const effectIds = await enqueueEffects(tx, input.storeId, [
      {
        type: "partner.payoutEmail",
        payload: { partnerId: input.partnerId, payoutId: payout.id },
        orderingKey: `partner:${input.partnerId}:email`,
      },
    ]);
    return {
      totals: { ...totals, paid: totals.paid + totals.remaining, remaining: 0 },
      effectIds,
    };
  }, PAYOUT_TRANSACTION);
}

/** Removes a payment the store recorded by mistake. */
export async function cancelPartnerPayout(storeId: string, payoutId: string): Promise<void> {
  const deleted = await db
    .delete(partnerPayouts)
    .where(and(eq(partnerPayouts.storeId, storeId), eq(partnerPayouts.id, payoutId)));
  if (deleted[0].affectedRows === 0) throw partnerErrors.notFound();
}

async function findStoreReservation(storeId: string, reservationId: string) {
  const reservation = await db.query.reservations.findFirst({
    where: and(eq(reservations.storeId, storeId), eq(reservations.id, reservationId)),
    columns: {
      id: true,
      status: true,
      endDate: true,
      isTest: true,
      subtotalAmount: true,
      discountAmount: true,
      tulipInsuranceAmount: true,
    },
  });
  if (!reservation || reservation.isTest) throw partnerErrors.reservationNotFound();
  return reservation;
}

/** Sets what the store owes for one attributed reservation, with a reason; null goes back to the rule. */
export async function adjustPartnerCommission(input: {
  storeId: string;
  reservationId: string;
  amount: number | null;
  note?: string | null;
}): Promise<void> {
  await findStoreReservation(input.storeId, input.reservationId);
  const updated = await db
    .update(partnerBookings)
    .set({
      adjustedAmount: input.amount === null ? null : input.amount.toFixed(2),
      adjustmentNote: input.amount === null ? null : (input.note ?? null),
    })
    .where(
      and(
        eq(partnerBookings.storeId, input.storeId),
        eq(partnerBookings.reservationId, input.reservationId),
      ),
    );
  if (updated[0].affectedRows === 0) throw partnerErrors.notAttributed();
}

/** The partner a reservation is attributed to, and the ones it can be. */
export async function getReservationPartner(
  storeId: string,
  reservationId: string,
  now: Date = new Date(),
): Promise<ReservationPartner> {
  const [reservation, store] = await Promise.all([
    findStoreReservation(storeId, reservationId),
    readPartnerStore(storeId),
  ]);
  const [booking, options] = await Promise.all([
    db
      .select({
        partnerId: partnerBookings.partnerId,
        name: storePartners.name,
        origin: partnerBookings.origin,
        commissionType: partnerBookings.commissionType,
        commissionValue: partnerBookings.commissionValue,
        adjustedAmount: partnerBookings.adjustedAmount,
      })
      .from(partnerBookings)
      .innerJoin(storePartners, eq(storePartners.id, partnerBookings.partnerId))
      .where(
        and(eq(partnerBookings.storeId, storeId), eq(partnerBookings.reservationId, reservationId)),
      )
      .then(([row]) => row ?? null),
    listPartnerOptions(storeId),
  ]);

  const current = booking && {
    partnerId: booking.partnerId,
    name: booking.name,
    origin: booking.origin,
    commission:
      booking.adjustedAmount !== null
        ? Number(booking.adjustedAmount)
        : computeCommission(
            { type: booking.commissionType, value: Number(booking.commissionValue) },
            commissionBase(reservation, store.currency),
            store.currency,
          ),
    state: commissionState(reservation.status, reservation.endDate, now),
  };
  return { current, currency: store.currency, options };
}

/** The store's active partners, by name: those a reservation can be attributed to. */
export function listPartnerOptions(storeId: string) {
  return db
    .select({ id: storePartners.id, name: storePartners.name })
    .from(storePartners)
    .where(and(eq(storePartners.storeId, storeId), isNull(storePartners.archivedAt)))
    .orderBy(asc(storePartners.name));
}

const ruleOf = (
  row: PartnerRow,
): { commissionType: PartnerCommissionType; commissionValue: string } => ({
  commissionType: row.commissionType,
  commissionValue: row.commissionValue,
});

const bookingEmail = (partnerId: string, reservationId: string) =>
  ({
    type: "partner.bookingEmail",
    payload: { partnerId, reservationId },
    orderingKey: `partner:${partnerId}:email`,
    reservationId,
  }) as const;

/**
 * Attributes a reservation to a partner by hand (a customer sent by phone,
 * a wrong link), or removes its attribution. The partner's current rule is
 * copied; choosing the partner it already has changes nothing. A partner
 * newly credited is told.
 */
export async function setReservationPartner(input: {
  storeId: string;
  userId: string;
  reservationId: string;
  partnerId: string | null;
}): Promise<{ effectIds: string[] }> {
  await findStoreReservation(input.storeId, input.reservationId);
  const where = and(
    eq(partnerBookings.storeId, input.storeId),
    eq(partnerBookings.reservationId, input.reservationId),
  );
  if (input.partnerId === null) {
    await db.delete(partnerBookings).where(where);
    return { effectIds: [] };
  }
  const partner = await findPartner(input.storeId, input.partnerId);
  if (partner.archivedAt) throw partnerErrors.notFound();
  const [existing] = await db
    .select({ partnerId: partnerBookings.partnerId })
    .from(partnerBookings)
    .where(where);
  if (existing?.partnerId === partner.id) return { effectIds: [] };

  const values = {
    partnerId: partner.id,
    ...ruleOf(partner),
    origin: "manual" as const,
    attributedBy: input.userId,
    adjustedAmount: null,
    adjustmentNote: null,
    createdAt: new Date(),
  };
  const effectIds = await db.transaction(async (tx) => {
    await tx
      .insert(partnerBookings)
      .values({ storeId: input.storeId, reservationId: input.reservationId, ...values })
      .onDuplicateKeyUpdate({ set: values });
    return enqueueEffects(tx, input.storeId, [bookingEmail(partner.id, input.reservationId)]);
  });
  return { effectIds };
}

// --- Storefront -------------------------------------------------------------------

const activeCode = (storeId: string, code: string) =>
  and(
    eq(storePartners.storeId, storeId),
    eq(storePartners.code, code),
    isNull(storePartners.archivedAt),
  );

/** The active partner of a store a code names, or null. */
export async function findActivePartnerByCode(
  storeId: string,
  code: string,
): Promise<{ id: string; name: string } | null> {
  const [row] = await db
    .select({ id: storePartners.id, name: storePartners.name })
    .from(storePartners)
    .where(activeCode(storeId, code))
    .limit(1);
  return row ?? null;
}

/** Whether a click on a partner link still holds, after the store's window. */
async function withinWindow(storeId: string, clickedAt: Date, now: Date): Promise<boolean> {
  const { attributionDays } = await getPartnerSettings(storeId);
  return (
    clickedAt.getTime() <= now.getTime() &&
    now.getTime() - clickedAt.getTime() <= attributionDays * DAY_MS
  );
}

/** A partner the checkout knows: by the link the visitor followed, or by the code they typed. */
export interface CheckoutPartner {
  code: string;
  name: string;
  /**
   * The perk, when the store gave one and it can be used now: its discount,
   * and the promo code the server applies at booking. The code never reaches
   * the storefront (`checkoutPerkView`).
   */
  perk: (PartnerPerkView & { promoCode: string }) | null;
}

/**
 * The partner a checkout credits: the code the customer typed, else the
 * link of the storefront's cookie while the store's window holds. Null for
 * an unknown or archived code.
 */
export async function findCheckoutPartner(input: {
  storeId: string;
  code: string;
  /** The link's click, for a code read from the cookie; none for a typed code. */
  clickedAt?: Date;
  now?: Date;
}): Promise<CheckoutPartner | null> {
  const now = input.now ?? new Date();
  if (input.clickedAt && !(await withinWindow(input.storeId, input.clickedAt, now))) return null;
  const [row] = await db
    .select({
      code: storePartners.code,
      name: storePartners.name,
      perkCode: promoCodes.code,
      perkType: promoCodes.type,
      perkValue: promoCodes.value,
      perkMinimum: promoCodes.minimumAmount,
    })
    .from(storePartners)
    .leftJoin(
      promoCodes,
      and(
        eq(promoCodes.id, storePartners.promoCodeId),
        eq(promoCodes.storeId, storePartners.storeId),
        usableNow(now),
      ),
    )
    .where(activeCode(input.storeId, input.code))
    .limit(1);
  if (!row) return null;
  return {
    code: row.code,
    name: row.name,
    perk:
      row.perkCode && row.perkType && row.perkValue !== null
        ? {
            promoCode: row.perkCode,
            type: row.perkType,
            value: Number(row.perkValue),
            minimumAmount: Number(row.perkMinimum ?? 0),
          }
        : null,
  };
}

/** What the storefront may see of a perk: its discount, without its promo code. */
export const checkoutPerkView = (perk: CheckoutPartner["perk"]): PartnerPerkView | null =>
  perk ? { type: perk.type, value: perk.value, minimumAmount: perk.minimumAmount } : null;

/**
 * How often the checkout's partner code field may be tried. Per IP, a
 * customer typing the code they were given needs a few tries, never dozens.
 * Per store, guessing codes from many addresses stays slow, while one person
 * cannot easily block the field for the store's other customers. Only the
 * check is limited: booking never is, and partner links keep working.
 */
export const PARTNER_CODE_CHECK_LIMITS = {
  perIp: { windowMs: 15 * 60 * 1000, max: 10 },
  perStore: { windowMs: 60 * 60 * 1000, max: 120 },
} as const;

/**
 * A partner's code typed at checkout: the partner's name and what the
 * customer sees of its perk, never the perk's promo code. Both limits are
 * counted before anything is read, and an unknown store answers as an
 * unknown code does.
 */
export async function checkStorefrontPartnerCode(input: {
  storeId: string;
  code: string;
  ip: string;
  now?: Date;
}): Promise<PartnerCodeCheck> {
  const now = input.now ?? new Date();
  const perIp = await consumeRateLimit(
    `partner-code:ip:${input.ip.slice(0, 64)}`,
    PARTNER_CODE_CHECK_LIMITS.perIp,
    now.getTime(),
  );
  if (!perIp.allowed) return { status: "rate_limited", retryAfterSeconds: perIp.retryAfterSeconds };
  const perStore = await consumeRateLimit(
    `partner-code:store:${input.storeId}`,
    PARTNER_CODE_CHECK_LIMITS.perStore,
    now.getTime(),
  );
  if (!perStore.allowed) {
    return { status: "rate_limited", retryAfterSeconds: perStore.retryAfterSeconds };
  }
  const code = parsePartnerCode(input.code);
  const partner = code ? await findCheckoutPartner({ storeId: input.storeId, code, now }) : null;
  if (!partner) return { status: "not_found" };
  return { status: "found", partner: { name: partner.name, perk: checkoutPerkView(partner.perk) } };
}

/** The partner a booking credits, and how. */
export interface CheckoutCredit {
  code: string;
  origin: Exclude<PartnerBookingOrigin, "manual">;
  clickedAt?: Date;
}

/**
 * The partner a storefront booking credits, read before it is written: the
 * code the customer typed, else the link the storefront's cookie remembers
 * (within the store's window, checked again at attribution). With the
 * promo code of its perk when it can be used now, for the server to apply
 * when the customer kept the perk the checkout showed. Null without a code
 * or a link.
 */
export async function resolveCheckoutCredit(input: {
  storeId: string;
  typedCode: string | undefined;
  link: { code: string; clickedAt: Date } | null;
  now?: Date;
}): Promise<{ credit: CheckoutCredit; perkPromoCode: string | null } | null> {
  const typed = parsePartnerCode(input.typedCode);
  const credit: CheckoutCredit | null = typed
    ? { code: typed, origin: "code" }
    : input.link
      ? { code: input.link.code, origin: "link", clickedAt: input.link.clickedAt }
      : null;
  if (!credit) return null;
  const partner = await findCheckoutPartner({
    storeId: input.storeId,
    code: credit.code,
    clickedAt: credit.clickedAt,
    now: input.now,
  });
  return { credit, perkPromoCode: partner?.perk?.promoCode ?? null };
}

/**
 * Attributes a reservation made on the storefront to a partner: the code the
 * customer typed (`code`), or the link they followed (`link`, within the
 * store's window). Nothing for a test reservation, an unknown or archived
 * code, or a reservation already attributed (the store's own choice wins).
 * The partner is told by e-mail.
 */
export async function attributeReservation(input: {
  storeId: string;
  reservationId: string;
  code: string;
  origin: Exclude<PartnerBookingOrigin, "manual">;
  clickedAt?: Date;
  now?: Date;
}): Promise<{ attributed: boolean; effectIds: string[] }> {
  const now = input.now ?? new Date();
  const none = { attributed: false, effectIds: [] };
  if (input.origin === "link") {
    if (!input.clickedAt || !(await withinWindow(input.storeId, input.clickedAt, now))) return none;
  }
  const partner = await db.query.storePartners.findFirst({
    where: activeCode(input.storeId, input.code),
  });
  if (!partner) return none;
  const reservation = await db.query.reservations.findFirst({
    where: and(eq(reservations.storeId, input.storeId), eq(reservations.id, input.reservationId)),
    columns: { isTest: true },
  });
  if (!reservation || reservation.isTest) return none;

  return db.transaction(async (tx) => {
    const result = await tx
      .insert(partnerBookings)
      .ignore()
      .values({
        storeId: input.storeId,
        reservationId: input.reservationId,
        partnerId: partner.id,
        ...ruleOf(partner),
        origin: input.origin,
      });
    if (result[0].affectedRows === 0) return none;
    const effectIds = await enqueueEffects(tx, input.storeId, [
      bookingEmail(partner.id, input.reservationId),
    ]);
    return { attributed: true, effectIds };
  });
}
