import {
  importCreateRunInputSchema,
  importMappingSchema,
  importStageRowsInputSchema,
  importUpdateRowInputSchema,
  importUpdateRunInputSchema,
} from "@louez/validations";
import { z } from "zod";

import { requirePermission } from "../../procedures";
import {
  createCustomerImportRun,
  getImportErrorRows,
  getImportRun,
  listImportRuns,
  previewCustomerImport,
  processCustomerImportChunk,
  revertCustomerImport,
  stageImportRows,
  startCustomerImport,
  updateImportRow,
  updateImportRun,
} from "../../services/customer-import";
import {
  createProductImportRun,
  previewProductImport,
  processProductImportChunk,
  revertProductImport,
} from "../../services/product-import";
import { toORPCError } from "../../utils/orpc-error";

// Importing rewrites the customer base: owners only, like exporting it.
const importProcedure = requirePermission("manage_settings");

const runIdInput = z.object({ runId: z.string().length(21) });

const countsSchema = z.object({
  total: z.number(),
  created: z.number(),
  updated: z.number(),
  skipped: z.number(),
  errors: z.number(),
});

const statusSchema = z.enum(["draft", "ready", "running", "completed", "failed", "reverted"]);

const previewRowSchema = z.object({
  rowIndex: z.number(),
  payload: z.record(z.string(), z.string()),
  action: z.enum(["create", "update", "skip", "error"]),
  reasons: z.array(z.string()),
  warnings: z.array(z.string()),
});

const guarded = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (error) {
    throw toORPCError(error);
  }
};

const createRun = importProcedure
  .input(importCreateRunInputSchema)
  .output(z.object({ id: z.string(), mapping: importMappingSchema }))
  .handler(({ context, input }) => {
    const params = {
      storeId: context.store.id,
      userId: context.session.user?.id ?? null,
      source: input.source,
      fileName: input.fileName ?? null,
      columns: input.columns,
    };
    return guarded(() =>
      input.entityType === "products"
        ? createProductImportRun(params)
        : createCustomerImportRun(params),
    );
  });

const stageRows = importProcedure
  .input(importStageRowsInputSchema)
  .output(z.object({ staged: z.number() }))
  .handler(({ context, input }) =>
    guarded(() => stageImportRows({ storeId: context.store.id, ...input })),
  );

const updateRun = importProcedure
  .input(importUpdateRunInputSchema)
  .output(z.object({ success: z.literal(true) }))
  .handler(({ context, input }) =>
    guarded(async () => {
      await updateImportRun({ storeId: context.store.id, ...input });
      return { success: true as const };
    }),
  );

const updateRow = importProcedure
  .input(importUpdateRowInputSchema)
  .output(z.object({ success: z.literal(true) }))
  .handler(({ context, input }) =>
    guarded(async () => {
      await updateImportRow({ storeId: context.store.id, ...input });
      return { success: true as const };
    }),
  );

const get = importProcedure
  .input(runIdInput)
  .output(
    z.object({
      id: z.string(),
      entityType: z.enum(["customers", "products"]),
      source: z.string(),
      fileName: z.string().nullable(),
      status: statusSchema,
      duplicateStrategy: z.enum(["fill_empty", "overwrite", "skip"]),
      mapping: importMappingSchema.nullable(),
      counts: countsSchema.nullable(),
      staged: z.number(),
    }),
  )
  .handler(({ context, input }) => guarded(() => getImportRun(context.store.id, input.runId)));

const preview = importProcedure
  .input(runIdInput)
  .output(
    z.object({
      total: z.number(),
      counts: z.object({
        create: z.number(),
        update: z.number(),
        skip: z.number(),
        error: z.number(),
      }),
      samples: z.object({
        create: z.array(previewRowSchema),
        update: z.array(previewRowSchema),
        skip: z.array(previewRowSchema),
        error: z.array(previewRowSchema),
      }),
      dateOrder: z.enum(["dmy", "mdy"]),
    }),
  )
  .handler(({ context, input }) =>
    guarded(async () => {
      const storeId = context.store.id;
      const run = await getImportRun(storeId, input.runId);
      return run.entityType === "products"
        ? previewProductImport({
            storeId,
            runId: input.runId,
            remainingQuota: (await context.getRemainingProductQuota?.(storeId)) ?? null,
          })
        : previewCustomerImport({
            storeId,
            runId: input.runId,
            defaultCountry: context.store.settings?.country ?? "FR",
            remainingQuota: (await context.getRemainingCustomerQuota?.(storeId)) ?? null,
          });
    }),
  );

const start = importProcedure
  .input(runIdInput)
  .output(z.object({ success: z.literal(true) }))
  .handler(({ context, input }) =>
    guarded(async () => {
      await startCustomerImport(context.store.id, input.runId);
      return { success: true as const };
    }),
  );

/** Called in a loop by the wizard; each call moves the import forward by one chunk. */
const processNext = importProcedure
  .input(runIdInput)
  .output(z.object({ status: statusSchema, counts: countsSchema }))
  .handler(({ context, input }) =>
    guarded(async () => {
      const storeId = context.store.id;
      const run = await getImportRun(storeId, input.runId);
      return run.entityType === "products"
        ? processProductImportChunk({
            storeId,
            runId: input.runId,
            remainingQuota: (await context.getRemainingProductQuota?.(storeId)) ?? null,
          })
        : processCustomerImportChunk({
            storeId,
            runId: input.runId,
            defaultCountry: context.store.settings?.country ?? "FR",
            remainingQuota: (await context.getRemainingCustomerQuota?.(storeId)) ?? null,
          });
    }),
  );

const revert = importProcedure
  .input(runIdInput)
  .output(z.object({ reverted: z.number(), kept: z.number() }))
  .handler(({ context, input }) =>
    guarded(async () => {
      const run = await getImportRun(context.store.id, input.runId);
      return run.entityType === "products"
        ? revertProductImport(context.store.id, input.runId)
        : revertCustomerImport(context.store.id, input.runId);
    }),
  );

const list = importProcedure
  .output(
    z.array(
      z.object({
        id: z.string(),
        entityType: z.enum(["customers", "products"]),
        source: z.string(),
        fileName: z.string().nullable(),
        status: statusSchema,
        counts: countsSchema.nullable(),
        createdAt: z.date(),
        completedAt: z.date().nullable(),
      }),
    ),
  )
  .handler(({ context }) => guarded(() => listImportRuns(context.store.id)));

const errorRows = importProcedure
  .input(runIdInput)
  .output(
    z.array(
      z.object({
        rowIndex: z.number(),
        payload: z.record(z.string(), z.string()),
        errors: z.array(z.object({ field: z.string().nullable(), code: z.string() })).nullable(),
      }),
    ),
  )
  .handler(({ context, input }) =>
    guarded(() => getImportErrorRows(context.store.id, input.runId)),
  );

export const dashboardImportsRouter = {
  createRun,
  stageRows,
  updateRun,
  updateRow,
  get,
  preview,
  start,
  processNext,
  revert,
  list,
  errorRows,
};
