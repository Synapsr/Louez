import { updateOnlineStoreInputSchema } from "@louez/validations";

import {
  checkStoreSlugInput,
  checkStoreSlugOutput,
  completeStorefrontImageUploadInput,
  createStorefrontImageUploadInput,
  uploadStorefrontImageInput,
  updateAppearanceInput,
  updateAppearanceOutput,
  updateOnlineStoreOutput,
  updateSlugInput,
  updateSlugOutput,
} from "../../contracts/online-store";
import {
  completeImageUploadOutput,
  createImageUploadOutput,
  UPLOAD_IMAGE_MAX_BODY_BYTES,
} from "../../contracts/uploads";
import { onlineStoreLinks } from "../../platform/links";
import type { ProcedureScope } from "../../platform/permissions";
import { storeProcedure } from "../../platform/procedures";
import { withSetupMark } from "../../platform/setup-analytics";
import {
  checkCurrentStoreSlug,
  updateAppearance,
  updateOnlineStore,
  updateStoreSlug,
  type SlugChangePreview,
} from "../../services/online-store";
import { completeImageUpload, createImageUpload, uploadImage } from "../../services/uploads";
import { confirmUnderLock } from "./product-context";
import { settingsActor } from "./settings-context";

/**
 * The online store, on every transport: the dashboard's online store editor
 * (RPC), `/api/v1/online-store` (OpenAPI) and the `online_store_*` MCP tools
 * of the settings bundle. The logic is in services/online-store.ts.
 */

const READ: ProcedureScope = { domain: "online_store", level: "read" };
/** The dashboard lets only members who manage settings change the online store. */
const WRITE: ProcedureScope = { domain: "online_store", level: "write", role: "manage_settings" };

// --- Web address -------------------------------------------------------------

const checkSlugAvailability = storeProcedure
  .meta({
    capability: "online_store.checkSlugAvailability",
    scope: READ,
    mcp: {
      name: "online_store_check_slug_availability",
      description:
        "Check whether this store can move to another web address (its slug) before online_store_update_slug. Answers `available`, `current` when it is the store's address already, the `reason` when it cannot (taken, reserved, invalid), and up to three free `suggestions` close to it.",
      bundle: "settings",
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
  })
  .route({ method: "GET", path: "/online-store/slug-availability" })
  .input(checkStoreSlugInput)
  .output(checkStoreSlugOutput)
  .handler(({ context, input }) => checkCurrentStoreSlug(context.store.slug, input));

const updateSlug = storeProcedure
  .meta({
    capability: "online_store.updateSlug",
    scope: WRITE,
    sensitive: "destructive",
    mcp: {
      name: "online_store_update_slug",
      description:
        "Move the store to a new web address (its slug): the storefront's public URL changes and Louez keeps no redirect, so links to the old address stop working once the store is online. Check the address first with online_store_check_slug_availability. The first call answers CONFIRMATION_REQUIRED with a preview of the old and the new URL: show it to the user, and once they agree, call again with the same arguments and the confirmationToken. Returns the new address and the store's links.",
      bundle: "settings",
      annotations: { destructiveHint: true, idempotentHint: true },
    },
  })
  .route({ method: "POST", path: "/online-store/slug" })
  .input(updateSlugInput)
  .output(updateSlugOutput)
  .handler(async ({ context, input, path }) => {
    const { urls } = context.ports;
    const result = await updateStoreSlug(settingsActor(context), input, {
      storefrontUrl: (slug) => urls.storefront(slug, "/"),
      // The preview and its binding read the slug and the launch state under the lock.
      confirm: confirmUnderLock<SlugChangePreview>(context, path, input, (preview) => ({
        state: { previousSlug: preview.previousSlug, online: preview.online },
        details: {
          previousUrl: preview.previousUrl,
          url: preview.url,
          oldLinksRedirect: false,
          online: preview.online,
        },
      })),
    });
    return {
      slug: result.slug,
      previousSlug: result.previousSlug,
      storefrontUrl: urls.storefront(result.slug, "/"),
      oldLinksRedirect: false,
      links: onlineStoreLinks(
        urls,
        { id: context.store.id, slug: result.slug, onboardingCompleted: result.online },
        "identity",
      ),
    };
  });

// --- Look and images ---------------------------------------------------------

const updateAppearanceProcedure = storeProcedure
  .meta({
    capability: "online_store.updateAppearance",
    scope: WRITE,
    mcp: {
      name: "online_store_update_appearance",
      description:
        "Change how the storefront looks: light or dark theme, brand colour, logos, favicon, the home page's banner photos and their layout. Send only the fields to change; null removes an image. Images must be the store's own uploads: upload each with online_store_upload_image (the bytes or a public URL in one call), or with online_store_create_image_upload and online_store_complete_image_upload, then send the url they return. Returns the look, with the online store editor in `links`: give the user that URL.",
      bundle: "settings",
      annotations: { idempotentHint: true },
    },
  })
  .route({ method: "PATCH", path: "/online-store/appearance" })
  .input(updateAppearanceInput)
  .output(updateAppearanceOutput)
  .handler(async ({ context, input }) => ({
    appearance: await updateAppearance(settingsActor(context), input),
    links: onlineStoreLinks(context.ports.urls, context.store, "identity"),
  }));

const createImageUploadProcedure = storeProcedure
  .meta({
    capability: "online_store.uploadImage",
    scope: WRITE,
    // The upload URL lets its bearer write to the store's storage: never stored.
    secretOutput: true,
    mcp: {
      name: "online_store_create_image_upload",
      description:
        "Start uploading a logo, a favicon (kind logo) or a banner photo (kind hero): JPEG, PNG, GIF or WebP. Returns a `key` and an `upload`: send the file's bytes in that one HTTP request, as given (a PUT with its headers, or a multipart POST with its fields then the file as `file`), without an Authorization header, before `expiresAt`. Then call online_store_complete_image_upload with the same kind and the key.",
      bundle: "settings",
    },
  })
  .route({ method: "POST", path: "/online-store/image-uploads" })
  .input(createStorefrontImageUploadInput)
  .output(createImageUploadOutput)
  .handler(({ context, input }) =>
    withSetupMark(context.actor.storeId, () =>
      createImageUpload(context.ports.storage, { storeId: context.actor.storeId, ...input }),
    ),
  );

const completeImageUploadProcedure = storeProcedure
  .meta({
    capability: "online_store.uploadImage",
    scope: WRITE,
    mcp: {
      name: "online_store_complete_image_upload",
      description:
        "Finish a storefront image upload: checks the file that arrived at the key and returns its public `url`. Set it with online_store_update_appearance (logoUrl, darkLogoUrl, faviconUrl or heroImages). A file that is not a valid image of the declared type is deleted and refused.",
      bundle: "settings",
      annotations: { idempotentHint: true },
    },
  })
  .route({ method: "POST", path: "/online-store/image-uploads/complete" })
  .input(completeStorefrontImageUploadInput)
  .output(completeImageUploadOutput)
  .handler(({ context, input }) =>
    withSetupMark(context.actor.storeId, () =>
      completeImageUpload(context.ports.storage, { storeId: context.actor.storeId, ...input }),
    ),
  );

const uploadImageProcedure = storeProcedure
  .meta({
    capability: "online_store.uploadImage",
    scope: WRITE,
    mcp: {
      name: "online_store_upload_image",
      description:
        "Upload a logo, a favicon (kind logo, 2 MB at most) or a banner photo (kind hero, 5 MB at most) in one call: JPEG, PNG, GIF or WebP. Send the file's bytes base64 as `contentBase64` when you cannot reach the upload URL of online_store_create_image_upload, such as an image you made in your own workspace; or a public HTTPS `imageUrl` for Louez to download. The type is read from the bytes. Returns the image's public `url`: set it with online_store_update_appearance (logoUrl, darkLogoUrl, faviconUrl or heroImages).",
      bundle: "settings",
      annotations: { openWorldHint: true },
    },
    maxBodyBytes: UPLOAD_IMAGE_MAX_BODY_BYTES,
  })
  .route({ method: "POST", path: "/online-store/images" })
  .input(uploadStorefrontImageInput)
  .output(completeImageUploadOutput)
  .handler(({ context, input: { kind, ...source } }) =>
    withSetupMark(context.actor.storeId, () =>
      uploadImage(context.ports.storage, { storeId: context.actor.storeId, kind, source }),
    ),
  );

// --- The editor --------------------------------------------------------------

/**
 * One save for the whole online store editor: the client sends the sections
 * it changed, the service writes them in one update.
 */
const update = storeProcedure
  .meta({
    capability: "online_store.update",
    scope: WRITE,
    mcp: {
      name: "online_store_update",
      description:
        "Save sections of the online store editor, each sent whole: identity (name, tagline and description as HTML, storefront language, logos, theme), home (banner photos and layout, announcement bar, home sections), contact (email, phone, address and coordinates, the contact page's channels, social links), legal (terms, legal notice, footer note) and seo (Google site verification, share image). A section left out stays as it is. For a few fields, prefer settings_update_store_info, settings_update_legal or online_store_update_appearance, which take one field at a time. Returns the editor's links.",
      bundle: "settings",
      annotations: { idempotentHint: true },
    },
  })
  .route({ method: "PATCH", path: "/online-store" })
  .input(updateOnlineStoreInputSchema)
  .output(updateOnlineStoreOutput)
  .handler(async ({ context, input }) => ({
    ...(await updateOnlineStore(settingsActor(context), input)),
    links: onlineStoreLinks(context.ports.urls, context.store, "identity"),
  }));

export const dashboardOnlineStoreRouter = {
  update,
  checkSlugAvailability,
  updateSlug,
  updateAppearance: updateAppearanceProcedure,
  createImageUpload: createImageUploadProcedure,
  completeImageUpload: completeImageUploadProcedure,
  uploadImage: uploadImageProcedure,
};
