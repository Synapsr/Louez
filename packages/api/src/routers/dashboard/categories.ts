import {
  createCategoryInput,
  createCategoryOutput,
  categoryOutput,
  deleteCategoryInput,
  deleteCategoryOutput,
  getCategoryInput,
  listCategoriesInput,
  listCategoriesOutput,
  reorderCategoriesInput,
  reorderCategoriesOutput,
  updateCategoryInput,
} from "../../contracts/categories";
import {
  completeImageUploadInput,
  completeImageUploadOutput,
  createImageUploadInput,
  createImageUploadOutput,
  UPLOAD_IMAGE_MAX_BODY_BYTES,
  uploadImageInput,
} from "../../contracts/uploads";
import { checkConfirmation } from "../../platform/confirmation";
import { categoryLinks, type LinkStore } from "../../platform/links";
import type { UrlsPort } from "../../platform/ports";
import { storeProcedure } from "../../platform/procedures";
import { withSetupMark } from "../../platform/setup-analytics";
import {
  createCategory,
  deleteCategory,
  getCategory,
  listCategories,
  reorderCategories,
  updateCategory,
} from "../../services/categories";
import { completeImageUpload, createImageUpload, uploadImage } from "../../services/uploads";

/**
 * Categories, on every transport: the dashboard (RPC), `/api/v1/categories`
 * (OpenAPI) and the `categories_*` MCP tools. The logic is in
 * services/categories.ts; this file holds the contract, the rights and the
 * confirmation.
 */

const LINKS_HELP =
  "Its `links` hold the dashboard's categories page and, once the store is online, the storefront catalog filtered on the category, the URLs to give the user.";

/** The REST reference's own texts (`.route({ description })`), for a developer. */
const REST_LINKS_NOTE =
  "Its `links.dashboard` is the dashboard's categories page; once the store is online, `links.storefront` is the storefront catalog filtered on the category.";

const REST_IMAGE_URL_NOTE =
  "`imageUrl` takes the `url` of a category image uploaded for the store (`POST /categories/images`, or `POST /categories/image-uploads` then `POST /categories/image-uploads/complete`); another URL is refused with `CATEGORY_IMAGE_INVALID`.";

/** A category with its links. */
const withLinks = <T extends { id: string; slug: string | null }>(
  context: { ports: { urls: UrlsPort }; store: LinkStore },
  category: T,
) => ({ ...category, links: categoryLinks(context.ports.urls, context.store, category) });

const list = storeProcedure
  .meta({
    capability: "categories.list",
    scope: { domain: "categories", level: "read" },
    mcp: {
      name: "categories_list",
      title: "List Categories",
      description:
        "List the store's product categories in the store's order, with how many products each holds. Returns up to `limit` categories (default and maximum 500) and a nextCursor to fetch the next page; nextCursor is null on the last page. Each category has `links`, the URLs to give the user.",
      bundle: "catalog",
    },
  })
  .route({
    method: "GET",
    path: "/categories",
    description:
      "Lists the store's product categories in the store's order (as `POST /categories/reorder` sets it, then by name), each with its position and the number of products it holds. Returns up to `limit` categories (500 by default and at most) in `items`. To read on, pass `nextCursor` back as `cursor`; it is null on the last page, and a cursor this operation did not return answers `INVALID_CURSOR`. Each category comes with `links.dashboard`, the dashboard's categories page, and `links.storefront` once the store is online.",
  })
  .input(listCategoriesInput)
  .output(listCategoriesOutput)
  .handler(async ({ context, input }) => {
    const page = await listCategories(context.actor.storeId, input);
    return { ...page, items: page.items.map((category) => withLinks(context, category)) };
  });

const get = storeProcedure
  .meta({
    capability: "categories.get",
    scope: { domain: "categories", level: "read" },
    mcp: {
      name: "categories_get",
      title: "Get Category",
      description: `Get one product category of the store by its id. ${LINKS_HELP}`,
      bundle: "catalog",
    },
  })
  .route({
    method: "GET",
    path: "/categories/{id}",
    description: `Returns one category of the store: its name, slug, description, image, position and number of products. An id the store does not have answers \`CATEGORY_NOT_FOUND\`. ${REST_LINKS_NOTE}`,
  })
  .input(getCategoryInput)
  .output(categoryOutput)
  .handler(async ({ context, input }) =>
    withLinks(context, await getCategory(context.actor.storeId, input.id)),
  );

const create = storeProcedure
  .meta({
    capability: "categories.create",
    scope: { domain: "categories", level: "write" },
    mcp: {
      name: "categories_create",
      title: "Create Category",
      description: `Create a product category, placed last in the store's order. If the store already has a category with the same name (case-insensitive), that one is returned unchanged with \`created: false\`. \`imageUrl\` takes the \`url\` a finished image upload returns (categories_upload_image, or categories_complete_image_upload). ${LINKS_HELP}`,
      bundle: "catalog",
      effect: "additive",
      reach: "public",
      annotations: { idempotentHint: true },
    },
  })
  .route({
    method: "POST",
    path: "/categories",
    description: `Creates a product category, placed last in the store's order. \`name\` takes 2 to 255 characters; \`description\` and \`imageUrl\` are optional. When the store already has a category of the same name, whatever the case, that one is returned unchanged with \`created: false\`, so a retry creates nothing twice. A store holds 2,000 categories at most: past that, \`CATEGORY_LIMIT_REACHED\`. ${REST_IMAGE_URL_NOTE} ${REST_LINKS_NOTE}`,
  })
  .input(createCategoryInput)
  .output(createCategoryOutput)
  .handler(async ({ context, input }) =>
    withLinks(context, await createCategory(context.actor.storeId, input)),
  );

const update = storeProcedure
  .meta({
    capability: "categories.update",
    scope: { domain: "categories", level: "write" },
    mcp: {
      name: "categories_update",
      title: "Update Category",
      description: `Change a product category. Send only the fields to change: a field left out stays as it is, and null clears the description or the image. A name another category of the store already has is refused. ${LINKS_HELP}`,
      bundle: "catalog",
      effect: "overwrite",
      reach: "public",
      annotations: { idempotentHint: true },
    },
  })
  .route({
    method: "PATCH",
    path: "/categories/{id}",
    description: `Changes a category's name, description or image. Send only the fields to change: a field left out stays as it is, and null clears the description or the image. A name another category of the store already has, whatever the case, is refused with \`CATEGORY_NAME_TAKEN\`; an id the store does not have answers \`CATEGORY_NOT_FOUND\`. ${REST_IMAGE_URL_NOTE} Returns the category. ${REST_LINKS_NOTE}`,
  })
  .input(updateCategoryInput)
  .output(categoryOutput)
  .handler(async ({ context, input }) =>
    withLinks(context, await updateCategory(context.actor.storeId, input)),
  );

const remove = storeProcedure
  .meta({
    capability: "categories.delete",
    scope: { domain: "categories", level: "write", role: "delete" },
    sensitive: "destructive",
    mcp: {
      name: "categories_delete",
      title: "Delete Category",
      description:
        "Delete a product category. Its products keep their other categories, or move to `replacementCategoryId` when given. The first call answers CONFIRMATION_REQUIRED with a preview of how many products lose the category.",
      bundle: "catalog",
      effect: "delete",
      reach: "public",
    },
  })
  .route({
    method: "DELETE",
    path: "/categories/{id}",
    description:
      "Deletes a category. Its products keep their other categories, or move to `replacementCategoryId` when given; a product whose main category it was takes its next one, or none. A replacement that is not another category of the store answers `CATEGORY_REPLACEMENT_INVALID`. On a key that asks for confirmations, it asks for a confirmation first (412 `CONFIRMATION_REQUIRED`), with a preview of the products that lose the category and of those left with none. Returns the deleted id, the number of products it held and the replacement's id.",
  })
  .input(deleteCategoryInput)
  .output(deleteCategoryOutput)
  .handler(({ context, input, path }) =>
    deleteCategory(context.actor.storeId, input, {
      // Asked under the deletion's own lock: what the preview shows is what
      // happens. Any change to it since the preview (a product linked or
      // unlinked, the category or the replacement renamed or changed) makes
      // the token stale. `updatedAt` counts whole seconds, so names are bound
      // too.
      confirm: (preview, tx) =>
        checkConfirmation({
          consequences: ["deletion"],
          executor: tx,
          actor: context.actor,
          headers: context.headers,
          procedure: path.join("."),
          input,
          state: {
            affectedProductCount: preview.affectedProductCount,
            uncategorizedProductCount: preview.uncategorizedProductCount,
            name: preview.category.name,
            updatedAt: preview.category.updatedAt.toISOString(),
            replacement: preview.replacement,
          },
          preview: {
            summary: preview.summary,
            details: {
              category: { id: preview.category.id, name: preview.category.name },
              replacement: preview.replacement,
              affectedProductCount: preview.affectedProductCount,
              uncategorizedProductCount: preview.uncategorizedProductCount,
            },
          },
        }),
    }),
  );

const reorder = storeProcedure
  .meta({
    capability: "categories.reorder",
    scope: { domain: "categories", level: "write" },
    mcp: {
      name: "categories_reorder",
      title: "Reorder Categories",
      description:
        "Set the order of the store's categories, as the storefront shows them. Takes the ids of every category of the store, each once, in the new order (categories_list gives them).",
      bundle: "catalog",
      effect: "overwrite",
      reach: "public",
      annotations: { idempotentHint: true },
    },
  })
  .route({
    method: "POST",
    path: "/categories/reorder",
    description:
      "Sets the order of the store's categories, as the storefront shows them. `ids` holds every category of the store, each once, in the new order (`GET /categories` gives them). A list with a category missing, unknown or repeated is refused with `CATEGORY_ORDER_MISMATCH`, which names them in `details.missing`, `details.unknown` and `details.duplicates`. Returns each id with its new position, from 1.",
  })
  .input(reorderCategoriesInput)
  .output(reorderCategoriesOutput)
  .handler(({ context, input }) => reorderCategories(context.actor.storeId, input.ids));

const createImageUploadProcedure = storeProcedure
  .meta({
    capability: "categories.uploadImage",
    scope: { domain: "categories", level: "write" },
    // The upload URL lets its bearer write to the store's storage: never stored.
    secretOutput: true,
    mcp: {
      name: "categories_create_image_upload",
      title: "Start Category Image Upload",
      description:
        "Start uploading a category image (JPEG, PNG, GIF or WebP, 5 MB at most). Returns a `key` and an `upload`: send the file's bytes in that one HTTP request, as given (a PUT with its headers, or a multipart POST with its fields then the file as `file`), without an Authorization header, before `expiresAt`. categories_complete_image_upload finishes it, with the key.",
      bundle: "catalog",
      effect: "additive",
    },
  })
  .route({
    method: "POST",
    path: "/categories/image-uploads",
    description: [
      "Starts the upload of a category image: JPEG, PNG, GIF or WebP, 5 MB at most (`UPLOAD_TOO_LARGE` above). Send its `contentType` and `size` in bytes. The upload takes three requests:",
      "",
      "1. This one returns a `key`, an `upload` and its `expiresAt`, 10 minutes from now.",
      "2. Send the file's bytes in the one request `upload` describes, without the `Authorization` header and before `expiresAt`: with `upload.method` PUT, the bytes as the body of a PUT to `upload.url` with `upload.headers`, its `Content-Type` included; with POST, a `multipart/form-data` POST to `upload.url` with `upload.fields` first, then the file as `file`.",
      "3. `POST /categories/image-uploads/complete` with the `key` checks the file and returns its public `url`.",
      "",
      "Each call issues a new upload. `POST /categories/images` uploads an image in one request instead.",
    ].join("\n"),
  })
  .input(createImageUploadInput)
  .output(createImageUploadOutput)
  .handler(({ context, input }) =>
    withSetupMark(context.actor.storeId, () =>
      createImageUpload(context.ports.storage, {
        storeId: context.actor.storeId,
        kind: "category",
        ...input,
      }),
    ),
  );

const completeImageUploadProcedure = storeProcedure
  .meta({
    capability: "categories.uploadImage",
    scope: { domain: "categories", level: "write" },
    mcp: {
      name: "categories_complete_image_upload",
      title: "Complete Category Image Upload",
      description:
        "Finish a category image upload: checks the file just sent to the key, makes it publicly readable and returns its `url`, which `imageUrl` takes in categories_create and categories_update. It changes no record and deletes nothing. A file that is not a valid image of the declared type is refused and stays private; the upload starts over with a new key.",
      bundle: "catalog",
      effect: "additive",
      reach: "public",
      annotations: { idempotentHint: true },
    },
  })
  .route({
    method: "POST",
    path: "/categories/image-uploads/complete",
    description:
      "Finishes a category image upload started with `POST /categories/image-uploads`, once its file was sent: checks the file at the `key` (its size, and that its bytes are an image of the declared type), makes it publicly readable and returns its `url`, its type and its size. `imageUrl` takes that `url` in `POST /categories` and `PATCH /categories/{id}`. It changes no category. A key that is not a category upload of the store answers `UPLOAD_NOT_OWNED`; a key with no file sent yet, `UPLOAD_NOT_FOUND`. A file over 5 MB (`UPLOAD_TOO_LARGE`) or whose bytes are not an image of the declared type (`UPLOAD_CONTENT_INVALID`) is refused and stays private: start over with a new upload. Completing the same key again returns the same answer.",
  })
  .input(completeImageUploadInput)
  .output(completeImageUploadOutput)
  .handler(({ context, input }) =>
    withSetupMark(context.actor.storeId, () =>
      completeImageUpload(context.ports.storage, {
        storeId: context.actor.storeId,
        kind: "category",
        key: input.key,
      }),
    ),
  );

const uploadImageProcedure = storeProcedure
  .meta({
    capability: "categories.uploadImage",
    scope: { domain: "categories", level: "write" },
    mcp: {
      name: "categories_upload_image",
      title: "Upload Category Image",
      description:
        "Upload a category image in one call (JPEG, PNG, GIF or WebP). It takes the file's bytes base64 as `contentBase64` (5 MB at most), for a file whose upload URL (categories_create_image_upload) is out of reach, such as an image generated on the caller's machine; or a public HTTPS `imageUrl`, which Louez downloads (5 MB at most). The type is read from the bytes. Each upload is a new image; no record changes. Returns the image's public `url`, which `imageUrl` takes in categories_create and categories_update.",
      bundle: "catalog",
      effect: "additive",
      reach: "provider",
    },
    maxBodyBytes: UPLOAD_IMAGE_MAX_BODY_BYTES,
  })
  .route({
    method: "POST",
    path: "/categories/images",
    description:
      "Uploads a category image in one request: JPEG, PNG, GIF or WebP, 5 MB at most. Send exactly one of `contentBase64`, the file's bytes in base64 (or a `data:image/…;base64,` URL), and `imageUrl`, a public HTTPS URL Louez downloads; both or neither answers `UPLOAD_SOURCE_INVALID`. The type is read from the bytes: a `contentType` that does not match them, or bytes that are no such image, answer `UPLOAD_CONTENT_INVALID`, and text that is not base64 answers `UPLOAD_BASE64_INVALID`. A URL that does not answer 200 with the image within 10 seconds, needs more than 3 redirects, is not HTTPS or points to a private or local address answers `UPLOAD_URL_UNREACHABLE`; while too many images are being downloaded, `UPLOAD_IMPORT_BUSY` (429, retry a few seconds later). An image over 5 MB answers `UPLOAD_TOO_LARGE`. Each call stores a new image and changes no category. Returns the image's public `url`, which `imageUrl` takes in `POST /categories` and `PATCH /categories/{id}`, with its key, type and size.",
  })
  .input(uploadImageInput)
  .output(completeImageUploadOutput)
  .handler(({ context, input }) =>
    withSetupMark(context.actor.storeId, () =>
      uploadImage(context.ports.storage, {
        storeId: context.actor.storeId,
        kind: "category",
        source: input,
      }),
    ),
  );

export const dashboardCategoriesRouter = {
  list,
  get,
  create,
  update,
  delete: remove,
  reorder,
  createImageUpload: createImageUploadProcedure,
  completeImageUpload: completeImageUploadProcedure,
  uploadImage: uploadImageProcedure,
};
