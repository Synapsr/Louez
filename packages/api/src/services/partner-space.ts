import {
  db,
  partnerBookings,
  partnerPayouts,
  promoCodes,
  reservations,
  storePartners,
} from "@louez/db";
import { roundToMinorUnit } from "@louez/utils";
import { and, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";

import {
  PARTNER_STATEMENT_MONTHS,
  type PartnerBooking,
  type PartnerCommissionType,
  type PartnerMonthTotals,
  type PartnerNotifications,
} from "../contracts/partners";
import { enqueueEffects } from "../platform/effects";
import { monthRange, monthTotals, recentMonths } from "./partner-commission";
import {
  getPartnerSettings,
  partnerNotifyEmail,
  partnerStatementFor,
  readPartnerBookings,
  readPartnerPayouts,
  readPartnerStore,
  type PartnerStore,
} from "./partners";

/**
 * The partner's side of Liens partenaires (docs/product/liens-partenaires.md):
 * its own space, opened by a secret link without an account, the e-mails it
 * gets, and the months its store still owes it. Nothing here names a
 * customer: a booking is its dates, its commission and its state.
 */

type PartnerRow = typeof storePartners.$inferSelect;

/** What a partner sees of one booking: no number, customer, items or rental amount. */
export type PartnerSpaceBooking = Pick<PartnerBooking, "endDate" | "commission" | "state">;

/** One line of the space's recent activity. */
export type PartnerSpaceActivity =
  | {
      kind: "booking";
      at: Date;
      endDate: Date;
      commission: number;
      state: PartnerBooking["state"];
    }
  | { kind: "payout"; at: Date; month: string; amount: number };

export interface PartnerSpace {
  store: { name: string; slug: string; logoUrl: string | null };
  partner: {
    name: string;
    code: string;
    rule: { type: PartnerCommissionType; value: number };
    /** The promo code its customers get through its link, if any. */
    perkCode: string | null;
    archived: boolean;
  };
  currency: string;
  attributionDays: number;
  /** Every booking and payment so far. */
  overview: {
    /** Commissions of rentals still to come. */
    upcoming: number;
    /** Commissions due and not paid yet, every month together. */
    toReceive: number;
    /** What the store marked paid, every month together. */
    received: number;
    bookings: number;
  };
  /** The latest bookings credited and payments, the newest first. */
  activity: PartnerSpaceActivity[];
  months: string[];
  month: string;
  totals: PartnerMonthTotals;
  bookings: PartnerSpaceBooking[];
  notifications: PartnerNotifications;
}

const ACTIVITY_LIMIT = 8;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

async function findByToken(token: string): Promise<PartnerRow | null> {
  if (!TOKEN.test(token)) return null;
  const row = await db.query.storePartners.findFirst({
    where: eq(storePartners.statementToken, token),
  });
  return row ?? null;
}

const notificationsOf = (row: PartnerRow): PartnerNotifications => ({
  email: partnerNotifyEmail(row),
  bookings: row.notifyBookings,
  payouts: row.notifyPayouts,
  statements: row.notifyStatements,
});

/**
 * A partner's space, found by its secret: where it stands over all its
 * bookings, its recent activity, a month's detail (the current one by
 * default) and its e-mail settings. Null for an unknown secret.
 */
export async function getPartnerSpace(
  token: string,
  month?: string,
  now: Date = new Date(),
): Promise<PartnerSpace | null> {
  const row = await findByToken(token);
  if (!row) return null;
  const store = await readPartnerStore(row.storeId);
  const months = recentMonths(now, store.timezone, PARTNER_STATEMENT_MONTHS);
  const selected = month && months.includes(month) ? month : months[0];
  const [statement, all, payouts, settings, perk] = await Promise.all([
    partnerStatementFor(row.storeId, row, store, selected, now),
    readPartnerBookings({
      storeId: row.storeId,
      partnerIds: [row.id],
      currency: store.currency,
      now,
    }),
    readPartnerPayouts(row.storeId, [row.id]),
    getPartnerSettings(row.storeId),
    row.promoCodeId
      ? db
          .select({ code: promoCodes.code })
          .from(promoCodes)
          .where(
            and(
              eq(promoCodes.id, row.promoCodeId),
              eq(promoCodes.storeId, row.storeId),
              eq(promoCodes.isActive, true),
            ),
          )
          .then(([promo]) => promo?.code ?? null)
      : null,
  ]);

  const sum = (values: number[]) =>
    roundToMinorUnit(
      values.reduce((total, value) => total + value, 0),
      store.currency,
    );
  const due = sum(all.filter((b) => b.state === "due").map((b) => b.commission));
  const received = sum(payouts.map((payout) => payout.amount));
  const activity: PartnerSpaceActivity[] = [
    ...all.map(
      (booking): PartnerSpaceActivity => ({
        kind: "booking",
        at: booking.creditedAt,
        endDate: booking.endDate,
        commission: booking.commission,
        state: booking.state,
      }),
    ),
    ...payouts.map(
      (payout): PartnerSpaceActivity => ({
        kind: "payout",
        at: payout.paidAt,
        month: payout.month,
        amount: payout.amount,
      }),
    ),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, ACTIVITY_LIMIT);

  return {
    store: { name: store.name, slug: store.slug, logoUrl: store.logoUrl },
    partner: {
      name: row.name,
      code: row.code,
      rule: { type: row.commissionType, value: Number(row.commissionValue) },
      perkCode: perk,
      archived: row.archivedAt !== null,
    },
    currency: store.currency,
    attributionDays: settings.attributionDays,
    overview: {
      upcoming: sum(all.filter((b) => b.state === "upcoming").map((b) => b.commission)),
      toReceive: Math.max(0, sum([due, -received])),
      received,
      bookings: all.filter((b) => b.state !== "cancelled").length,
    },
    activity,
    months,
    month: selected,
    totals: statement.totals,
    bookings: statement.bookings.map((booking) => ({
      endDate: booking.endDate,
      commission: booking.commission,
      state: booking.state,
    })),
    notifications: notificationsOf(row),
  };
}

/**
 * The partner's own e-mail settings, from its space. False for an unknown
 * secret. An address equal to the store's contact for it is kept as "the
 * contact's", so a later change of contact follows.
 */
export async function updatePartnerNotifications(
  token: string,
  notifications: PartnerNotifications,
): Promise<boolean> {
  const row = await findByToken(token);
  if (!row) return false;
  const email =
    notifications.email && notifications.email !== row.contactEmail ? notifications.email : null;
  await db
    .update(storePartners)
    .set({
      notifyEmail: email,
      notifyBookings: notifications.bookings,
      notifyPayouts: notifications.payouts,
      notifyStatements: notifications.statements,
      updatedAt: new Date(),
    })
    .where(eq(storePartners.id, row.id));
  return true;
}

// --- What the e-mails read when they go out --------------------------------------------

interface NoticeBase {
  to: string;
  store: PartnerStore;
  partnerName: string;
  /** The space's secret, for its link. */
  token: string;
}

async function readNoticeBase(
  partnerId: string,
  kind: "bookings" | "payouts" | "statements",
): Promise<{ row: PartnerRow; base: NoticeBase } | { skipped: string }> {
  const row = await db.query.storePartners.findFirst({ where: eq(storePartners.id, partnerId) });
  if (!row) return { skipped: "partner_gone" };
  const wanted =
    kind === "bookings"
      ? row.notifyBookings
      : kind === "payouts"
        ? row.notifyPayouts
        : row.notifyStatements;
  if (!wanted) return { skipped: "partner_opted_out" };
  const to = partnerNotifyEmail(row);
  if (!to) return { skipped: "partner_no_email" };
  return {
    row,
    base: {
      to,
      store: await readPartnerStore(row.storeId),
      partnerName: row.name,
      token: row.statementToken,
    },
  };
}

export type PartnerBookingNotice = NoticeBase & { booking: PartnerSpaceBooking };

/** A credited booking's e-mail, read when it goes out: nothing once it is no longer the partner's. */
export async function readPartnerBookingNotice(
  partnerId: string,
  reservationId: string,
  now: Date = new Date(),
): Promise<PartnerBookingNotice | { skipped: string }> {
  const found = await readNoticeBase(partnerId, "bookings");
  if ("skipped" in found) return found;
  const [booking] = (
    await readPartnerBookings({
      storeId: found.row.storeId,
      partnerIds: [partnerId],
      currency: found.base.store.currency,
      now,
    })
  ).filter((candidate) => candidate.reservationId === reservationId);
  if (!booking) return { skipped: "booking_not_partner" };
  if (booking.state === "cancelled") return { skipped: "booking_cancelled" };
  return {
    ...found.base,
    booking: { endDate: booking.endDate, commission: booking.commission, state: booking.state },
  };
}

export type PartnerPayoutNotice = NoticeBase & { month: string; amount: number };

/** A payment's e-mail, read when it goes out: nothing once the store cancelled it. */
export async function readPartnerPayoutNotice(
  partnerId: string,
  payoutId: string,
): Promise<PartnerPayoutNotice | { skipped: string }> {
  const found = await readNoticeBase(partnerId, "payouts");
  if ("skipped" in found) return found;
  const [payout] = await db
    .select({ month: partnerPayouts.month, amount: partnerPayouts.amount })
    .from(partnerPayouts)
    .where(and(eq(partnerPayouts.id, payoutId), eq(partnerPayouts.partnerId, partnerId)));
  if (!payout) return { skipped: "payout_cancelled" };
  return { ...found.base, month: payout.month, amount: Number(payout.amount) };
}

export type PartnerStatementNotice = NoticeBase & { month: string; totals: PartnerMonthTotals };

/** A month's statement e-mail, read when it goes out. */
export async function readPartnerStatementNotice(
  partnerId: string,
  month: string,
  now: Date = new Date(),
): Promise<PartnerStatementNotice | { skipped: string }> {
  const found = await readNoticeBase(partnerId, "statements");
  if ("skipped" in found) return found;
  const statement = await partnerStatementFor(
    found.row.storeId,
    found.row,
    found.base.store,
    month,
    now,
  );
  if (statement.totals.bookings === 0) return { skipped: "statement_empty" };
  return { ...found.base, month, totals: statement.totals };
}

// --- The monthly statements ---------------------------------------------------------------

/**
 * Queues the statement e-mail of the month that ended for each partner who
 * wants it and had bookings ending in it, once: the partner keeps the month
 * it was queued for. Run by the cron; returns the effects to dispatch.
 */
export async function queueMonthlyPartnerStatements(
  now: Date = new Date(),
  limit = 200,
): Promise<string[]> {
  // Partners already done for last month (in UTC) stay out of the batch, so
  // they never crowd out the others; a store's own month is checked below.
  const [, utcPrevious] = recentMonths(now, "UTC", 2);
  const candidates = await db
    .select({ id: storePartners.id, storeId: storePartners.storeId })
    .from(storePartners)
    .where(
      and(
        isNull(storePartners.archivedAt),
        eq(storePartners.notifyStatements, true),
        or(isNotNull(storePartners.notifyEmail), isNotNull(storePartners.contactEmail)),
        or(
          isNull(storePartners.statementSentMonth),
          lt(storePartners.statementSentMonth, utcPrevious),
        ),
        sql`EXISTS (SELECT 1 FROM ${partnerBookings} WHERE ${partnerBookings.partnerId} = ${storePartners.id})`,
      ),
    )
    .limit(limit);

  const effectIds: string[] = [];
  for (const candidate of candidates) {
    const store = await readPartnerStore(candidate.storeId);
    const [, previous] = recentMonths(now, store.timezone, 2);
    if (!previous) continue;
    const range = monthRange(previous, store.timezone);
    const ids = await db.transaction(async (tx) => {
      // Claimed by this run: a parallel run updates nothing and queues nothing.
      const claimed = await tx
        .update(storePartners)
        .set({ statementSentMonth: previous })
        .where(
          and(
            eq(storePartners.id, candidate.id),
            or(
              isNull(storePartners.statementSentMonth),
              lt(storePartners.statementSentMonth, previous),
            ),
          ),
        );
      if (claimed[0].affectedRows === 0) return [];
      const [ended] = await tx
        .select({ count: sql<number>`COUNT(*)` })
        .from(partnerBookings)
        .innerJoin(reservations, eq(reservations.id, partnerBookings.reservationId))
        .where(
          and(
            eq(partnerBookings.partnerId, candidate.id),
            gte(reservations.endDate, range.start),
            lt(reservations.endDate, range.end),
            eq(reservations.isTest, false),
          ),
        );
      if (!ended || Number(ended.count) === 0) return [];
      return enqueueEffects(tx, candidate.storeId, [
        {
          type: "partner.statementEmail",
          payload: { partnerId: candidate.id, month: previous },
          orderingKey: `partner:${candidate.id}:email`,
        },
      ]);
    });
    effectIds.push(...ids);
  }
  return effectIds;
}

// --- What the store still owes ----------------------------------------------------------------

export interface DuePartnerMonth {
  partnerId: string;
  partnerName: string;
  month: string;
  remaining: number;
  currency: string;
  /** When the month ended, in the store's timezone: the item's date. */
  endedAt: Date;
}

/**
 * The past months (the current one aside) a store owes a partner something
 * for, over the statement months: due commissions not marked paid.
 */
export async function readDuePartnerMonths(
  storeId: string,
  now: Date = new Date(),
): Promise<DuePartnerMonth[]> {
  const partners = await db
    .select({ id: storePartners.id, name: storePartners.name })
    .from(storePartners)
    .where(eq(storePartners.storeId, storeId));
  if (partners.length === 0) return [];
  const store = await readPartnerStore(storeId);
  const months = recentMonths(now, store.timezone, PARTNER_STATEMENT_MONTHS).slice(1);
  const oldest = months.at(-1);
  if (!oldest) return [];
  const range = {
    start: monthRange(oldest, store.timezone).start,
    end: monthRange(months[0], store.timezone).end,
  };
  const ids = partners.map((partner) => partner.id);
  const [bookings, payouts] = await Promise.all([
    readPartnerBookings({ storeId, partnerIds: ids, range, currency: store.currency, now }),
    db
      .select({
        partnerId: partnerPayouts.partnerId,
        month: partnerPayouts.month,
        amount: partnerPayouts.amount,
      })
      .from(partnerPayouts)
      .where(
        and(
          eq(partnerPayouts.storeId, storeId),
          inArray(partnerPayouts.partnerId, ids),
          gte(partnerPayouts.month, oldest),
        ),
      ),
  ]);

  const due: DuePartnerMonth[] = [];
  for (const partner of partners) {
    for (const month of months) {
      const monthRangeOf = monthRange(month, store.timezone);
      const inMonth = bookings.filter(
        (booking) =>
          booking.partnerId === partner.id &&
          booking.endDate >= monthRangeOf.start &&
          booking.endDate < monthRangeOf.end,
      );
      if (inMonth.length === 0) continue;
      const paid = payouts
        .filter((payout) => payout.partnerId === partner.id && payout.month === month)
        .reduce((sum, payout) => sum + Number(payout.amount), 0);
      const totals = monthTotals(inMonth, paid, 0, store.currency);
      if (totals.remaining > 0) {
        due.push({
          partnerId: partner.id,
          partnerName: partner.name,
          month,
          remaining: totals.remaining,
          currency: store.currency,
          endedAt: monthRangeOf.end,
        });
      }
    }
  }
  return due;
}
