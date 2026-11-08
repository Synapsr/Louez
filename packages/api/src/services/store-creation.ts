import {
  db,
  isDuplicateKeyError,
  markLegacyStore,
  markStore,
  storeMembers,
  stores,
  users,
  type Transaction,
} from "@louez/db";
import { generateReferralCode, getTimezoneForCountry, isValidReferralCode } from "@louez/utils";
import { defaultBusinessHours, isReservedSlug, storeInfoSchema } from "@louez/validations";
import { and, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";

import {
  SLUG_SUGGESTION_COUNT,
  STORE_CREATION_DAILY_LIMIT,
  storeErrors,
  type CreateStoreInput,
  type NewStoreTermsView,
} from "../contracts/stores";
import type { AccountActor } from "../platform/actor";
import { enqueueEffects, type ApiEffect } from "../platform/effects";
import { platformErrors } from "../platform/errors";
import type { NewStoreTerms } from "../platform/ports";
import { resolveReferralAttribution, type ReferralAttribution } from "./referral-attribution";

/**
 * A new store, the same for the onboarding and for an agent: its default
 * settings, its owner, its subscription row (pay-as-you-go with the offer for
 * new stores), its referral attribution, its welcome AI credits and its
 * analytics. `stores.create` is the one way in (routers/dashboard/stores.ts).
 */

// --- Web address ------------------------------------------------------------

const slugSchema = storeInfoSchema.shape.slug;

/** A store's web address from any text: lowercase ASCII, digits and single hyphens, 50 at most. */
function toStoreSlug(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
}

/** The addresses among `slugs` that a store already has. */
async function takenSlugs(slugs: readonly string[]): Promise<Set<string>> {
  if (slugs.length === 0) return new Set();
  const rows = await db
    .select({ slug: stores.slug })
    .from(stores)
    .where(inArray(stores.slug, [...slugs]));
  return new Set(rows.map((row) => row.slug));
}

/** Free addresses close to `base`: `base`, then `base-2`, `base-3`… */
async function suggestSlugs(base: string, exclude: string): Promise<string[]> {
  const root = base.length >= 3 ? base : base ? `${base}-shop` : "";
  if (!root) return [];
  const candidates = [root];
  for (let suffix = 2; candidates.length < 12; suffix += 1) {
    const tail = `-${suffix}`;
    candidates.push(`${root.slice(0, 50 - tail.length).replace(/-+$/g, "")}${tail}`);
  }
  const usable = candidates.filter(
    (slug) => slug !== exclude && slugSchema.safeParse(slug).success,
  );
  const taken = await takenSlugs(usable);
  return usable.filter((slug) => !taken.has(slug)).slice(0, SLUG_SUGGESTION_COUNT);
}

/** Whether a store could take this web address now, with free ones close to it when not. */
export async function checkStoreSlug(input: { slug: string }) {
  const slug = input.slug.trim();
  const base = toStoreSlug(slug);
  if (!slugSchema.safeParse(slug).success) {
    return {
      slug,
      available: false,
      reason: isReservedSlug(slug) ? ("reserved" as const) : ("invalid" as const),
      suggestions: await suggestSlugs(base, slug),
    };
  }
  if ((await takenSlugs([slug])).size === 0) {
    return { slug, available: true, reason: null, suggestions: [] };
  }
  return {
    slug,
    available: false,
    reason: "taken" as const,
    suggestions: await suggestSlugs(base, slug),
  };
}

// --- Referral attribution ---------------------------------------------------

export type ReferralAttributionOutcome =
  | "no_cookie"
  | "invalid_code"
  | "existing_owner"
  | "unknown_referrer"
  | "self_referral"
  | "already_attributed"
  | "attributed";

export interface PendingReferral {
  referralCode: string | null;
  attribution: ReferralAttribution | null;
  outcome: ReferralAttributionOutcome;
}

/**
 * Resolves a referral code for a user's new store. Only a user who owns no
 * store yet can be referred (`ignoredOwnedStoreId`: the incomplete store
 * being saved, which does not count); a code of an unknown store, or of one
 * of the user's own stores (self-referral, compared on the owner), refers
 * nobody.
 */
export async function resolvePendingReferral(input: {
  userId: string;
  referralCode: string | null;
  ignoredOwnedStoreId?: string;
}): Promise<PendingReferral> {
  const { referralCode } = input;
  if (!referralCode) return { referralCode, attribution: null, outcome: "no_cookie" };
  if (!isValidReferralCode(referralCode)) {
    return { referralCode, attribution: null, outcome: "invalid_code" };
  }

  const owner = and(eq(storeMembers.userId, input.userId), eq(storeMembers.role, "owner"));
  const ownsAStore = await db.query.storeMembers.findFirst({
    where: input.ignoredOwnedStoreId
      ? and(owner, ne(storeMembers.storeId, input.ignoredOwnedStoreId))
      : owner,
    columns: { id: true },
  });
  if (ownsAStore) return { referralCode, attribution: null, outcome: "existing_owner" };

  const referrer = await db.query.stores.findFirst({
    where: eq(stores.referralCode, referralCode),
    columns: { id: true, userId: true },
  });
  if (!referrer) return { referralCode, attribution: null, outcome: "unknown_referrer" };
  const attribution = resolveReferralAttribution({
    refCode: referralCode,
    referrerStore: referrer,
    currentUserId: input.userId,
  });
  if (!attribution) return { referralCode, attribution: null, outcome: "self_referral" };
  return { referralCode, attribution, outcome: "attributed" };
}

// --- Terms ------------------------------------------------------------------

const decimal = (minor: number) => (minor / 100).toFixed(2);

/** The terms as the preview and the answer show them, with one plain sentence. */
export function describeNewStoreTerms(terms: NewStoreTerms): NewStoreTermsView {
  if (terms.billing === "none") {
    return { billing: "none", summary: "This Louez instance charges no fees." };
  }
  if (terms.billing === "offer") {
    return {
      billing: "offer",
      offer: terms.offer,
      summary: terms.offer
        ? `Louez's offer for new stores applies: ${terms.offer}. The user can see it, or pick a monthly plan instead, on the subscription page.`
        : "Louez's terms for new stores apply. The user can see them, or pick a monthly plan instead, on the subscription page.",
    };
  }
  const currency = terms.currency.toUpperCase();
  const feePerReservation = terms.tiers.map((tier) => ({
    upToReservationsPerMonth: tier.upToCount,
    amount: decimal(tier.priceMinor),
    currency,
  }));
  let from = 1;
  const bands = feePerReservation.map((tier) => {
    const upTo = tier.upToReservationsPerMonth;
    const range =
      upTo === null
        ? from === 1
          ? "every reservation"
          : `reservations beyond ${from - 1}`
        : `reservations ${from} to ${upTo}`;
    from = (upTo ?? 0) + 1;
    return `${tier.amount} ${currency} each for ${range}`;
  });
  return {
    billing: "pay_as_you_go",
    freeReservations: terms.freeReservations,
    feePerReservation,
    summary: `Pay as you go, no subscription: the first ${terms.freeReservations} reservations are free, then a fee per reservation each month (${bands.join(", ")}). The user can switch to a monthly plan on the subscription page.`,
  };
}

// --- Creation ---------------------------------------------------------------

/** The settings a new store starts with, as the onboarding always set them. */
function defaultSettings(input: { country: string; currency: string }) {
  return {
    reservationMode: "payment" as const,
    minRentalMinutes: 60,
    maxRentalMinutes: null,
    advanceNoticeMinutes: 1440,
    turnoverBufferMinutes: 0,
    businessHours: defaultBusinessHours,
    country: input.country,
    timezone: getTimezoneForCountry(input.country),
    currency: input.currency,
  };
}

/** A web address another store took: the error, with free ones close to it. */
export async function slugTakenError(slug: string) {
  return storeErrors.slugTaken(slug, await suggestSlugs(toStoreSlug(slug), slug));
}

/** Refuses a web address another store has. */
export async function assertSlugFree(slug: string): Promise<void> {
  if ((await takenSlugs([slug])).size > 0) throw await slugTakenError(slug);
}

/**
 * The stores the user created in the last 24 hours, counted on the
 * database's clock. Under the user row's lock, so two creations of one
 * account count each other.
 */
async function storesCreatedToday(executor: Transaction | typeof db, userId: string) {
  const [row] = await executor
    .select({ count: sql<number>`COUNT(*)` })
    .from(stores)
    .where(and(eq(stores.userId, userId), gt(stores.createdAt, sql`NOW() - INTERVAL 1 DAY`)));
  return Number(row?.count ?? 0);
}

/**
 * A key or a token creates at most `STORE_CREATION_DAILY_LIMIT` stores per
 * account in 24 hours, whatever made the others; a dashboard session has no
 * cap, as before.
 */
export async function assertUnderCreationLimit(
  actor: AccountActor,
  executor: Transaction | typeof db = db,
): Promise<void> {
  if (actor.credential.kind === "session") return;
  if ((await storesCreatedToday(executor, actor.credential.userId)) >= STORE_CREATION_DAILY_LIMIT) {
    throw storeErrors.creationLimit(STORE_CREATION_DAILY_LIMIT);
  }
}

/** A standalone instance hosts one store: refuses a second one once a store is online. */
export async function assertInstanceTakesAStore(singleStore: boolean): Promise<void> {
  if (!singleStore) return;
  const online = await db.query.stores.findFirst({
    columns: { id: true },
    where: eq(stores.onboardingCompleted, true),
  });
  if (online) throw storeErrors.singleStoreInstance();
}

/** A referral code no store has, tried a few times as the onboarding did. */
async function freeReferralCode(): Promise<string> {
  let code = generateReferralCode();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const taken = await db.query.stores.findFirst({
      where: eq(stores.referralCode, code),
      columns: { id: true },
    });
    if (!taken) break;
    code = generateReferralCode();
  }
  return code;
}

const optional = (value: string | null | undefined) => value || null;

export interface CreatedStore {
  id: string;
  name: string;
  slug: string;
  country: string;
  currency: string;
  timezone: string;
  /** The analytics and credit rows to send once committed (`ports.dispatchEffects`). */
  effectIds: string[];
}

/**
 * Creates a store owned by the actor's user, in one transaction:
 *
 * - the store, with the onboarding's default settings, its country's time
 *   zone, a referral code of its own, the referral attribution and the
 *   user's sign-up origin (the cookie's, recorded on the user when unset);
 * - the owner's membership;
 * - the billing marks of the store and its legacy snapshot, and the
 *   subscription row the billing code writes (`insertSubscription`);
 * - in the outbox: the welcome AI credits and the analytics events
 *   (referral attribution, referred reward when the store got one, store
 *   info saved).
 *
 * The user row is locked first: two creations of one account run one after
 * the other, so the daily cap counts both. A web address taken meanwhile
 * fails on the unique key, as STORE_SLUG_TAKEN.
 */
export async function createStore(input: {
  actor: AccountActor;
  store: CreateStoreInput;
  referral: PendingReferral;
  signupOrigin: string | null;
  insertSubscription: (
    tx: Transaction,
    input: { storeId: string; currency: string; referred: boolean },
  ) => Promise<boolean>;
}): Promise<CreatedStore> {
  const { actor, store, referral } = input;
  const userId = actor.credential.userId;
  const referralCode = await freeReferralCode();
  const settings = defaultSettings(store);
  const referredByStoreId = referral.attribution?.referredByStoreId ?? null;

  try {
    return await db.transaction(async (tx) => {
      const [user] = await tx
        .select({ signupOrigin: users.signupOrigin })
        .from(users)
        .where(eq(users.id, userId))
        .for("update");
      if (!user) throw platformErrors.unauthenticated("This account no longer exists.");
      await assertUnderCreationLimit(actor, tx);

      const signupOrigin = user.signupOrigin ?? input.signupOrigin;
      if (user.signupOrigin === null && input.signupOrigin !== null) {
        await tx
          .update(users)
          .set({ signupOrigin: input.signupOrigin, updatedAt: new Date() })
          .where(and(eq(users.id, userId), isNull(users.signupOrigin)));
      }

      const [created] = await tx
        .insert(stores)
        .values({
          userId,
          name: store.name,
          slug: store.slug,
          address: optional(store.address),
          latitude: store.latitude?.toString() || null,
          longitude: store.longitude?.toString() || null,
          email: optional(store.email),
          phone: optional(store.phone),
          referralCode,
          referredByUserId: referral.attribution?.referredByUserId ?? null,
          referredByStoreId,
          signupOrigin,
          settings,
        })
        .$returningId();
      const storeId = created.id;

      await tx.insert(storeMembers).values({ storeId, userId, role: "owner" });
      // Both aggregates are marked for every store; the relay never sends the
      // legacy one of a new store (billing contract README §8.3).
      await markStore(tx, storeId);
      await markLegacyStore(tx, storeId);
      const legacyBilled = await input.insertSubscription(tx, {
        storeId,
        currency: store.currency,
        referred: Boolean(referredByStoreId),
      });

      const analytics = (
        event: "store_info_saved" | "referral_attribution_resolved" | "referred_reward_granted",
        properties: Record<string, string | number | boolean | null>,
      ): ApiEffect => ({
        type: "store.creationAnalytics",
        payload: { event, ownerUserId: userId, transport: actor.transport, properties },
      });
      const effects: ApiEffect[] = [
        { type: "store.welcomeCredits", payload: { storeId } },
        analytics("referral_attribution_resolved", {
          placement: "onboarding_store_create",
          referral_attribution_outcome: referral.outcome,
          has_referral_cookie: Boolean(referral.referralCode),
          is_existing_incomplete_store: false,
          referred_store_id: storeId,
          referrer_store_id: referredByStoreId,
          currency: store.currency,
          country: store.country,
        }),
      ];
      // The welcome reward is the subscription row's: none without one.
      if (referredByStoreId && legacyBilled) {
        effects.push(
          analytics("referred_reward_granted", {
            placement: "onboarding_store_create",
            referred_store_id: storeId,
            referrer_store_id: referredByStoreId,
            currency: store.currency,
          }),
        );
      }
      effects.push(
        analytics("store_info_saved", {
          feature: "onboarding",
          surface: "dashboard",
          store_id: storeId,
          is_existing_incomplete_store: false,
          referral_outcome: referral.outcome,
          country: store.country,
          currency: store.currency,
          has_address: Boolean(store.address),
          has_coordinates: store.latitude != null && store.longitude != null,
          has_email: Boolean(store.email),
          has_phone: Boolean(store.phone),
        }),
      );
      const effectIds = await enqueueEffects(tx, storeId, effects);

      return {
        id: storeId,
        name: store.name,
        slug: store.slug,
        country: store.country,
        currency: store.currency,
        timezone: settings.timezone,
        effectIds,
      };
    });
  } catch (error) {
    // Another store took the address since the check.
    if (isDuplicateKeyError(error) && (await takenSlugs([store.slug])).size > 0) {
      throw await slugTakenError(store.slug);
    }
    throw error;
  }
}
