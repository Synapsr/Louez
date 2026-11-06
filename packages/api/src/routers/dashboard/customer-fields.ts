import { customerFieldDefinitions, customerFieldValues, db, stores } from "@louez/db";
import { normalizeAxisKey } from "@louez/utils";
import {
  CUSTOMER_FIELD_LIMITS,
  customerFieldCreateInputSchema,
  customerFieldDefinitionSchema,
  customerFieldReorderInputSchema,
  customerFieldTemplateAdoptInputSchema,
  customerFieldUpdateInputSchema,
  customerProfileSettingsSchema,
  type CustomerFieldCreateInput,
} from "@louez/validations";
import { ORPCError } from "@orpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { dashboardProcedure, requirePermission } from "../../procedures";
import {
  countCustomerFieldValues,
  findCustomerFieldDuplicates,
  listCustomerFieldDefinitions,
} from "../../services/customer-fields";

const definitionWithUsageSchema = customerFieldDefinitionSchema.extend({
  /** Customers holding a value: a field with values is archived, not deleted by accident. */
  valueCount: z.number(),
});

const listWithUsage = async (storeId: string) => {
  const [definitions, usage] = await Promise.all([
    listCustomerFieldDefinitions(storeId),
    countCustomerFieldValues(storeId),
  ]);
  return definitions.map((definition) => ({
    ...definition,
    valueCount: usage.get(definition.id) ?? 0,
  }));
};

const list = dashboardProcedure
  .output(z.array(definitionWithUsageSchema))
  .handler(async ({ context }) => listWithUsage(context.store.id));

const KEY_MAX_LENGTH = 64;

const toFieldKey = (input: Pick<CustomerFieldCreateInput, "key" | "label">) =>
  normalizeAxisKey(input.key ?? input.label).slice(0, KEY_MAX_LENGTH);

/** Refuses a change that would push the store past the editor's guard rails. */
const assertWithinLimits = (
  definitions: Awaited<ReturnType<typeof listCustomerFieldDefinitions>>,
) => {
  const active = definitions.filter((definition) => definition.isActive);
  if (active.length > CUSTOMER_FIELD_LIMITS.activeFields) {
    throw new ORPCError("BAD_REQUEST", { message: "errors.customerFields.tooManyFields" });
  }
  if (
    active.filter((definition) => definition.isSearchable).length >
    CUSTOMER_FIELD_LIMITS.searchableFields
  ) {
    throw new ORPCError("BAD_REQUEST", { message: "errors.customerFields.tooManySearchable" });
  }
  if (
    active.filter((definition) => definition.showInList).length > CUSTOMER_FIELD_LIMITS.listFields
  ) {
    throw new ORPCError("BAD_REQUEST", { message: "errors.customerFields.tooManyListFields" });
  }
};

const toInsertValues = (storeId: string, input: CustomerFieldCreateInput, position: number) => ({
  storeId,
  key: toFieldKey(input),
  label: input.label,
  type: input.type,
  format: input.type === "text" ? (input.format ?? null) : null,
  options: input.type === "select" ? (input.options ?? null) : null,
  unit: input.type === "number" ? input.unit || null : null,
  helpText: input.helpText || null,
  section: input.section,
  position,
  appliesTo: input.appliesTo,
  isRequired: input.isRequired,
  isSensitive: input.isSensitive,
  showOnContract: input.showOnContract,
  isSearchable: input.isSearchable,
  showInList: input.showInList,
  templateKey: input.templateKey || null,
});

/**
 * Adds fields by stable key. Idempotent by (storeId, key): adopting a template
 * twice, or two people clicking at once, lands on the unique constraint and
 * leaves the existing field as the merchant configured it.
 */
const insertFields = async (storeId: string, inputs: CustomerFieldCreateInput[]) => {
  await db.transaction(async (tx) => {
    const [{ maxPosition }] = await tx
      .select({ maxPosition: sql<number>`COALESCE(MAX(${customerFieldDefinitions.position}), 0)` })
      .from(customerFieldDefinitions)
      .where(eq(customerFieldDefinitions.storeId, storeId));

    for (const [index, input] of inputs.entries()) {
      if (!toFieldKey(input)) {
        throw new ORPCError("BAD_REQUEST", { message: "errors.invalidData" });
      }
      await tx
        .insert(customerFieldDefinitions)
        .values(toInsertValues(storeId, input, Number(maxPosition) + index + 1))
        .onDuplicateKeyUpdate({ set: { updatedAt: new Date() } });
    }

    assertWithinLimits(await listCustomerFieldDefinitions(storeId, {}, tx));
  });
  return listWithUsage(storeId);
};

const create = requirePermission("manage_settings")
  .input(customerFieldCreateInputSchema)
  .output(z.array(definitionWithUsageSchema))
  .handler(async ({ context, input }) => insertFields(context.store.id, [input]));

const adoptTemplate = requirePermission("manage_settings")
  .input(customerFieldTemplateAdoptInputSchema)
  .output(z.array(definitionWithUsageSchema))
  .handler(async ({ context, input }) =>
    insertFields(
      context.store.id,
      input.fields.map((field) => ({ ...field, templateKey: input.templateKey })),
    ),
  );

const findOwnedDefinition = async (storeId: string, id: string) => {
  const definition = await db.query.customerFieldDefinitions.findFirst({
    columns: { id: true, type: true },
    where: and(eq(customerFieldDefinitions.id, id), eq(customerFieldDefinitions.storeId, storeId)),
  });
  if (!definition) throw new ORPCError("NOT_FOUND", { message: "errors.invalidData" });
  return definition;
};

const update = requirePermission("manage_settings")
  .input(customerFieldUpdateInputSchema.extend({ isActive: z.boolean().optional() }))
  .output(z.array(definitionWithUsageSchema))
  .handler(async ({ context, input }) => {
    const storeId = context.store.id;
    const definition = await findOwnedDefinition(storeId, input.id);
    const { id, options, unit, format, helpText, ...rest } = input;

    if (definition.type === "select" && options !== undefined && (options?.length ?? 0) === 0) {
      throw new ORPCError("BAD_REQUEST", { message: "errors.optionsRequired" });
    }

    await db.transaction(async (tx) => {
      await tx
        .update(customerFieldDefinitions)
        .set({
          ...rest,
          ...(options !== undefined && definition.type === "select" ? { options } : {}),
          ...(unit !== undefined && definition.type === "number" ? { unit: unit || null } : {}),
          ...(format !== undefined && definition.type === "text" ? { format: format ?? null } : {}),
          ...(helpText !== undefined ? { helpText: helpText || null } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(eq(customerFieldDefinitions.id, id), eq(customerFieldDefinitions.storeId, storeId)),
        );
      assertWithinLimits(await listCustomerFieldDefinitions(storeId, {}, tx));
    });
    return listWithUsage(storeId);
  });

const reorder = requirePermission("manage_settings")
  .input(customerFieldReorderInputSchema)
  .output(z.array(definitionWithUsageSchema))
  .handler(async ({ context, input }) => {
    const storeId = context.store.id;
    await db.transaction(async (tx) => {
      for (const [index, field] of input.fields.entries()) {
        await tx
          .update(customerFieldDefinitions)
          .set({ position: index + 1, section: field.section, updatedAt: new Date() })
          .where(
            and(
              eq(customerFieldDefinitions.id, field.id),
              eq(customerFieldDefinitions.storeId, storeId),
            ),
          );
      }
    });
    return listWithUsage(storeId);
  });

/** Permanent: the field and every value customers hold for it. Archiving is `update({ isActive: false })`. */
const remove = requirePermission("manage_settings")
  .input(z.object({ id: z.string().length(21) }))
  .output(z.array(definitionWithUsageSchema))
  .handler(async ({ context, input }) => {
    const storeId = context.store.id;
    await findOwnedDefinition(storeId, input.id);
    await db.transaction(async (tx) => {
      await tx
        .delete(customerFieldValues)
        .where(
          and(
            eq(customerFieldValues.storeId, storeId),
            eq(customerFieldValues.definitionId, input.id),
          ),
        );
      await tx
        .delete(customerFieldDefinitions)
        .where(
          and(
            eq(customerFieldDefinitions.id, input.id),
            eq(customerFieldDefinitions.storeId, storeId),
          ),
        );
    });
    return listWithUsage(storeId);
  });

const renameSection = requirePermission("manage_settings")
  .input(
    z.object({
      from: z.string().trim().min(1).max(100),
      to: z.string().trim().min(1).max(100),
    }),
  )
  .output(z.array(definitionWithUsageSchema))
  .handler(async ({ context, input }) => {
    const storeId = context.store.id;
    const inSection = await db
      .select({ id: customerFieldDefinitions.id })
      .from(customerFieldDefinitions)
      .where(
        and(
          eq(customerFieldDefinitions.storeId, storeId),
          eq(customerFieldDefinitions.section, input.from),
        ),
      );
    if (inSection.length > 0) {
      await db
        .update(customerFieldDefinitions)
        .set({ section: input.to, updatedAt: new Date() })
        .where(
          and(
            eq(customerFieldDefinitions.storeId, storeId),
            inArray(
              customerFieldDefinitions.id,
              inSection.map((row) => row.id),
            ),
          ),
        );
    }
    return listWithUsage(storeId);
  });

const duplicates = dashboardProcedure
  .input(
    z.object({
      definitionId: z.string().length(21),
      value: z.string().trim().min(1).max(2000),
      excludeCustomerId: z.string().length(21).optional(),
    }),
  )
  .output(
    z.array(
      z.object({
        customerId: z.string(),
        firstName: z.string(),
        lastName: z.string(),
        companyName: z.string().nullable(),
      }),
    ),
  )
  .handler(async ({ context, input }) =>
    findCustomerFieldDuplicates({ storeId: context.store.id, ...input }),
  );

/**
 * Visibility of the native optional blocks. The rest of the settings JSON is
 * re-read and kept as is: a stale client copy must not overwrite other groups.
 */
const updateProfileSettings = requirePermission("manage_settings")
  .input(customerProfileSettingsSchema)
  .output(customerProfileSettingsSchema)
  .handler(async ({ context, input }) => {
    const current = await db.query.stores.findFirst({
      where: eq(stores.id, context.store.id),
      columns: { settings: true },
    });
    if (!current) throw new ORPCError("NOT_FOUND", { message: "errors.storeNotFound" });

    const settings = current.settings ?? {
      reservationMode: "payment" as const,
      advanceNoticeMinutes: 1440,
    };
    const customerProfile = { ...settings.customerProfile, ...input };
    await db
      .update(stores)
      .set({ settings: { ...settings, customerProfile }, updatedAt: new Date() })
      .where(eq(stores.id, context.store.id));
    return customerProfile;
  });

export const dashboardCustomerFieldsRouter = {
  list,
  create,
  adoptTemplate,
  update,
  reorder,
  remove,
  renameSection,
  duplicates,
  updateProfileSettings,
};
