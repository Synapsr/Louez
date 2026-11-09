import {
  db,
  isDuplicateKeyError,
  markLegacyStore,
  markSetupWrite,
  markStore,
  mergeStoreRow,
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
import { analyticsEventIdentity, enqueueEffects, type ApiEffect } from "../platform/effects";
import { platformErrors } from "../platform/errors";
import { stableStringify } from "../platform/hash";
import type { NewStorePort, NewStoreTerms } from "../platform/ports";
import { setupActorOf, storeCreatedBy } from "../platform/setup-analytics";
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
  | "affiliate_referral"
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
 * nobody, and so does any code when a Klibon affiliate sent the visitor.
 */
export async function resolvePendingReferral(input: {
  userId: string;
  referralCode: string | null;
  /** The Klibon affiliate code the visitor carries (SignupAttribution). */
  affiliateReferral: string | null;
  ignoredOwnedStoreId?: string;
}): Promise<PendingReferral> {
  const { referralCode } = input;
  if (!referralCode) return { referralCode, attribution: null, outcome: "no_cookie" };
  // A store sent by a Klibon affiliate earns the affiliate's commission, not the store
  // referral rewards as well: the affiliate's code wins, and the cookie is spent.
  if (input.affiliateReferral) {
    return { referralCode, attribution: null, outcome: "affiliate_referral" };
  }
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
  /** What the store pays, from the decision its subscription row was written from. */
  pricing: NewStoreTermsView;
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
 *   subscription row the billing code writes (`subscribe`), with the terms
 *   of that same decision;
 * - in the outbox: the welcome AI credits, as many as `welcomeCredits` says
 *   now, and the analytics events (referral attribution, referred reward
 *   when the store got one, store info saved), each with its own id and the
 *   creation's time.
 *
 * The user row is locked first: two creations of one account run one after
 * the other, so the daily cap counts both. A web address taken meanwhile
 * fails on the unique key, as STORE_SLUG_TAKEN. `confirmedPricing` is what
 * the caller confirmed in the preview: terms that changed since (the store
 * created after a billing cutoff the preview came before) roll everything
 * back with STORE_TERMS_CHANGED.
 */
export async function createStore(input: {
  actor: AccountActor;
  store: CreateStoreInput;
  referral: PendingReferral;
  signupOrigin: string | null;
  subscribe: NewStorePort["subscribe"];
  welcomeCredits: number;
  confirmedPricing: NewStoreTermsView | null;
}): Promise<CreatedStore> {
  const { actor, store, referral } = input;
  const { credential } = actor;
  const userId = credential.userId;
  const setupActor = setupActorOf(credential);
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
      // When the creation runs, once it holds the account: its events' time.
      const createdAt = new Date();

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
      // The creation is the store's first setup write; it starts offline.
      await markSetupWrite(tx, storeId, false);

      await tx.insert(storeMembers).values({ storeId, userId, role: "owner" });
      // Both aggregates are marked for every store; the relay never sends the
      // legacy one of a new store (billing contract README §8.3).
      await markStore(tx, storeId);
      await markLegacyStore(tx, storeId);
      const pricing = describeNewStoreTerms(
        await input.subscribe(tx, {
          storeId,
          currency: store.currency,
          referred: Boolean(referredByStoreId),
        }),
      );
      if (
        input.confirmedPricing &&
        stableStringify(pricing) !== stableStringify(input.confirmedPricing)
      ) {
        throw storeErrors.termsChanged();
      }
      const legacyBilled = pricing.billing === "pay_as_you_go";
      const identity = () => analyticsEventIdentity(createdAt);

      const analytics = (
        event: "store_info_saved" | "referral_attribution_resolved" | "referred_reward_granted",
        properties: Record<string, string | number | boolean | null>,
      ): ApiEffect => ({
        type: "store.creationAnalytics",
        payload: {
          ...identity(),
          event,
          ownerUserId: userId,
          transport: actor.transport,
          properties,
        },
      });
      const effects: ApiEffect[] = [];
      if (input.welcomeCredits > 0) {
        effects.push({
          type: "store.welcomeCredits",
          payload: { storeId, credits: input.welcomeCredits },
        });
      }
      effects.push(
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
      );
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
          // Who created it: the setup analytics split stores on it.
          store_created_by: credential.kind === "session" ? "human" : "agent",
          credential_kind: setupActor.credentialKind,
          agent_client: setupActor.agentClient,
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
        pricing,
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

// --- The onboarding's store step on an existing store -------------------------

const targetColumns = {
  id: true,
  userId: true,
  onboardingCompleted: true,
  referredByStoreId: true,
  referredByUserId: true,
} as const;

/**
 * The store the onboarding's store step saves, as the wizard always picked
 * it: the one it edits (the user must own it, or be platform staff), else the
 * active store when it is an incomplete store the user owns, else the user's
 * incomplete store, the one with this web address first. A web address held
 * by another store is refused, unless it is an incomplete store of the user
 * the step then saves. Null: the user has no store to finish, and the step
 * creates one (`stores.create`).
 */
async function onboardingStoreOf(input: {
  actor: AccountActor;
  editingStoreId: string | null;
  activeStoreId: string | null;
  slug: string;
}) {
  const userId = input.actor.credential.userId;
  const ownerOf = async (storeId: string) =>
    Boolean(
      await db.query.storeMembers.findFirst({
        where: and(
          eq(storeMembers.storeId, storeId),
          eq(storeMembers.userId, userId),
          eq(storeMembers.role, "owner"),
        ),
        columns: { id: true },
      }),
    );
  const storeById = (storeId: string) =>
    db.query.stores.findFirst({ where: eq(stores.id, storeId), columns: targetColumns });

  let target: Awaited<ReturnType<typeof storeById>> = undefined;
  if (input.editingStoreId) {
    target = await storeById(input.editingStoreId);
    if (!target || !(input.actor.isPlatformAdmin || (await ownerOf(target.id)))) {
      throw platformErrors.noStore();
    }
  } else if (input.activeStoreId && (await ownerOf(input.activeStoreId))) {
    const active = await storeById(input.activeStoreId);
    if (active && !active.onboardingCompleted) target = active;
  }
  if (!target) {
    const incomplete = await db.query.stores.findMany({
      where: and(eq(stores.userId, userId), eq(stores.onboardingCompleted, false)),
      columns: { ...targetColumns, slug: true },
      orderBy: (columns, { desc }) => [desc(columns.updatedAt)],
    });
    target = incomplete.find((store) => store.slug === input.slug) ?? incomplete[0];
  }

  const holder = await db.query.stores.findFirst({
    where: eq(stores.slug, input.slug),
    columns: targetColumns,
  });
  if (holder) {
    const reusable = holder.userId === userId && holder.onboardingCompleted === false;
    if (!target && reusable) target = holder;
    if (!target || holder.id !== target.id) throw await slugTakenError(input.slug);
  }
  return target ?? null;
}

export interface SavedOnboardingStore {
  /** Null: no store to finish; the step creates one. */
  id: string | null;
  online: boolean;
  /** The request's referral cookie was read for this store: the answer spends it. */
  spendReferral: boolean;
  /** The user saved an incomplete store they own: the page reports the signup to Klibon. */
  ownerSaved: boolean;
  effectIds: string[];
}

/**
 * The onboarding's store step on a store that exists already: an incomplete
 * store of the user (one an agent created included), or the one being
 * edited. Under the store row's lock, in one transaction: the name, the web
 * address, the contact and the place, the country and the currency, the
 * onboarding's default rules where the store has none (settings set since,
 * by the user or an agent, are kept); for an incomplete store not referred
 * yet, the referral attribution and, when Louez's own billing bills it, the
 * referred reward (`rewardReferredStore`); in the outbox, the analytics
 * events (referral attribution, referred reward, store info saved).
 */
export async function saveOnboardingStoreInfo(input: {
  actor: AccountActor;
  store: CreateStoreInput;
  editingStoreId: string | null;
  activeStoreId: string | null;
  referralCode: string | null;
  affiliateReferral: string | null;
  rewardReferredStore: NewStorePort["rewardReferredStore"];
}): Promise<SavedOnboardingStore> {
  const { actor, store } = input;
  const userId = actor.credential.userId;
  const target = await onboardingStoreOf({
    actor,
    editingStoreId: input.editingStoreId,
    activeStoreId: input.activeStoreId,
    slug: store.slug,
  });
  if (!target) {
    return { id: null, online: false, spendReferral: false, ownerSaved: false, effectIds: [] };
  }

  const storeId = target.id;
  const incomplete = target.onboardingCompleted !== true;
  const referral: PendingReferral =
    !incomplete || target.referredByStoreId
      ? { referralCode: null, attribution: null, outcome: "already_attributed" }
      : await resolvePendingReferral({
          userId,
          referralCode: input.referralCode,
          affiliateReferral: input.affiliateReferral,
          ignoredOwnedStoreId: storeId,
        });
  const setupActor = setupActorOf(actor.credential);

  let saved: { result: string[] | undefined } | null;
  try {
    saved = await mergeStoreRow(db, storeId, async ({ settings: current }, tx) => {
      // The slug, settings and referral columns are in the store's billing snapshot.
      await markStore(tx, storeId);
      const rewarded = referral.attribution ? await input.rewardReferredStore(tx, storeId) : false;
      const identity = () => analyticsEventIdentity(new Date());
      const analytics = (
        event: "store_info_saved" | "referral_attribution_resolved" | "referred_reward_granted",
        properties: Record<string, string | number | boolean | null>,
      ): ApiEffect => ({
        type: "store.creationAnalytics",
        payload: {
          ...identity(),
          event,
          ownerUserId: userId,
          transport: actor.transport,
          properties,
        },
      });
      const referrerStoreId = referral.attribution?.referredByStoreId ?? null;
      const effects: ApiEffect[] = [];
      if (incomplete) {
        effects.push(
          analytics("referral_attribution_resolved", {
            placement: "onboarding_store_create",
            referral_attribution_outcome: referral.outcome,
            has_referral_cookie: Boolean(referral.referralCode),
            is_existing_incomplete_store: true,
            referred_store_id: storeId,
            referrer_store_id: referrerStoreId,
            currency: store.currency,
            country: store.country,
          }),
        );
      }
      if (rewarded && referrerStoreId) {
        effects.push(
          analytics("referred_reward_granted", {
            placement: "onboarding_store_create",
            referred_store_id: storeId,
            referrer_store_id: referrerStoreId,
            currency: store.currency,
          }),
        );
      }
      effects.push(
        analytics("store_info_saved", {
          feature: "onboarding",
          surface: "dashboard",
          store_id: storeId,
          is_existing_incomplete_store: incomplete,
          referral_outcome: incomplete ? referral.outcome : null,
          country: store.country,
          currency: store.currency,
          has_address: Boolean(store.address),
          has_coordinates: store.latitude != null && store.longitude != null,
          has_email: Boolean(store.email),
          has_phone: Boolean(store.phone),
          // A human finishing a store an agent may have created.
          store_created_by: await storeCreatedBy(tx, storeId),
          credential_kind: setupActor.credentialKind,
          agent_client: setupActor.agentClient,
        }),
      );
      const effectIds = await enqueueEffects(tx, storeId, effects);

      return {
        set: {
          name: store.name,
          slug: store.slug,
          address: optional(store.address),
          latitude: store.latitude?.toString() || null,
          longitude: store.longitude?.toString() || null,
          email: optional(store.email),
          phone: optional(store.phone),
          referredByUserId: referral.attribution?.referredByUserId ?? target.referredByUserId,
          referredByStoreId: referrerStoreId ?? target.referredByStoreId,
          settings: {
            ...current,
            reservationMode: current?.reservationMode ?? "payment",
            minRentalMinutes: current?.minRentalMinutes ?? 60,
            maxRentalMinutes: current?.maxRentalMinutes ?? null,
            advanceNoticeMinutes: current?.advanceNoticeMinutes ?? 1440,
            turnoverBufferMinutes: current?.turnoverBufferMinutes ?? 0,
            businessHours:
              current?.businessHours?.enabled !== undefined
                ? current.businessHours
                : defaultBusinessHours,
            country: store.country,
            timezone: getTimezoneForCountry(store.country),
            currency: store.currency,
          },
        },
        result: effectIds,
      };
    });
  } catch (error) {
    // Another store took the address since the check.
    if (isDuplicateKeyError(error) && (await takenSlugs([store.slug])).size > 0) {
      throw await slugTakenError(store.slug);
    }
    throw error;
  }
  if (!saved) throw platformErrors.noStore();

  return {
    id: storeId,
    online: !incomplete,
    // Read for this store only when it could still be attributed, as the step always did.
    spendReferral: Boolean(referral.referralCode),
    ownerSaved: incomplete && target.userId === userId,
    effectIds: saved.result ?? [],
  };
}
