import {
  VARIANT_STORE_MAX,
  VARIANT_USAGE_PRODUCTS_MAX,
  VARIANT_VALUE_MAX,
  createVariantValueInput,
  createVariantValueOutput,
  deleteVariantDefinitionOutput,
  deleteVariantValueOutput,
  ensureVariantDefinitionInput,
  ensureVariantDefinitionOutput,
  getVariantUsageInput,
  getVariantUsageOutput,
  listVariantsInput,
  listVariantsOutput,
  setVariantDefinitionActiveInput,
  setVariantDefinitionActiveOutput,
  updateVariantDefinitionInput,
  updateVariantValueInput,
  variantDefinitionSchema,
  variantIdInput,
  variantValueSchema,
  withdrawVariantOutput,
} from "../../contracts/product-variants";
import { productLinks } from "../../platform/links";
import { storeProcedure } from "../../platform/procedures";
import * as variants from "../../services/product-variants";
import { confirmUnderLock, productActor } from "./product-context";

/**
 * The store's variant catalog on every transport, as part of the products
 * router (`dashboard.products.*`): the sizes, colors and custom variants its
 * products are booked by, and their values. The logic is in
 * services/product-variants.ts.
 */

const VARIANT_HELP =
  "A variant (size, color…) is shared by the store's products: a product books by it when it is one of the product's bookingAttributeAxes (by its key), and each unit carries one of its values in its attributes. products_update sets those.";
const CONFIRM_HELP = "The first call answers CONFIRMATION_REQUIRED with a preview.";

/** The REST reference's own texts (`.route({ description })`), for a developer. */
const REST_VARIANT_HELP =
  "A variant (size, color…) is shared by the store's products: a product books by it when its key is one of the product's `bookingAttributeAxes`, and each of its units then carries one of its values in `attributes`. `PATCH /products/{id}` sets both.";

const REST_CONFIRM =
  "It asks for a confirmation first (412 `CONFIRMATION_REQUIRED`) on a key that asks for confirmations, with a preview";

export const listVariants = storeProcedure
  .meta({
    capability: "products.listVariants",
    scope: { domain: "products", level: "read" },
    mcp: {
      name: "products_list_variants",
      title: "List Variants",
      description: `List the store's variants with their values, in the catalog's order. ${VARIANT_HELP} Returns up to \`limit\` variants (${VARIANT_STORE_MAX} at most and by default) and a nextCursor; nextCursor is null on the last page.`,
      bundle: "catalog",
    },
  })
  .route({
    method: "GET",
    path: "/variants",
    description: `Lists the store's variants with their values, in the catalog's order. Returns up to \`limit\` variants (${VARIANT_STORE_MAX} by default and at most, as many as a store may hold); pass \`nextCursor\` back as \`cursor\` to read on; it is null on the last page. ${REST_VARIANT_HELP}`,
  })
  .input(listVariantsInput)
  .output(listVariantsOutput)
  .handler(({ context, input }) => variants.listVariants(context.actor.storeId, input));

export const ensureVariantDefinition = storeProcedure
  .meta({
    capability: "products.ensureVariantDefinition",
    scope: { domain: "products", level: "write" },
    mcp: {
      name: "products_create_variant",
      title: "Create Variant",
      description: `Add a variant to the store's catalog, with values to start with. A variant with the same key (derived from the label when none is sent) is returned as is, with created false. ${VARIANT_HELP} Returns the variant.`,
      bundle: "catalog",
      effect: "additive",
      reach: "public",
      annotations: { idempotentHint: true },
    },
  })
  .route({
    method: "POST",
    path: "/variants",
    description: `Adds a variant to the store's catalog: its \`label\` (2 to 50 characters), its \`kind\` (\`size\`, \`color\` or \`custom\`, the default), its \`key\` (up to 32 characters, derived from the label by default) and up to 100 \`values\` to start with, each with its \`colorHex\` for a color. A key, or a label without a key, that has no letter or digit is refused with \`VARIANT_INVALID\`. When the store already has a variant with that key, it is returned as is, with \`created: false\`; the starting values are only added to a variant that has none yet. A store holds at most ${VARIANT_STORE_MAX} variants (\`VARIANT_LIMIT_REACHED\`). Returns the variant with its values. ${REST_VARIANT_HELP}`,
  })
  .input(ensureVariantDefinitionInput)
  .output(ensureVariantDefinitionOutput)
  .handler(({ context, input }) => variants.ensureVariantDefinition(context.actor.storeId, input));

export const updateVariantDefinition = storeProcedure
  .meta({
    capability: "products.updateVariantDefinition",
    scope: { domain: "products", level: "write" },
    mcp: {
      name: "products_update_variant",
      title: "Update Variant",
      description:
        "Rename a variant. Its key stays, so the products that book by it keep it. Returns the variant.",
      bundle: "catalog",
      effect: "overwrite",
      reach: "public",
      annotations: { idempotentHint: true },
    },
  })
  .route({
    method: "PATCH",
    path: "/variants/{id}",
    description:
      "Renames a variant (`label`, 2 to 50 characters). Its `key` stays, so the products that book by it keep it. Returns the variant with its values.",
  })
  .input(updateVariantDefinitionInput)
  .output(variantDefinitionSchema)
  .handler(({ context, input }) => variants.updateVariantDefinition(context.actor.storeId, input));

export const setVariantDefinitionActive = storeProcedure
  .meta({
    capability: "products.setVariantDefinitionActive",
    scope: { domain: "products", level: "write" },
    mcp: {
      name: "products_set_variant_active",
      title: "Turn Variant On or Off",
      description:
        "Turn a variant on or off. Off only stops offering it when editing products: the products that carry it keep it. products_withdraw_variant takes it off them.",
      bundle: "catalog",
      effect: "overwrite",
      reach: "public",
      annotations: { idempotentHint: true },
    },
  })
  .route({
    method: "POST",
    path: "/variants/{id}/active",
    description:
      "Turns a variant on or off (`isActive`). Off only stops offering it when editing products: the products that carry it keep it, and `POST /variants/{id}/withdraw` takes it off them. Returns the variant's id and `isActive`.",
  })
  .input(setVariantDefinitionActiveInput)
  .output(setVariantDefinitionActiveOutput)
  .handler(({ context, input }) =>
    variants.setVariantDefinitionActive(context.actor.storeId, input),
  );

export const deleteVariantDefinition = storeProcedure
  .meta({
    capability: "products.deleteVariantDefinition",
    scope: { domain: "products", level: "write", role: "delete" },
    sensitive: "destructive",
    mcp: {
      name: "products_delete_variant",
      title: "Delete Variant",
      description: `Delete a variant and its values from the catalog. Refused with VARIANT_IN_USE, naming the products, while products use it (products_withdraw_variant takes it off them). ${CONFIRM_HELP}`,
      bundle: "catalog",
      effect: "delete",
      // The marketplace export also matches a variant by its label, so a
      // delete the in-use check allows can still change exported swatches.
      reach: "public",
    },
  })
  .route({
    method: "DELETE",
    path: "/variants/{id}",
    description: `Deletes a variant and its values from the catalog. Refused with \`VARIANT_IN_USE\` while products use it, as a booking axis or through their units' values: \`details.productCount\` counts them and \`details.products\` names them. \`GET /variants/usage\` lists them too, and \`POST /variants/{id}/withdraw\` takes the variant off them. ${REST_CONFIRM} of the variant and how many values it has. Returns the variant's id.`,
  })
  .input(variantIdInput)
  .output(deleteVariantDefinitionOutput)
  .handler(({ context, input, path }) =>
    variants.deleteVariantDefinition(context.actor.storeId, input.id, {
      confirm: confirmUnderLock(context, path, input, (preview) => ({
        // Refused while a product uses it: only the catalog's entry goes.
        consequences: ["change"],
        state: preview.definition,
        details: {
          variant: { id: preview.definition.id, label: preview.definition.label },
          valueCount: preview.definition.valueIds.length,
        },
      })),
    }),
  );

export const getVariantUsage = storeProcedure
  .meta({
    capability: "products.getVariantUsage",
    scope: { domain: "products", level: "read" },
    mcp: {
      name: "products_get_variant_usage",
      title: "Get Variant Usage",
      description:
        "Which products use each variant, as a booking axis or through their units' values: what products_withdraw_variant would change, and what keeps products_delete_variant from deleting it. Each product has `links` with its dashboard page, the URL to give the user. Pass definitionId for one variant.",
      bundle: "catalog",
    },
  })
  .route({
    method: "GET",
    path: "/variants/usage",
    description: `Says which products use each variant, as a booking axis or through their units' values: what \`POST /variants/{id}/withdraw\` would change, and what keeps \`DELETE /variants/{id}\` from deleting it. Pass \`definitionId\` for one variant; by default, every variant. Each comes with its \`productCount\` and its \`products\`, the first ${VARIANT_USAGE_PRODUCTS_MAX} by name, each with \`links.dashboard\`, its page in the Louez dashboard.`,
  })
  .input(getVariantUsageInput)
  .output(getVariantUsageOutput)
  .handler(async ({ context, input }) => {
    const usage = await variants.getVariantUsage(context.actor.storeId, input);
    return {
      items: usage.items.map((item) => ({
        ...item,
        products: item.products.map((product) => ({
          ...product,
          links: productLinks(context.ports.urls, context.store, product),
        })),
      })),
    };
  });

export const withdrawVariantFromProducts = storeProcedure
  .meta({
    capability: "products.withdrawVariantFromProducts",
    scope: { domain: "products", level: "write" },
    sensitive: "destructive",
    mcp: {
      name: "products_withdraw_variant",
      title: "Withdraw Variant from Products",
      description: `Withdraw a variant from every product of the store at once: it is no longer one of their booking axes, their units lose their value for it, and their stock and bookings stop being split by it. The variant stays in the catalog. ${CONFIRM_HELP} Returns how many products changed.`,
      bundle: "catalog",
      effect: "delete",
      reach: "public",
      annotations: { idempotentHint: true },
    },
  })
  .route({
    method: "POST",
    path: "/variants/{id}/withdraw",
    description: `Withdraws a variant from every product of the store at once: it is no longer one of their booking axes, their units lose their value for it, and their stock and bookings stop being split by it. The variant stays in the catalog. ${REST_CONFIRM} of the products it changes (their count, and the first 50). Returns \`affectedProductCount\`, how many products changed.`,
  })
  .input(variantIdInput)
  .output(withdrawVariantOutput)
  .handler(({ context, input, path }) =>
    variants.withdrawVariantFromProducts(productActor(context), input.id, {
      confirm: confirmUnderLock(context, path, input, (preview) => ({
        // The units of the products that use it lose their values for it.
        consequences: preview.products.length > 0 ? ["deletion"] : ["change"],
        state: {
          definition: preview.definition,
          productIds: preview.products.map((product) => product.id),
        },
        details: {
          variant: { id: preview.definition.id, label: preview.definition.label },
          productCount: preview.products.length,
          products: preview.products.slice(0, 50),
        },
      })),
    }),
  );

export const createVariantValue = storeProcedure
  .meta({
    capability: "products.createVariantValue",
    scope: { domain: "products", level: "write" },
    mcp: {
      name: "products_create_variant_value",
      title: "Add Variant Value",
      description:
        "Add a value to a variant, e.g. XL to Size; a color variant takes its swatch in colorHex. A value with the same label (case-insensitive) is returned with created false, its color updated when one is sent. Returns the value.",
      bundle: "catalog",
      effect: "overwrite",
      reach: "public",
      annotations: { idempotentHint: true },
    },
  })
  .route({
    method: "POST",
    path: "/variants/{definitionId}/values",
    description: `Adds a value to a variant, e.g. XL to Size: its \`label\` (1 to 100 characters) and, for a color variant, its swatch in \`colorHex\` (\`#RRGGBB\`). When the variant already has a value of that label, whatever its case, that value is returned with \`created: false\`, its color updated when one is sent. A variant holds at most ${VARIANT_VALUE_MAX} values (\`VARIANT_VALUE_LIMIT_REACHED\`). Returns the value.`,
  })
  .input(createVariantValueInput)
  .output(createVariantValueOutput)
  .handler(({ context, input }) => variants.createVariantValue(context.actor.storeId, input));

export const updateVariantValue = storeProcedure
  .meta({
    capability: "products.updateVariantValue",
    scope: { domain: "products", level: "write" },
    mcp: {
      name: "products_update_variant_value",
      title: "Update Variant Value",
      description:
        "Rename a variant's value or change its color. Send only the fields to change; colorHex null clears the color. Units that carry the former label keep it. Returns the value.",
      bundle: "catalog",
      effect: "overwrite",
      reach: "public",
      annotations: { idempotentHint: true },
    },
  })
  .route({
    method: "PATCH",
    path: "/variants/values/{id}",
    description:
      "Renames a variant's value or changes its color. Send only the fields to change; `colorHex: null` clears the color. Refused with `VARIANT_VALUE_EXISTS` when the variant has another value of that label, whatever its case. Units that carry the former label keep it. Returns the value.",
  })
  .input(updateVariantValueInput)
  .output(variantValueSchema)
  .handler(({ context, input }) => variants.updateVariantValue(context.actor.storeId, input));

export const deleteVariantValue = storeProcedure
  .meta({
    capability: "products.deleteVariantValue",
    scope: { domain: "products", level: "write", role: "delete" },
    sensitive: "destructive",
    mcp: {
      name: "products_delete_variant_value",
      title: "Delete Variant Value",
      description: `Delete a value from a variant's catalog: it is no longer offered to products. Units that carry it keep it; the preview names their products. ${CONFIRM_HELP}`,
      bundle: "catalog",
      effect: "delete",
      reach: "public",
    },
  })
  .route({
    method: "DELETE",
    path: "/variants/values/{id}",
    description: `Deletes a value from a variant's catalog: it is no longer offered to products. Units that carry it keep it. ${REST_CONFIRM} naming the products whose units carry it (their count, and the first 50). Returns the value's id.`,
  })
  .input(variantIdInput)
  .output(deleteVariantValueOutput)
  .handler(({ context, input, path }) =>
    variants.deleteVariantValue(context.actor.storeId, input.id, {
      confirm: confirmUnderLock(context, path, input, (preview) => ({
        // Units that carry the value keep it: only the catalog's entry goes.
        consequences: ["change"],
        state: {
          value: preview.value,
          definition: preview.definition,
          productIds: preview.products.map((product) => product.id),
        },
        details: {
          value: preview.value,
          variant: preview.definition,
          productCount: preview.products.length,
          products: preview.products.slice(0, 50),
        },
      })),
    }),
  );
