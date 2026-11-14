import {
  apiHandoffs,
  db,
  lockStoreRow,
  storeMembers,
  unmarkSetupWrite,
  type ApiApprovalPayload,
  type Transaction,
} from "@louez/db";
import { and, count, eq, gt, inArray, isNull, max, min } from "drizzle-orm";
import type { ORPCError } from "@orpc/server";

import { handoffErrors } from "../contracts/handoffs";
import type { ScopedActor } from "../platform/actor";
import { mayApprove } from "../platform/approval-rule";
import type { ApprovalToRequest } from "../platform/confirmation";
import { databaseNow } from "../platform/database-clock";
import {
  APPROVAL_POLL_SECONDS,
  approvalErrors,
  platformErrors,
  type ApiErrorData,
  type ApprovalAnswer,
} from "../platform/errors";
import { sha256, stableStringify } from "../platform/hash";
import type { HandoffDecided } from "./handoff-decisions";
import {
  approvalPayloadOf,
  connectionAlive,
  liveConnections,
  executionExpiry,
  handoffUrl,
  linkExpiry,
  statusOf,
} from "./handoffs";

/**
 * A person's approval of an operation (docs/architecture/api-and-agents.md,
 * "A person's approval"): a hand-off of kind `operation_approval`, which an
 * agent's call requests when its branch needs a person, which the person
 * approves or refuses on its page, signed in, and which the agent then
 * carries out with its id. This module requests it, once the write's own
 * transaction is over, and records the person's decision. Carrying it out
 * inside the write is the plan's next step (3c): until then an approved
 * approval presented with a call runs nothing, and no procedure Louez serves
 * asks for one (`APPROVAL_LIVE` is empty, platform/approval-rule.ts).
 *
 * The lock rule: approval code takes the store row only as the first lock
 * of a transaction of its own (a request, a decision), and an approval row
 * last; inside a caller's transaction it takes nothing, and reads nothing
 * but an approval row by its key (`answerPresentedApproval`). So a request
 * never waits for the store's row while a caller's domain lock is held, and
 * every writer of a store's approvals but a revocation is ordered by that
 * row. A revocation's cleanup (`failCredentialHandoffs`) takes each of the
 * connection's stores in a transaction of its own: the store's row, then the
 * connection's open steps there. No approval code holds two store rows.
 *
 * Every time an approval's rules read is the database's clock, read once
 * the lock it waits for is held. Expiry is computed from `expires_at`
 * (`statusOf`), never written by a job.
 */

const KIND = "operation_approval" as const;
const HOUR_MS = 3_600_000;

// --- The rules ---------------------------------------------------------------

/** Open approvals (pending or approved, in time) one connection may hold in one store. */
export const MAX_PENDING_APPROVALS = 10;
/** New approvals one connection may request in one store within an hour. */
export const APPROVAL_REQUESTS_PER_HOUR = 30;
/** Open approvals one store may hold, whatever the connection: counted under the store's lock, exactly. */
export const MAX_STORE_PENDING_APPROVALS = 50;
/** After a person refused a request, the same request is refused this long. */
export const APPROVAL_COOL_DOWN_MS = HOUR_MS;

/**
 * The identity of a request: the credential that asks, the store, the
 * procedure and the consequential facts the procedure declares with its
 * preview (the records acted on, the amount and its currency, the target
 * status, a hash of each recipient), never free text. Two requests that
 * differ only in their wording are one; it decides uniqueness, the caps and
 * the cool-down. A SHA-256, hex.
 */
export function approvalIdentity(request: {
  credential: { kind: string; id: string | null };
  storeId: string;
  procedure: string;
  facts: Record<string, unknown>;
}): string {
  return sha256(
    stableStringify({
      credential: [request.credential.kind, request.credential.id],
      storeId: request.storeId,
      procedure: request.procedure,
      facts: request.facts,
    }),
  );
}

/**
 * When the same request may be asked again after a person refused it at
 * `refusedAt`, or null when it may now: the cool-down is keyed by the
 * request's identity, so rewording does not dodge it and it blocks no other
 * request.
 */
export function coolDownEnd(
  refusedAt: Date | null,
  now: Date,
  coolDownMs = APPROVAL_COOL_DOWN_MS,
): Date | null {
  if (!refusedAt) return null;
  const end = new Date(refusedAt.getTime() + coolDownMs);
  return end > now ? end : null;
}

/**
 * What the caps count, under the store's lock, each with when its first
 * entry frees.
 */
export interface ApprovalCounts {
  /** The connection's open approvals in the store, and the earliest expiry among them. */
  connectionOpen: { count: number; firstEnd: Date | null };
  /** The approvals the connection requested in the store within the hour, and the earliest. */
  connectionLastHour: { count: number; firstAt: Date | null };
  /** The store's open approvals, and the earliest expiry among them. */
  storeOpen: { count: number; firstEnd: Date | null };
}

export const APPROVAL_LIMITS = {
  connectionOpen: MAX_PENDING_APPROVALS,
  connectionPerHour: APPROVAL_REQUESTS_PER_HOUR,
  storeOpen: MAX_STORE_PENDING_APPROVALS,
  hourMs: HOUR_MS,
};

/**
 * Which cap a new approval would pass, with when it frees, or null when it
 * may be created. A request that finds its own open approval is not new and
 * counts nothing.
 */
export function approvalsFull(
  counts: ApprovalCounts,
  now: Date,
  limits = APPROVAL_LIMITS,
): { limit: "connection_open" | "connection_per_hour" | "store_open"; retryAt: Date } | null {
  const later = (at: Date | null) => at ?? new Date(now.getTime() + limits.hourMs);
  if (counts.connectionOpen.count >= limits.connectionOpen) {
    return { limit: "connection_open", retryAt: later(counts.connectionOpen.firstEnd) };
  }
  if (counts.connectionLastHour.count >= limits.connectionPerHour) {
    const first = counts.connectionLastHour.firstAt;
    return {
      limit: "connection_per_hour",
      retryAt: first ? new Date(first.getTime() + limits.hourMs) : later(null),
    };
  }
  if (counts.storeOpen.count >= limits.storeOpen) {
    return { limit: "store_open", retryAt: later(counts.storeOpen.firstEnd) };
  }
  return null;
}

// --- Requesting -----------------------------------------------------------

/** An approval's id: what its link carries, and what a call presents to carry it out. */
const APPROVAL_ID = /^[A-Za-z0-9_-]{21}$/;

type HandoffRow = typeof apiHandoffs.$inferSelect;

/**
 * The answer to a call that presents an approval id, in the caller's
 * transaction (`checkConfirmation`): from a read of the approval's row by
 * its key, and nothing else; it changes nothing. Null when what the call
 * presents is no approval id (a confirmation token): the call asks for one.
 * An id this caller did not ask for, in this store, for this procedure and
 * this request, answers as no approval at all. Pull request 3c consumes an
 * approved one here.
 */
export async function answerPresentedApproval(
  tx: Transaction,
  request: ApprovalToRequest,
  presented: string,
): Promise<ORPCError<string, ApiErrorData> | null> {
  if (!APPROVAL_ID.test(presented)) return null;
  const { actor } = request;
  const [row] = await tx
    .select()
    .from(apiHandoffs)
    .where(
      and(
        eq(apiHandoffs.id, presented),
        eq(apiHandoffs.storeId, actor.storeId),
        eq(apiHandoffs.kind, KIND),
        eq(apiHandoffs.credentialKind, actor.credential.kind),
        actor.credential.id === null
          ? isNull(apiHandoffs.credentialId)
          : eq(apiHandoffs.credentialId, actor.credential.id),
        eq(apiHandoffs.procedure, request.procedure),
        eq(apiHandoffs.subject, subjectOf(request)),
      ),
    );
  if (!row) return approvalErrors.invalid("other_request");
  switch (statusOf(row, await databaseNow(tx))) {
    case "pending":
    case "opened":
      return approvalErrors.pending(answerOf(row, request));
    case "expired":
      return approvalErrors.invalid("expired");
    case "completed":
      return approvalErrors.invalid("used");
    case "failed":
      return row.failureCode === "declined"
        ? approvalErrors.declined(row.id, row.decisionReason)
        : approvalErrors.invalid("other_request");
    case "approved":
      // Where pull request 3c consumes it, in this transaction. Until then an
      // approval runs nothing: a refusal, so the call's key runs again.
      return approvalErrors.invalid("execution_unavailable");
  }
}

/**
 * Requests the approval a refused call computed, once the caller's
 * transaction is over (`raiseConfirmation`), in a transaction of its own:
 * the store row's lock first, then approval rows. Every request and every
 * decision of the store waits on that row, so what is read after it is all
 * that was committed before, and exact: the open approval of the identity,
 * the cool-down and the three caps, on the database's clock read once the
 * lock is held. Returns the answer to throw:
 *
 * - no open approval of the identity: a new one, `pending`, within the caps
 *   and outside the cool-down after a refusal (`APPROVAL_REQUIRED`);
 * - the same request while one is pending: the same id and link, its
 *   preview and binding refreshed, its revision raised, its time to decide
 *   counted again;
 * - while one is approved: unchanged, its binding and decision intact; the
 *   answer shows the preview the person approved, and whether this call is
 *   still as it showed (`stillAsApproved`).
 *
 * What the request stores was computed under the write's locks a moment
 * before: the page computes the preview again when it loads and when the
 * person clicks (pull request 4), and the execution compares the binding
 * again under the write's locks (3c).
 */
export async function requestApproval(
  request: ApprovalToRequest,
): Promise<ORPCError<string, ApiErrorData>> {
  const { actor } = request;
  return db.transaction(async (tx) => {
    // The first statement, and the first lock, of this transaction.
    if (!(await lockStoreRow(tx, actor.storeId))) return platformErrors.noStore();
    // Refused: the write sets nothing up.
    await unmarkSetupWrite(tx);
    // Read under the store's lock, which a revocation's cleanup takes too
    // (`failCredentialHandoffs`): a connection revoked since the call was
    // authenticated opens nothing, and one revoked after this read has what
    // it opens here ended by that cleanup.
    const { kind: credentialKind, id: credentialId } = actor.credential;
    if (!(await connectionAlive({ credentialKind, credentialId }, tx))) {
      return platformErrors.unauthenticated();
    }
    // Its approver is the connection's own user: an approval nobody could
    // decide is not opened. A member removed since the call was
    // authenticated gets the answer their next call gets; team writes hold
    // the store's row, so the membership read here is the one that counts.
    const requester = await requesterStanding(tx, request);
    if (requester) return requester;
    const now = await databaseNow(tx);
    const subject = subjectOf(request);

    const [open] = await tx
      .select()
      .from(apiHandoffs)
      .where(
        and(
          eq(apiHandoffs.storeId, actor.storeId),
          eq(apiHandoffs.kind, KIND),
          eq(apiHandoffs.subject, subject),
          eq(apiHandoffs.activeSlot, 1),
        ),
      );
    if (open) {
      const answered = await answerOpen(tx, request, open, now);
      if (answered) return answered;
    }

    const asksAgainAt = coolDownEnd(await lastRefusal(tx, actor.storeId, subject, now), now);
    if (asksAgainAt) return approvalErrors.recentlyDeclined(asksAgainAt, now);
    const full = approvalsFull(await countApprovals(tx, actor, now), now);
    if (full) return approvalErrors.full(full.limit, full.retryAt, now);

    // The unique key of the open steps backs this: only a writer that skips
    // the store's lock could still have opened the identity meanwhile, and
    // none does; such an insert fails, and nothing is written.
    const [created] = await tx
      .insert(apiHandoffs)
      .values({
        storeId: actor.storeId,
        kind: KIND,
        subject,
        procedure: request.procedure,
        bindingHash: request.bindingHash,
        payload: payloadOf(request),
        status: "pending",
        activeSlot: 1,
        userId: actor.credential.userId,
        credentialKind: actor.credential.kind,
        credentialId: actor.credential.id,
        clientName: actor.credential.clientName,
        // Its link is its id: no secret was ever given for it.
        tokenHash: null,
        linkIssuedAt: now,
        expiresAt: linkExpiry(KIND, now),
        createdAt: now,
        updatedAt: now,
      })
      .$returningId();
    return approvalErrors.required(
      request.preview,
      answerOf(await reread(tx, created.id), request),
    );
  });
}

/**
 * Why the request's own user could not decide what it asks, as their
 * membership stands under the store's lock: no longer in the store, or
 * without the right the action needs. Null when they could (`mayApprove`).
 */
async function requesterStanding(
  tx: Transaction,
  request: ApprovalToRequest,
): Promise<ORPCError<string, ApiErrorData> | null> {
  const { storeId, credential } = request.actor;
  const [member] = await tx
    .select({ role: storeMembers.role })
    .from(storeMembers)
    .where(and(eq(storeMembers.storeId, storeId), eq(storeMembers.userId, credential.userId)));
  if (!member) return platformErrors.noStore();
  const allowed = mayApprove(
    { userId: credential.userId, storeId, role: member.role },
    { storeId, requesterUserId: credential.userId, scope: request.scope },
  );
  const { domain, level } = request.scope;
  return allowed ? null : platformErrors.permissionDenied(`${domain}:${level}`);
}

/** The request's identity (`approvalIdentity`). */
const subjectOf = (request: ApprovalToRequest) =>
  approvalIdentity({
    credential: request.actor.credential,
    storeId: request.actor.storeId,
    procedure: request.procedure,
    facts: request.facts,
  });

/**
 * The open approval of an identity found, under the store's lock: answered
 * as it stands, or, once expired, freed of its slot for a new one (null: go
 * on and create it). Each update holds only while the row is still open,
 * and one that changes nothing goes on as if none was open.
 */
async function answerOpen(
  tx: Transaction,
  request: ApprovalToRequest,
  open: HandoffRow,
  now: Date,
): Promise<ORPCError<string, ApiErrorData> | null> {
  const { actor } = request;
  const status = statusOf(open, now);
  if (status === "approved") {
    // What the person approved, never this call's preview, and whether this
    // call is still as that preview showed (`stillAsApproved`).
    const approved = approvalPayloadOf(open)?.preview ?? request.preview;
    return approvalErrors.required(approved, answerOf(open, request));
  }
  const stillOpen = and(
    eq(apiHandoffs.id, open.id),
    eq(apiHandoffs.status, open.status),
    eq(apiHandoffs.activeSlot, 1),
  );
  if (status === "pending") {
    const [refreshed] = await tx
      .update(apiHandoffs)
      .set({
        payload: payloadOf(request),
        bindingHash: request.bindingHash,
        revision: open.revision + 1,
        clientName: actor.credential.clientName,
        linkIssuedAt: now,
        expiresAt: linkExpiry(KIND, now),
        updatedAt: now,
      })
      .where(stillOpen);
    if (refreshed.affectedRows === 1) {
      return approvalErrors.required(request.preview, answerOf(await reread(tx, open.id), request));
    }
    return null;
  }
  // Expired, as its row still says: it gives up its slot to the new request.
  await tx.update(apiHandoffs).set({ activeSlot: null, updatedAt: now }).where(stillOpen);
  return null;
}

/** What the approval's row holds of the request: the input, the preview shown, the scope. */
function payloadOf(request: ApprovalToRequest): ApiApprovalPayload {
  return {
    input: request.input,
    preview: request.preview,
    scope: request.scope,
    consequences: [...request.consequences],
  };
}

async function reread(tx: Transaction, id: string): Promise<HandoffRow> {
  const [row] = await tx.select().from(apiHandoffs).where(eq(apiHandoffs.id, id));
  if (!row) throw new Error(`The approval ${id} written in this transaction is gone.`);
  return row;
}

/**
 * The approval as the agent's answer shows it. An approved one also says
 * whether this call, and the store, are still as the preview the person
 * approved showed: its binding is the call's.
 */
function answerOf(row: HandoffRow, request: ApprovalToRequest): ApprovalAnswer {
  const approved = row.status === "approved";
  return {
    id: row.id,
    url: handoffUrl(request.urls, row.id),
    status: approved ? "approved" : "pending",
    expiresAt: row.expiresAt.toISOString(),
    pollAfterSeconds: APPROVAL_POLL_SECONDS,
    decision:
      row.decision === "approved" && row.decidedAt
        ? { outcome: "approved", at: row.decidedAt.toISOString(), reason: row.decisionReason }
        : null,
    ...(approved ? { stillAsApproved: row.bindingHash === request.bindingHash } : {}),
  };
}

/** When the person last refused this same request within the cool-down, under the store's lock. */
async function lastRefusal(tx: Transaction, storeId: string, subject: string, now: Date) {
  const [row] = await tx
    .select({ at: max(apiHandoffs.decidedAt) })
    .from(apiHandoffs)
    .where(
      and(
        eq(apiHandoffs.storeId, storeId),
        eq(apiHandoffs.kind, KIND),
        eq(apiHandoffs.subject, subject),
        eq(apiHandoffs.decision, "refused"),
        gt(apiHandoffs.decidedAt, new Date(now.getTime() - APPROVAL_COOL_DOWN_MS)),
      ),
    );
  return row?.at ?? null;
}

/**
 * The caps' counts, under the store's lock: every request of the store waits
 * on it, so each count is exact, the connection's and the store's.
 */
async function countApprovals(
  tx: Transaction,
  actor: ScopedActor,
  now: Date,
): Promise<ApprovalCounts> {
  const ofStore = and(eq(apiHandoffs.storeId, actor.storeId), eq(apiHandoffs.kind, KIND));
  const ofConnection = and(
    ofStore,
    eq(apiHandoffs.credentialKind, actor.credential.kind),
    actor.credential.id === null
      ? isNull(apiHandoffs.credentialId)
      : eq(apiHandoffs.credentialId, actor.credential.id),
  );
  // Open, for a connection that still exists: a revoked connection's rows
  // count for nothing, whether its cleanup has ended them yet or not.
  const openRows = await tx
    .select({
      credentialKind: apiHandoffs.credentialKind,
      credentialId: apiHandoffs.credentialId,
      expiresAt: apiHandoffs.expiresAt,
    })
    .from(apiHandoffs)
    .where(
      and(
        ofStore,
        eq(apiHandoffs.activeSlot, 1),
        inArray(apiHandoffs.status, ["pending", "approved"]),
        gt(apiHandoffs.expiresAt, now),
      ),
    );
  const isLive = await liveConnections(openRows, tx);
  const counted = (rows: typeof openRows) => ({
    count: rows.length,
    firstEnd: rows.reduce<Date | null>(
      (first, row) => (first && first <= row.expiresAt ? first : row.expiresAt),
      null,
    ),
  });
  const storeOpen = counted(openRows.filter(isLive));
  const connectionOpen = counted(
    openRows.filter(
      (row) =>
        row.credentialKind === actor.credential.kind && row.credentialId === actor.credential.id,
    ),
  );
  const [lastHour] = await tx
    .select({ count: count(), first: min(apiHandoffs.createdAt) })
    .from(apiHandoffs)
    .where(and(ofConnection, gt(apiHandoffs.createdAt, new Date(now.getTime() - HOUR_MS))));
  return {
    connectionOpen,
    connectionLastHour: { count: lastHour?.count ?? 0, firstAt: lastHour?.first ?? null },
    storeOpen,
  };
}

// --- Deciding --------------------------------------------------------------

/**
 * A person's answer to an approval on its page, once `handoffs.decide` found
 * it theirs and theirs to decide (services/handoff-decisions.ts). Under the
 * store row's lock, on the database's clock, the approval must still be
 * pending and in time, still the user's, at the revision the page showed,
 * with the binding the page showed (`shown`), for a connection that still
 * exists, and the user still allowed (`mayApprove`, the procedure's scope);
 * anything else decides nothing. To approve makes it `approved`, executable
 * for an hour; to refuse ends it `failed`, `declined`. The decision is
 * written in that statement, and never after.
 */
export async function answerApproval(
  row: Pick<HandoffRow, "id" | "storeId">,
  input: {
    decision: "approve" | "refuse";
    reason: string | null;
    revision: number;
    /** The binding the page showed. */
    shown: string;
    userId: string;
  },
): Promise<HandoffDecided> {
  const decided = await db.transaction(async (tx) => {
    if (!(await lockStoreRow(tx, row.storeId))) throw platformErrors.noStore();
    const [current] = await tx
      .select()
      .from(apiHandoffs)
      .where(
        and(
          eq(apiHandoffs.id, row.id),
          eq(apiHandoffs.storeId, row.storeId),
          eq(apiHandoffs.kind, KIND),
        ),
      )
      .for("update");
    // Read once the approval's row is held: a click that waited for it is
    // judged at the time it decides, never at the time it began to wait.
    const now = await databaseNow(tx);
    if (!current) throw handoffErrors.decisionInvalid("invalid");
    // Whose step it is first: another user learns nothing of it.
    if (current.userId !== input.userId) throw handoffErrors.decisionInvalid("other_user");
    const status = statusOf(current, now);
    if (status === "expired") throw handoffErrors.decisionInvalid("expired");
    if (status !== "pending") throw handoffErrors.decisionInvalid("finished");
    if (current.revision !== input.revision || current.bindingHash !== input.shown) {
      throw handoffErrors.decisionInvalid("changed");
    }
    if (!(await mayStillApprove(tx, current, input.userId))) {
      throw handoffErrors.decisionInvalid("not_allowed");
    }
    const decision = {
      decidedAt: now,
      decidedByUserId: input.userId,
      decisionReason: input.reason,
      updatedAt: now,
    };
    const atShown = and(
      eq(apiHandoffs.id, current.id),
      eq(apiHandoffs.status, "pending"),
      eq(apiHandoffs.revision, input.revision),
      eq(apiHandoffs.bindingHash, input.shown),
      eq(apiHandoffs.userId, input.userId),
    );
    const [result] =
      input.decision === "approve"
        ? await tx
            .update(apiHandoffs)
            .set({
              status: "approved",
              decision: "approved",
              expiresAt: executionExpiry(now),
              ...decision,
            })
            .where(atShown)
        : await tx
            .update(apiHandoffs)
            .set({
              status: "failed",
              failedAt: now,
              failureCode: "declined",
              activeSlot: null,
              decision: "refused",
              ...decision,
            })
            .where(atShown);
    if (result.affectedRows !== 1) throw handoffErrors.decisionInvalid("changed");
    return input.decision === "approve" ? ("approved" as const) : ("refused" as const);
  });
  return { handoffId: row.id, decision: decided, outcome: null, effectIds: [] };
}

/**
 * Whether the user may still approve, read in the decision's transaction
 * under the store's lock: the connection that asked still exists, and
 * `mayApprove` allows the user as their membership stands now.
 */
async function mayStillApprove(tx: Transaction, row: HandoffRow, userId: string) {
  const payload = approvalPayloadOf(row);
  if (!payload || !(await connectionAlive(row, tx))) return false;
  const [member] = await tx
    .select({ role: storeMembers.role })
    .from(storeMembers)
    .where(and(eq(storeMembers.storeId, row.storeId), eq(storeMembers.userId, userId)));
  return mayApprove(
    { userId, storeId: row.storeId, role: member?.role ?? null },
    { storeId: row.storeId, requesterUserId: row.userId, scope: payload.scope },
  );
}
