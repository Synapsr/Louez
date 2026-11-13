/**
 * A fixture router for the transport tests (exposure, OpenAPI, MCP bridge,
 * parity). Not served by the app.
 */
import { z } from "zod";

import { requireConfirmation } from "./confirmation";
import { storeProcedure } from "./procedures";

/** The fixture's paths, in the order a registry would list them. */
export const FIXTURE_EXPOSED = ["fixture.notes.list", "fixture.notes.remove"] as const;

const noteSchema = z.object({ id: z.string(), title: z.string(), createdAt: z.date() });

/**
 * Two procedures on the `categories` domain: a read, and a sensitive write
 * that asks for a confirmation and counts its runs (an idempotent replay does
 * not run it again). Each call builds fresh procedures and a fresh counter.
 */
export function createFixtureRouter() {
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

  return { fixture: { notes: { list, remove } } };
}
