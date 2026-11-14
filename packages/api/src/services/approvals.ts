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
import { mayApprove, type Consequences } from "../platform/approval-rule";
import { databaseNow } from "../platform/database-clock";
import {
  APPROVAL_POLL_SECONDS,
  approvalErrors,
  platformErrors,
  type ApiErrorData,
  type ApprovalAnswer,
} from "../platform/errors";
import { sha256, stableStringify } from "../platform/hash";
import type { ProcedureScope } from "../platform/permissions";
import type { UrlsPort } from "../platform/ports";
import type { HandoffDecided } from "./handoff-decisions";
import {
  approvalPayloadOf,
  connectionAlive,
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
 * carries out with its id. This module requests it, inside the write's own
 * transaction, and records the person's decision. Carrying it out inside
 * the write is the plan's next step (3c): until then an approved approval
 * presented with a call runs nothing, and no procedure Louez serves asks for
 * one (`APPROVAL_LIVE` is empty, platform/approval-rule.ts).
 *
 * Revocation never takes the store's lock: it ends the rows of a connection
 * in one statement, after the decision that holds them, or before it, which
 * then finds them ended (`failCredentialHandoffs`).
 *
 * Every rule reads the database's clock on the transaction's connection,
 * under the store row's lock, which every writer of an approval holds:
 * requests, decisions and the caps are ordered by it. Expiry is computed
 * from `expires_at` (`statusOf`), never written by a job.
 */

const KIND = "operation_approval" as const;
const HOUR_MS = 3_600_000;

// --- The rules ---------------------------------------------------------------

/** Open approvals (pending or approved, in time) one connection may hold in one store. */
export const MAX_PENDING_APPROVALS = 10;
/** New approvals one connection may request in one store within an hour. */
export const APPROVAL_REQUESTS_PER_HOUR = 30;
/** Open approvals one store may hold, whatever the connection. */
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

/** What the caps count, under the store's lock: each with when its first entry frees. */
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

/** What an approval is requested with: the call, its preview and its binding, in the write's transaction. */
export interface ApprovalRequest {
  /** The write's transaction, which holds the locks the preview was computed under. */
  tx: Transaction;
  actor: ScopedActor;
  procedure: string;
  input: unknown;
  preview: { summary: string; details?: Record<string, unknown> };
  consequences: Consequences;
  /** The consequential facts that make the request's identity (`approvalIdentity`). */
  facts: Record<string, unknown>;
  /** The right the action needs: its procedure's scope, which `mayApprove` asks of the approver. */
  scope: ProcedureScope;
  /** The binding the token would carry: user, credential, store, procedure, input and state. */
  bindingHash: string;
  urls: UrlsPort;
  /** What the call carries in the confirmation's channel, if anything. */
  presented: string | null;
}

/** An approval's id: what its link carries, and what a call presents to carry it out. */
const APPROVAL_ID = /^[A-Za-z0-9_-]{21}$/;

type HandoffRow = typeof apiHandoffs.$inferSelect;

/**
 * The approval a call at a person's level asks for, as the refusal it
 * answers with: nothing of the write happens. On the write's transaction,
 * under the store row's lock, on the database's clock.
 *
 * - No approval id (a confirmation token is not one), no open approval of
 *   the same identity: a new one, `pending`, within the caps and outside the
 *   cool-down after a refusal (`APPROVAL_REQUIRED`).
 * - The same request while one is pending: the same id and link, its
 *   preview and binding refreshed, its revision raised, its time to decide
 *   counted again.
 * - While one is approved: unchanged, its binding and decision intact.
 * - An approval id: read only, never changed. Pending, refused, expired, or
 *   not this request's (another credential's, store's or procedure's, or
 *   no approval at all: the same answer) each say so; approved, it cannot be
 *   carried out yet, and the call throws without running.
 *
 * The caller returns the refusal out of its transaction, which commits the
 * approval, and throws it once that transaction is over (`checkConfirmation`).
 */
export async function requestApproval(
  request: ApprovalRequest,
): Promise<ORPCError<string, ApiErrorData>> {
  const { tx, actor } = request;
  if (!(await lockStoreRow(tx, actor.storeId))) throw platformErrors.noStore();
  // Refused: the write sets nothing up, though its transaction commits the approval.
  await unmarkSetupWrite(tx);
  const now = await databaseNow(tx);
  const subject = approvalIdentity({
    credential: actor.credential,
    storeId: actor.storeId,
    procedure: request.procedure,
    facts: request.facts,
  });

  const presented =
    request.presented && APPROVAL_ID.test(request.presented) ? request.presented : null;
  if (presented) return answerPresented(request, presented, subject, now);

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
    )
    .for("update");
  if (open && statusOf(open, now) === "approved") {
    return approvalErrors.required(request.preview, answerOf(open, request.urls));
  }
  if (open && statusOf(open, now) === "pending") {
    await tx
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
      .where(eq(apiHandoffs.id, open.id));
    return approvalErrors.required(
      request.preview,
      answerOf(await reread(tx, open.id), request.urls),
    );
  }
  if (open) {
    // Expired, as its row still says: it gives up its slot to the new request.
    await tx
      .update(apiHandoffs)
      .set({ activeSlot: null, updatedAt: now })
      .where(eq(apiHandoffs.id, open.id));
  }

  const asksAgainAt = coolDownEnd(await lastRefusal(tx, actor.storeId, subject, now), now);
  if (asksAgainAt) return approvalErrors.recentlyDeclined(asksAgainAt, now);
  const full = approvalsFull(await countApprovals(tx, actor, now), now);
  if (full) return approvalErrors.full(full.limit, full.retryAt, now);

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
    answerOf(await reread(tx, created.id), request.urls),
  );
}

/**
 * A call that presents an approval id: read under its lock, changed never.
 * An id this caller did not ask for, in this store, for this procedure and
 * this request, answers as no approval at all.
 */
async function answerPresented(
  request: ApprovalRequest,
  id: string,
  subject: string,
  now: Date,
): Promise<ORPCError<string, ApiErrorData>> {
  const { tx, actor } = request;
  const [row] = await tx
    .select()
    .from(apiHandoffs)
    .where(
      and(
        eq(apiHandoffs.id, id),
        eq(apiHandoffs.storeId, actor.storeId),
        eq(apiHandoffs.kind, KIND),
        eq(apiHandoffs.credentialKind, actor.credential.kind),
        actor.credential.id === null
          ? isNull(apiHandoffs.credentialId)
          : eq(apiHandoffs.credentialId, actor.credential.id),
        eq(apiHandoffs.procedure, request.procedure),
        eq(apiHandoffs.subject, subject),
      ),
    )
    .for("update");
  if (!row) return approvalErrors.invalid("other_request");
  switch (statusOf(row, now)) {
    case "pending":
    case "opened":
      return approvalErrors.pending(answerOf(row, request.urls));
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
      // approval runs nothing: the call fails, and nothing is written.
      throw new Error(
        `${request.procedure}: an approved approval cannot be carried out yet; nothing was done.`,
      );
  }
}

/** What the approval's row holds of the request: the input, the preview shown, the scope. */
function payloadOf(request: ApprovalRequest): ApiApprovalPayload {
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

/** The approval as the agent's answer shows it. */
function answerOf(row: HandoffRow, urls: UrlsPort): ApprovalAnswer {
  return {
    id: row.id,
    url: handoffUrl(urls, row.id),
    status: row.status === "approved" ? "approved" : "pending",
    expiresAt: row.expiresAt.toISOString(),
    pollAfterSeconds: APPROVAL_POLL_SECONDS,
    decision:
      row.decision === "approved" && row.decidedAt
        ? { outcome: "approved", at: row.decidedAt.toISOString(), reason: row.decisionReason }
        : null,
  };
}

/** When the person last refused this same request within the cool-down, read under the store's lock. */
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
    )
    .for("share");
  return row?.at ?? null;
}

/** The caps' counts, read under the store's lock with locking reads: every committed approval counts. */
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
  const open = and(
    eq(apiHandoffs.activeSlot, 1),
    inArray(apiHandoffs.status, ["pending", "approved"]),
    gt(apiHandoffs.expiresAt, now),
  );
  const [connectionOpen] = await tx
    .select({ count: count(), first: min(apiHandoffs.expiresAt) })
    .from(apiHandoffs)
    .where(and(ofConnection, open))
    .for("share");
  const [lastHour] = await tx
    .select({ count: count(), first: min(apiHandoffs.createdAt) })
    .from(apiHandoffs)
    .where(and(ofConnection, gt(apiHandoffs.createdAt, new Date(now.getTime() - HOUR_MS))))
    .for("share");
  const [storeOpen] = await tx
    .select({ count: count(), first: min(apiHandoffs.expiresAt) })
    .from(apiHandoffs)
    .where(and(ofStore, open))
    .for("share");
  return {
    connectionOpen: { count: connectionOpen?.count ?? 0, firstEnd: connectionOpen?.first ?? null },
    connectionLastHour: { count: lastHour?.count ?? 0, firstAt: lastHour?.first ?? null },
    storeOpen: { count: storeOpen?.count ?? 0, firstEnd: storeOpen?.first ?? null },
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
    const now = await databaseNow(tx);
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
