import { currentApiOperation } from "@louez/db";

import {
  createProductInput,
  createSeasonalPricingInput,
  deleteProductInput,
  deleteProductOutput,
  deleteSeasonalPricingOutput,
  duplicateProductInput,
  getProductInput,
  listProductUnitsInput,
  listProductUnitsOutput,
  listProductsInput,
  listProductsOutput,
  listSeasonalPricingsInput,
  listSeasonalPricingsOutput,
  productActivityInput,
  productActivityOutput,
  productImageJobInput,
  productOutput,
  PRODUCT_TIMELINE_MAX_DAYS,
  PRODUCT_WRITE_MAX_BODY_BYTES,
  productTimelineInput,
  productTimelineOutput,
  reorderProductsInput,
  reorderProductsOutput,
  SEASONAL_PRICING_PAGE_MAX,
  seasonalPricingIdInput,
  seasonalPricingSchema,
  updateProductInput,
  updateProductStatusInput,
  updateProductStatusOutput,
  updateSeasonalPricingInput,
  useImageVersionInput,
} from "../../contracts/products";
import { jobSchema, JOB_WAIT_SECONDS_MAX } from "../../contracts/jobs";
import {
  completeImageUploadInput,
  completeImageUploadOutput,
  createImageUploadInput,
  createImageUploadOutput,
  UPLOAD_IMAGE_MAX_BODY_BYTES,
  uploadImageInput,
} from "../../contracts/uploads";
import { ANSWER_PAGE_MAX, ANSWER_PAGE_MCP_DEFAULT, answerPage } from "../../platform/answer-pages";
import { readAfterCommit } from "../../platform/errors";
import { productLinks } from "../../platform/links";
import type { ProductImageOperation } from "../../platform/ports";
import { storeProcedure } from "../../platform/procedures";
import { withSetupMark } from "../../platform/setup-analytics";
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
  emit,
  eventStore,
  deleteProduct,
  duplicateProduct,
  getProduct,
  listProductUnits,
  listProducts,
  reorderProducts,
  updateProduct,
  updateProductStatus,
} from "../../services/products";
import {
  ACTIVE_IMAGE_JOBS_MAX,
  imageJobDuration,
  startImageJob,
  useImageVersion,
} from "../../services/product-images";
import { completeImageUpload, createImageUpload, uploadImage } from "../../services/uploads";
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

/** A product's units by identifier (unique within it), then id: products_get's and products_list_units'. */
const UNIT_ORDER = {
  key: (unit: { identifier: string; id: string }) => `${unit.identifier}\u0000${unit.id}`,
};

/**
 * A product as an agent's answer shows it (`meta.mcp.answer`): its first
 * `ANSWER_PAGE_MCP_DEFAULT` units, `unitsTotal`, and `unitsNextCursor`, the
 * cursor products_list_units reads on from. Applied by the MCP bridge after
 * the call, a replay included: the procedure returns, and an idempotency key
 * stores, the whole product, which the dashboard and the API get.
 */
const pageProductUnits = (answer: Record<string, unknown>): Record<string, unknown> => {
  const all = (answer.units ?? []) as Array<{ identifier: string; id: string }>;
  const units = answerPage(all, UNIT_ORDER, {}, { transport: "mcp", tool: "products_get" });
  return {
    ...answer,
    units: units.items,
    unitsTotal: all.length,
    unitsNextCursor: units.nextCursor,
  };
};

/** A page of products, each with its links. */
const withItemLinks = async (
  context: ProductContext,
  page: Promise<Awaited<ReturnType<typeof listProducts>>>,
) => {
  const result = await page;
  return { ...result, items: result.items.map((item) => withLinks(context, item)) };
};

const UNITS_PAGE_HELP = `Over MCP, \`units\` holds the first ${ANSWER_PAGE_MCP_DEFAULT} units by identifier (over the REST API, every unit); \`unitsTotal\` counts them all and, when \`unitsNextCursor\` is not null, products_list_units gives the others from that cursor. products_update keeps the units its \`units\` list leaves out, and deletes only those in removeUnitIds.`;

const TIERS_HELP =
  'Pricing: a duration product has a base rate (basePriceDuration, e.g. { "price": "30", "duration": 1, "unit": "day" }) and optional rateTiers (prix dégressifs): each tier is the TOTAL price of a rental of exactly that duration, e.g. { "duration": 7, "unit": "day", "price": "150" } for a week. A fixed product has one price per item (pricingKind "fixed"). Seasons are set with products_create_seasonal_pricing.';

/** The REST reference's own texts (`.route({ description })`), for a developer. */
const REST_LINKS =
  "`links.dashboard`, its page in the Louez dashboard, and, while it is active and the store is online, `links.storefront`, its page on the online store.";

const REST_LINKS_NOTE = `The product comes with ${REST_LINKS}`;

const REST_KEY_CONFIRMATION =
  "On a key that asks for confirmations, it asks for one first (412 `CONFIRMATION_REQUIRED`)";

const REST_TIERS_NOTE =
  'A duration product has a base rate (`basePriceDuration`, such as `{ "price": "30", "duration": 1, "unit": "day" }`) and optional `rateTiers`: each tier is the total price of a rental of exactly its duration, such as `{ "duration": 7, "unit": "day", "price": "150" }` for a week. A fixed product (`pricingKind: fixed`) has one price per item. Seasons are set with `POST /products/{productId}/seasonal-pricings`.';

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
  .route({
    method: "GET",
    path: "/products",
    description: `Lists the store's products in the catalog's order (as \`POST /products/reorder\` sets it, then newest first), with their price, stock and main category. Filter by \`status\` (every status by default), \`categoryIds\` (the products in any of them) or \`search\` (part of the name). Returns up to \`limit\` products (100 by default, 200 at most), the currency, and the count per status within the category and search filters. To read on, pass \`nextCursor\` back as \`cursor\` with the same filters; it is null on the last page. A product's tiers, units and accessories are in \`GET /products/{id}\`. Each product comes with ${REST_LINKS}`,
  })
  .input(listProductsInput)
  .output(listProductsOutput)
  .handler(({ context, input }) =>
    withItemLinks(context, listProducts(productActor(context), input)),
  );

const get = storeProcedure
  .meta({
    capability: "products.get",
    scope: { domain: "products", level: "read" },
    mcp: {
      name: "products_get",
      title: "Get Product",
      description: `Get one product of the store with everything its form holds: pricing (base rate, tiers), deposit, taxes, promotion, stock and units, variants, accessories, categories, images. The answer can be edited and sent back to products_update. ${UNITS_PAGE_HELP} ${LINKS_HELP}`,
      bundle: "catalog",
      answer: pageProductUnits,
    },
  })
  .route({
    method: "GET",
    path: "/products/{id}",
    description: `Returns one product with everything its form in the dashboard holds: pricing (base rate, tiers), deposit, taxes, promotion, stock, every unit (retired ones included), variants, accessories, categories, images and the versions of each photo (\`imageVersions\`). Edit it and send the fields to change to \`PATCH /products/{id}\`. ${REST_LINKS_NOTE}`,
  })
  .input(getProductInput)
  .output(productOutput)
  .handler(async ({ context, input }) =>
    withLinks(context, await getProduct(productActor(context), input.id)),
  );

const listUnits = storeProcedure
  .meta({
    capability: "products.listUnits",
    scope: { domain: "products", level: "read" },
    mcp: {
      name: "products_list_units",
      title: "List Product Units",
      description: `List a product's units (serial numbers, asset tags), retired ones included, in products_get's order (by identifier): id, identifier, variant attributes and whether it is active or retired. Takes the product's id, and a cursor (products_get's unitsNextCursor, or the nextCursor of a previous page) to read on; nextCursor is null on the last page. Without a limit, a page holds ${ANSWER_PAGE_MCP_DEFAULT} units over MCP and every unit over the REST API.`,
      bundle: "catalog",
    },
  })
  .route({
    method: "GET",
    path: "/products/{id}/units",
    description: `Lists a product's units (serial numbers, asset tags), retired ones included, by identifier: id, identifier, variant values and whether it is active or retired. Without \`limit\`, the answer holds every unit; with one (${ANSWER_PAGE_MAX} at most), pass \`nextCursor\` back as \`cursor\` to read on; it is null on the last page. \`total\` counts every unit.`,
  })
  .input(listProductUnitsInput)
  .output(listProductUnitsOutput)
  .handler(async ({ context, input }) => {
    const units = await listProductUnits(context.actor.storeId, input.id);
    const page = answerPage(units, UNIT_ORDER, input, {
      transport: context.actor.transport,
      tool: "products_list_units",
    });
    return { ...page, total: units.length };
  });

// --- Writes ------------------------------------------------------------------

const create = storeProcedure
  .meta({
    capability: "products.create",
    scope: { domain: "products", level: "write" },
    mcp: {
      name: "products_create",
      title: "Create Product",
      description: `Create a product, with everything the dashboard's product form holds. Only name and a price are required: a product is active, priced by duration, returnable and stocked 1 by default. ${TIERS_HELP} \`images\` takes the urls finished image uploads return (products_upload_image, or products_complete_image_upload). Returns the product as products_get does, with its \`links\`, the URLs to give the user to see it. An idempotency key makes a retry safe.`,
      bundle: "catalog",
      answer: pageProductUnits,
      effect: "additive",
      reach: "public",
    },
    // A thousand units with their notes and photos is more than 2 MiB.
    maxBodyBytes: PRODUCT_WRITE_MAX_BODY_BYTES,
  })
  .route({
    method: "POST",
    path: "/products",
    description: `Creates a product, with everything the dashboard's product form holds. Only \`name\` and a price are required: by default a product is active, priced by duration, returnable, with a stock of 1. ${REST_TIERS_NOTE} \`images\` takes the \`url\` a finished image upload returns (\`POST /products/images\`, or \`POST /products/image-uploads\` then \`POST /products/image-uploads/complete\`); any other image answers \`PRODUCT_IMAGE_INVALID\`. A product the form would refuse answers \`PRODUCT_INVALID\`, with each issue in \`details.issues\`. Returns the product as \`GET /products/{id}\` does. ${REST_LINKS_NOTE}`,
  })
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
      description: `Change a product. Send only the fields to change: a field left out stays as it is; a list you send (rateTiers, accessories, categoryIds, images) replaces the stored one; \`units\` updates the units it holds and adds new ones, the others stay, and \`removeUnitIds\` deletes units. \`price\` alone changes a duration product's base price. ${TIERS_HELP} When the change archives the product, deletes its tiers and seasons (switching to fixed pricing) or deletes units, the first call answers CONFIRMATION_REQUIRED with a preview. Returns the product. ${LINKS_HELP}`,
      bundle: "catalog",
      answer: pageProductUnits,
      effect: "overwrite",
      reach: "public",
      annotations: { idempotentHint: true },
    },
    maxBodyBytes: PRODUCT_WRITE_MAX_BODY_BYTES,
  })
  .route({
    method: "PATCH",
    path: "/products/{id}",
    description: `Changes a product. Send only the fields to change: a field left out stays as it is, and \`null\` clears the description, the AI context, the video or the tax settings. A list you send (\`rateTiers\`, \`accessories\`, \`categoryIds\`, \`images\`) replaces the stored one. \`units\` updates the units it holds (with their \`id\`) and adds the others; the units left out stay, and \`removeUnitIds\` deletes active units. \`price\` alone changes a duration product's base price. ${REST_TIERS_NOTE} Refused with \`PRODUCT_UNITS_ASSIGNED\` for deleting a unit a current or future reservation holds, \`PRODUCT_STOCK_KIND_LOCKED\` for changing the stock kind while a confirmed or ongoing reservation holds the product, and \`PRODUCT_UNIT_TRACKING_IN_USE\` for turning unit tracking off while current or future reservations booked specific variants. When the change archives the product, deletes its tiers and seasons (by switching to fixed pricing) or deletes units (\`removeUnitIds\`, or unit tracking turned off), on a key that asks for confirmations it asks for one first (412 \`CONFIRMATION_REQUIRED\`), with a preview of what goes. Returns the product. ${REST_LINKS_NOTE}`,
  })
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
          // Archiving can be undone; deleted units, tiers and seasons cannot.
          consequences:
            preview.deletedUnits.length +
              preview.deletedTierCount +
              preview.deletedSeasonalPricingCount >
            0
              ? ["deletion"]
              : ["change"],
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
      annotations: { idempotentHint: true },
    },
  })
  .route({
    method: "POST",
    path: "/products/{id}/status",
    description:
      "Publishes (`active`), unpublishes (`draft`) or archives (`archived`) a product. Archiving takes it off the online store and out of the catalog; its reservations are kept. On a key that asks for confirmations, archiving asks for one first (412 `CONFIRMATION_REQUIRED`), with a preview of the number of pending, confirmed and ongoing reservations that hold it. Returns the new and the previous status, and the product's `links.dashboard`, its page in the Louez dashboard, and, once active and while the store is online, `links.storefront`, its page on the online store.",
  })
  .input(updateProductStatusInput)
  .output(updateProductStatusOutput)
  .handler(async ({ context, input, path }) => {
    const { slug, ...result } = await updateProductStatus(productActor(context), input, {
      confirm: confirmUnderLock(context, path, input, (preview) => ({
        // Archived, the product can be put back.
        consequences: ["change"],
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
  .route({
    method: "DELETE",
    path: "/products/{id}",
    description: `Deletes a product for good, with its units and its links to categories and accessories, both ways. The reservations with this product keep their lines. Refused with \`PRODUCT_UNITS_ASSIGNED\` while a current or future reservation holds one of its units. To take a product off the online store without deleting it, archive it with \`POST /products/{id}/status\`. ${REST_KEY_CONFIRMATION}, with a preview of the units it deletes and the number of reservations with the product. Returns the product's id and the number of units deleted.`,
  })
  .input(deleteProductInput)
  .output(deleteProductOutput)
  .handler(({ context, input, path }) =>
    deleteProduct(productActor(context), input.id, {
      confirm: confirmUnderLock(context, path, input, (preview) => ({
        consequences: ["deletion"],
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
      answer: pageProductUnits,
      effect: "additive",
    },
  })
  .route({
    method: "POST",
    path: "/products/{id}/duplicate",
    description:
      'Copies a product as a draft named "<name> (copy)", with its pricing, tiers, deposit, taxes, images, video and categories. Units are not copied: the copy does not track units, and its stock is the number of items the original has. Its accessories and promotion are not copied either. Returns the new product, with `links.dashboard`, its page in the Louez dashboard (a draft has no page on the online store).',
  })
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
  .route({
    method: "POST",
    path: "/products/reorder",
    description:
      "Sets the order of products, as the online store and the dashboard show them. Send the product `ids` in their new order (5,000 at most): they swap among the places they already hold, and the products left out keep theirs. Ids the store does not have are ignored. Returns each product sent with its new `position`.",
  })
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
  .route({
    method: "POST",
    path: "/products/image-uploads",
    description:
      "Starts uploading a product image: send its `contentType` (JPEG, PNG, GIF or WebP) and its `size` in bytes, 15 MB at most (`UPLOAD_TOO_LARGE` above). Returns a `key` and an `upload`, the one HTTP request that sends the file's bytes: make it as given (a PUT with its `headers`, or a multipart POST with its `fields`, then the file as `file`), without an `Authorization` header, before `expiresAt`, 10 minutes later. Then `POST /products/image-uploads/complete` with the key checks the file and publishes it.",
  })
  .input(createImageUploadInput)
  .output(createImageUploadOutput)
  .handler(({ context, input }) =>
    withSetupMark(context.actor.storeId, () =>
      createImageUpload(context.ports.storage, {
        storeId: context.actor.storeId,
        kind: "product",
        ...input,
      }),
    ),
  );

const completeImageUploadProcedure = storeProcedure
  .meta({
    capability: "products.uploadImage",
    scope: { domain: "products", level: "write" },
    mcp: {
      name: "products_complete_image_upload",
      title: "Complete Product Image Upload",
      description:
        "Finish a product image upload: checks the file just sent to the key, makes it publicly readable and returns its `url`, which a product's `images` take in products_create and products_update. It changes no record and deletes nothing. A file that is not a valid image of the declared type is refused and stays private; the upload starts over with a new key.",
      bundle: "catalog",
      effect: "additive",
      reach: "public",
      annotations: { idempotentHint: true },
    },
  })
  .route({
    method: "POST",
    path: "/products/image-uploads/complete",
    description:
      "Finishes an upload started with `POST /products/image-uploads`: checks the file sent to the `key`, makes it publicly readable and returns its `url`, type and size. A product takes that url in its `images` (`POST /products`, `PATCH /products/{id}`); this call changes no product and deletes nothing. A key with nothing uploaded answers `UPLOAD_NOT_FOUND`, and a key that is not a product upload of the store `UPLOAD_NOT_OWNED`. A file that is not a valid image of the declared type answers `UPLOAD_CONTENT_INVALID` and stays private: start a new upload. Completing a good upload again returns the same answer.",
  })
  .input(completeImageUploadInput)
  .output(completeImageUploadOutput)
  .handler(({ context, input }) =>
    withSetupMark(context.actor.storeId, () =>
      completeImageUpload(context.ports.storage, {
        storeId: context.actor.storeId,
        kind: "product",
        key: input.key,
      }),
    ),
  );

const uploadImageProcedure = storeProcedure
  .meta({
    capability: "products.uploadImage",
    scope: { domain: "products", level: "write" },
    mcp: {
      name: "products_upload_image",
      title: "Upload Product Image",
      description:
        "Upload a product image in one call (JPEG, PNG, GIF or WebP). It takes the file's bytes base64 as `contentBase64` (5 MB at most), for a file whose upload URL (products_create_image_upload) is out of reach, such as an image generated on the caller's machine; or a public HTTPS `imageUrl`, which Louez downloads (15 MB at most). The type is read from the bytes. Each upload is a new image; no product changes. Returns the image's public `url`, which a product's `images` take in products_create and products_update.",
      bundle: "catalog",
      effect: "additive",
      reach: "provider",
    },
    maxBodyBytes: UPLOAD_IMAGE_MAX_BODY_BYTES,
  })
  .route({
    method: "POST",
    path: "/products/images",
    description:
      "Uploads a product image (JPEG, PNG, GIF or WebP) in one call, from exactly one of: its bytes as base64 in `contentBase64` (or a `data:image/…;base64,` URL), 5 MB at most once decoded; or a public HTTPS `imageUrl`, which Louez downloads, 15 MB at most. Both or neither answer `UPLOAD_SOURCE_INVALID`. The type is read from the bytes: with `contentBase64`, a `contentType` sent must match them; with `imageUrl`, the type is only detected from the bytes downloaded. An `imageUrl` must answer 200 with the image, following at most 3 redirects, each request within 10 seconds; private and local addresses are refused, and a download that fails answers `UPLOAD_URL_UNREACHABLE`. Each call stores a new image and changes no product. Returns the image's public `url`, which a product takes in its `images` (`POST /products`, `PATCH /products/{id}`).",
  })
  .input(uploadImageInput)
  .output(completeImageUploadOutput)
  .handler(({ context, input }) =>
    withSetupMark(context.actor.storeId, () =>
      uploadImage(context.ports.storage, {
        storeId: context.actor.storeId,
        kind: "product",
        source: input,
      }),
    ),
  );

// --- AI photos -----------------------------------------------------------------

/** What both AI photo tools say of how they run, what they cost and how to undo them. */
const imageJobHelp = (operation: ProductImageOperation) =>
  `It runs in the background, usually ${imageJobDuration(operation)}: the answer is the job at once (status queued), and jobs_get with its id says how it goes (waitSeconds up to ${JOB_WAIT_SECONDS_MAX}). Once it succeeds, the result replaces the photo on the product (and on its online page), and the original stays among the photo's versions (imageVersions of products_get); products_use_image_version with the job's source.versionId puts it back. The job carries the photo before (source.url) and, once done, after (result.url). It costs AI credits (priceCredits; 0 when free or not billed on this instance), charged only once the result is on the product, never for a failed run. For a paid run, the first call always answers CONFIRMATION_REQUIRED with the price and the balance, whatever the connection's confirmation setting. Calling again for a photo whose job runs returns that job. At most ${ACTIVE_IMAGE_JOBS_MAX} photos of a store are processed at once.`;

/** The REST reference's text on how both AI photo operations run, what they cost and how to undo them. */
const restImageJobNote = (operation: ProductImageOperation) =>
  `It runs in the background, usually ${imageJobDuration(operation)}: the answer is the job, at once, with status \`queued\`, and \`GET /jobs/{id}\` says how it goes (its \`waitSeconds\` waits up to ${JOB_WAIT_SECONDS_MAX} seconds for the end). Once it succeeds, the result replaces the photo on the product, and so on its online page; the original stays among the photo's versions (\`imageVersions\` in \`GET /products/{id}\`), and \`POST /products/{id}/images/use-version\` with the job's \`source.versionId\` puts it back. The job holds the photo before (\`source.url\`) and, once done, after (\`result.url\`). It costs AI credits (\`priceCredits\`; 0 when free or not billed on this instance), charged only once the result is on the product, never for a failed run; without enough credits, it answers \`AI_CREDITS_EXHAUSTED\`. A paid run always asks for a confirmation first (412 \`CONFIRMATION_REQUIRED\`), whatever the key's confirmation setting, with the price and the store's balance. The same photo sent again while its job runs returns that job; another AI operation running on it answers \`IMAGE_JOB_RUNNING\`. A store has at most ${ACTIVE_IMAGE_JOBS_MAX} photos processed at once (\`IMAGE_JOBS_BUSY\` beyond). A photo that is not one of the product's \`images\` answers \`IMAGE_NOT_ON_PRODUCT\`.`;

/** The procedure's API write, which the job names as the one that started it. */
const startedBy = () => currentApiOperation()?.operationId ?? null;

const enhanceImage = storeProcedure
  .meta({
    capability: "products.enhanceImage",
    scope: { domain: "products", level: "write" },
    sensitive: "spend",
    mcp: {
      name: "products_enhance_image",
      title: "Enhance Product Photo with AI",
      description: `Enhance one photo of a product with AI (GPT Image): a clean studio photo of the same product on a cut-out background, framed 4:3. Takes the product's id and one of its \`images\`, as products_get returns them. A photo already enhanced is refused (enhance its original instead); a photo whose background was removed can still be enhanced. ${imageJobHelp("enhance")}`,
      bundle: "catalog",
      effect: "overwrite",
      reach: "public",
    },
  })
  .route({
    method: "POST",
    path: "/products/{id}/images/enhance",
    description: `Enhances one photo of a product with AI: a clean studio photo of the same product on a cut-out background, framed 4:3. Send the product's id and \`imageUrl\`, one of its \`images\` as \`GET /products/{id}\` returns them. A photo already enhanced answers \`IMAGE_ALREADY_PROCESSED\` (enhance its original instead); a photo whose background was removed can still be enhanced. ${restImageJobNote("enhance")}`,
  })
  .input(productImageJobInput)
  .output(jobSchema)
  .handler(({ context, input, path }) =>
    startImageJob(
      { ...context, procedure: path.join("."), operationId: startedBy() },
      input,
      "enhance",
    ),
  );

const removeImageBackground = storeProcedure
  .meta({
    capability: "products.removeImageBackground",
    scope: { domain: "products", level: "write" },
    sensitive: "spend",
    mcp: {
      name: "products_remove_image_background",
      title: "Remove Product Photo Background",
      description: `Remove the background of one photo of a product: the product alone on transparency, centred, without any AI redrawing. Takes the product's id and one of its \`images\`, as products_get returns them. A photo already processed (background removed or AI enhanced) is refused. ${imageJobHelp("remove-background")}`,
      bundle: "catalog",
      effect: "overwrite",
      reach: "public",
    },
  })
  .route({
    method: "POST",
    path: "/products/{id}/images/remove-background",
    description: `Removes the background of one photo of a product: the product alone on transparency, centred, with no AI redrawing. Send the product's id and \`imageUrl\`, one of its \`images\` as \`GET /products/{id}\` returns them. A photo already processed (background removed or AI enhanced) answers \`IMAGE_ALREADY_PROCESSED\`. ${restImageJobNote("remove-background")}`,
  })
  .input(productImageJobInput)
  .output(jobSchema)
  .handler(({ context, input, path }) =>
    startImageJob(
      { ...context, procedure: path.join("."), operationId: startedBy() },
      input,
      "remove-background",
    ),
  );

const useImageVersionProcedure = storeProcedure
  .meta({
    capability: "products.useImageVersion",
    scope: { domain: "products", level: "write" },
    mcp: {
      name: "products_use_image_version",
      title: "Use Product Photo Version",
      description: `Put one of a photo's versions in use on the product: its original, a crop, an AI enhancement or a background removal, as imageVersions of products_get lists them (or a job's source.versionId). It takes the photo's place in \`images\`, on the product and its online page. No version is deleted, so it also undoes an AI enhancement or a background removal, and can be reversed the same way. Takes the product's id and the version's id. Returns the product. ${LINKS_HELP}`,
      bundle: "catalog",
      answer: pageProductUnits,
      effect: "overwrite",
      reach: "public",
      annotations: { idempotentHint: true },
    },
  })
  .route({
    method: "POST",
    path: "/products/{id}/images/use-version",
    description: `Puts one of a photo's versions in use on the product: its original, a crop, an AI enhancement or a background removal, as \`imageVersions\` in \`GET /products/{id}\` lists them, or a job's \`source.versionId\`. The version takes the photo's place in \`images\`, on the product and its online page. No version is deleted, so this undoes an AI enhancement or a background removal, and can be reversed the same way. Send the product's id and the \`versionId\`. An unknown version answers \`IMAGE_VERSION_NOT_FOUND\`; a version whose photo is no longer on the product answers \`IMAGE_VERSION_PHOTO_REMOVED\` (add its url to \`images\` with \`PATCH /products/{id}\` instead). Returns the product. ${REST_LINKS_NOTE}`,
  })
  .input(useImageVersionInput)
  .output(productOutput)
  .handler(async ({ context, input }) => {
    const actor = productActor(context);
    const { changed, name } = await useImageVersion(actor, input);
    if (changed) {
      emit(actor, {
        type: "product.updated",
        store: eventStore(actor),
        productId: input.id,
        productName: name,
      });
    }
    return withLinks(context, await readAfterCommit(() => getProduct(actor, input.id)));
  });

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
  .route({
    method: "GET",
    path: "/products/{id}/activity",
    description:
      "Returns the history of a product's units, newest first: units created, changed, retired or reinstated, their downtimes declared, changed, closed or deleted, and their assignments to reservations. The events of units deleted since are left out. Returns up to `limit` events (12 by default, 50 at most); to read on, pass `nextCursor` back as `cursor`; it is null on the last page. Its events name reservations, so it needs a key that can read products, reservations and customers; another key answers `PERMISSION_DENIED`.",
  })
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
      description: `When a product is out: the reservations that hold it between \`from\` and \`to\` (ISO 8601, at most 400 days apart), with their dates, customer, amounts, quantity and assigned units, and the downtimes of its units in that window. Without a limit, a page holds ${ANSWER_PAGE_MCP_DEFAULT} reservations over MCP and every one over the REST API; nextCursor, when not null, reads on, and every page holds the downtimes. Needs read access to products, reservations and customers; without the last two it answers PERMISSION_DENIED.`,
      bundle: "catalog",
    },
  })
  .route({
    method: "GET",
    path: "/products/{id}/reservation-timeline",
    description: `Shows when a product is out between \`from\` and \`to\` (ISO 8601, at most ${PRODUCT_TIMELINE_MAX_DAYS} days apart, or \`PRODUCT_TIMELINE_RANGE_INVALID\`): the reservations with this product whose dates overlap the window, by start date, each with its status, dates, customer's name, amounts, quantity of the product, assigned units and lines; and the downtimes of its units in the window. Without \`limit\`, the answer holds every reservation; with one (${ANSWER_PAGE_MAX} at most), pass \`nextCursor\` back as \`cursor\` to read on. Every page holds all the downtimes. It needs a key that can read products, reservations and customers; another key answers \`PERMISSION_DENIED\`.`,
  })
  .input(productTimelineInput)
  .output(productTimelineOutput)
  .handler(async ({ context, input }) => {
    // It shows reservations (numbers, dates, amounts) and their customers:
    // the connection must read those too, not only products.
    requireReservationsAndCustomers(context);
    const { id, from, to } = input;
    const timeline = await getProductReservationTimeline(context.actor.storeId, { id, from, to });
    // By start date, then id: a total order, whatever order the grouping left.
    const order = {
      key: (reservation: (typeof timeline.reservations)[number]) =>
        `${reservation.startDate.toISOString()}\u0000${reservation.id}`,
    };
    const page = answerPage(timeline.reservations, order, input, {
      transport: context.actor.transport,
      tool: "products_get_reservation_timeline",
    });
    return { ...timeline, reservations: page.items, nextCursor: page.nextCursor };
  });

// --- Seasonal pricing --------------------------------------------------------

const SEASON_HELP =
  "A season replaces the product's base rate and tiers on its days (startDate to endDate, both included, YYYY-MM-DD); seasons of a product never overlap. Its tiers have the same meaning as the product's rateTiers: the total price for exactly that duration.";

const REST_SEASON_NOTE =
  "A season replaces the product's base rate and tiers on its days, from `startDate` to `endDate` (YYYY-MM-DD, both included); the seasons of a product never overlap. Its tiers mean what the product's `rateTiers` mean: the total price of a rental of exactly that duration.";

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
  .route({
    method: "GET",
    path: "/products/{productId}/seasonal-pricings",
    description: `Lists a product's seasonal prices by start day, with their tiers. ${REST_SEASON_NOTE} Returns up to \`limit\` seasons (${SEASONAL_PRICING_PAGE_MAX} by default and at most); to read on, pass \`nextCursor\` back as \`cursor\`; it is null on the last page.`,
  })
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
  .route({
    method: "POST",
    path: "/products/{productId}/seasonal-pricings",
    description: `Adds a seasonal price to a product priced by duration: a \`name\`, its days, its base \`price\` (for the product's base duration) and optional \`rateTiers\` (50 at most). ${REST_SEASON_NOTE} \`endDate\` must come after \`startDate\` (\`SEASONAL_PRICING_DATES_INVALID\`). Refused with \`SEASONAL_PRICING_OVERLAP\` for days that overlap another season of the product (its id in \`details.overlappingId\`), and with \`SEASONAL_PRICING_FIXED_PRODUCT\` for a product with fixed pricing. Returns the season.`,
  })
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
  .route({
    method: "PATCH",
    path: "/products/seasonal-pricings/{id}",
    description: `Changes a seasonal price. Send only the fields to change; \`rateTiers\` sent replaces the season's tiers, and an empty list removes them. ${REST_SEASON_NOTE} Refused with \`SEASONAL_PRICING_DATES_INVALID\` when \`endDate\` does not come after \`startDate\`, and with \`SEASONAL_PRICING_OVERLAP\` for days that overlap another season of the product. Returns the season.`,
  })
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
  .route({
    method: "POST",
    path: "/products/seasonal-pricings/{id}/duplicate",
    description:
      'Copies a seasonal price one year later, with its tiers, named "<name> (copie)". Refused with `SEASONAL_PRICING_OVERLAP` when the new days overlap another season of the product. Returns the new season.',
  })
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
  .route({
    method: "DELETE",
    path: "/products/seasonal-pricings/{id}",
    description: `Deletes a seasonal price and its tiers: the product's own rates apply on its days again. ${REST_KEY_CONFIRMATION}, with a preview of the season, its product and its number of tiers. Returns the season's id and its product's id.`,
  })
  .input(seasonalPricingIdInput)
  .output(deleteSeasonalPricingOutput)
  .handler(({ context, input, path }) =>
    deleteSeasonalPricing(productActor(context), input.id, {
      confirm: confirmUnderLock(context, path, input, (preview) => ({
        // The season's tiers go with it.
        consequences: ["deletion"],
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
  get,
  create,
  update,
  updateStatus,
  delete: remove,
  duplicate,
  reorder,
  createImageUpload: createImageUploadProcedure,
  completeImageUpload: completeImageUploadProcedure,
  uploadImage: uploadImageProcedure,
  enhanceImage,
  removeImageBackground,
  useImageVersion: useImageVersionProcedure,
  getActivity,
  getReservationTimeline,
  listSeasonalPricings: listSeasonalPricingsProcedure,
  createSeasonalPricing: createSeasonalPricingProcedure,
  updateSeasonalPricing: updateSeasonalPricingProcedure,
  duplicateSeasonalPricing: duplicateSeasonalPricingProcedure,
  deleteSeasonalPricing: deleteSeasonalPricingProcedure,
  listUnits,
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
