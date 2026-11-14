import { randomBytes } from "node:crypto";

import {
  apiConfirmations,
  currentApiOperation,
  db,
  unmarkSetupWrite,
  type Transaction,
} from "@louez/db";
import { and, eq, gt, isNull, lt } from "drizzle-orm";

import { requestApproval } from "../services/approvals";
import type { ScopedActor } from "./actor";
import {
  APPROVAL_LIVE,
  CONSEQUENCES,
  confirmationStep,
  isConsequence,
  type Consequence,
  type Consequences,
} from "./approval-rule";
import { apiError, platformErrors } from "./errors";
import { sha256, stableStringify } from "./hash";
import type { ProcedureScope } from "./permissions";
import type { UrlsPort } from "./ports";

/** Header that carries a confirmation token. The MCP bridge maps its `confirmationToken` argument onto it. */
export const CONFIRMATION_HEADER = "louez-confirmation";
export const CONFIRMATION_TTL_MS = 10 * 60_000;

/** What the caller is shown before a sensitive operation runs. */
export interface ConfirmationPreview {
  /** One sentence, plain English: what will happen. */
  summary: string;
  /** Facts the human should check: amounts, customer, consequences. */
  details?: Record<string, unknown>;
}

/**
 * Asks for a confirmation before a sensitive operation, as the rule decides
 * from the branch's `consequences` and the actor's credential
 * (`approvalLevel`, platform/approval-rule.ts). Call it in the handler, after
 * the checks and before the first write.
 *
 * - Nobody to ask (a dashboard session; a connection set to run directly,
 *   for what it may run directly): returns at once.
 * - No token, or a token that does not match: throws CONFIRMATION_REQUIRED
 *   with the preview and a new token.
 * - A matching token: consumes it (once) and returns.
 *
 * The token is bound to the actor, the connection, the store, the procedure,
 * the input (without the token) and `state`: the business facts the preview
 * showed (amount, recipients, the record's version). If any of them changes,
 * the token no longer works.
 *
 * This proves the caller saw the preview. It does not prove a human approved:
 * the same agent can send both calls. A person's approval is planned for the
 * actions a person must approve (docs/architecture/api-and-agents.md).
 *
 * It takes no `executor`: it throws, and a refusal thrown inside a
 * transaction would roll back the preview it records with it. A write that
 * asks under its lock, and every branch a person may have to approve, asks
 * with `checkConfirmation`, and throws its refusal once its transaction
 * committed.
 */
export async function requireConfirmation<Check extends ConfirmationCheck & { executor?: never }>(
  input: KnownCheck<Check>,
): Promise<void> {
  const refusal = await checkConfirmation(input);
  if (refusal) throw refusal;
}

/**
 * A check whose type is known. An object spread from `any` is `any`, and
 * would carry whatever `consequences` it holds at run time: it does not
 * compile. (A spread of a typed object loses its index signature, so no type
 * sees it: approval-coverage.test.ts refuses a spread in an object that
 * declares consequences.)
 */
export type KnownCheck<Check extends ConfirmationCheck> = Check &
  (0 extends 1 & Check ? never : unknown);

export interface ConfirmationCheck {
  actor: ScopedActor;
  headers: Headers;
  procedure: string;
  input: unknown;
  state: unknown;
  preview: ConfirmationPreview;
  /**
   * What the branch about to run does (`Consequence`, platform/approval-rule.ts),
   * declared with its preview: who is asked follows from it. Never inferred
   * from the procedure's `sensitive`, `effect` or `reach`. At least one, by
   * type, and checked again when it runs.
   */
  consequences: Consequences;
  /**
   * The transaction the operation runs in, when it asks under a lock: the
   * token is consumed, or the new preview recorded, on its connection, so a
   * lock holder never waits for another connection of the pool. A branch a
   * person approves needs it: its approval is written there.
   */
  executor?: Transaction;
  /**
   * What a person's approval of this branch is about, for a branch that may
   * need one (a person's level, for a consequence that is live): the
   * consequential facts that make the request's identity (the records acted
   * on, the amount and its currency, the target status, a hash of each
   * recipient; never free text such as notes or a reason), the right the
   * action needs (the procedure's scope, which the approver must hold), and
   * the URLs its link is built with. Asked for an approval without it, the
   * call throws.
   */
  approval?: {
    facts: Record<string, unknown>;
    scope: ProcedureScope;
    urls: UrlsPort;
  };
  /**
   * The consequences live for this call: `APPROVAL_LIVE` when absent, as for
   * every procedure Louez serves. Only the transport tests' fixture router
   * names it (platform/testing.ts), from the option it is built with, to
   * run an approval before any consequence is live; no request reaches it,
   * and it is refused in production.
   */
  liveConsequences?: readonly Consequence[];
  now?: Date;
}

/**
 * `requireConfirmation` without the throw: null when the operation may go
 * on, else the error to answer. A new preview, or a person's approval, is
 * recorded on `executor`, so a caller inside a transaction must commit it
 * (not roll back) and throw the error once the transaction is over: the
 * refusal is the write's only trace, as nothing of it ran (`isRefusal`).
 */
export async function checkConfirmation<Check extends ConfirmationCheck>(input: KnownCheck<Check>) {
  // The type asks for at least one, each a consequence the rule knows; a value
  // forced past it is a bug here, and must never read as "nothing to ask".
  if (
    !Array.isArray(input.consequences) ||
    input.consequences.length === 0 ||
    !input.consequences.every(isConsequence)
  ) {
    throw new Error(
      `${input.procedure}: a confirmation declares the consequences of its branch, at least one, each one of ${CONSEQUENCES.join(", ")}.`,
    );
  }
  if (input.liveConsequences !== undefined && process.env.NODE_ENV === "production") {
    throw new Error(
      `${input.procedure}: live consequences are the transport tests' fixture's alone.`,
    );
  }
  const step = confirmationStep(
    input.consequences,
    input.actor.credential,
    input.liveConsequences ?? APPROVAL_LIVE,
  );
  if (step === "none") return null;

  const bindingHash = sha256(
    stableStringify({
      userId: input.actor.credential.userId,
      credential: [input.actor.credential.kind, input.actor.credential.id],
      storeId: input.actor.storeId,
      procedure: input.procedure,
      input: input.input,
      state: input.state,
    }),
  );
  const token = input.headers.get(CONFIRMATION_HEADER);

  if (step === "approval") {
    // The approval is written in the write's transaction, under its locks,
    // and its refusal returned: the caller's commit keeps it.
    if (!input.executor || !input.approval) {
      throw new Error(
        `${input.procedure}: a branch a person approves asks with its transaction (executor) and what the approval is about (approval).`,
      );
    }
    return requestApproval({
      tx: input.executor,
      actor: input.actor,
      procedure: input.procedure,
      input: input.input,
      preview: input.preview,
      consequences: input.consequences,
      facts: input.approval.facts,
      scope: input.approval.scope,
      urls: input.approval.urls,
      bindingHash,
      presented: token,
    });
  }

  const executor = input.executor ?? db;
  const now = input.now ?? new Date();
  if (token) {
    const [result] = await executor
      .update(apiConfirmations)
      .set({ consumedAt: now })
      .where(
        and(
          eq(apiConfirmations.id, token),
          eq(apiConfirmations.storeId, input.actor.storeId),
          eq(apiConfirmations.procedure, input.procedure),
          eq(apiConfirmations.bindingHash, bindingHash),
          isNull(apiConfirmations.consumedAt),
          gt(apiConfirmations.expiresAt, now),
        ),
      );
    if (result.affectedRows !== 1) {
      if (input.executor) await unmarkSetupWrite(input.executor);
      return platformErrors.confirmationInvalid();
    }
    // The write ran on a preview the caller accepted (the setup analytics say so).
    const operation = currentApiOperation();
    if (operation) operation.confirmed = true;
    return null;
  }

  // Expired previews are useless: drop the store's own as new ones come
  // (only its own: a caller under a store lock must not wait on other stores).
  await executor
    .delete(apiConfirmations)
    .where(
      and(eq(apiConfirmations.storeId, input.actor.storeId), lt(apiConfirmations.expiresAt, now)),
    );

  // Refused for now: the write sets nothing up, though its transaction commits
  // the preview. A mark is only ever in the caller's transaction.
  if (input.executor) await unmarkSetupWrite(input.executor);
  const id = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + CONFIRMATION_TTL_MS);
  await executor.insert(apiConfirmations).values({
    id,
    storeId: input.actor.storeId,
    procedure: input.procedure,
    bindingHash,
    expiresAt,
  });

  return apiError("PRECONDITION_FAILED", "CONFIRMATION_REQUIRED", {
    message: `${input.preview.summary} Nothing was done yet. To go ahead, call again with the same input and this confirmation token.`,
    details: {
      preview: input.preview,
      confirmationToken: id,
      expiresAt: expiresAt.toISOString(),
    },
  });
}
