import { randomBytes, timingSafeEqual } from "node:crypto";

import {
  apiAgentGrants,
  apiHandoffs,
  apiKeys,
  db,
  lockStoreRow,
  storeMembers,
  stores,
} from "@louez/db";
import { hasPermission, type MemberRole } from "@louez/utils";
import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { createDashboardUrl } from "../adapters/stripe-connect";
import {
  HANDOFF_TTL_HOURS,
  handoffErrors,
  handoffFailureMessage,
  type HandoffKind,
  type HandoffLink,
  type HandoffStatus,
  type HandoffView,
} from "../contracts/handoffs";
import { isApiError, platformErrors } from "../platform/errors";
import { sha256 } from "../platform/hash";
import { dashboardPageLinks, type DashboardLinkStore } from "../platform/links";
import type { ApiPorts, UrlsPort } from "../platform/ports";
import type { ApiDomain } from "../platform/permissions";
import { startConnectOnboarding, syncConnectStatus, type ConnectStore } from "./stripe-connect";

/**
 * Handoffs: a step only the human can take, started by an agent (plan,
 * section 7). The agent gets a link to a Louez page (`/handoffs/<token>`);
 * the page makes the user sign in as the user the link was made for, checks
 * they may still do it in this store, and on their click sends them to the
 * provider. The provider comes back to `/handoffs/<id>/return/<state>`,
 * where the state proves the return belongs to that click. The agent reads
 * the handoff (`handoffs.get`) until it is completed.
 *
 * The link's secret is stored hashed. Asking again for the same kind while
 * one is active gives the same handoff a new link, and the old link stops
 * working. One active handoff per store and kind.
 */

const HOUR_MS = 3_600_000;
const TTL_MS = HANDOFF_TTL_HOURS * HOUR_MS;
/** An active handoff shows in the inbox this long after its link went out. */
export const HANDOFF_WAIT_MS = HOUR_MS;

/** The domain each kind belongs to: who may read it, and the bundle its tool is in. */
export const HANDOFF_KIND_DOMAINS: Record<HandoffKind, ApiDomain> = {
  stripe_connect_onboarding: "settings",
  stripe_dashboard: "settings",
  billing_card_setup: "billing",
};

/** Who may take the step in the store: the dashboard's own rule for each flow. */
export function mayTakeStep(kind: HandoffKind, role: MemberRole): boolean {
  if (kind === "billing_card_setup") return role === "owner";
  return hasPermission(role, "manage_settings");
}

const PAGES: Record<HandoffKind, `/dashboard${string}`> = {
  stripe_connect_onboarding: "/dashboard/settings/payments",
  stripe_dashboard: "/dashboard/settings/payments",
  billing_card_setup: "/dashboard/settings/billing",
};

type HandoffRow = typeof apiHandoffs.$inferSelect;

/** Who asks for a handoff: the user the link is for, and their connection. */
export interface HandoffRequester {
  storeId: string;
  userId: string;
  credentialKind: string;
  credentialId: string | null;
  clientName: string | null;
}

export function statusOf(row: Pick<HandoffRow, "status" | "expiresAt">, now: Date): HandoffStatus {
  if ((row.status === "pending" || row.status === "opened") && row.expiresAt <= now) {
    return "expired";
  }
  return row.status;
}

const SUMMARIES: Record<HandoffKind, Record<HandoffStatus, string>> = {
  stripe_connect_onboarding: {
    pending: "The link to connect Stripe is waiting for the user to open it.",
    opened: "The user started Stripe's identity checks and has not finished them yet.",
    completed: "The user finished Stripe's onboarding.",
    expired: "The link to connect Stripe expired before the user finished: ask for a new one.",
    failed: "Connecting Stripe failed.",
  },
  stripe_dashboard: {
    pending: "The link to Stripe's dashboard is waiting for the user to open it.",
    opened: "The user is on their way to Stripe's dashboard.",
    completed: "The user opened Stripe's dashboard.",
    expired: "The link to Stripe's dashboard expired: ask for a new one.",
    failed: "Opening Stripe's dashboard failed.",
  },
  billing_card_setup: {
    pending: "The link to add the billing card is waiting for the user to open it.",
    opened: "The user is adding the billing card on Stripe and has not finished yet.",
    completed: "The billing card is saved.",
    expired: "The link to add the billing card expired: ask for a new one.",
    failed: "Adding the billing card failed.",
  },
};

export function handoffView(
  row: HandoffRow,
  context: { now: Date; urls: UrlsPort; store: DashboardLinkStore },
): HandoffView {
  const status = statusOf(row, context.now);
  return {
    id: row.id,
    kind: row.kind,
    status,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    openedAt: row.openedAt,
    completedAt: row.completedAt,
    failure:
      status === "failed" && row.failureCode
        ? { code: row.failureCode, message: handoffFailureMessage(row.failureCode) }
        : null,
    summary:
      status === "failed" && row.failureCode
        ? `${SUMMARIES[row.kind].failed} ${handoffFailureMessage(row.failureCode)}`
        : SUMMARIES[row.kind][status],
    links: dashboardPageLinks(context.urls, context.store, PAGES[row.kind]),
  };
}

/**
 * The path of the page a link opens. The token is the handoff's id (21
 * characters) then its secret (43), with no dot: the app's proxy takes a
 * path with a dot for a static file.
 */
export const handoffPath = (token: string) => `/handoffs/${encodeURIComponent(token)}`;
/** Where the provider sends the user back, with the state of their click. */
export const handoffReturnPath = (id: string, state: string) => `/handoffs/return/${id}/${state}`;
/** Where Stripe sends the user when its onboarding link expired. */
export const handoffRefreshPath = (id: string, state: string) => `/handoffs/refresh/${id}/${state}`;
/** Where the user lands once back: where the step stands. */
export const handoffDonePath = (id: string) => `/handoffs/done/${encodeURIComponent(id)}`;

const newSecret = () => randomBytes(32).toString("base64url");

const ACTIVE = ["pending", "opened"] as const;

/** No attempt in flight: what a new click, or another user, starts from. */
const NO_ATTEMPT = {
  returnStateHash: null,
  providerRef: null,
  providerCheckAt: null,
  providerChecks: 0,
} as const;

/**
 * The rows a write of one attempt may change: the handoff still active, and
 * that attempt still the current one. A new click replaces the attempt in one
 * statement too, so InnoDB orders the two: once replaced, the old attempt's
 * writes change nothing.
 */
const ofAttempt = (id: string, attempt: string) =>
  and(
    eq(apiHandoffs.id, id),
    eq(apiHandoffs.returnStateHash, attempt),
    inArray(apiHandoffs.status, [...ACTIVE]),
  );

/** The provider-check lease: 30 seconds, doubling with each check, 5 minutes at most. */
export const HANDOFF_CHECK_LEASE_SECONDS = { min: 30, max: 300 } as const;

/**
 * The lease's end on the database's clock, from the checks made so far. Set
 * before `provider_checks` in the same statement, so it reads the old count.
 */
const leaseEnd = () =>
  sql`NOW(3) + INTERVAL LEAST(${HANDOFF_CHECK_LEASE_SECONDS.min} * POW(2, LEAST(${apiHandoffs.providerChecks}, 4)), ${HANDOFF_CHECK_LEASE_SECONDS.max}) SECOND`;

/**
 * Gives the store an active handoff of `kind` with a new link: the one it
 * has (its old link stops working, and an expired one runs again), or a new
 * one. Serialized per store by the store row's lock. The link is bound to
 * the requester's user; a different user asking starts the step over.
 */
export async function issueHandoff(
  requester: HandoffRequester,
  kind: HandoffKind,
  context: { urls: UrlsPort; now?: Date },
): Promise<HandoffLink> {
  const now = context.now ?? new Date();
  const secret = newSecret();
  const tokenHash = sha256(secret);
  const expiresAt = new Date(now.getTime() + TTL_MS);
  const credential = {
    userId: requester.userId,
    credentialKind: requester.credentialKind,
    credentialId: requester.credentialId,
    clientName: requester.clientName,
  };

  const row = await db.transaction(async (tx) => {
    if (!(await lockStoreRow(tx, requester.storeId))) throw platformErrors.noStore();
    const [active] = await tx
      .select()
      .from(apiHandoffs)
      .where(
        and(
          eq(apiHandoffs.storeId, requester.storeId),
          eq(apiHandoffs.kind, kind),
          eq(apiHandoffs.activeSlot, 1),
        ),
      )
      .for("update");
    if (active) {
      const sameUser = active.userId === requester.userId;
      await tx
        .update(apiHandoffs)
        .set({
          ...credential,
          tokenHash,
          linkIssuedAt: now,
          expiresAt,
          // Another user starts over: the click in flight was not theirs.
          ...(sameUser ? {} : { status: "pending", openedAt: null, ...NO_ATTEMPT }),
          updatedAt: now,
        })
        .where(eq(apiHandoffs.id, active.id));
      const [updated] = await tx.select().from(apiHandoffs).where(eq(apiHandoffs.id, active.id));
      return updated;
    }
    const [created] = await tx
      .insert(apiHandoffs)
      .values({
        storeId: requester.storeId,
        kind,
        status: "pending",
        activeSlot: 1,
        ...credential,
        tokenHash,
        linkIssuedAt: now,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      })
      .$returningId();
    const [inserted] = await tx.select().from(apiHandoffs).where(eq(apiHandoffs.id, created.id));
    return inserted;
  });
  if (!row) throw platformErrors.noStore();

  return {
    handoff: handoffView(row, { now, urls: context.urls, store: { id: requester.storeId } }),
    url: context.urls.dashboard(handoffPath(`${row.id}${secret}`)),
  };
}

/** A handoff of the store, or HANDOFF_NOT_FOUND (another store's id included). */
export async function getHandoffRow(storeId: string, id: string): Promise<HandoffRow> {
  const [row] = await db
    .select()
    .from(apiHandoffs)
    .where(and(eq(apiHandoffs.id, id), eq(apiHandoffs.storeId, storeId)));
  if (!row) throw handoffErrors.notFound(id);
  return row;
}

/** Which rows an ending may change: the active handoff, or only its attempt and provider flow. */
const toEnd = (id: string, attempt?: { state: string; providerRef?: string }) =>
  attempt
    ? and(
        ofAttempt(id, attempt.state),
        attempt.providerRef ? eq(apiHandoffs.providerRef, attempt.providerRef) : undefined,
      )
    : and(eq(apiHandoffs.id, id), inArray(apiHandoffs.status, [...ACTIVE]));

/**
 * Ends an active handoff as completed; with `attempt`, only while that
 * attempt (and its provider flow) is the current one. False when it changed nothing.
 */
export async function completeHandoff(
  id: string,
  now = new Date(),
  attempt?: { state: string; providerRef?: string },
): Promise<boolean> {
  const [result] = await db
    .update(apiHandoffs)
    .set({ status: "completed", completedAt: now, activeSlot: null, updatedAt: now })
    .where(toEnd(id, attempt));
  return result.affectedRows > 0;
}

/** Ends an active handoff as failed, with a code from `handoffFailureMessage`; `attempt` as above. */
export async function failHandoff(
  id: string,
  code: string,
  now = new Date(),
  attempt?: { state: string },
): Promise<void> {
  await db
    .update(apiHandoffs)
    .set({
      status: "failed",
      failedAt: now,
      failureCode: code,
      activeSlot: null,
      updatedAt: now,
    })
    .where(toEnd(id, attempt));
}

/**
 * Ends the active handoffs a revoked connection asked for: its links stop
 * working at once, and the step may be asked for again.
 */
export async function failCredentialHandoffs(
  credential: { kind: "api_key" | "oauth"; id: string },
  now = new Date(),
): Promise<void> {
  await db
    .update(apiHandoffs)
    .set({
      status: "failed",
      failedAt: now,
      failureCode: "connection_revoked",
      activeSlot: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(apiHandoffs.credentialKind, credential.kind),
        eq(apiHandoffs.credentialId, credential.id),
        inArray(apiHandoffs.status, [...ACTIVE]),
      ),
    );
}

/**
 * Completes the store's active handoff of `kind`, if any: for a provider
 * event that says the step is done (Stripe's `account.updated`).
 */
export async function completeActiveHandoff(
  storeId: string,
  kind: HandoffKind,
  now = new Date(),
): Promise<void> {
  await db
    .update(apiHandoffs)
    .set({ status: "completed", completedAt: now, activeSlot: null, updatedAt: now })
    .where(
      and(
        eq(apiHandoffs.storeId, storeId),
        eq(apiHandoffs.kind, kind),
        eq(apiHandoffs.activeSlot, 1),
      ),
    );
}

// --- The user's side ---------------------------------------------------------

/** Why the page refuses a link or a return. */
export type HandoffRefusal =
  /** No such link, or a link replaced by a newer one. */
  | "invalid"
  | "expired"
  /** Completed or failed already. */
  | "finished"
  /** Signed in as someone else than the user the link is for. */
  | "other_user"
  /** The user may not take this step in the store now. */
  | "not_allowed";

export type HandoffCheck =
  | { ok: true; row: HandoffRow; store: { id: string; name: string } }
  | { ok: false; reason: HandoffRefusal; row: HandoffRow | null };

const TOKEN_PATTERN = /^([A-Za-z0-9_-]{21})([A-Za-z0-9_-]{43})$/;

function sameHash(stored: string | null, value: string): boolean {
  if (!stored) return false;
  const a = Buffer.from(stored, "hex");
  const b = Buffer.from(sha256(value), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The row a link names, when its secret is the current one. */
async function rowOfToken(token: string) {
  const match = TOKEN_PATTERN.exec(token);
  if (!match) return null;
  const [, id = "", secret = ""] = match;
  const [row] = await db
    .select()
    .from(apiHandoffs)
    .where(and(eq(apiHandoffs.id, id), eq(apiHandoffs.tokenHash, sha256(secret))));
  return row ?? null;
}

/** Whether the connection that asked for the step still exists: a revoked agent's link stops. */
async function connectionAlive(row: HandoffRow): Promise<boolean> {
  if (!row.credentialId) return row.credentialKind === "session";
  if (row.credentialKind === "api_key") {
    const [key] = await db
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(and(eq(apiKeys.id, row.credentialId), isNull(apiKeys.revokedAt)));
    return key !== undefined;
  }
  if (row.credentialKind === "oauth") {
    const [grant] = await db
      .select({ id: apiAgentGrants.id })
      .from(apiAgentGrants)
      .where(eq(apiAgentGrants.id, row.credentialId));
    return grant !== undefined;
  }
  return false;
}

/**
 * Whether `userId` may take the step of `row` now: the link's user, still
 * allowed in the store, for a connection that still exists.
 */
async function checkUser(row: HandoffRow, userId: string): Promise<HandoffCheck> {
  if (row.userId !== userId) return { ok: false, reason: "other_user", row };
  if (!(await connectionAlive(row))) return { ok: false, reason: "invalid", row };
  const [member] = await db
    .select({ role: storeMembers.role, storeName: stores.name })
    .from(storeMembers)
    .innerJoin(stores, eq(stores.id, storeMembers.storeId))
    .where(and(eq(storeMembers.storeId, row.storeId), eq(storeMembers.userId, userId)));
  if (!member || !mayTakeStep(row.kind, member.role)) {
    return { ok: false, reason: "not_allowed", row };
  }
  return { ok: true, row, store: { id: row.storeId, name: member.storeName } };
}

/** The link as the page shows it before the user continues. Changes nothing. */
export async function readHandoffLink(
  token: string,
  userId: string,
  now = new Date(),
): Promise<HandoffCheck> {
  const row = await rowOfToken(token);
  if (!row) return { ok: false, reason: "invalid", row: null };
  const status = statusOf(row, now);
  if (status === "completed" || status === "failed") return { ok: false, reason: "finished", row };
  if (status === "expired") return { ok: false, reason: "expired", row };
  return checkUser(row, userId);
}

/**
 * The user continues to the provider: the handoff is opened with a new
 * attempt, a fresh state the provider's return must carry. A link continued
 * twice gives a new attempt each time: the earlier one's provider flow and
 * lease are dropped, and only the latest attempt's return counts.
 */
export async function continueHandoff(
  token: string,
  userId: string,
  now = new Date(),
): Promise<HandoffCheck & { state?: string }> {
  const checked = await readHandoffLink(token, userId, now);
  if (!checked.ok) return checked;
  const state = newSecret();
  const updated = await db
    .update(apiHandoffs)
    .set({
      status: "opened",
      openedAt: checked.row.openedAt ?? now,
      ...NO_ATTEMPT,
      returnStateHash: sha256(state),
      updatedAt: now,
    })
    .where(
      and(
        eq(apiHandoffs.id, checked.row.id),
        eq(apiHandoffs.tokenHash, checked.row.tokenHash),
        inArray(apiHandoffs.status, [...ACTIVE]),
      ),
    );
  if (updated[0].affectedRows === 0) return { ok: false, reason: "invalid", row: null };
  const [row] = await db.select().from(apiHandoffs).where(eq(apiHandoffs.id, checked.row.id));
  return { ...checked, row: row ?? checked.row, state };
}

/**
 * The provider's return: the state must be the latest click's, and the user
 * the link's, still allowed. A finished handoff passes, so a reload of the
 * return page shows where it stands.
 */
export async function checkHandoffReturn(
  id: string,
  state: string,
  userId: string,
): Promise<HandoffCheck> {
  if (!/^[A-Za-z0-9_-]{21}$/.test(id) || !/^[A-Za-z0-9_-]{43}$/.test(state)) {
    return { ok: false, reason: "invalid", row: null };
  }
  const [row] = await db.select().from(apiHandoffs).where(eq(apiHandoffs.id, id));
  if (!row || !sameHash(row.returnStateHash, state)) {
    return { ok: false, reason: "invalid", row: null };
  }
  return checkUser(row, userId);
}

/** The handoff the done page shows: only to the user it is for, still allowed. */
export async function readHandoffForUser(id: string, userId: string): Promise<HandoffCheck> {
  if (!/^[A-Za-z0-9_-]{21}$/.test(id)) return { ok: false, reason: "invalid", row: null };
  const [row] = await db.select().from(apiHandoffs).where(eq(apiHandoffs.id, id));
  if (!row) return { ok: false, reason: "invalid", row: null };
  return checkUser(row, userId);
}

// --- The provider's side -----------------------------------------------------

/** What the provider flows take from the app. */
export type HandoffPorts = Pick<ApiPorts, "urls" | "stripeConnect" | "billing">;

/** Where the page sends the user next: the provider, or the return page. */
export type HandoffLaunch =
  | { ok: true; redirect: string }
  | { ok: false; failure: string; retryable: boolean };

const CONNECT_COLUMNS = {
  id: stores.id,
  userId: stores.userId,
  name: stores.name,
  slug: stores.slug,
  description: stores.description,
  email: stores.email,
  phone: stores.phone,
  settings: stores.settings,
  stripeAccountId: stores.stripeAccountId,
  stripeChargesEnabled: stores.stripeChargesEnabled,
} as const;

async function connectStore(storeId: string): Promise<ConnectStore | null> {
  const [store] = await db.select(CONNECT_COLUMNS).from(stores).where(eq(stores.id, storeId));
  return store ?? null;
}

const codeOf = (error: unknown) => (isApiError(error) ? error.data.code : null);

/**
 * Sends the user who continued `row` (with `state`) to the provider. A step
 * that turns out done already (Stripe chargeable) completes and goes to the
 * return page. A failure ends the handoff as failed, except a provider that
 * did not answer: the user may try again with the same link.
 */
export async function launchHandoff(input: {
  row: HandoffRow;
  state: string;
  userId: string;
  locale: string;
  ports: HandoffPorts;
  now?: Date;
}): Promise<HandoffLaunch> {
  const { row, state, ports } = input;
  const now = input.now ?? new Date();
  const returnUrl = ports.urls.dashboard(handoffReturnPath(row.id, state));
  const attempt = { state: sha256(state) };
  const fail = async (code: string): Promise<HandoffLaunch> => {
    await failHandoff(row.id, code, now, attempt);
    return { ok: false, failure: code, retryable: false };
  };

  if (row.kind === "billing_card_setup") {
    const started = await ports.billing?.startCardSetup({
      storeId: row.storeId,
      userId: input.userId,
      locale: input.locale,
      returnUrl,
    });
    if (!started) return fail("not_available");
    if (started.ok) return { ok: true, redirect: started.url };
    if (started.reason === "unavailable") return fail("not_available");
    return { ok: false, failure: "provider_failed", retryable: true };
  }

  const client = ports.stripeConnect?.() ?? null;
  const store = await connectStore(row.storeId);
  if (!client || !store) return fail("not_available");

  if (row.kind === "stripe_dashboard") {
    if (!store.stripeAccountId) return fail("not_available");
    try {
      const url = await createDashboardUrl(client, store.stripeAccountId);
      await completeHandoff(row.id, now, attempt);
      return { ok: true, redirect: url };
    } catch (error) {
      console.error("Stripe dashboard link failed:", error);
      return { ok: false, failure: "provider_failed", retryable: true };
    }
  }

  if (store.stripeAccountId && store.stripeChargesEnabled) {
    await completeHandoff(row.id, now, attempt);
    return { ok: true, redirect: returnUrl };
  }
  try {
    const { url } = await startConnectOnboarding({
      client,
      store,
      urls: ports.urls,
      returnUrl,
      refreshUrl: ports.urls.dashboard(handoffRefreshPath(row.id, state)),
    });
    return { ok: true, redirect: url };
  } catch (error) {
    if (codeOf(error) === "STRIPE_UNAVAILABLE") {
      return { ok: false, failure: "provider_failed", retryable: true };
    }
    if (codeOf(error) === "STORE_EMAIL_REQUIRED") return fail("store_email_required");
    return fail("not_available");
  }
}

/** Where the return page stands once the provider sent the user back. */
export type HandoffReturn = { done: boolean };

/**
 * Claims the attempt for a provider call, in one statement: it must still be
 * the current attempt of an active handoff. It takes the provider-check lease
 * (polls back off) and records the provider's flow of this attempt.
 */
async function claimAttempt(
  id: string,
  attempt: string,
  providerRef?: string,
  now = new Date(),
): Promise<boolean> {
  const [result] = await db
    .update(apiHandoffs)
    .set({
      ...(providerRef ? { providerRef } : {}),
      providerCheckAt: leaseEnd(),
      providerChecks: sql`${apiHandoffs.providerChecks} + 1`,
      updatedAt: now,
    })
    .where(ofAttempt(id, attempt));
  return result.affectedRows > 0;
}

/** Whether the handoff is completed now, whoever completed it. */
async function isCompleted(id: string): Promise<boolean> {
  const [row] = await db
    .select({ status: apiHandoffs.status })
    .from(apiHandoffs)
    .where(eq(apiHandoffs.id, id));
  return row?.status === "completed";
}

/**
 * The provider sent the user back from the attempt `state` names. The
 * attempt is claimed before any provider call, and every write after is
 * conditioned on it: a newer click in between makes them change nothing.
 * Stripe's onboarding: the account is read again and the store's columns
 * written (the dashboard's callback does the same); the step is done once
 * the details are submitted, even while Stripe still reviews them. The
 * billing card: `checkoutSessionId` is Stripe Checkout's session, saved now;
 * without it the user cancelled.
 */
export async function finishHandoffReturn(input: {
  row: HandoffRow;
  state: string;
  ports: HandoffPorts;
  checkoutSessionId: string | null;
  now?: Date;
}): Promise<HandoffReturn> {
  const { row, ports } = input;
  const now = input.now ?? new Date();
  const attempt = sha256(input.state);
  if (row.status === "completed") return { done: true };
  if (row.status === "failed") return { done: false };

  if (row.kind === "billing_card_setup") {
    const checkoutSessionId = input.checkoutSessionId;
    if (!checkoutSessionId || !ports.billing) return { done: false };
    if (!(await claimAttempt(row.id, attempt, checkoutSessionId, now))) {
      return { done: await isCompleted(row.id) };
    }
    const outcome = await ports.billing.finishCardSetup({
      storeId: row.storeId,
      checkoutSessionId,
    });
    if (outcome !== "refreshed") return { done: false };
    await completeHandoff(row.id, now, { state: attempt, providerRef: checkoutSessionId });
    return { done: await isCompleted(row.id) };
  }

  if (row.kind === "stripe_connect_onboarding") {
    const client = ports.stripeConnect?.() ?? null;
    const store = await connectStore(row.storeId);
    if (!client || !store?.stripeAccountId) return { done: false };
    if (!(await claimAttempt(row.id, attempt, undefined, now))) {
      return { done: await isCompleted(row.id) };
    }
    try {
      const status = await syncConnectStatus({
        client,
        storeId: store.id,
        accountId: store.stripeAccountId,
      });
      if (status.detailsSubmitted) await completeHandoff(row.id, now, { state: attempt });
      return { done: await isCompleted(row.id) };
    } catch {
      return { done: false };
    }
  }
  return { done: false };
}

/**
 * Stripe's onboarding link expired while the user was on it: a new one for
 * the same account, back to the same return. Null when there is none to give.
 */
export async function refreshHandoffOnboarding(input: {
  row: HandoffRow;
  state: string;
  ports: HandoffPorts;
}): Promise<string | null> {
  const { row, state, ports } = input;
  if (row.kind !== "stripe_connect_onboarding" || statusOf(row, new Date()) !== "opened") {
    return null;
  }
  const client = ports.stripeConnect?.() ?? null;
  const store = await connectStore(row.storeId);
  if (!client || !store) return null;
  try {
    const { url } = await startConnectOnboarding({
      client,
      store,
      urls: ports.urls,
      returnUrl: ports.urls.dashboard(handoffReturnPath(row.id, state)),
      refreshUrl: ports.urls.dashboard(handoffRefreshPath(row.id, state)),
    });
    return url;
  } catch {
    return null;
  }
}

/**
 * A billing card handoff the user came back from while Stripe had not
 * confirmed the card: asks the billing service again (it saves the card at
 * most once), so `handoffs.get` sees it complete without another visit. At
 * most one check per lease, taken in one statement on the database's clock:
 * concurrent polls, and polls within the lease, read the stored status. None
 * once the link expired, and only for the current attempt's own Checkout.
 */
export async function settlePendingCardSetup(
  row: HandoffRow,
  ports: HandoffPorts,
  now = new Date(),
): Promise<HandoffRow> {
  const { returnStateHash: attempt, providerRef } = row;
  if (
    row.kind !== "billing_card_setup" ||
    row.status !== "opened" ||
    !attempt ||
    !providerRef ||
    !ports.billing
  ) {
    return row;
  }
  const [lease] = await db
    .update(apiHandoffs)
    .set({
      providerCheckAt: leaseEnd(),
      providerChecks: sql`${apiHandoffs.providerChecks} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        ofAttempt(row.id, attempt),
        eq(apiHandoffs.providerRef, providerRef),
        gt(apiHandoffs.expiresAt, sql`NOW(3)`),
        or(isNull(apiHandoffs.providerCheckAt), lte(apiHandoffs.providerCheckAt, sql`NOW(3)`)),
      ),
    );
  if (lease.affectedRows === 0) return getHandoffRow(row.storeId, row.id);
  try {
    const outcome = await ports.billing.finishCardSetup({
      storeId: row.storeId,
      checkoutSessionId: providerRef,
    });
    if (outcome === "refreshed") {
      await completeHandoff(row.id, now, { state: attempt, providerRef });
    }
  } catch (error) {
    console.error("Billing card check failed:", error);
  }
  return getHandoffRow(row.storeId, row.id);
}

/** Handoffs untouched this long are deleted by the cron. */
export const HANDOFF_RETENTION_DAYS = 90;
const PURGE_BATCH = 500;
const PURGE_BUDGET_MS = 5_000;

/**
 * Deletes the handoffs untouched past the retention, oldest first, in
 * batches on `api_handoffs_updated_idx`, until none is left or the time
 * budget is spent; the next cron run goes on.
 */
export async function purgeHandoffs(
  now = new Date(),
  options: { batch?: number; budgetMs?: number } = {},
): Promise<number> {
  const batch = options.batch ?? PURGE_BATCH;
  const deadline = Date.now() + (options.budgetMs ?? PURGE_BUDGET_MS);
  const before = new Date(now.getTime() - HANDOFF_RETENTION_DAYS * 24 * HOUR_MS);
  let deleted = 0;
  for (;;) {
    const [result] = await db
      .delete(apiHandoffs)
      .where(lte(apiHandoffs.updatedAt, before))
      .orderBy(asc(apiHandoffs.updatedAt))
      .limit(batch);
    deleted += result.affectedRows;
    if (result.affectedRows < batch || Date.now() >= deadline) return deleted;
  }
}
