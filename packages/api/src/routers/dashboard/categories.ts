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
  .route({ method: "GET", path: "/categories" })
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
  .route({ method: "GET", path: "/categories/{id}" })
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
  .route({ method: "POST", path: "/categories" })
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
  .route({ method: "PATCH", path: "/categories/{id}" })
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
  .route({ method: "DELETE", path: "/categories/{id}" })
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
  .route({ method: "POST", path: "/categories/reorder" })
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
  .route({ method: "POST", path: "/categories/image-uploads" })
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
  .route({ method: "POST", path: "/categories/image-uploads/complete" })
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
        "Upload a category image in one call (JPEG, PNG, GIF or WebP). It takes the file's bytes base64 as `contentBase64` (5 MB at most), for a file whose upload URL (categories_create_image_upload) is out of reach, such as an image made in the agent's own workspace; or a public HTTPS `imageUrl`, which Louez downloads (5 MB at most). The type is read from the bytes. Each upload is a new image; no record changes. Returns the image's public `url`, which `imageUrl` takes in categories_create and categories_update.",
      bundle: "catalog",
      effect: "additive",
      reach: "provider",
    },
    maxBodyBytes: UPLOAD_IMAGE_MAX_BODY_BYTES,
  })
  .route({ method: "POST", path: "/categories/images" })
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
