/**
 * A fixture router for the transport tests (exposure, OpenAPI, MCP bridge,
 * parity). Not served by the app.
 */
import { db, stores } from "@louez/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { CONSEQUENCES, type Consequence } from "./approval-rule";
import { checkConfirmation, requireConfirmation } from "./confirmation";
import { platformErrors } from "./errors";
import { sha256 } from "./hash";
import type { ProcedureScope } from "./permissions";
import { storeProcedure } from "./procedures";

/** The fixture's paths, in the order a registry would list them. */
export const FIXTURE_EXPOSED = ["fixture.notes.list", "fixture.notes.remove"] as const;

const noteSchema = z.object({ id: z.string(), title: z.string(), createdAt: z.date() });

const ERASE_SCOPE: ProcedureScope = { domain: "categories", level: "write", role: "delete" };

/**
 * Procedures on the `categories` domain: a read, and two sensitive writes.
 * `remove` asks for a confirmation and counts its runs (an idempotent replay
 * does not run it again). `erase` asks as a write does, in its transaction,
 * for the consequences its input declares, and writes the store's
 * description once it may: a person's approval runs through it.
 * Each call builds fresh procedures and a fresh counter.
 *
 * `liveConsequences` makes consequences live for `erase` alone, as
 * `APPROVAL_LIVE` will for the procedures Louez serves; nothing else names
 * them, and no request can (`checkConfirmation` refuses them in production).
 */
export function createFixtureRouter(options: { liveConsequences?: readonly Consequence[] } = {}) {
  let runs = 0;

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
      const outcome = await db.transaction(async (tx) => {
        // What the preview shows: the store's name, read before anything is
        // locked, so the transaction's snapshot predates what the approval
        // reads under its own lock, as a write under another lock would.
        const [store] = await tx
          .select({ name: stores.name })
          .from(stores)
          .where(eq(stores.id, context.actor.storeId));
        if (!store) throw platformErrors.noStore();
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
        // Refused: the transaction commits what the refusal recorded, and nothing else.
        if (refusal) return { refusal };
        await tx
          .update(stores)
          .set({ description: `erased ${input.id}` })
          .where(eq(stores.id, context.actor.storeId));
        return { refusal: null };
      });
      if (outcome.refusal) throw outcome.refusal;
      runs += 1;
      return { id: input.id, erased: true, runs };
    });

  return { fixture: { notes: { list, remove, erase } } };
}
