import { customerFieldDefinitions, customerFieldTargets, customerFieldValues, db } from "@louez/db";
import { normalizeAxisKey } from "@louez/utils";
import {
  CUSTOMER_FIELD_LIMITS,
  customerFieldCreateInputSchema,
  customerFieldDefinitionSchema,
  customerFieldReorderInputSchema,
  customerFieldSectionOnlineInputSchema,
  customerFieldTemplateAdoptInputSchema,
  customerFieldUpdateInputSchema,
  customerProfileFieldUpdateInputSchema,
  fieldAppliesToProduct,
  mergeCustomerFieldOnlineSettings,
  resolvedCustomerProfileSettingsSchema,
  type CustomerFieldCreateInput,
  type CustomerFieldUpdateInput,
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
import {
  countItemFieldValues,
  filterOwnedTargets,
  getProductCategoryIds,
  listCustomerFieldTargetOptions,
  removeItemFieldValues,
  replaceCustomerFieldTargets,
} from "../../services/customer-fields-online";
import {
  getCustomerProfileSettings,
  updateCustomerProfileField,
} from "../../services/customer-profile-fields";

const definitionWithUsageSchema = customerFieldDefinitionSchema.extend({
  /**
   * Customers (customer scope) or rented units (item scope) holding a value:
   * a field with values is archived, not deleted by accident.
   */
  valueCount: z.number(),
});

/**
 * Every definition, archived ones included, with its usage. Targets whose
 * product or category no longer exists are left out, so the editor never
 * shows a nameless chip and the next save drops them.
 */
const listWithUsage = async (storeId: string) => {
  const [definitions, customerUsage, itemUsage] = await Promise.all([
    listCustomerFieldDefinitions(storeId, { scope: "all" }),
    countCustomerFieldValues(storeId),
    countItemFieldValues(storeId),
  ]);
  const owned = new Set(
    (
      await filterOwnedTargets(
        storeId,
        definitions.flatMap((definition) => definition.targets),
      )
    ).map((target) => `${target.type}:${target.id}`),
  );
  return definitions.map((definition) => ({
    ...definition,
    targets: definition.targets.filter((target) => owned.has(`${target.type}:${target.id}`)),
    valueCount: (definition.scope === "item" ? itemUsage : customerUsage).get(definition.id) ?? 0,
  }));
};

const list = dashboardProcedure
  .output(z.array(definitionWithUsageSchema))
  .handler(async ({ context }) => listWithUsage(context.store.id));

const KEY_MAX_LENGTH = 64;

// Accents are dropped first so "Numéro de pièce" reads `numero_de_piece`, not `num_ro_de_pi_ce`.
// The variant axis normaliser itself stays as is: its keys are already stored.
const toFieldKey = (input: Pick<CustomerFieldCreateInput, "key" | "label">) =>
  normalizeAxisKey((input.key ?? input.label).normalize("NFKD").replace(/\p{M}+/gu, "")).slice(
    0,
    KEY_MAX_LENGTH,
  );

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
  scope: input.scope,
  collectMode: input.collectMode,
  targetMode: input.targetMode,
  customerEditable: input.customerEditable,
});

/**
 * Adds fields by stable key. Idempotent by (storeId, key): adopting a template
 * twice, or two people clicking at once, lands on the unique constraint and
 * leaves the existing field (scope and targets included) as the merchant
 * configured it. Targets are only written for fields this call created.
 */
const insertFields = async (storeId: string, inputs: CustomerFieldCreateInput[]) => {
  await db.transaction(async (tx) => {
    const [{ maxPosition }] = await tx
      .select({ maxPosition: sql<number>`COALESCE(MAX(${customerFieldDefinitions.position}), 0)` })
      .from(customerFieldDefinitions)
      .where(eq(customerFieldDefinitions.storeId, storeId));

    const keys = inputs.map(toFieldKey);
    if (keys.some((key) => !key)) {
      throw new ORPCError("BAD_REQUEST", { message: "errors.invalidData" });
    }
    const existingKeys = new Set(
      (
        await tx
          .select({ key: customerFieldDefinitions.key })
          .from(customerFieldDefinitions)
          .where(
            and(
              eq(customerFieldDefinitions.storeId, storeId),
              inArray(customerFieldDefinitions.key, keys),
            ),
          )
      ).map((row) => row.key),
    );

    for (const [index, input] of inputs.entries()) {
      await tx
        .insert(customerFieldDefinitions)
        .values(toInsertValues(storeId, input, Number(maxPosition) + index + 1))
        .onDuplicateKeyUpdate({ set: { updatedAt: new Date() } });
    }

    const targeted = inputs.filter(
      (input) => input.targets.length > 0 && !existingKeys.has(toFieldKey(input)),
    );
    if (targeted.length > 0) {
      const created = await tx
        .select({ id: customerFieldDefinitions.id, key: customerFieldDefinitions.key })
        .from(customerFieldDefinitions)
        .where(
          and(
            eq(customerFieldDefinitions.storeId, storeId),
            inArray(customerFieldDefinitions.key, targeted.map(toFieldKey)),
          ),
        );
      const idByKey = new Map(created.map((row) => [row.key, row.id]));
      for (const input of targeted) {
        const definitionId = idByKey.get(toFieldKey(input));
        if (!definitionId) continue;
        await replaceCustomerFieldTargets(tx, {
          storeId,
          definitionIds: [definitionId],
          targets: input.targets,
        });
      }
    }

    assertWithinLimits(await listCustomerFieldDefinitions(storeId, { scope: "all" }, tx));
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
    columns: { id: true, type: true, scope: true, collectMode: true, customerEditable: true },
    where: and(eq(customerFieldDefinitions.id, id), eq(customerFieldDefinitions.storeId, storeId)),
  });
  if (!definition) throw new ORPCError("NOT_FOUND", { message: "errors.invalidData" });
  return definition;
};

/** An item-scope field keeps the customer-record switches off (the schema cannot know the stored scope). */
const turnsOnCustomerOnlyFlag = (input: CustomerFieldUpdateInput) =>
  Boolean(input.isRequired || input.isSearchable || input.showInList) ||
  (input.appliesTo !== undefined && input.appliesTo !== "all");

/** Only the keys the input carries change; `targets` is a replace-all when present. */
const update = requirePermission("manage_settings")
  .input(customerFieldUpdateInputSchema)
  .output(z.array(definitionWithUsageSchema))
  .handler(async ({ context, input }) => {
    const storeId = context.store.id;
    const definition = await findOwnedDefinition(storeId, input.id);
    const { id, options, unit, format, helpText, targets, collectMode, customerEditable, ...rest } =
      input;

    if (definition.type === "select" && options !== undefined && (options?.length ?? 0) === 0) {
      throw new ORPCError("BAD_REQUEST", { message: "errors.optionsRequired" });
    }
    if (definition.scope === "item" && turnsOnCustomerOnlyFlag(input)) {
      throw new ORPCError("BAD_REQUEST", { message: "errors.invalidData" });
    }
    const online = mergeCustomerFieldOnlineSettings(definition, { collectMode, customerEditable });
    if (!online) throw new ORPCError("BAD_REQUEST", { message: "errors.invalidData" });

    await db.transaction(async (tx) => {
      await tx
        .update(customerFieldDefinitions)
        .set({
          ...rest,
          ...online,
          ...(options !== undefined && definition.type === "select" ? { options } : {}),
          ...(unit !== undefined && definition.type === "number" ? { unit: unit || null } : {}),
          ...(format !== undefined && definition.type === "text" ? { format: format ?? null } : {}),
          ...(helpText !== undefined ? { helpText: helpText || null } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(eq(customerFieldDefinitions.id, id), eq(customerFieldDefinitions.storeId, storeId)),
        );
      if (targets !== undefined) {
        await replaceCustomerFieldTargets(tx, { storeId, definitionIds: [id], targets });
      }
      assertWithinLimits(await listCustomerFieldDefinitions(storeId, { scope: "all" }, tx));
    });
    return listWithUsage(storeId);
  });

/**
 * "Réservation en ligne…" of a section: the same online settings on every
 * active field in it, both scopes, in one transaction. Used right after
 * adopting a template ("Pour quels produits ?").
 */
const updateSectionOnline = requirePermission("manage_settings")
  .input(customerFieldSectionOnlineInputSchema)
  .output(z.array(definitionWithUsageSchema))
  .handler(async ({ context, input }) => {
    const storeId = context.store.id;
    await db.transaction(async (tx) => {
      const inSection = await tx
        .select({ id: customerFieldDefinitions.id })
        .from(customerFieldDefinitions)
        .where(
          and(
            eq(customerFieldDefinitions.storeId, storeId),
            eq(customerFieldDefinitions.section, input.section),
            eq(customerFieldDefinitions.isActive, true),
          ),
        );
      const ids = inSection.map((row) => row.id);
      if (ids.length === 0) return;

      await tx
        .update(customerFieldDefinitions)
        .set({
          collectMode: input.collectMode,
          targetMode: input.targetMode,
          customerEditable: input.customerEditable,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(customerFieldDefinitions.storeId, storeId),
            inArray(customerFieldDefinitions.id, ids),
          ),
        );
      await replaceCustomerFieldTargets(tx, {
        storeId,
        definitionIds: ids,
        targets: input.targets,
      });
    });
    return listWithUsage(storeId);
  });

/** Categories and products for the "Pour" picker and the preview's product picker. */
const targetOptions = dashboardProcedure
  .output(
    z.object({
      categories: z.array(z.object({ id: z.string(), name: z.string() })),
      products: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          status: z.enum(["draft", "active", "archived"]),
          image: z.string().nullable(),
          categoryIds: z.array(z.string()),
        }),
      ),
    }),
  )
  .handler(async ({ context }) => listCustomerFieldTargetOptions(context.store.id));

/**
 * Active fields that concern this product, both scopes and every collect
 * mode, in editor order. The product page decides what to show.
 */
const forProduct = dashboardProcedure
  .input(z.object({ productId: z.string().min(1).max(21) }))
  .output(z.array(customerFieldDefinitionSchema))
  .handler(async ({ context, input }) => {
    const storeId = context.store.id;
    const categoryIds = await getProductCategoryIds(storeId, [input.productId]);
    const productCategoryIds = categoryIds.get(input.productId);
    if (!productCategoryIds) {
      throw new ORPCError("NOT_FOUND", { message: "errors.productNotFound" });
    }
    const definitions = await listCustomerFieldDefinitions(storeId, {
      activeOnly: true,
      scope: "all",
    });
    return definitions.filter((definition) =>
      fieldAppliesToProduct(definition, { id: input.productId, categoryIds: productCategoryIds }),
    );
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

/**
 * Permanent: the field, its targets and every value held for it, on customer
 * records and on reservation units alike. Archiving is
 * `update({ id, isActive: false })`.
 */
const remove = requirePermission("manage_settings")
  .input(z.object({ id: z.string().length(21) }))
  .output(z.array(definitionWithUsageSchema))
  .handler(async ({ context, input }) => {
    const storeId = context.store.id;
    const definition = await findOwnedDefinition(storeId, input.id);
    await db.transaction(async (tx) => {
      if (definition.scope === "item") {
        await removeItemFieldValues(tx, storeId, input.id);
      }
      await tx
        .delete(customerFieldValues)
        .where(
          and(
            eq(customerFieldValues.storeId, storeId),
            eq(customerFieldValues.definitionId, input.id),
          ),
        );
      await tx
        .delete(customerFieldTargets)
        .where(
          and(
            eq(customerFieldTargets.storeId, storeId),
            eq(customerFieldTargets.definitionId, input.id),
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
 * Birth date, customer source and social links: shown on the record or not,
 * required by the team or not, and asked online like a custom field. Targets
 * pointing at deleted products or categories are left out.
 */
const profileSettings = dashboardProcedure
  .output(resolvedCustomerProfileSettingsSchema)
  .handler(async ({ context }) => {
    const settings = await getCustomerProfileSettings(context.store.id);
    if (!settings) throw new ORPCError("NOT_FOUND", { message: "errors.storeNotFound" });
    return settings;
  });

/**
 * One native field's settings. Only the keys sent change (`targets` replaces
 * the list); hiding a field stops asking it online, `never` takes the
 * customer's edit right with it. Answers every native field, resolved.
 */
const updateProfileField = requirePermission("manage_settings")
  .input(customerProfileFieldUpdateInputSchema)
  .output(resolvedCustomerProfileSettingsSchema)
  .handler(async ({ context, input }) => {
    const result = await updateCustomerProfileField(context.store.id, input);
    if (!result.ok) {
      throw result.error === "storeNotFound"
        ? new ORPCError("NOT_FOUND", { message: "errors.storeNotFound" })
        : new ORPCError("BAD_REQUEST", { message: "errors.invalidData" });
    }
    return result.settings;
  });

export const dashboardCustomerFieldsRouter = {
  list,
  create,
  adoptTemplate,
  update,
  updateSectionOnline,
  targetOptions,
  forProduct,
  reorder,
  remove,
  renameSection,
  duplicates,
  profileSettings,
  updateProfileField,
};
