import { randomBytes, timingSafeEqual } from "node:crypto";

import {
  apiAgentGrants,
  apiHandoffs,
  apiKeys,
  db,
  lockStoreRow,
  storeMembers,
  stores,
  type ApiApprovalPayload,
  type ApiHandoffPayload,
  type Transaction,
} from "@louez/db";
import { hasPermission, type MemberRole } from "@louez/utils";
import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { createDashboardUrl } from "../adapters/stripe-connect";
import {
  HANDOFF_TTL_HOURS,
  handoffErrors,
  handoffFailureMessage,
  type HandoffDecision,
  type HandoffKind,
  type HandoffLink,
  type HandoffStatus,
  type HandoffView,
  type StepKind,
} from "../contracts/handoffs";
import { mayApprove } from "../platform/approval-rule";
import { databaseNow } from "../platform/database-clock";
import { isApiError, platformErrors, readAfterCommit } from "../platform/errors";
import { sha256 } from "../platform/hash";
import { logProviderError } from "../platform/sanitize-error";
import { dashboardPageLinks, type DashboardLinkStore } from "../platform/links";
import type { ApiPorts, UrlsPort } from "../platform/ports";
import { API_DOMAINS, type ApiDomain, type ProcedureScope } from "../platform/permissions";
import { startConnectOnboarding, syncConnectStatus, type ConnectStore } from "./stripe-connect";

/**
 * Handoffs: a step only the human can take, started by an agent (plan,
 * section 7). The agent gets a link to a Louez page (`/handoffs/<id>`): the
 * id addresses the step and the signed-in session is the credential. The
 * page makes the user sign in as the user the step is for, checks they may
 * still do it in this store, and on their click sends them to the provider.
 * The provider comes back to `/handoffs/return/<id>/<state>`, where the
 * state proves the return belongs to that click. The agent reads the
 * handoff (`handoffs.get`) until it is completed.
 *
 * Asking again for the same kind (and subject) while one is active gives the
 * same handoff, with the same link, a new expiry and its revision raised: a
 * click on a page that showed an earlier revision decides nothing, and the
 * page shows the step again. A link given before links were addressed by id
 * carries a secret after the id; it opens while its hash is the row's
 * current one. One active handoff per store, kind and subject: a
 * store-wide step has an empty subject; a team invitation's is its address's
 * hash, so each address has its own approval. A team invitation has no
 * provider: its page asks an owner to approve or refuse (`handoffs.decide`,
 * services/handoff-decisions.ts), and the row records what they decided.
 */

const HOUR_MS = 3_600_000;
/** An active handoff shows in the inbox this long after its link went out. */
export const HANDOFF_WAIT_MS = HOUR_MS;

/**
 * The domain each kind belongs to: who may read it, and the bundle its tool
 * is in. An operation's approval belongs to its procedure's domain, which
 * its row holds (`approvalPayloadOf`).
 */
export const HANDOFF_KIND_DOMAINS: Record<StepKind, ApiDomain> = {
  stripe_connect_onboarding: "settings",
  stripe_dashboard: "settings",
  billing_card_setup: "billing",
  team_invitation: "team",
};

/**
 * The domain whose read access shows a step: its kind's, or an approval's
 * procedure's. An approval whose row names no domain Louez knows has none:
 * nobody reads it by its domain.
 */
export function handoffDomain(row: Pick<HandoffRow, "kind" | "payload">): ApiDomain | null {
  if (row.kind === "operation_approval") return approvalPayloadOf(row)?.scope.domain ?? null;
  return HANDOFF_KIND_DOMAINS[row.kind];
}

/** What an approval's row carries, its scope read as a procedure's scope. */
export interface ApprovalPayload extends Omit<ApiApprovalPayload, "scope"> {
  scope: ProcedureScope;
}

/**
 * An approval's payload, or null for another kind, or a payload that does
 * not name a domain and a level Louez knows: such a row is decided and read
 * by nobody (`mayActOnStep`, `handoffDomain`).
 */
export function approvalPayloadOf(
  row: Pick<HandoffRow, "kind" | "payload">,
): ApprovalPayload | null {
  if (row.kind !== "operation_approval" || !row.payload || !("scope" in row.payload)) return null;
  const { scope } = row.payload;
  if (
    !(API_DOMAINS as readonly string[]).includes(scope.domain) ||
    (scope.level !== "read" && scope.level !== "write")
  ) {
    return null;
  }
  return row.payload as ApprovalPayload;
}

/**
 * Whether a connection reads an approval: the one that asked for it, while
 * it reads the approval's procedure domain. `handoffs_get` and the inbox
 * give an approval to a connection by this rule alone.
 */
export function connectionReadsApproval(
  credential: { kind: string; id: string | null },
  row: Pick<HandoffRow, "kind" | "payload" | "credentialKind" | "credentialId">,
  reads: (domain: ApiDomain) => boolean,
): boolean {
  if (row.kind !== "operation_approval") return false;
  if (row.credentialKind !== credential.kind || row.credentialId !== credential.id) return false;
  const domain = handoffDomain(row);
  return domain !== null && reads(domain);
}

/**
 * The clock a step's times are read on. An approval's rules date and read
 * its times on the database's clock (services/approvals.ts), so every reader
 * of an approval does too; the other kinds keep the clock they are given,
 * the application's, as before.
 */
export async function stepNow(row: Pick<HandoffRow, "kind">, now: Date): Promise<Date> {
  return row.kind === "operation_approval" ? databaseNow() : now;
}

/** An invitation's payload, or null for another kind. */
export function invitationPayloadOf(
  row: Pick<HandoffRow, "kind" | "payload">,
): ApiHandoffPayload | null {
  if (row.kind !== "team_invitation" || !row.payload || !("email" in row.payload)) return null;
  return row.payload;
}

/** How long a kind gives the person, counted from each request of the step. */
export interface HandoffLifetimes {
  /** The link works this long: to continue to the provider, or to decide on the page. */
  actMs: number;
  /** Once a person approved: how long the agent has to carry it out (an operation's approval). */
  executeMs?: number;
}

/** An operation's approval: a day to decide, counted from each request, then an hour to carry it out. */
export const APPROVAL_DECIDE_HOURS = 24;
export const APPROVAL_EXECUTE_HOURS = 1;

/**
 * Each kind's lifetimes. A lifetime bounds the link, never the provider: a
 * provider's return after the link expired still completes its attempt
 * (`claimAttempt`), and a return or a lease never reads this table.
 */
export const HANDOFF_LIFETIMES: Record<HandoffKind, HandoffLifetimes> = {
  stripe_connect_onboarding: { actMs: HANDOFF_TTL_HOURS * HOUR_MS },
  stripe_dashboard: { actMs: HANDOFF_TTL_HOURS * HOUR_MS },
  billing_card_setup: { actMs: HANDOFF_TTL_HOURS * HOUR_MS },
  team_invitation: { actMs: HANDOFF_TTL_HOURS * HOUR_MS },
  operation_approval: {
    actMs: APPROVAL_DECIDE_HOURS * HOUR_MS,
    executeMs: APPROVAL_EXECUTE_HOURS * HOUR_MS,
  },
};

/** When a step's link stops working, for a request at `requestedAt`. */
export function linkExpiry(kind: HandoffKind, requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + HANDOFF_LIFETIMES[kind].actMs);
}

/** Until when an approval approved at `approvedAt` may be carried out. */
export function executionExpiry(
  approvedAt: Date,
  lifetimes = HANDOFF_LIFETIMES.operation_approval,
) {
  return new Date(approvedAt.getTime() + (lifetimes.executeMs ?? 0));
}

/**
 * The kinds a person decides on the step's page, with the right deciding
 * needs: an invitation is decided as the team's manager, an operation's
 * approval with the right its procedure needs (`decisionScopeOf`). The other
 * kinds have no decision: the person goes on to the provider.
 */
export const HANDOFF_DECISION_SCOPES: Partial<Record<StepKind, ProcedureScope>> = {
  team_invitation: { domain: "team", level: "write", role: "manage_members" },
};

/**
 * The right deciding the step needs, for a kind decided on its page: the
 * kind's, or an approval's procedure's scope. Undefined for a provider's
 * step, and for an approval whose row names no scope Louez knows.
 */
export function decisionScopeOf(
  row: Pick<HandoffRow, "kind" | "payload">,
): ProcedureScope | undefined {
  if (row.kind === "operation_approval") return approvalPayloadOf(row)?.scope;
  return HANDOFF_DECISION_SCOPES[row.kind];
}

/** Whether a person decides the kind on the step's page, rather than go on to a provider. */
export const isDecidedOnPage = (kind: HandoffKind) =>
  kind === "operation_approval" || HANDOFF_DECISION_SCOPES[kind] !== undefined;

/** Who may take a provider's step in the store: the dashboard's own rule for each flow. */
export function mayTakeStep(kind: HandoffKind, role: MemberRole): boolean {
  if (kind === "billing_card_setup") return role === "owner";
  return hasPermission(role, "manage_settings");
}

/**
 * Whether `userId`, whose role in the step's store is `role` (null when they
 * are no longer a member), may still take the step: decide it, by the one
 * rule of who decides (`mayApprove`: the user the requesting connection acts
 * for, still a member whose role allows the decision), or go on to the
 * provider (`mayTakeStep`).
 */
export function mayActOnStep(
  row: Pick<HandoffRow, "kind" | "storeId" | "userId" | "payload">,
  userId: string,
  role: MemberRole | null,
): boolean {
  if (isDecidedOnPage(row.kind)) {
    const scope = decisionScopeOf(row);
    if (!scope) return false;
    return mayApprove(
      { userId, storeId: row.storeId, role },
      { storeId: row.storeId, requesterUserId: row.userId, scope },
    );
  }
  return role !== null && mayTakeStep(row.kind, role);
}

const PAGES: Record<HandoffKind, `/dashboard${string}`> = {
  stripe_connect_onboarding: "/dashboard/settings/payments",
  stripe_dashboard: "/dashboard/settings/payments",
  billing_card_setup: "/dashboard/settings/billing",
  team_invitation: "/dashboard/team",
  // The dashboard has no page of an approval yet: its link is the step's page (`url`).
  operation_approval: "/dashboard",
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

/**
 * Where a step stands at `now`. Expiry is computed, never written: an open
 * step past `expires_at` reads as expired (an approval: not decided within
 * its day, or approved and not carried out within its hour).
 */
export function statusOf(row: Pick<HandoffRow, "status" | "expiresAt">, now: Date): HandoffStatus {
  if (isOpenStatus(row.status) && row.expiresAt <= now) return "expired";
  return row.status;
}

/** The stored states of a step that is not over: an approval approved is still open. */
const OPEN = ["pending", "opened", "approved"] as const;
const isOpenStatus = (status: HandoffRow["status"]) => (OPEN as readonly string[]).includes(status);

/** The states a step of a kind other than an approval takes. */
type StepStatus = Exclude<HandoffStatus, "approved">;

const APPROVAL_SUMMARIES: Record<HandoffStatus, string> = {
  pending: "The request waits for the user to approve it, signed in to Louez, from the link.",
  opened: "The request waits for the user to approve it, signed in to Louez, from the link.",
  approved: "The user approved the request.",
  completed: "The approved request was carried out.",
  expired: "The approval expired before it was carried out: ask again.",
  failed: "The request was not approved.",
};

const SUMMARIES: Record<StepKind, Record<StepStatus, string>> = {
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
  team_invitation: {
    pending: "The invitation is waiting for the user to approve it from the link.",
    opened: "The invitation is waiting for the user to approve it from the link.",
    completed: "The user approved the invitation: it went out, or the person joined.",
    expired: "The link to approve the invitation expired before the user answered: ask again.",
    failed: "The invitation was not approved.",
  },
};

/** A step the person approved, which ended failed: it could not be carried out. */
const APPROVED_NOT_CARRIED_OUT = "The user approved, but it could not be carried out.";

/** What a person decided on the step's page, as the row records it; null until then. */
function decisionOf(
  row: Pick<HandoffRow, "decision" | "decidedAt" | "decisionReason">,
): HandoffDecision {
  if (!row.decision || !row.decidedAt) return null;
  return { outcome: row.decision, at: row.decidedAt, reason: row.decisionReason };
}

/** The view's sentence: where the step stands, and why it failed. */
function summaryOf(row: HandoffRow, status: HandoffStatus): string {
  const summaries = row.kind === "operation_approval" ? APPROVAL_SUMMARIES : SUMMARIES[row.kind];
  if (status === "failed" && row.failureCode) {
    const failed = row.decision === "approved" ? APPROVED_NOT_CARRIED_OUT : summaries.failed;
    return `${failed} ${handoffFailureMessage(row.failureCode)}`;
  }
  if (isConfirming(row, status)) return CONFIRMING_SUMMARY;
  // Only an approval is ever approved; another kind's row cannot hold it.
  return status === "approved" ? APPROVAL_SUMMARIES.approved : summaries[status];
}

const CONFIRMING_SUMMARY = "The user is back from Stripe, which has not confirmed the card yet.";

/**
 * The user came back from the provider, which had not confirmed the step:
 * a billing card's Checkout is on the row, and the step is still open.
 */
export function isConfirming(row: Pick<HandoffRow, "kind" | "providerRef">, status: HandoffStatus) {
  return row.kind === "billing_card_setup" && row.providerRef !== null && status === "opened";
}

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
    confirming: isConfirming(row, status),
    invitation: invitationPayloadOf(row),
    url: handoffUrl(context.urls, row.id),
    decision: decisionOf(row),
    summary: summaryOf(row, status),
    links: dashboardPageLinks(context.urls, context.store, PAGES[row.kind]),
  };
}

/**
 * The path of the page a link opens: the handoff's id (21 characters), or,
 * for a link given before links were addressed by id, the id then its
 * secret (43). No dot: the app's proxy takes a path with a dot for a static file.
 */
export const handoffPath = (link: string) => `/handoffs/${encodeURIComponent(link)}`;
/** The step's page, where the user takes it: the same for the step's whole life. */
export const handoffUrl = (urls: UrlsPort, id: string) => urls.dashboard(handoffPath(id));

/**
 * A handoff view kept for an idempotency key before views carried `url` or
 * `decision`, as a view gives them now: the link follows from the id, and no
 * view stored then carried a decision. Anything else is returned as it is.
 */
export function upgradeStoredView(stored: unknown, urls: UrlsPort): unknown {
  if (!stored || typeof stored !== "object") return stored;
  const { id } = stored as { id?: unknown };
  if (typeof id !== "string") return stored;
  return {
    ...stored,
    ...("url" in stored ? {} : { url: handoffUrl(urls, id) }),
    ...("decision" in stored ? {} : { decision: null }),
  };
}

/** A stored answer that hands a step over (`{ handoff, url }`), its view upgraded. */
export function upgradeStoredLink(stored: unknown, urls: UrlsPort): unknown {
  if (!stored || typeof stored !== "object" || !("handoff" in stored)) return stored;
  return { ...stored, handoff: upgradeStoredView(stored.handoff, urls) };
}
/** Where the provider sends the user back, with the state of their click. */
export const handoffReturnPath = (id: string, state: string) => `/handoffs/return/${id}/${state}`;
/** Where Stripe sends the user when its onboarding link expired. */
export const handoffRefreshPath = (id: string, state: string) => `/handoffs/refresh/${id}/${state}`;
/** Where the user lands once back: where the step stands. */
export const handoffDonePath = (id: string) => `/handoffs/done/${encodeURIComponent(id)}`;

const newSecret = () => randomBytes(32).toString("base64url");

/** The states of a provider's step or an invitation not over: an approval also stays open once approved (`OPEN`). */
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

/** The provider-check lease is free: never taken, or ended on the database's clock. */
const leaseFree = () =>
  or(isNull(apiHandoffs.providerCheckAt), lte(apiHandoffs.providerCheckAt, sql`NOW(3)`));

/**
 * The lease's end on the database's clock, from the checks made so far. Set
 * before `provider_checks` in the same statement, so it reads the old count.
 */
const leaseEnd = () =>
  sql`NOW(3) + INTERVAL LEAST(${HANDOFF_CHECK_LEASE_SECONDS.min} * POW(2, LEAST(${apiHandoffs.providerChecks}, 4)), ${HANDOFF_CHECK_LEASE_SECONDS.max}) SECOND`;

/**
 * Gives the store an active handoff of `kind`: the one it has, with its
 * expiry pushed back (an expired one runs again) and its revision raised, or
 * a new one. Its link is its page, the same for its whole life. Serialized
 * per store by the store row's lock. The step is bound to the requester's
 * user; a different user asking starts the step over.
 *
 * Every write still stores a hash, of a secret nobody receives: an instance
 * still running the code that read links by their secret reads every row as
 * before, and a link with a secret given before this one stops opening.
 */
export async function issueHandoff(
  requester: HandoffRequester,
  // An approval is requested once its write is over (services/approvals.ts).
  kind: StepKind,
  context: {
    urls: UrlsPort;
    now?: Date;
    /** What the step is about within its kind: one active handoff per subject. */
    subject?: string;
    /**
     * Runs under the store's lock before the link is issued, with the active
     * handoff of the subject if any: it may refuse (throw), and returns what
     * the handoff carries.
     */
    prepare?: (
      tx: Transaction,
      active: HandoffRow | undefined,
    ) => Promise<ApiHandoffPayload | null>;
  },
): Promise<HandoffLink> {
  const subject = context.subject ?? "";
  const now = context.now ?? new Date();
  const tokenHash = sha256(newSecret());
  const expiresAt = linkExpiry(kind, now);
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
          eq(apiHandoffs.subject, subject),
          eq(apiHandoffs.activeSlot, 1),
        ),
      )
      .for("update");
    const payload = context.prepare ? await context.prepare(tx, active) : null;
    if (active) {
      const sameUser = active.userId === requester.userId;
      await tx
        .update(apiHandoffs)
        .set({
          ...credential,
          tokenHash,
          linkIssuedAt: now,
          expiresAt,
          payload,
          revision: sql`${apiHandoffs.revision} + 1`,
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
        subject,
        payload,
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
    url: handoffUrl(context.urls, row.id),
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
 * Ends the open handoffs a revoked connection asked for, an approval already
 * approved included: its links stop working at once, an approval it holds
 * can never be carried out, and the step may be asked for again.
 *
 * `storeIds` are the stores the connection could act in. Their rows are
 * locked first, in id order, with those of the stores it already has an open
 * step in: every writer that opens a step holds its store's row, so a step a
 * request was opening while the connection was revoked is committed, and
 * ended here, or its request finds the connection gone under that lock.
 */
export async function failCredentialHandoffs(
  credential: { kind: "api_key" | "oauth"; id: string },
  storeIds: readonly string[],
  now = new Date(),
): Promise<void> {
  const ofCredential = and(
    eq(apiHandoffs.credentialKind, credential.kind),
    eq(apiHandoffs.credentialId, credential.id),
    inArray(apiHandoffs.status, [...OPEN]),
  );
  await db.transaction(async (tx) => {
    const open = await tx
      .selectDistinct({ storeId: apiHandoffs.storeId })
      .from(apiHandoffs)
      .where(ofCredential);
    const stores = new Set([...storeIds, ...open.map((row) => row.storeId)]);
    for (const storeId of [...stores].sort()) await lockStoreRow(tx, storeId);
    // An update reads what is committed now, whatever this transaction read before.
    await tx
      .update(apiHandoffs)
      .set({
        status: "failed",
        failedAt: now,
        failureCode: "connection_revoked",
        activeSlot: null,
        updatedAt: now,
      })
      .where(ofCredential);
  });
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
  /** No such link, or a link with a secret replaced by a newer one. */
  | "invalid"
  /** The step changed since the page showed it: the click decides nothing, the page asks again. */
  | "changed"
  | "expired"
  /** Completed or failed already. */
  | "finished"
  /** Signed in as someone else than the user the link is for. */
  | "other_user"
  /** The user may not take this step in the store now. */
  | "not_allowed";

export type HandoffCheck =
  | { ok: true; row: HandoffRow; store: { id: string; name: string } }
  /** Another user learns nothing of the step: no row, so no status, kind or store. */
  | { ok: false; reason: "other_user"; row: null }
  | { ok: false; reason: Exclude<HandoffRefusal, "other_user">; row: HandoffRow | null };

/**
 * The one answer a signed-in user who is not the step's user gets, whatever
 * the step's state, kind or store: it is checked before anything else.
 */
const NOT_THEIRS = { ok: false, reason: "other_user", row: null } as const;

/** Whether `userId` is the user the step is for: the first check of every reader. */
const isStepUser = (row: Pick<HandoffRow, "userId">, userId: string) => row.userId === userId;

/**
 * A link: the handoff's id, or, given before links were addressed by id,
 * the id then its 43-character secret.
 */
const LINK_PATTERN = /^([A-Za-z0-9_-]{21})([A-Za-z0-9_-]{43})?$/;

function sameHash(stored: string | null, value: string): boolean {
  if (!stored) return false;
  const a = Buffer.from(stored, "hex");
  const b = Buffer.from(sha256(value), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The row a link names. A link that carries a secret opens only while the
 * secret's hash is the row's current one, as when the secret was the link's
 * credential; the session is the credential of every link either way.
 */
async function rowOfLink(link: string) {
  const match = LINK_PATTERN.exec(link);
  if (!match) return null;
  const [, id = "", secret] = match;
  const [row] = await db.select().from(apiHandoffs).where(eq(apiHandoffs.id, id));
  if (!row) return null;
  if (secret !== undefined && !sameHash(row.tokenHash, secret)) return null;
  return row;
}

/**
 * The rows a decision on the step may change: the handoff, at the revision
 * its page showed, while it is still the step of the user who decides. A
 * repeated request or another user starting over raises the revision, so a
 * click on a page that showed an earlier one changes nothing; and a step
 * that became another user's is never changed by the user it was shown to,
 * whatever its revision. Every write that raises a provider step's or an
 * invitation's revision holds the row's lock under the store row's lock, so
 * the comparison and the raise are ordered. (An approval's request raises
 * its revision under the store row's lock too, and its decision compares it
 * in a conditional statement on the row: services/approvals.ts.)
 */
export const atShownRevision = (id: string, revision: number, userId: string) =>
  and(eq(apiHandoffs.id, id), eq(apiHandoffs.revision, revision), eq(apiHandoffs.userId, userId));

/**
 * What an owner's page shows of an agent's invitation, and what approving it
 * carries out: the address, the role, and whether the address joins at once.
 * The page posts this digest next to the revision, and the decision compares
 * it with the row's payload under the store's lock: the owner decides what
 * they read, even when a writer changed the payload without raising the
 * revision (an instance still running the code before revisions).
 */
export function invitationShown(payload: ApiHandoffPayload): string {
  return sha256(JSON.stringify([payload.email, payload.role, payload.joinsAtOnce]));
}

/**
 * Whether the connection that asked for the step still exists: a revoked
 * agent's link stops. On `executor`, a transaction's own connection when a
 * decision reads it under its lock.
 */
export async function connectionAlive(
  row: Pick<HandoffRow, "credentialKind" | "credentialId">,
  executor: Transaction | typeof db = db,
): Promise<boolean> {
  if (!row.credentialId) return row.credentialKind === "session";
  if (row.credentialKind === "api_key") {
    const [key] = await executor
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(and(eq(apiKeys.id, row.credentialId), isNull(apiKeys.revokedAt)));
    return key !== undefined;
  }
  if (row.credentialKind === "oauth") {
    const [grant] = await executor
      .select({ id: apiAgentGrants.id })
      .from(apiAgentGrants)
      .where(eq(apiAgentGrants.id, row.credentialId));
    return grant !== undefined;
  }
  return false;
}

/**
 * Whether `userId` may take the step of `row` now: the step's user, for a
 * connection that still exists, still allowed in the store (`mayActOnStep`).
 * Anyone else gets `NOT_THEIRS` and nothing about the step.
 */
async function checkUser(row: HandoffRow, userId: string): Promise<HandoffCheck> {
  if (!isStepUser(row, userId)) return NOT_THEIRS;
  if (!(await connectionAlive(row))) return { ok: false, reason: "invalid", row };
  const [member] = await db
    .select({ role: storeMembers.role, storeName: stores.name })
    .from(storeMembers)
    .innerJoin(stores, eq(stores.id, storeMembers.storeId))
    .where(and(eq(storeMembers.storeId, row.storeId), eq(storeMembers.userId, userId)));
  if (!member || !mayActOnStep(row, userId, member.role)) {
    return { ok: false, reason: "not_allowed", row };
  }
  return { ok: true, row, store: { id: row.storeId, name: member.storeName } };
}

/**
 * The link as the page shows it before the user continues. Changes nothing.
 * Whose step it is comes first: another user is told only that, before the
 * step's state is read.
 */
export async function readHandoffLink(
  link: string,
  userId: string,
  now = new Date(),
): Promise<HandoffCheck> {
  const row = await rowOfLink(link);
  if (!row) return { ok: false, reason: "invalid", row: null };
  if (!isStepUser(row, userId)) return NOT_THEIRS;
  const status = statusOf(row, await stepNow(row, now));
  if (status === "completed" || status === "failed") return { ok: false, reason: "finished", row };
  if (status === "expired") return { ok: false, reason: "expired", row };
  return checkUser(row, userId);
}

/**
 * The user continues to the provider, from a page that showed `revision`:
 * the handoff is opened with a new attempt, a fresh state the provider's
 * return must carry. A step asked for again since the page showed it
 * (another revision) is not continued: the page shows it again. A link
 * continued twice gives a new attempt each time: the earlier one's provider
 * flow and lease are dropped, and only the latest attempt's return counts.
 */
export async function continueHandoff(
  link: string,
  userId: string,
  revision: number,
  now = new Date(),
): Promise<HandoffCheck & { state?: string }> {
  const checked = await readHandoffLink(link, userId, now);
  if (!checked.ok) return checked;
  // No provider: an invitation or an approval is decided on its page (`handoffs.decide`).
  if (isDecidedOnPage(checked.row.kind)) return { ok: false, reason: "invalid", row: null };
  const changed = { ok: false, reason: "changed", row: checked.row } as const;
  if (checked.row.revision !== revision) return changed;
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
        atShownRevision(checked.row.id, revision, userId),
        inArray(apiHandoffs.status, [...ACTIVE]),
      ),
    );
  if (updated[0].affectedRows === 0) return changed;
  const [row] = await db.select().from(apiHandoffs).where(eq(apiHandoffs.id, checked.row.id));
  return { ...checked, row: row ?? checked.row, state };
}

/**
 * The provider's return: the state must be the latest click's (the state is
 * what authenticates the return: only the browser that clicked holds it),
 * and the user the step's, still allowed. A finished handoff passes, so a
 * reload of the return page shows where it stands. Another session gets
 * nothing about the step, as everywhere.
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
      logProviderError("Stripe dashboard link failed", error);
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
 * the current attempt of an active handoff, and its provider-check lease
 * free. It takes the lease, so concurrent returns and polls read the stored
 * status, and records the provider's flow of this attempt. A return after
 * the link expired may still claim it (the user finished on the provider's
 * page), once per lease like any other check.
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
    .where(and(ofAttempt(id, attempt), leaseFree()));
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
 * most once), so it completes without another visit (`handoffs.refresh`). At
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
        leaseFree(),
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
    logProviderError("Billing card check failed", error);
  }
  // The lease is committed and the provider was asked: a handoff gone by now
  // is no refusal of this call.
  return readAfterCommit(() => getHandoffRow(row.storeId, row.id));
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
