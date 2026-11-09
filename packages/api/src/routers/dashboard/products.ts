import {
  LEGACY_PAGE_MAX_OFFSET,
  createProductInput,
  createSeasonalPricingInput,
  deleteProductInput,
  deleteProductOutput,
  deleteSeasonalPricingOutput,
  duplicateProductInput,
  getProductInput,
  legacyListProductsInput,
  listProductsInput,
  listProductsOutput,
  listSeasonalPricingsInput,
  listSeasonalPricingsOutput,
  productActivityInput,
  productActivityOutput,
  productErrors,
  productOutput,
  productTimelineInput,
  productTimelineOutput,
  reorderProductsInput,
  reorderProductsOutput,
  seasonalPricingIdInput,
  seasonalPricingSchema,
  updateProductInput,
  updateProductStatusInput,
  updateProductStatusOutput,
  updateSeasonalPricingInput,
} from "../../contracts/products";
import {
  completeImageUploadInput,
  completeImageUploadOutput,
  createImageUploadInput,
  createImageUploadOutput,
} from "../../contracts/uploads";
import { productLinks } from "../../platform/links";
import { storeProcedure } from "../../platform/procedures";
import { getProductUnitActivityPage } from "../../services/product-activity";
import { getProductReservationTimeline } from "../../services/product-reservation-timeline";
import {
  createSeasonalPricing,
  deleteSeasonalPricing,
  duplicateSeasonalPricing,
  listSeasonalPricings,
  updateSeasonalPricing,
} from "../../services/product-seasonal-pricing";
import {
  assertOwnedProduct,
  createProduct,
  deleteProduct,
  duplicateProduct,
  getProduct,
  listProducts,
  reorderProducts,
  updateProduct,
  updateProductStatus,
} from "../../services/products";
import { completeImageUpload, createImageUpload } from "../../services/uploads";
import {
  confirmUnderLock,
  productActor,
  requireReservationsAndCustomers,
  type ProductContext,
} from "./product-context";
import {
  closeDowntime,
  declareDowntime,
  deleteDowntime,
  getUnitHistory,
  reinstateUnit,
  retireUnit,
  updateDowntime,
  updateUnitDetails,
} from "./product-units";
import {
  createVariantValue,
  deleteVariantDefinition,
  deleteVariantValue,
  ensureVariantDefinition,
  getVariantUsage,
  listVariants,
  setVariantDefinitionActive,
  updateVariantDefinition,
  updateVariantValue,
  withdrawVariantFromProducts,
} from "./product-variants";

/**
 * Products, on every transport: the dashboard (RPC), `/api/v1/products`
 * (OpenAPI) and the `products_*` MCP tools. The logic is in
 * services/products.ts and services/product-seasonal-pricing.ts; this file
 * holds the contract, the rights and the confirmations. Units and downtimes
 * are in product-units.ts, the variant catalog in product-variants.ts.
 */

const LINKS_HELP =
  "Its `links` hold the product's dashboard page and, while it is active, its storefront page, the URLs to give the user.";

/** A product, or a list item, with its links. */
const withLinks = <T extends { id: string; slug: string | null; status: string | null }>(
  context: ProductContext,
  product: T,
) => ({ ...product, links: productLinks(context.ports.urls, context.store, product) });

/** A page of products, each with its links. */
const withItemLinks = async (
  context: ProductContext,
  page: Promise<Awaited<ReturnType<typeof listProducts>>>,
) => {
  const result = await page;
  return { ...result, items: result.items.map((item) => withLinks(context, item)) };
};

const TIERS_HELP =
  'Pricing: a duration product has a base rate (basePriceDuration, e.g. { "price": "30", "duration": 1, "unit": "day" }) and optional rateTiers (prix dégressifs): each tier is the TOTAL price of a rental of exactly that duration, e.g. { "duration": 7, "unit": "day", "price": "150" } for a week. A fixed product has one price per item (pricingKind "fixed"). Seasons are set with products_create_seasonal_pricing.';

// --- Reads -------------------------------------------------------------------

const list = storeProcedure
  .meta({
    capability: "products.list",
    scope: { domain: "products", level: "read" },
    mcp: {
      name: "products_list",
      title: "List Products",
      description:
        "List the store's products in the catalog's order, with their price, stock and main category, and the count per status. Filter by status, categoryIds or part of the name. Returns up to `limit` products (default 100, at most 200) and a nextCursor for the next page; nextCursor is null on the last page. Each product has `links`: its dashboard page and, while it is active, its storefront page, the URLs to give the user. A product's tiers, units and accessories are in products_get.",
      bundle: "catalog",
    },
  })
  .route({ method: "GET", path: "/products" })
  .input(listProductsInput)
  .output(listProductsOutput)
  .handler(({ context, input }) =>
    withItemLinks(context, listProducts(productActor(context), input)),
  );

// The former list_products tool, with its offset paging: one read, counted
// once, bounded. No alias expresses a page number over a cursor.
const listLegacyPage = storeProcedure
  .meta({
    capability: "products.list",
    scope: { domain: "products", level: "read" },
    mcp: {
      name: "list_products",
      title: "List Products by Page (Former Tool)",
      description: `Former tool, kept for agents set up before; products_list replaces it. Lists the store's products by page (page, pageSize up to 100) within the first ${LEGACY_PAGE_MAX_OFFSET} products.`,
      bundle: "catalog",
      listed: false,
    },
  })
  .input(legacyListProductsInput)
  .output(listProductsOutput)
  .handler(({ context, input }) => {
    const pageSize = input.pageSize ?? 50;
    const offset = ((input.page ?? 1) - 1) * pageSize;
    if (offset >= LEGACY_PAGE_MAX_OFFSET) throw productErrors.legacyPageTooDeep();
    return withItemLinks(
      context,
      listProducts(productActor(context), {
        status: input.status,
        categoryIds: input.categoryId ? [input.categoryId] : undefined,
        search: input.search,
        limit: Math.min(pageSize, LEGACY_PAGE_MAX_OFFSET - offset),
        offset,
      }),
    );
  });

const get = storeProcedure
  .meta({
    capability: "products.get",
    scope: { domain: "products", level: "read" },
    mcp: {
      name: "products_get",
      title: "Get Product",
      description: `Get one product of the store with everything its form holds: pricing (base rate, tiers), deposit, taxes, promotion, stock and units, variants, accessories, categories, images. The answer can be edited and sent back to products_update. ${LINKS_HELP}`,
      bundle: "catalog",
      aliases: [{ name: "get_product", renamedArgs: { productId: "id" } }],
    },
  })
  .route({ method: "GET", path: "/products/{id}" })
  .input(getProductInput)
  .output(productOutput)
  .handler(async ({ context, input }) =>
    withLinks(context, await getProduct(productActor(context), input.id)),
  );

// --- Writes ------------------------------------------------------------------

const create = storeProcedure
  .meta({
    capability: "products.create",
    scope: { domain: "products", level: "write" },
    mcp: {
      name: "products_create",
      title: "Create Product",
      description: `Create a product, with everything the dashboard's product form holds. Only name and a price are required: a product is active, priced by duration, returnable and stocked 1 by default. ${TIERS_HELP} \`images\` takes the urls finished image uploads return (products_complete_image_upload). Returns the product as products_get does, with its \`links\`, the URLs to give the user to see it. An idempotencyKey makes a retry safe.`,
      bundle: "catalog",
      effect: "additive",
      reach: "public",
      aliases: [{ name: "create_product" }],
    },
  })
  .route({ method: "POST", path: "/products" })
  .input(createProductInput)
  .output(productOutput)
  .handler(async ({ context, input }) =>
    withLinks(context, await createProduct(productActor(context), input)),
  );

const update = storeProcedure
  .meta({
    capability: "products.update",
    scope: { domain: "products", level: "write" },
    sensitive: "destructive",
    mcp: {
      name: "products_update",
      title: "Update Product",
      description: `Change a product. Send only the fields to change: a field left out stays as it is; a list you send (rateTiers, accessories, units, categoryIds, images) replaces the stored one. \`price\` alone changes a duration product's base price. ${TIERS_HELP} When the change archives the product, deletes its tiers and seasons (switching to fixed pricing) or deletes units, the first call answers CONFIRMATION_REQUIRED with a preview. Returns the product. ${LINKS_HELP}`,
      bundle: "catalog",
      effect: "overwrite",
      reach: "public",
      aliases: [{ name: "update_product", renamedArgs: { productId: "id" } }],
      annotations: { idempotentHint: true },
    },
  })
  .route({ method: "PATCH", path: "/products/{id}" })
  .input(updateProductInput)
  .output(productOutput)
  .handler(async ({ context, input, path }) =>
    withLinks(
      context,
      await updateProduct(productActor(context), input, {
        // Under the update's lock: what the preview shows is what happens. A
        // change since (the product saved again, a unit, a tier, a season)
        // makes the token stale. `updatedAt` counts whole seconds, so the
        // name is bound too.
        confirm: confirmUnderLock(context, path, input, (preview) => ({
          state: {
            name: preview.product.name,
            status: preview.product.status,
            updatedAt: preview.product.updatedAt.toISOString(),
            deletedTierCount: preview.deletedTierCount,
            deletedSeasonalPricingCount: preview.deletedSeasonalPricingCount,
            // Every unit the preview names, as it names it.
            deletedUnits: preview.deletedUnits,
          },
          details: {
            product: { id: preview.product.id, name: preview.product.name },
            ...(preview.archives ? { archives: true } : {}),
            ...(preview.deletedTierCount + preview.deletedSeasonalPricingCount > 0
              ? {
                  deletesPricingTiers: preview.deletedTierCount,
                  deletesSeasonalPrices: preview.deletedSeasonalPricingCount,
                }
              : {}),
            ...(preview.deletedUnits.length > 0
              ? {
                  deletesUnitCount: preview.deletedUnits.length,
                  deletesUnits: preview.deletedUnits,
                }
              : {}),
          },
        })),
      }),
    ),
  );

const updateStatus = storeProcedure
  .meta({
    capability: "products.updateStatus",
    scope: { domain: "products", level: "write" },
    sensitive: "destructive",
    mcp: {
      name: "products_update_status",
      title: "Change Product Status",
      description:
        "Publish (active), unpublish (draft) or archive a product. Archiving takes it off the storefront and the catalog; its reservations are kept. Archiving first answers CONFIRMATION_REQUIRED with a preview. Returns the product's `links`: its dashboard page and, once active, its storefront page, the URLs to give the user.",
      bundle: "catalog",
      effect: "overwrite",
      reach: "public",
      aliases: [
        {
          name: "archive_product",
          renamedArgs: { productId: "id" },
          fixedArgs: { status: "archived" },
        },
      ],
      annotations: { idempotentHint: true },
    },
  })
  .route({ method: "POST", path: "/products/{id}/status" })
  .input(updateProductStatusInput)
  .output(updateProductStatusOutput)
  .handler(async ({ context, input, path }) => {
    const { slug, ...result } = await updateProductStatus(productActor(context), input, {
      confirm: confirmUnderLock(context, path, input, (preview) => ({
        state: {
          name: preview.product.name,
          status: preview.product.status,
          updatedAt: preview.product.updatedAt.toISOString(),
          activeReservationCount: preview.activeReservationCount,
        },
        details: {
          product: { id: preview.product.id, name: preview.product.name },
          status: preview.product.status,
          activeReservationCount: preview.activeReservationCount,
        },
      })),
    });
    return {
      ...result,
      links: productLinks(context.ports.urls, context.store, { ...result, slug }),
    };
  });

const remove = storeProcedure
  .meta({
    capability: "products.delete",
    scope: { domain: "products", level: "write", role: "delete" },
    sensitive: "destructive",
    mcp: {
      name: "products_delete",
      title: "Delete Product",
      description:
        "Delete a product for good, with its units, category and accessory links. Refused while a current or future reservation holds one of its units. Archiving it (products_update_status) only takes it off the storefront. The first call answers CONFIRMATION_REQUIRED with a preview of what is deleted.",
      bundle: "catalog",
      effect: "delete",
      reach: "public",
    },
  })
  .route({ method: "DELETE", path: "/products/{id}" })
  .input(deleteProductInput)
  .output(deleteProductOutput)
  .handler(({ context, input, path }) =>
    deleteProduct(productActor(context), input.id, {
      confirm: confirmUnderLock(context, path, input, (preview) => ({
        state: {
          name: preview.product.name,
          updatedAt: preview.product.updatedAt.toISOString(),
          unitIds: preview.units.map((unit) => unit.id),
          reservationCount: preview.reservationCount,
        },
        details: {
          product: { id: preview.product.id, name: preview.product.name },
          units: preview.units,
          reservationCount: preview.reservationCount,
        },
      })),
    }),
  );

const duplicate = storeProcedure
  .meta({
    capability: "products.duplicate",
    scope: { domain: "products", level: "write" },
    mcp: {
      name: "products_duplicate",
      title: "Duplicate Product",
      description:
        'Copy a product as a draft named "<name> (copy)", with its pricing, tiers, deposit, taxes, images and categories. Units are not copied: the copy counts the same stock without tracking units. Returns the new product, with its `links` (a draft has its dashboard page only).',
      bundle: "catalog",
      effect: "additive",
    },
  })
  .route({ method: "POST", path: "/products/{id}/duplicate" })
  .input(duplicateProductInput)
  .output(productOutput)
  .handler(async ({ context, input }) =>
    withLinks(context, await duplicateProduct(productActor(context), input.id)),
  );

const reorder = storeProcedure
  .meta({
    capability: "products.reorder",
    scope: { domain: "products", level: "write" },
    mcp: {
      name: "products_reorder",
      title: "Reorder Products",
      description:
        "Set the order of products, as the storefront and the dashboard show them. Send product ids in their new order: they swap among the places they already hold, and products left out keep theirs. Returns each sent product's new position.",
      bundle: "catalog",
      effect: "overwrite",
      reach: "public",
      annotations: { idempotentHint: true },
    },
  })
  .route({ method: "POST", path: "/products/reorder" })
  .input(reorderProductsInput)
  .output(reorderProductsOutput)
  .handler(({ context, input }) => reorderProducts(productActor(context), input.ids));

const createImageUploadProcedure = storeProcedure
  .meta({
    capability: "products.uploadImage",
    scope: { domain: "products", level: "write" },
    // The upload URL lets its bearer write to the store's storage: never stored.
    secretOutput: true,
    mcp: {
      name: "products_create_image_upload",
      title: "Start Product Image Upload",
      description:
        "Start uploading a product image (JPEG, PNG, GIF or WebP, 15 MB at most). Returns a `key` and an `upload`: send the file's bytes in that one HTTP request, as given (a PUT with its headers, or a multipart POST with its fields then the file as `file`), without an Authorization header, before `expiresAt`. products_complete_image_upload finishes it, with the key.",
      bundle: "catalog",
      effect: "additive",
    },
  })
  .route({ method: "POST", path: "/products/image-uploads" })
  .input(createImageUploadInput)
  .output(createImageUploadOutput)
  .handler(({ context, input }) =>
    createImageUpload(context.ports.storage, {
      storeId: context.actor.storeId,
      kind: "product",
      ...input,
    }),
  );

const completeImageUploadProcedure = storeProcedure
  .meta({
    capability: "products.uploadImage",
    scope: { domain: "products", level: "write" },
    mcp: {
      name: "products_complete_image_upload",
      title: "Complete Product Image Upload",
      description:
        "Finish a product image upload: checks the file that arrived at the key and returns its public `url`. That url is what a product's `images` take in products_create and products_update. A file that is not a valid image of the declared type is deleted and refused.",
      bundle: "catalog",
      effect: "additive",
      annotations: { idempotentHint: true },
    },
  })
  .route({ method: "POST", path: "/products/image-uploads/complete" })
  .input(completeImageUploadInput)
  .output(completeImageUploadOutput)
  .handler(({ context, input }) =>
    completeImageUpload(context.ports.storage, {
      storeId: context.actor.storeId,
      kind: "product",
      key: input.key,
    }),
  );

// --- Activity and timeline ---------------------------------------------------

const getActivity = storeProcedure
  .meta({
    capability: "products.getActivity",
    scope: { domain: "products", level: "read" },
    mcp: {
      name: "products_get_activity",
      title: "Get Product Activity",
      description:
        "The history of a product's units, newest first: units created, changed, deleted, retired or reinstated, downtimes, assignments to reservations. Returns up to `limit` events (default 12, at most 50) and a nextCursor; nextCursor is null on the last page. Its events name reservations, so it needs read access to products, reservations and customers; without the last two it answers PERMISSION_DENIED.",
      bundle: "catalog",
    },
  })
  .route({ method: "GET", path: "/products/{id}/activity" })
  .input(productActivityInput)
  .output(productActivityOutput)
  .handler(async ({ context, input }) => {
    // Assignment events and repair notes name reservations.
    requireReservationsAndCustomers(context);
    await assertOwnedProduct(context.actor.storeId, input.id);
    return getProductUnitActivityPage({
      storeId: context.actor.storeId,
      productId: input.id,
      cursor: input.cursor,
      limit: input.limit,
    });
  });

const getReservationTimeline = storeProcedure
  .meta({
    capability: "products.getReservationTimeline",
    scope: { domain: "products", level: "read" },
    mcp: {
      name: "products_get_reservation_timeline",
      title: "Get Product Reservation Timeline",
      description:
        "When a product is out: the reservations that hold it between `from` and `to` (ISO 8601, at most 400 days apart), with their dates, customer, amounts, quantity and assigned units, and the downtimes of its units in that window. Needs read access to products, reservations and customers; without the last two it answers PERMISSION_DENIED.",
      bundle: "catalog",
    },
  })
  .route({ method: "GET", path: "/products/{id}/reservation-timeline" })
  .input(productTimelineInput)
  .output(productTimelineOutput)
  .handler(({ context, input }) => {
    // It shows reservations (numbers, dates, amounts) and their customers:
    // the connection must read those too, not only products.
    requireReservationsAndCustomers(context);
    return getProductReservationTimeline(context.actor.storeId, input);
  });

// --- Seasonal pricing --------------------------------------------------------

const SEASON_HELP =
  "A season replaces the product's base rate and tiers on its days (startDate to endDate, both included, YYYY-MM-DD); seasons of a product never overlap. Its tiers have the same meaning as the product's rateTiers: the total price for exactly that duration.";

const listSeasonalPricingsProcedure = storeProcedure
  .meta({
    capability: "products.listSeasonalPricings",
    scope: { domain: "products", level: "read" },
    mcp: {
      name: "products_list_seasonal_pricings",
      title: "List Seasonal Prices",
      description: `List a product's seasonal prices by start day, with their tiers. ${SEASON_HELP}`,
      bundle: "catalog",
    },
  })
  .route({ method: "GET", path: "/products/{productId}/seasonal-pricings" })
  .input(listSeasonalPricingsInput)
  .output(listSeasonalPricingsOutput)
  .handler(({ context, input }) => listSeasonalPricings(context.actor.storeId, input));

const createSeasonalPricingProcedure = storeProcedure
  .meta({
    capability: "products.createSeasonalPricing",
    scope: { domain: "products", level: "write" },
    mcp: {
      name: "products_create_seasonal_pricing",
      title: "Create Seasonal Price",
      description: `Add a seasonal price to a duration product: a name, its days, its base price (for the product's base duration) and optional tiers. ${SEASON_HELP} Days that overlap another season are refused. Returns the season.`,
      bundle: "catalog",
      effect: "additive",
      reach: "public",
    },
  })
  .route({ method: "POST", path: "/products/{productId}/seasonal-pricings" })
  .input(createSeasonalPricingInput)
  .output(seasonalPricingSchema)
  .handler(({ context, input }) => createSeasonalPricing(productActor(context), input));

const updateSeasonalPricingProcedure = storeProcedure
  .meta({
    capability: "products.updateSeasonalPricing",
    scope: { domain: "products", level: "write" },
    mcp: {
      name: "products_update_seasonal_pricing",
      title: "Update Seasonal Price",
      description: `Change a seasonal price. Send only the fields to change; rateTiers sent replaces the season's tiers. ${SEASON_HELP}`,
      bundle: "catalog",
      effect: "overwrite",
      reach: "public",
      annotations: { idempotentHint: true },
    },
  })
  .route({ method: "PATCH", path: "/products/seasonal-pricings/{id}" })
  .input(updateSeasonalPricingInput)
  .output(seasonalPricingSchema)
  .handler(({ context, input }) => updateSeasonalPricing(productActor(context), input));

const duplicateSeasonalPricingProcedure = storeProcedure
  .meta({
    capability: "products.duplicateSeasonalPricing",
    scope: { domain: "products", level: "write" },
    mcp: {
      name: "products_duplicate_seasonal_pricing",
      title: "Duplicate Seasonal Price",
      description:
        'Copy a seasonal price one year later, named "<name> (copie)", with its tiers. Refused when the new days overlap another season. Returns the new season.',
      bundle: "catalog",
      effect: "additive",
      reach: "public",
    },
  })
  .route({ method: "POST", path: "/products/seasonal-pricings/{id}/duplicate" })
  .input(seasonalPricingIdInput)
  .output(seasonalPricingSchema)
  .handler(({ context, input }) => duplicateSeasonalPricing(productActor(context), input.id));

const deleteSeasonalPricingProcedure = storeProcedure
  .meta({
    capability: "products.deleteSeasonalPricing",
    scope: { domain: "products", level: "write", role: "delete" },
    sensitive: "destructive",
    mcp: {
      name: "products_delete_seasonal_pricing",
      title: "Delete Seasonal Price",
      description:
        "Delete a seasonal price and its tiers: the product's own rates apply on its days again. The first call answers CONFIRMATION_REQUIRED with a preview.",
      bundle: "catalog",
      effect: "delete",
      reach: "public",
    },
  })
  .route({ method: "DELETE", path: "/products/seasonal-pricings/{id}" })
  .input(seasonalPricingIdInput)
  .output(deleteSeasonalPricingOutput)
  .handler(({ context, input, path }) =>
    deleteSeasonalPricing(productActor(context), input.id, {
      confirm: confirmUnderLock(context, path, input, (preview) => ({
        state: {
          ...preview.season,
          updatedAt: preview.season.updatedAt.toISOString(),
          tierCount: preview.tierCount,
        },
        details: {
          season: {
            id: preview.season.id,
            name: preview.season.name,
            startDate: preview.season.startDate,
            endDate: preview.season.endDate,
          },
          product: preview.product,
          tierCount: preview.tierCount,
        },
      })),
    }),
  );

export const dashboardProductsRouter = {
  list,
  listLegacyPage,
  get,
  create,
  update,
  updateStatus,
  delete: remove,
  duplicate,
  reorder,
  createImageUpload: createImageUploadProcedure,
  completeImageUpload: completeImageUploadProcedure,
  getActivity,
  getReservationTimeline,
  listSeasonalPricings: listSeasonalPricingsProcedure,
  createSeasonalPricing: createSeasonalPricingProcedure,
  updateSeasonalPricing: updateSeasonalPricingProcedure,
  duplicateSeasonalPricing: duplicateSeasonalPricingProcedure,
  deleteSeasonalPricing: deleteSeasonalPricingProcedure,
  // Units and downtimes (product-units.ts)
  getUnitHistory,
  declareDowntime,
  updateDowntime,
  closeDowntime,
  deleteDowntime,
  retireUnit,
  reinstateUnit,
  updateUnitDetails,
  // The store's variant catalog (product-variants.ts)
  listVariants,
  ensureVariantDefinition,
  updateVariantDefinition,
  setVariantDefinitionActive,
  deleteVariantDefinition,
  getVariantUsage,
  withdrawVariantFromProducts,
  createVariantValue,
  updateVariantValue,
  deleteVariantValue,
};
