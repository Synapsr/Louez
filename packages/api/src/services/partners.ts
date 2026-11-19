import { randomBytes } from "node:crypto";

import {
  db,
  pageViews,
  partnerBookings,
  partnerPayouts,
  reservations,
  storePartners,
  stores,
} from "@louez/db";
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";

import {
  PARTNER_STATEMENT_MONTHS,
  partnerCodeFromName,
  partnerErrors,
  type Partner,
  type PartnerBooking,
  type PartnerCommissionType,
  type PartnerFields,
  type PartnerList,
  type PartnerMonthTotals,
  type PartnerStatement,
  type ReservationPartner,
} from "../contracts/partners";
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
 * store marked paid. Every read and write is scoped to one store.
 */

type PartnerRow = typeof storePartners.$inferSelect;

/** The secret of a partner's read-only statement page: 32 random bytes, base64url (43 characters). */
export const newStatementToken = (): string => randomBytes(32).toString("base64url");

const toPartner = (row: PartnerRow): Partner => ({
  id: row.id,
  name: row.name,
  code: row.code,
  commission: { type: row.commissionType, value: Number(row.commissionValue) },
  contact: { name: row.contactName, email: row.contactEmail, phone: row.contactPhone },
  archived: row.archivedAt !== null,
  createdAt: row.createdAt,
});

interface StoreMoney {
  name: string;
  currency: string;
  timezone: string;
}

async function readStore(storeId: string): Promise<StoreMoney> {
  const store = await db.query.stores.findFirst({
    where: eq(stores.id, storeId),
    columns: { name: true, settings: true },
  });
  return {
    name: store?.name ?? "",
    currency: store?.settings?.currency ?? "EUR",
    timezone: resolveTimezone(store?.settings?.timezone),
  };
}

async function findPartner(storeId: string, partnerId: string): Promise<PartnerRow> {
  const row = await db.query.storePartners.findFirst({
    where: and(eq(storePartners.storeId, storeId), eq(storePartners.id, partnerId)),
  });
  if (!row) throw partnerErrors.notFound();
  return row;
}

// --- Reading bookings ---------------------------------------------------------

/** The attributed reservations of some partners whose rental ends in `[start, end)`. */
async function readBookings(input: {
  storeId: string;
  partnerIds: readonly string[];
  start: Date;
  end: Date;
  currency: string;
  now: Date;
}): Promise<(PartnerBooking & { partnerId: string })[]> {
  if (input.partnerIds.length === 0) return [];
  const rows = await db
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
    })
    .from(partnerBookings)
    .innerJoin(reservations, eq(reservations.id, partnerBookings.reservationId))
    .where(
      and(
        eq(partnerBookings.storeId, input.storeId),
        eq(reservations.storeId, input.storeId),
        eq(reservations.isTest, false),
        inArray(partnerBookings.partnerId, [...input.partnerIds]),
        gte(reservations.endDate, input.start),
        lt(reservations.endDate, input.end),
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
    };
  });
}

/** What the store marked paid per partner for a month. */
async function readPayouts(storeId: string, partnerIds: readonly string[], month: string) {
  if (partnerIds.length === 0) return [];
  return db
    .select({
      id: partnerPayouts.id,
      partnerId: partnerPayouts.partnerId,
      amount: partnerPayouts.amount,
      paidAt: partnerPayouts.paidAt,
    })
    .from(partnerPayouts)
    .where(
      and(
        eq(partnerPayouts.storeId, storeId),
        inArray(partnerPayouts.partnerId, [...partnerIds]),
        eq(partnerPayouts.month, month),
      ),
    )
    .orderBy(asc(partnerPayouts.paidAt));
}

/** Distinct storefront sessions that carried each partner's link over `[start, end)`. */
async function readVisits(storeId: string, start: Date, end: Date): Promise<Map<string, number>> {
  const rows = await db
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

// --- Store reads ----------------------------------------------------------------

/** The store's partners, active first, each with its figures for a month (the current one by default). */
export async function listPartners(
  storeId: string,
  month?: string,
  now: Date = new Date(),
): Promise<PartnerList> {
  const store = await readStore(storeId);
  const selected = month ?? monthOf(now, store.timezone);
  const { start, end } = monthRange(selected, store.timezone);
  const rows = await db
    .select()
    .from(storePartners)
    .where(eq(storePartners.storeId, storeId))
    .orderBy(sql`${storePartners.archivedAt} IS NULL DESC`, asc(storePartners.name));
  const ids = rows.map((row) => row.id);
  const [bookings, payouts, visits] = await Promise.all([
    readBookings({ storeId, partnerIds: ids, start, end, currency: store.currency, now }),
    readPayouts(storeId, ids, selected),
    readVisits(storeId, start, end),
  ]);

  return {
    currency: store.currency,
    month: selected,
    partners: rows.map((row) => ({
      ...toPartner(row),
      totals: monthTotals(
        bookings.filter((booking) => booking.partnerId === row.id),
        payouts
          .filter((payout) => payout.partnerId === row.id)
          .reduce((sum, payout) => sum + Number(payout.amount), 0),
        visits.get(row.id) ?? 0,
        store.currency,
      ),
    })),
  };
}

async function statementFor(
  storeId: string,
  row: PartnerRow,
  store: StoreMoney,
  month: string,
  now: Date,
): Promise<PartnerStatement> {
  const { start, end } = monthRange(month, store.timezone);
  const [bookings, payouts, visits] = await Promise.all([
    readBookings({ storeId, partnerIds: [row.id], start, end, currency: store.currency, now }),
    readPayouts(storeId, [row.id], month),
    readVisits(storeId, start, end),
  ]);
  const paid = payouts.reduce((sum, payout) => sum + Number(payout.amount), 0);
  return {
    partner: toPartner(row),
    currency: store.currency,
    month,
    totals: monthTotals(bookings, paid, visits.get(row.id) ?? 0, store.currency),
    bookings: bookings.map(({ partnerId: _partnerId, ...booking }) => booking),
    payouts: payouts.map((payout) => ({
      id: payout.id,
      amount: Number(payout.amount),
      paidAt: payout.paidAt,
    })),
  };
}

/** A partner's statement for a month (the current one by default), with its page's secret. */
export async function getPartnerStatement(
  storeId: string,
  partnerId: string,
  month?: string,
  now: Date = new Date(),
): Promise<PartnerStatement & { months: string[]; statementToken: string }> {
  const [row, store] = await Promise.all([findPartner(storeId, partnerId), readStore(storeId)]);
  const months = recentMonths(now, store.timezone, PARTNER_STATEMENT_MONTHS);
  const selected = month ?? months[0];
  const statement = await statementFor(storeId, row, store, selected, now);
  return {
    ...statement,
    months: months.includes(selected) ? months : [selected, ...months],
    statementToken: row.statementToken,
  };
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

const fieldValues = (fields: PartnerFields) => ({
  name: fields.name,
  contactName: fields.contactName ?? null,
  contactEmail: fields.contactEmail ?? null,
  contactPhone: fields.contactPhone ?? null,
  commissionType: fields.commission.type,
  commissionValue: fields.commission.value.toFixed(2),
});

/**
 * Adds a partner. Its code is drawn from its name and never changes after: a
 * printed QR code must keep working when the partner is renamed.
 */
export async function createPartner(storeId: string, fields: PartnerFields): Promise<Partner> {
  // Two creations racing for one code: the unique key refuses the second, which retries.
  for (let attempt = 0; ; attempt += 1) {
    const code = await freeCode(storeId, fields.name);
    const id = await db
      .insert(storePartners)
      .values({ storeId, code, statementToken: newStatementToken(), ...fieldValues(fields) })
      .$returningId()
      .then(([row]) => row?.id)
      .catch((error: unknown) => {
        if (attempt < 2 && isDuplicateKey(error)) return null;
        throw error;
      });
    if (id) return toPartner(await findPartner(storeId, id));
  }
}

const isDuplicateKey = (error: unknown): boolean => {
  const cause = error instanceof Error && "cause" in error ? error.cause : error;
  return (
    typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ER_DUP_ENTRY"
  );
};

/** Renames a partner or changes its contact or commission; reservations already attributed keep their rule. */
export async function updatePartner(
  storeId: string,
  partnerId: string,
  fields: PartnerFields,
): Promise<Partner> {
  await findPartner(storeId, partnerId);
  await db
    .update(storePartners)
    .set({ ...fieldValues(fields), updatedAt: new Date() })
    .where(and(eq(storePartners.storeId, storeId), eq(storePartners.id, partnerId)));
  return toPartner(await findPartner(storeId, partnerId));
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
  return toPartner(await findPartner(storeId, partnerId));
}

/** Gives the partner's statement page a new secret: the old link stops working. */
export async function rotatePartnerStatementToken(
  storeId: string,
  partnerId: string,
): Promise<{ statementToken: string }> {
  await findPartner(storeId, partnerId);
  const statementToken = newStatementToken();
  await db
    .update(storePartners)
    .set({ statementToken, updatedAt: new Date() })
    .where(and(eq(storePartners.storeId, storeId), eq(storePartners.id, partnerId)));
  return { statementToken };
}

/**
 * Records that the store paid what is left of a month's due commissions. The
 * money moves outside Louez; this is the store's own note, so the statement
 * shows what remains when a rental changes afterwards.
 */
export async function markPartnerMonthPaid(input: {
  storeId: string;
  userId: string;
  partnerId: string;
  month: string;
  now?: Date;
}): Promise<PartnerMonthTotals> {
  const [row, store] = await Promise.all([
    findPartner(input.storeId, input.partnerId),
    readStore(input.storeId),
  ]);
  const statement = await statementFor(
    input.storeId,
    row,
    store,
    input.month,
    input.now ?? new Date(),
  );
  if (statement.totals.remaining <= 0) throw partnerErrors.nothingToPay();
  await db.insert(partnerPayouts).values({
    storeId: input.storeId,
    partnerId: input.partnerId,
    month: input.month,
    amount: statement.totals.remaining.toFixed(2),
    currency: store.currency,
    userId: input.userId,
  });
  const paid = statement.totals.paid + statement.totals.remaining;
  return { ...statement.totals, paid, remaining: 0 };
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
    readStore(storeId),
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
    db
      .select({ id: storePartners.id, name: storePartners.name })
      .from(storePartners)
      .where(and(eq(storePartners.storeId, storeId), isNull(storePartners.archivedAt)))
      .orderBy(asc(storePartners.name)),
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

const ruleOf = (
  row: PartnerRow,
): { commissionType: PartnerCommissionType; commissionValue: string } => ({
  commissionType: row.commissionType,
  commissionValue: row.commissionValue,
});

/**
 * Attributes a reservation to a partner by hand (a customer sent by phone,
 * a wrong link), or removes its attribution. The partner's current rule is
 * copied; choosing the partner it already has changes nothing.
 */
export async function setReservationPartner(input: {
  storeId: string;
  userId: string;
  reservationId: string;
  partnerId: string | null;
}): Promise<void> {
  await findStoreReservation(input.storeId, input.reservationId);
  const where = and(
    eq(partnerBookings.storeId, input.storeId),
    eq(partnerBookings.reservationId, input.reservationId),
  );
  if (input.partnerId === null) {
    await db.delete(partnerBookings).where(where);
    return;
  }
  const partner = await findPartner(input.storeId, input.partnerId);
  if (partner.archivedAt) throw partnerErrors.notFound();
  const [existing] = await db
    .select({ partnerId: partnerBookings.partnerId })
    .from(partnerBookings)
    .where(where);
  if (existing?.partnerId === partner.id) return;

  const values = {
    partnerId: partner.id,
    ...ruleOf(partner),
    origin: "manual" as const,
    attributedBy: input.userId,
    adjustedAmount: null,
    adjustmentNote: null,
    createdAt: new Date(),
  };
  await db
    .insert(partnerBookings)
    .values({ storeId: input.storeId, reservationId: input.reservationId, ...values })
    .onDuplicateKeyUpdate({ set: values });
}

// --- Storefront -------------------------------------------------------------------

const activeCode = (storeId: string, code: string) =>
  and(
    eq(storePartners.storeId, storeId),
    eq(storePartners.code, code),
    isNull(storePartners.archivedAt),
  );

/** The active partner of a store a link's code names, or null. */
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

/**
 * Attributes a reservation made on the storefront to the partner whose link
 * the customer agreed to credit (the storefront's partner cookie). Nothing for
 * a test reservation, an unknown or archived code, or a reservation already
 * attributed (the store's own choice wins).
 */
export async function attributeReservationFromLink(input: {
  storeId: string;
  reservationId: string;
  code: string;
}): Promise<boolean> {
  const partner = await db.query.storePartners.findFirst({
    where: activeCode(input.storeId, input.code),
  });
  if (!partner) return false;
  const reservation = await db.query.reservations.findFirst({
    where: and(eq(reservations.storeId, input.storeId), eq(reservations.id, input.reservationId)),
    columns: { isTest: true },
  });
  if (!reservation || reservation.isTest) return false;
  const result = await db
    .insert(partnerBookings)
    .ignore()
    .values({
      storeId: input.storeId,
      reservationId: input.reservationId,
      partnerId: partner.id,
      ...ruleOf(partner),
      origin: "link",
    });
  return result[0].affectedRows > 0;
}

// --- The partner's own page ----------------------------------------------------------

export interface PublicPartnerStatement {
  storeName: string;
  partnerName: string;
  currency: string;
  month: string;
  months: string[];
  totals: PartnerMonthTotals;
  /**
   * The end of each rental, its commission and its state: no reservation
   * number, customer, items or rental amount, which together could point
   * the partner at one family.
   */
  bookings: Pick<PartnerBooking, "endDate" | "commission" | "state">[];
}

/**
 * What a partner reads on its statement page, found by the page's secret:
 * its months, totals and bookings, without anything about the customers.
 * Null for an unknown secret.
 */
export async function getPublicPartnerStatement(
  token: string,
  month?: string,
  now: Date = new Date(),
): Promise<PublicPartnerStatement | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = await db.query.storePartners.findFirst({
    where: eq(storePartners.statementToken, token),
  });
  if (!row) return null;
  const store = await readStore(row.storeId);
  const months = recentMonths(now, store.timezone, PARTNER_STATEMENT_MONTHS);
  const selected = month && months.includes(month) ? month : months[0];
  const statement = await statementFor(row.storeId, row, store, selected, now);
  return {
    storeName: store.name,
    partnerName: row.name,
    currency: store.currency,
    month: selected,
    months,
    totals: statement.totals,
    bookings: statement.bookings.map((booking) => ({
      endDate: booking.endDate,
      commission: booking.commission,
      state: booking.state,
    })),
  };
}
