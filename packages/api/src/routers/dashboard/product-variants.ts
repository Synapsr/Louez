import {
  VARIANT_STORE_MAX,
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
  "A variant (size, color…) is shared by the store's products: a product books by it when it is one of the product's bookingAttributeAxes (by its key), and each unit carries one of its values in its attributes. Set those with products_update.";
const CONFIRM_HELP =
  "The first call answers CONFIRMATION_REQUIRED with a preview: show it to the user, and once they confirm, call again with the same arguments and the confirmationToken.";

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
  .route({ method: "GET", path: "/variants" })
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
      annotations: { idempotentHint: true },
    },
  })
  .route({ method: "POST", path: "/variants" })
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
      annotations: { idempotentHint: true },
    },
  })
  .route({ method: "PATCH", path: "/variants/{id}" })
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
        "Turn a variant on or off. Off only stops offering it when editing products: the products that carry it keep it. To take it off them, use products_withdraw_variant.",
      bundle: "catalog",
      annotations: { idempotentHint: true },
    },
  })
  .route({ method: "POST", path: "/variants/{id}/active" })
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
      description: `Delete a variant and its values from the catalog. Refused with VARIANT_IN_USE, naming the products, while products use it: withdraw it from them first with products_withdraw_variant. ${CONFIRM_HELP}`,
      bundle: "catalog",
    },
  })
  .route({ method: "DELETE", path: "/variants/{id}" })
  .input(variantIdInput)
  .output(deleteVariantDefinitionOutput)
  .handler(({ context, input, path }) =>
    variants.deleteVariantDefinition(context.actor.storeId, input.id, {
      confirm: confirmUnderLock(context, path, input, (preview) => ({
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
  .route({ method: "GET", path: "/variants/usage" })
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
      annotations: { idempotentHint: true },
    },
  })
  .route({ method: "POST", path: "/variants/{id}/withdraw" })
  .input(variantIdInput)
  .output(withdrawVariantOutput)
  .handler(({ context, input, path }) =>
    variants.withdrawVariantFromProducts(productActor(context), input.id, {
      confirm: confirmUnderLock(context, path, input, (preview) => ({
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
      annotations: { idempotentHint: true },
    },
  })
  .route({ method: "POST", path: "/variants/{definitionId}/values" })
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
      annotations: { idempotentHint: true },
    },
  })
  .route({ method: "PATCH", path: "/variants/values/{id}" })
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
    },
  })
  .route({ method: "DELETE", path: "/variants/values/{id}" })
  .input(variantIdInput)
  .output(deleteVariantValueOutput)
  .handler(({ context, input, path }) =>
    variants.deleteVariantValue(context.actor.storeId, input.id, {
      confirm: confirmUnderLock(context, path, input, (preview) => ({
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
