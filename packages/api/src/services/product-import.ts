import {
  categories,
  db,
  importRecords,
  importRows,
  importRuns,
  nextCategorySlug,
  nextProductSlug,
  productCategories,
  products,
  reservationItems,
} from "@louez/db";
import type { Transaction } from "@louez/db";
import type { ImportDuplicateStrategy } from "@louez/types";
import { pricingModeToMinutes } from "@louez/utils";
import {
  type ProductImportRowInput,
  suggestProductImportMapping,
  transformProductImportRow,
} from "@louez/validations";
import { and, asc, count, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";

import {
  EMPTY_IMPORT_COUNTS,
  type ImportPlannedAction,
  type ImportPreviewRow,
  getOwnedRun,
  withImportRunLock,
} from "./customer-import";
import { ApiServiceError } from "./errors";

const CHUNK_SIZE = 100;
const PREVIEW_SAMPLE = 50;
const UNTOUCHED_TOLERANCE_MS = 5000;

export async function createProductImportRun(params: {
  storeId: string;
  userId: string | null;
  source: string;
  fileName: string | null;
  columns: string[];
}) {
  const mapping = suggestProductImportMapping(params.columns);
  const [run] = await db
    .insert(importRuns)
    .values({
      storeId: params.storeId,
      entityType: "products",
      source: params.source,
      fileName: params.fileName,
      mapping,
      counts: EMPTY_IMPORT_COUNTS,
      createdByUserId: params.userId,
    })
    .$returningId();
  return { id: run.id, mapping };
}

const normalizeName = (name: string) => name.trim().toLowerCase();

interface ExistingProduct {
  description: string | null;
  price: string;
  quantity: number;
  trackUnits: boolean;
}

/**
 * What an import may change on a product that already exists. Its photos,
 * deposit, categories and unit tracking were set up by hand and are never
 * touched. "Fill empty" only ever adds a missing description.
 */
export function resolveProductChanges(
  existing: ExistingProduct,
  input: Pick<ProductImportRowInput, "description" | "price" | "quantity">,
  strategy: ImportDuplicateStrategy,
) {
  const changes: { description?: string; price?: string; quantity?: number } = {};
  if (input.description && !existing.description) changes.description = input.description;
  if (strategy !== "overwrite") return changes;

  if (input.description && input.description !== existing.description) {
    changes.description = input.description;
  }
  if (Number(input.price) !== Number(existing.price)) changes.price = input.price;
  if (input.quantity !== null && !existing.trackUnits && input.quantity !== existing.quantity) {
    changes.quantity = input.quantity;
  }
  return changes;
}

/** The store's live products by lowercased name: what a row without an external id is matched on. */
async function loadExistingProducts(storeId: string) {
  const rows = await db
    .select({
      name: products.name,
      description: products.description,
      price: products.price,
      quantity: products.quantity,
      trackUnits: products.trackUnits,
    })
    .from(products)
    .where(and(eq(products.storeId, storeId), ne(products.status, "archived")));
  return new Map(rows.map((row) => [normalizeName(row.name), row]));
}

export async function previewProductImport(params: {
  storeId: string;
  runId: string;
  remainingQuota: number | null;
}) {
  const run = await getOwnedRun(params.storeId, params.runId);
  const mapping = run.mapping ?? {};
  const rows = await db
    .select({ rowIndex: importRows.rowIndex, payload: importRows.payload })
    .from(importRows)
    .where(eq(importRows.runId, run.id))
    .orderBy(asc(importRows.rowIndex));

  const existing = await loadExistingProducts(params.storeId);
  const seen = new Set<string>();
  let quota = params.remainingQuota;
  const counts = { create: 0, update: 0, skip: 0, error: 0 };
  const samples: Record<ImportPlannedAction, ImportPreviewRow[]> = {
    create: [],
    update: [],
    skip: [],
    error: [],
  };

  for (const row of rows) {
    const { input, errors, warnings } = transformProductImportRow(row.payload, mapping);
    let action: ImportPlannedAction;
    let reasons: string[] = [];

    if (!input) {
      action = "error";
      reasons = errors.map((error) => error.code);
    } else if (seen.has(normalizeName(input.name))) {
      action = "skip";
      reasons = ["duplicateInFile"];
    } else if (existing.has(normalizeName(input.name))) {
      const current = existing.get(normalizeName(input.name));
      const changes =
        current && run.duplicateStrategy !== "skip"
          ? resolveProductChanges(current, input, run.duplicateStrategy)
          : {};
      action = Object.keys(changes).length > 0 ? "update" : "skip";
      if (action === "skip") {
        reasons = [run.duplicateStrategy === "skip" ? "productAlreadyExists" : "nothingToUpdate"];
      }
    } else if (quota !== null && quota <= 0) {
      action = "skip";
      reasons = ["planLimit"];
    } else {
      action = "create";
      if (quota !== null) quota -= 1;
    }
    if (input) seen.add(normalizeName(input.name));

    counts[action] += 1;
    if (samples[action].length < PREVIEW_SAMPLE) {
      samples[action].push({
        rowIndex: row.rowIndex,
        payload: row.payload,
        action,
        reasons,
        warnings: warnings.map((warning) => warning.code),
      });
    }
  }

  // Products carry no dates: the order is reported for a uniform preview shape.
  return { total: rows.length, counts, samples, dateOrder: "dmy" as const };
}

/** The category of that name, created on the fly: a catalogue arrives with its own families. */
async function resolveCategoryId(tx: Transaction, storeId: string, name: string | null) {
  if (!name) return null;
  const [found] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(eq(categories.storeId, storeId), sql`LOWER(${categories.name}) = ${name.toLowerCase()}`),
    )
    .limit(1);
  if (found) return found.id;

  const [created] = await tx
    .insert(categories)
    .values({ storeId, name, slug: await nextCategorySlug(tx, storeId, name) })
    .$returningId();
  return created.id;
}

const previousValuesSchema = z.object({
  description: z.string().nullable().optional(),
  price: z.string().optional(),
  quantity: z.number().optional(),
});

async function writeRow(
  tx: Transaction,
  params: {
    storeId: string;
    run: { id: string; source: string; duplicateStrategy: ImportDuplicateStrategy };
    input: ProductImportRowInput;
    canCreate: boolean;
  },
): Promise<{
  status: "created" | "updated" | "skipped";
  entityId: string | null;
  reason?: string;
  previousValues?: Record<string, unknown>;
}> {
  const { storeId, run, input } = params;

  const provenance = input.externalId
    ? await tx.query.importRecords.findFirst({
        columns: { entityId: true },
        where: and(
          eq(importRecords.storeId, storeId),
          eq(importRecords.source, run.source),
          eq(importRecords.entityType, "products"),
          eq(importRecords.externalId, input.externalId),
        ),
      })
    : undefined;

  const [existing] = await tx
    .select({
      id: products.id,
      description: products.description,
      price: products.price,
      quantity: products.quantity,
      trackUnits: products.trackUnits,
    })
    .from(products)
    .where(
      and(
        eq(products.storeId, storeId),
        ne(products.status, "archived"),
        provenance
          ? eq(products.id, provenance.entityId)
          : sql`LOWER(${products.name}) = ${normalizeName(input.name)}`,
      ),
    )
    .limit(1)
    .for("update");

  const recordProvenance = async (entityId: string) => {
    if (!input.externalId) return;
    await tx
      .insert(importRecords)
      .values({
        storeId,
        source: run.source,
        entityType: "products",
        externalId: input.externalId,
        entityId,
        runId: run.id,
      })
      .onDuplicateKeyUpdate({ set: { entityId, runId: run.id } });
  };

  if (!existing) {
    if (!params.canCreate) return { status: "skipped", entityId: null, reason: "planLimit" };
    const categoryId = await resolveCategoryId(tx, storeId, input.category);
    const now = new Date();
    // A draft: the merchant reviews photos, deposit and rates before it reaches the storefront.
    const [created] = await tx
      .insert(products)
      .values({
        storeId,
        name: input.name,
        slug: await nextProductSlug(tx, storeId, input.name),
        description: input.description,
        categoryId,
        price: input.price,
        deposit: input.deposit ?? "0",
        pricingMode: input.pricingMode,
        basePeriodMinutes: pricingModeToMinutes(input.pricingMode),
        quantity: input.quantity ?? 1,
        status: "draft",
        images: [],
        createdAt: now,
        updatedAt: now,
      })
      .$returningId();
    if (categoryId) {
      await tx
        .insert(productCategories)
        .values({ productId: created.id, categoryId, position: 0 })
        .onDuplicateKeyUpdate({ set: { position: 0 } });
    }
    await recordProvenance(created.id);
    return { status: "created", entityId: created.id };
  }

  if (run.duplicateStrategy === "skip") {
    return { status: "skipped", entityId: existing.id, reason: "productAlreadyExists" };
  }

  const changes = resolveProductChanges(existing, input, run.duplicateStrategy);

  if (Object.keys(changes).length === 0) {
    await recordProvenance(existing.id);
    return { status: "skipped", entityId: existing.id, reason: "nothingToUpdate" };
  }

  await tx
    .update(products)
    .set({ ...changes, updatedAt: new Date() })
    .where(and(eq(products.id, existing.id), eq(products.storeId, storeId)));
  await recordProvenance(existing.id);

  return {
    status: "updated",
    entityId: existing.id,
    previousValues: {
      ...("description" in changes ? { description: existing.description } : {}),
      ...("price" in changes ? { price: existing.price } : {}),
      ...("quantity" in changes ? { quantity: existing.quantity } : {}),
    },
  };
}

export async function processProductImportChunk(params: {
  storeId: string;
  runId: string;
  remainingQuota: number | null;
}) {
  return withImportRunLock(params, async () => {
    const run = await getOwnedRun(params.storeId, params.runId);
    if (run.status !== "running") {
      return { status: run.status, counts: run.counts ?? EMPTY_IMPORT_COUNTS };
    }

    const mapping = run.mapping ?? {};
    const pending = await db
      .select({ id: importRows.id, payload: importRows.payload })
      .from(importRows)
      .where(and(eq(importRows.runId, run.id), eq(importRows.status, "pending")))
      .orderBy(asc(importRows.rowIndex))
      .limit(CHUNK_SIZE);

    const counts = { ...(run.counts ?? EMPTY_IMPORT_COUNTS) };
    let quota = params.remainingQuota;

    for (const row of pending) {
      const result = transformProductImportRow(row.payload, mapping);
      if (!result.input) {
        counts.errors += 1;
        await db
          .update(importRows)
          .set({ status: "error", errors: result.errors, updatedAt: new Date() })
          .where(eq(importRows.id, row.id));
        continue;
      }

      const input = result.input;
      try {
        const outcome = await db.transaction((tx) =>
          writeRow(tx, {
            storeId: params.storeId,
            run,
            input,
            canCreate: quota === null || quota > 0,
          }),
        );
        if (outcome.status === "created" && quota !== null) quota -= 1;
        counts[outcome.status] += 1;
        await db
          .update(importRows)
          .set({
            status: outcome.status,
            entityId: outcome.entityId,
            errors: outcome.reason ? [{ field: null, code: outcome.reason }] : null,
            previousValues: outcome.previousValues ?? null,
            updatedAt: new Date(),
          })
          .where(eq(importRows.id, row.id));
      } catch {
        counts.errors += 1;
        await db
          .update(importRows)
          .set({
            status: "error",
            errors: [{ field: null, code: "writeFailed" }],
            updatedAt: new Date(),
          })
          .where(eq(importRows.id, row.id));
      }
    }

    const [{ remaining }] = await db
      .select({ remaining: count() })
      .from(importRows)
      .where(and(eq(importRows.runId, run.id), eq(importRows.status, "pending")));
    const done = remaining === 0;

    await db
      .update(importRuns)
      .set({
        counts,
        status: done ? "completed" : "running",
        completedAt: done ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(importRuns.id, run.id));

    return { status: done ? ("completed" as const) : ("running" as const), counts };
  });
}

/**
 * Undoes a catalogue import: products it created are removed unless they have
 * since been rented or edited, products it updated get their previous values
 * back. Categories it created are left in place: a category is cheap, and it
 * may already hold products added by hand.
 */
export async function revertProductImport(storeId: string, runId: string) {
  const run = await getOwnedRun(storeId, runId);
  if (run.status !== "completed") {
    throw new ApiServiceError("BAD_REQUEST", "errors.import.notRevertible");
  }

  const rows = await db
    .select({
      status: importRows.status,
      entityId: importRows.entityId,
      previousValues: importRows.previousValues,
      processedAt: importRows.updatedAt,
    })
    .from(importRows)
    .where(and(eq(importRows.runId, run.id), inArray(importRows.status, ["created", "updated"])));

  let reverted = 0;
  let kept = 0;

  for (const row of rows) {
    if (!row.entityId) continue;
    const entityId = row.entityId;
    const done = await db.transaction(async (tx) => {
      const [product] = await tx
        .select({ id: products.id, updatedAt: products.updatedAt })
        .from(products)
        .where(and(eq(products.id, entityId), eq(products.storeId, storeId)))
        .for("update");
      if (!product) return false;

      if (row.status === "created") {
        const [{ total }] = await tx
          .select({ total: count() })
          .from(reservationItems)
          .where(eq(reservationItems.productId, entityId));
        const touched =
          product.updatedAt.getTime() > row.processedAt.getTime() + UNTOUCHED_TOLERANCE_MS;
        if (total > 0 || touched) return false;
        await tx.delete(productCategories).where(eq(productCategories.productId, entityId));
        await tx.delete(importRecords).where(eq(importRecords.entityId, entityId));
        await tx
          .delete(products)
          .where(and(eq(products.id, entityId), eq(products.storeId, storeId)));
        return true;
      }

      const previous = previousValuesSchema.safeParse(row.previousValues ?? {});
      if (!previous.success) return false;
      const { description, price, quantity } = previous.data;
      await tx
        .update(products)
        .set({
          ...(description !== undefined ? { description } : {}),
          ...(price !== undefined ? { price } : {}),
          ...(quantity !== undefined ? { quantity } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(products.id, entityId), eq(products.storeId, storeId)));
      return true;
    });
    if (done) reverted += 1;
    else kept += 1;
  }

  await db
    .update(importRuns)
    .set({ status: "reverted", revertedAt: new Date(), updatedAt: new Date() })
    .where(eq(importRuns.id, run.id));

  return { reverted, kept };
}
