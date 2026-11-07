import { randomBytes } from "node:crypto";

import { apiConfirmations, db, type Transaction } from "@louez/db";
import { and, eq, gt, isNull, lt } from "drizzle-orm";

import type { StoreActor } from "./actor";
import { apiError, platformErrors } from "./errors";
import { sha256, stableStringify } from "./hash";

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
 * Asks for a confirmation before a sensitive operation, when the actor's
 * connection wants one (`confirmSensitive`). Call it in the handler, after
 * the checks and before the first write.
 *
 * - No confirmation wanted (dashboard session, connection set to run
 *   directly): returns at once.
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
 * the same agent can send both calls. Human approval comes with lot 2c.
 */
export async function requireConfirmation(input: ConfirmationCheck): Promise<void> {
  const refusal = await checkConfirmation(input);
  if (refusal) throw refusal;
}

export interface ConfirmationCheck {
  actor: StoreActor;
  headers: Headers;
  procedure: string;
  input: unknown;
  state: unknown;
  preview: ConfirmationPreview;
  /**
   * The transaction the operation runs in, when it asks under a lock: the
   * token is consumed, or the new preview recorded, on its connection, so a
   * lock holder never waits for another connection of the pool.
   */
  executor?: Transaction;
  now?: Date;
}

/**
 * `requireConfirmation` without the throw: null when the operation may go
 * on, else the error to answer. A new preview is recorded on `executor`, so
 * a caller inside a transaction must commit it (not roll back) and throw the
 * error once the transaction is over.
 */
export async function checkConfirmation(input: ConfirmationCheck) {
  if (!input.actor.credential.confirmSensitive) return null;

  const executor = input.executor ?? db;
  const now = input.now ?? new Date();
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
    return result.affectedRows === 1 ? null : platformErrors.confirmationInvalid();
  }

  // Expired previews are useless: drop the store's own as new ones come
  // (only its own: a caller under a store lock must not wait on other stores).
  await executor
    .delete(apiConfirmations)
    .where(
      and(eq(apiConfirmations.storeId, input.actor.storeId), lt(apiConfirmations.expiresAt, now)),
    );

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
