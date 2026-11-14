/**
 * A fixture router for the transport tests (exposure, OpenAPI, MCP bridge,
 * parity). Not served by the app.
 */
import { categories, db, retryTransactionOnDeadlock, stores } from "@louez/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { categoryErrors } from "../contracts/categories";
import { CONSEQUENCES, type Consequence } from "./approval-rule";
import { checkConfirmation, raiseConfirmation, requireConfirmation } from "./confirmation";
import { platformErrors } from "./errors";
import { sha256 } from "./hash";
import type { ProcedureScope } from "./permissions";
import type { ApprovalDisplay } from "../services/approval-display";
import { storeProcedure } from "./procedures";

/** The fixture's paths, in the order a registry would list them. */
export const FIXTURE_EXPOSED = ["fixture.notes.list", "fixture.notes.remove"] as const;

const noteSchema = z.object({ id: z.string(), title: z.string(), createdAt: z.date() });

const ERASE_SCOPE: ProcedureScope = { domain: "categories", level: "write", role: "delete" };

/**
 * Procedures on the `categories` domain: a read, and two sensitive writes.
 * `remove` asks for a confirmation and counts its runs (an idempotent replay
 * does not run it again). `erase` asks as a write does, in its transaction,
 * under its domain's lock, for the consequences its input declares, and once
 * it may erases the note (a category of the store, by its id) under that
 * lock, and no other: it never takes the store's row. A note that is not
 * there is refused (`CATEGORY_NOT_FOUND`) after it asked, and its
 * transaction rolls back with what asking did: a person's approval runs
 * through it.
 * Each call builds fresh procedures and a fresh counter.
 *
 * `liveConsequences` makes consequences live for `erase` alone, as
 * `APPROVAL_LIVE` will for the procedures Louez serves; nothing else names
 * them, and no request can (`checkConfirmation` refuses them in production).
 * `deadlocksBeforeCommit` makes `erase`'s transaction fail that many times
 * with a deadlock once it has asked (refused or let through), as a write
 * retried on a deadlock does;
 * `whileAsked` runs in that transaction once it has asked, its locks held;
 * `display` builds what a person reads first from the input, as a branch a
 * person approves builds it from its preview's values.
 */
export function createFixtureRouter(
  options: {
    liveConsequences?: readonly Consequence[];
    deadlocksBeforeCommit?: number;
    whileAsked?: () => Promise<void>;
    display?: (input: { id: string; amount?: number }, store: { name: string }) => ApprovalDisplay;
  } = {},
) {
  let runs = 0;
  let deadlocks = options.deadlocksBeforeCommit ?? 0;

  const list = storeProcedure
    .meta({
      capability: "fixture.notes.list",
      scope: { domain: "categories", level: "read" },
      mcp: {
        name: "fixture_notes_list",
        title: "List Notes",
        description: "List the store's notes. A fixture for tests.",
        bundle: "catalog",
      },
    })
    .input(z.object({ prefix: z.string().max(20).optional() }))
    .output(z.object({ storeId: z.string(), items: z.array(noteSchema) }))
    .handler(async ({ context, input }) => ({
      storeId: context.actor.storeId,
      items: [
        {
          id: "note_1",
          title: `${input.prefix ?? ""}First`,
          createdAt: new Date("2026-01-02T03:04:05.000Z"),
        },
      ],
    }));

  const remove = storeProcedure
    .meta({
      capability: "fixture.notes.remove",
      scope: { domain: "categories", level: "write", role: "delete" },
      sensitive: "destructive",
      mcp: {
        name: "fixture_notes_remove",
        title: "Remove Note",
        description: "Remove a note. A fixture for tests.",
        bundle: "catalog",
        effect: "delete",
      },
    })
    .input(z.object({ id: z.string().min(1) }))
    .output(z.object({ id: z.string(), removed: z.boolean(), runs: z.number() }))
    .handler(async ({ context, input, path }) => {
      await requireConfirmation({
        consequences: ["deletion"],
        actor: context.actor,
        headers: context.headers,
        procedure: path.join("."),
        input,
        state: { id: input.id },
        preview: { summary: `Remove note ${input.id}.`, details: { id: input.id } },
      });
      runs += 1;
      return { id: input.id, removed: true, runs };
    });

  const erase = storeProcedure
    .meta({
      capability: "fixture.notes.erase",
      scope: ERASE_SCOPE,
      sensitive: "destructive",
      mcp: {
        name: "fixture_notes_erase",
        title: "Erase Note",
        description: "Erase a note. A fixture for tests.",
        bundle: "catalog",
        effect: "delete",
      },
    })
    .input(
      z.object({
        id: z.string().min(1),
        consequences: z.tuple([z.enum(CONSEQUENCES)], z.enum(CONSEQUENCES)),
        amount: z.number().optional(),
        recipient: z.string().optional(),
        /** Free text: no part of the request's identity. */
        note: z.string().max(200).optional(),
      }),
    )
    .output(z.object({ id: z.string(), erased: z.boolean(), runs: z.number() }))
    .handler(async ({ context, input, path }) => {
      const outcome = await retryTransactionOnDeadlock(
        () =>
          db.transaction(async (tx) => {
            // What the preview shows: the store's name, read before its lock.
            const [store] = await tx
              .select({ name: stores.name })
              .from(stores)
              .where(eq(stores.id, context.actor.storeId));
            if (!store) throw platformErrors.noStore();
            // Its domain's lock, taken before it asks, as a write under its lock
            // does: the store's categories.
            await tx
              .select({ id: categories.id })
              .from(categories)
              .where(eq(categories.storeId, context.actor.storeId))
              .for("update");
            const refusal = await checkConfirmation({
              consequences: input.consequences,
              executor: tx,
              actor: context.actor,
              headers: context.headers,
              procedure: path.join("."),
              input,
              state: { name: store.name },
              preview: {
                summary: `Erase note ${input.id} of ${store.name}.`,
                details: { id: input.id, amount: input.amount ?? null },
              },
              display: options.display?.(input, store),
              approval: {
                facts: {
                  id: input.id,
                  amount: input.amount ?? null,
                  recipient: input.recipient ? sha256(input.recipient) : null,
                },
                scope: ERASE_SCOPE,
                urls: context.ports.urls,
              },
              liveConsequences: options.liveConsequences,
            });
            await options.whileAsked?.();
            if (deadlocks > 0) {
              deadlocks -= 1;
              throw Object.assign(new Error("Deadlock found when trying to get lock"), {
                code: "ER_LOCK_DEADLOCK",
                errno: 1213,
              });
            }
            // Refused: the transaction commits what the refusal recorded, and nothing else.
            if (refusal) return { refusal };
            const [erased] = await tx
              .delete(categories)
              .where(
                and(eq(categories.storeId, context.actor.storeId), eq(categories.id, input.id)),
              );
            if (erased.affectedRows !== 1) throw categoryErrors.notFound(input.id);
            return { refusal: null };
          }),
        { sleep: async () => {} },
      );
      // Raised once its transaction is over: an approval is requested then.
      if (outcome.refusal) return raiseConfirmation(outcome.refusal);
      runs += 1;
      return { id: input.id, erased: true, runs };
    });

  return { fixture: { notes: { list, remove, erase } } };
}
