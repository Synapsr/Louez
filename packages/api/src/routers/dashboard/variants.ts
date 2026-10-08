import { db, variantDefinitions, variantValues } from "@louez/db";
import { normalizeAxisKey } from "@louez/utils";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { dashboardProcedure } from "../../procedures";
import {
  findProductsUsingVariant,
  removeVariantFromStoreProducts,
} from "../../services/variant-axes";

const variantKindSchema = z.enum(["size", "color", "custom"]);

const variantValueOutputSchema = z.object({
  id: z.string(),
  label: z.string(),
  colorHex: z.string().nullable(),
  position: z.number(),
});

const variantDefinitionOutputSchema = z.object({
  id: z.string(),
  key: z.string(),
  label: z.string(),
  kind: variantKindSchema,
  isActive: z.boolean(),
  position: z.number(),
  values: z.array(variantValueOutputSchema),
});

const variantValueInputSchema = z.object({
  label: z.string().trim().min(1).max(100),
  colorHex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

const variantValueColumns = {
  id: variantValues.id,
  definitionId: variantValues.definitionId,
  label: variantValues.label,
  colorHex: variantValues.colorHex,
  position: variantValues.position,
};

async function listDefinitionsWithValues(storeId: string) {
  const definitions = await db
    .select({
      id: variantDefinitions.id,
      key: variantDefinitions.key,
      label: variantDefinitions.label,
      kind: variantDefinitions.kind,
      isActive: variantDefinitions.isActive,
      position: variantDefinitions.position,
    })
    .from(variantDefinitions)
    .where(eq(variantDefinitions.storeId, storeId))
    .orderBy(asc(variantDefinitions.position), asc(variantDefinitions.label));

  if (definitions.length === 0) return [];

  const values = await db
    .select(variantValueColumns)
    .from(variantValues)
    .where(
      inArray(
        variantValues.definitionId,
        definitions.map((definition) => definition.id),
      ),
    )
    .orderBy(asc(variantValues.position), asc(variantValues.label));

  const valuesByDefinition = new Map<string, Array<(typeof values)[number]>>();
  for (const value of values) {
    const list = valuesByDefinition.get(value.definitionId) ?? [];
    list.push(value);
    valuesByDefinition.set(value.definitionId, list);
  }

  return definitions.map((definition) => ({
    ...definition,
    values: (valuesByDefinition.get(definition.id) ?? []).map((value) => ({
      id: value.id,
      label: value.label,
      colorHex: value.colorHex,
      position: value.position,
    })),
  }));
}

const list = dashboardProcedure
  .output(z.array(variantDefinitionOutputSchema))
  .handler(async ({ context }) => listDefinitionsWithValues(context.store.id));

/**
 * Create-or-return a definition by canonical key. Used both for custom
 * definitions and for adopting a system preset (the client sends the
 * localized preset label + seed values). Idempotent: an existing definition
 * is returned as-is; seed values are only added when it has none yet.
 * It never touches products: only setDefinitionActive and deleteDefinition
 * do, since the editor calls this in the background.
 */
const ensureDefinition = dashboardProcedure
  .input(
    z.object({
      key: z.string().trim().min(1).max(32).optional(),
      label: z.string().trim().min(2).max(50),
      kind: variantKindSchema.default("custom"),
      isActive: z.boolean().default(true),
      values: z.array(variantValueInputSchema).max(100).default([]),
    }),
  )
  .output(variantDefinitionOutputSchema)
  .handler(async ({ context, input }) => {
    const key = normalizeAxisKey(input.key ?? input.label);
    if (!key) {
      throw new ORPCError("BAD_REQUEST", { message: "errors.invalidData" });
    }

    await db.transaction(async (tx) => {
      const [{ maxPosition }] = await tx
        .select({
          maxPosition: sql<number>`COALESCE(MAX(${variantDefinitions.position}), 0)`,
        })
        .from(variantDefinitions)
        .where(eq(variantDefinitions.storeId, context.store.id));

      // Idempotent by (storeId, key): a concurrent or repeated call lands on
      // the unique constraint instead of erroring.
      await tx
        .insert(variantDefinitions)
        .values({
          storeId: context.store.id,
          key,
          label: input.label,
          kind: input.kind,
          isActive: input.isActive,
          position: maxPosition + 1,
        })
        .onDuplicateKeyUpdate({ set: { updatedAt: new Date() } });

      const [definition] = await tx
        .select({ id: variantDefinitions.id })
        .from(variantDefinitions)
        .where(
          and(eq(variantDefinitions.storeId, context.store.id), eq(variantDefinitions.key, key)),
        )
        .limit(1);

      if (!definition) return;

      const [{ valueCount }] = await tx
        .select({ valueCount: sql<number>`COUNT(*)` })
        .from(variantValues)
        .where(eq(variantValues.definitionId, definition.id));

      if (Number(valueCount) === 0 && input.values.length > 0) {
        await tx
          .insert(variantValues)
          .values(
            input.values.map((value, index) => ({
              definitionId: definition.id,
              label: value.label,
              colorHex: value.colorHex ?? null,
              position: index,
            })),
          )
          .onDuplicateKeyUpdate({
            set: { position: sql`${variantValues.position}` },
          });
      }
    });

    const definitions = await listDefinitionsWithValues(context.store.id);
    const definition = definitions.find((entry) => entry.key === key);
    if (!definition) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "errors.invalidData",
      });
    }
    return definition;
  });

/**
 * Enable or disable a definition. Inactive only means "no longer offered
 * when editing products": products that already carry the variant keep it,
 * on the dashboard as in the storefront. Withdrawing it from them is a
 * separate, explicit action (`withdrawFromProducts`).
 */
const setDefinitionActive = dashboardProcedure
  .input(z.object({ id: z.string(), isActive: z.boolean() }))
  .output(z.object({ id: z.string(), isActive: z.boolean() }))
  .handler(async ({ context, input }) => {
    const [updated] = await db
      .update(variantDefinitions)
      .set({ isActive: input.isActive, updatedAt: new Date() })
      .where(
        and(eq(variantDefinitions.id, input.id), eq(variantDefinitions.storeId, context.store.id)),
      );
    if (updated.affectedRows === 0) {
      throw new ORPCError("NOT_FOUND", { message: "errors.invalidData" });
    }
    return { id: input.id, isActive: input.isActive };
  });

const productUsageSchema = z.array(z.object({ id: z.string(), name: z.string() }));

/** Which products still declare each definition as a booking axis. */
const usage = dashboardProcedure
  .output(z.array(z.object({ definitionId: z.string(), products: productUsageSchema })))
  .handler(async ({ context }) => {
    const definitions = await db
      .select({
        id: variantDefinitions.id,
        key: variantDefinitions.key,
        label: variantDefinitions.label,
      })
      .from(variantDefinitions)
      .where(eq(variantDefinitions.storeId, context.store.id));
    return Promise.all(
      definitions.map(async (definition) => ({
        definitionId: definition.id,
        products: await findProductsUsingVariant(db, {
          storeId: context.store.id,
          variant: { key: definition.key, label: definition.label },
        }),
      })),
    );
  });

/**
 * Withdraw a definition from every product of the store in one go: axes
 * dropped, unit values cleared, units and booked lines re-keyed. The owner
 * confirms it in the dashboard with the list of products in front of them.
 */
const withdrawFromProducts = dashboardProcedure
  .input(z.object({ id: z.string() }))
  .output(z.object({ id: z.string(), affectedProductCount: z.number() }))
  .handler(async ({ context, input }) => {
    const definition = await db.query.variantDefinitions.findFirst({
      columns: { id: true, key: true, label: true },
      where: and(
        eq(variantDefinitions.id, input.id),
        eq(variantDefinitions.storeId, context.store.id),
      ),
    });
    if (!definition) {
      throw new ORPCError("NOT_FOUND", { message: "errors.invalidData" });
    }
    const removed = await db.transaction((tx) =>
      removeVariantFromStoreProducts(tx, {
        storeId: context.store.id,
        variant: { key: definition.key, label: definition.label },
      }),
    );
    return { id: input.id, affectedProductCount: removed.productIds.length };
  });

/** Add a value to a definition's shared catalog (idempotent by label). */
const createValue = dashboardProcedure
  .input(
    z.object({
      definitionId: z.string(),
      label: z.string().trim().min(1).max(100),
      colorHex: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
    }),
  )
  .output(variantValueOutputSchema)
  .handler(async ({ context, input }) => {
    const definition = await db.query.variantDefinitions.findFirst({
      columns: { id: true },
      where: and(
        eq(variantDefinitions.id, input.definitionId),
        eq(variantDefinitions.storeId, context.store.id),
      ),
    });

    if (!definition) {
      throw new ORPCError("NOT_FOUND", { message: "errors.invalidData" });
    }

    const [{ maxPosition }] = await db
      .select({
        maxPosition: sql<number>`COALESCE(MAX(${variantValues.position}), 0)`,
      })
      .from(variantValues)
      .where(eq(variantValues.definitionId, input.definitionId));

    // Idempotent by (definitionId, label) — the store's collation treats
    // "m"/"M" as equal, which is exactly the dedup we want.
    await db
      .insert(variantValues)
      .values({
        definitionId: input.definitionId,
        label: input.label,
        colorHex: input.colorHex ?? null,
        position: maxPosition + 1,
      })
      .onDuplicateKeyUpdate({
        set: { colorHex: input.colorHex ?? sql`${variantValues.colorHex}` },
      });

    const [value] = await db
      .select(variantValueColumns)
      .from(variantValues)
      .where(
        and(
          eq(variantValues.definitionId, input.definitionId),
          eq(variantValues.label, input.label),
        ),
      )
      .limit(1);

    if (!value) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "errors.invalidData",
      });
    }

    return {
      id: value.id,
      label: value.label,
      colorHex: value.colorHex,
      position: value.position,
    };
  });

/** Update a value in a definition's shared catalog. */
const updateValue = dashboardProcedure
  .input(
    z.object({
      id: z.string(),
      label: z.string().trim().min(1).max(100),
      colorHex: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .nullable()
        .optional(),
    }),
  )
  .output(variantValueOutputSchema)
  .handler(async ({ context, input }) => {
    const [value] = await db
      .select({
        id: variantValues.id,
        definitionId: variantValues.definitionId,
      })
      .from(variantValues)
      .innerJoin(variantDefinitions, eq(variantDefinitions.id, variantValues.definitionId))
      .where(and(eq(variantValues.id, input.id), eq(variantDefinitions.storeId, context.store.id)))
      .limit(1);
    if (!value) {
      throw new ORPCError("NOT_FOUND", { message: "errors.invalidData" });
    }

    const [duplicate] = await db
      .select({ id: variantValues.id })
      .from(variantValues)
      .where(
        and(
          eq(variantValues.definitionId, value.definitionId),
          ne(variantValues.id, input.id),
          eq(sql`LOWER(${variantValues.label})`, input.label.toLowerCase()),
        ),
      )
      .limit(1);
    if (duplicate) {
      throw new ORPCError("CONFLICT", { message: "errors.invalidData" });
    }

    await db
      .update(variantValues)
      .set({
        label: input.label,
        ...(input.colorHex !== undefined && { colorHex: input.colorHex }),
      })
      .where(eq(variantValues.id, input.id));

    const [updatedValue] = await db
      .select(variantValueColumns)
      .from(variantValues)
      .where(eq(variantValues.id, input.id))
      .limit(1);
    if (!updatedValue) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "errors.invalidData",
      });
    }

    return {
      id: updatedValue.id,
      label: updatedValue.label,
      colorHex: updatedValue.colorHex,
      position: updatedValue.position,
    };
  });

/** Rename a definition. The canonical key is kept so product axes stay linked. */
const updateDefinition = dashboardProcedure
  .input(z.object({ id: z.string(), label: z.string().trim().min(2).max(50) }))
  .output(z.object({ id: z.string(), label: z.string() }))
  .handler(async ({ context, input }) => {
    const definition = await db.query.variantDefinitions.findFirst({
      columns: { id: true },
      where: and(
        eq(variantDefinitions.id, input.id),
        eq(variantDefinitions.storeId, context.store.id),
      ),
    });
    if (!definition) {
      throw new ORPCError("NOT_FOUND", { message: "errors.invalidData" });
    }

    await db
      .update(variantDefinitions)
      .set({ label: input.label, updatedAt: new Date() })
      .where(eq(variantDefinitions.id, input.id));

    return { id: input.id, label: input.label };
  });

/**
 * Remove a definition and its values from the catalog. Refused while
 * products still declare the variant: `usedBy` lists them so the owner can
 * withdraw it first. Deleting underneath them would leave product axes
 * pointing at nothing.
 */
const deleteDefinition = dashboardProcedure
  .input(z.object({ id: z.string() }))
  .output(z.object({ id: z.string(), deleted: z.boolean(), usedBy: productUsageSchema }))
  .handler(async ({ context, input }) => {
    const definition = await db.query.variantDefinitions.findFirst({
      columns: { id: true, key: true, label: true },
      where: and(
        eq(variantDefinitions.id, input.id),
        eq(variantDefinitions.storeId, context.store.id),
      ),
    });
    if (!definition) {
      throw new ORPCError("NOT_FOUND", { message: "errors.invalidData" });
    }

    const usedBy = await findProductsUsingVariant(db, {
      storeId: context.store.id,
      variant: { key: definition.key, label: definition.label },
    });
    if (usedBy.length > 0) {
      return { id: input.id, deleted: false, usedBy };
    }

    await db.transaction(async (tx) => {
      await tx.delete(variantValues).where(eq(variantValues.definitionId, input.id));
      await tx.delete(variantDefinitions).where(eq(variantDefinitions.id, input.id));
    });

    return { id: input.id, deleted: true, usedBy: [] };
  });

/** Remove a value from a definition's catalog. */
const deleteValue = dashboardProcedure
  .input(z.object({ id: z.string() }))
  .output(z.object({ id: z.string() }))
  .handler(async ({ context, input }) => {
    const [value] = await db
      .select({ id: variantValues.id })
      .from(variantValues)
      .innerJoin(variantDefinitions, eq(variantDefinitions.id, variantValues.definitionId))
      .where(and(eq(variantValues.id, input.id), eq(variantDefinitions.storeId, context.store.id)))
      .limit(1);
    if (!value) {
      throw new ORPCError("NOT_FOUND", { message: "errors.invalidData" });
    }

    await db.delete(variantValues).where(eq(variantValues.id, input.id));

    return { id: input.id };
  });

/**
 * Dashboard variants router — store-level shared variant catalog
 */
export const dashboardVariantsRouter = {
  list,
  ensureDefinition,
  setDefinitionActive,
  usage,
  withdrawFromProducts,
  createValue,
  updateValue,
  updateDefinition,
  deleteDefinition,
  deleteValue,
};
