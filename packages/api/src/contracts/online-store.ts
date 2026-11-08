import { IMAGE_UPLOAD_MIME_TYPES, storeInfoSchema } from "@louez/validations";
import { z } from "zod";

import { apiError } from "../platform/errors";
import { resourceLinksSchema } from "./links";
import { checkSlugAvailabilityOutput } from "./stores";

/**
 * The online store contract: its web address, its look, its logo and hero
 * images, and the editor's sections. No database here.
 */

const slugField = storeInfoSchema.shape.slug.describe(
  "The store's web address: 3 to 50 lowercase letters, digits and hyphens. Check it first with online_store_check_slug_availability.",
);

export const checkStoreSlugInput = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .describe("The web address to check. A name works too: suggestions come from it."),
});

export const checkStoreSlugOutput = checkSlugAvailabilityOutput.extend({
  /** True when it is this store's address already. */
  current: z.boolean(),
});

export const updateSlugInput = z.object({ slug: slugField });

export const updateSlugOutput = z.object({
  slug: z.string(),
  previousSlug: z.string(),
  /** The storefront at its new address; once the store is online, it answers there now. */
  storefrontUrl: z.string(),
  /** Links to the old address stop working: Louez keeps no redirect. */
  oldLinksRedirect: z.boolean(),
  links: resourceLinksSchema,
});

// --- Appearance -------------------------------------------------------------

const ownedImageUrl = z
  .string()
  .min(1)
  .max(2048)
  .describe("The url online_store_complete_image_upload returned.");

export const appearanceView = z.object({
  mode: z.enum(["light", "dark"]),
  primaryColor: z.string(),
  logoUrl: z.string().nullable(),
  darkLogoUrl: z.string().nullable(),
  faviconUrl: z.string().nullable(),
  heroImages: z.array(z.string()),
  heroLayout: z.enum(["cover", "split"]),
  heroAlign: z.enum(["start", "center", "end"]),
  heroVerticalAlign: z.enum(["start", "center", "end"]),
  catalogBrowseMode: z.enum(["products", "categories"]),
});

export const updateAppearanceInput = z.object({
  mode: z.enum(["light", "dark"]).optional().describe("The storefront's light or dark theme."),
  primaryColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional()
    .describe("The brand colour of buttons and links, as #RRGGBB."),
  logoUrl: ownedImageUrl.nullable().optional().describe("The logo; null removes it."),
  darkLogoUrl: ownedImageUrl
    .nullable()
    .optional()
    .describe("The logo shown on a dark background; null removes it."),
  faviconUrl: ownedImageUrl
    .nullable()
    .optional()
    .describe("The browser tab icon; null removes it."),
  heroImages: z
    .array(ownedImageUrl)
    .max(5)
    .optional()
    .describe("The home page's banner photos, in order, 5 at most; [] removes them."),
  heroLayout: z
    .enum(["cover", "split"])
    .optional()
    .describe(
      "cover: the photo fills the banner behind the text; split: text and photo side by side.",
    ),
  heroAlign: z.enum(["start", "center", "end"]).optional().describe("Where the banner text sits."),
  heroVerticalAlign: z.enum(["start", "center", "end"]).optional(),
  catalogBrowseMode: z
    .enum(["products", "categories"])
    .optional()
    .describe("Whether the home page lists products or categories first."),
});
export type UpdateAppearanceInput = z.infer<typeof updateAppearanceInput>;

export const updateAppearanceOutput = z.object({
  appearance: appearanceView,
  links: resourceLinksSchema,
});

// --- Images -----------------------------------------------------------------

/** The storefront's images an agent may upload. */
export const STOREFRONT_IMAGE_KINDS = ["logo", "hero"] as const;

const imageKind = z
  .enum(STOREFRONT_IMAGE_KINDS)
  .describe("logo: a logo or the favicon (2 MB at most); hero: a banner photo of the home page.");

export const createStorefrontImageUploadInput = z.object({
  kind: imageKind,
  contentType: z
    .enum(IMAGE_UPLOAD_MIME_TYPES)
    .describe("The image's type. Send the bytes with exactly this Content-Type."),
  size: z.number().int().min(1).describe("The file's size in bytes."),
});

export const completeStorefrontImageUploadInput = z.object({
  kind: imageKind,
  key: z.string().min(1).max(256).describe("The key online_store_create_image_upload returned."),
});

// --- The editor -------------------------------------------------------------

export const updateOnlineStoreOutput = z.object({
  success: z.literal(true),
  /** The online store editor and, once the store is online, its storefront. */
  links: resourceLinksSchema,
});

export const onlineStoreErrors = {
  slugUnchanged: (slug: string) =>
    apiError("BAD_REQUEST", "STORE_SLUG_UNCHANGED", {
      message: `The store's web address is "${slug}" already.`,
      i18nKey: "errors.invalidData",
      details: { slug },
    }),
  imageNotOwned: (url: string) =>
    apiError("BAD_REQUEST", "IMAGE_NOT_OWNED", {
      message:
        "This image is not one of the store's uploads. Upload it with online_store_create_image_upload and online_store_complete_image_upload, then send the url that returns.",
      i18nKey: "errors.invalidData",
      details: { url },
    }),
} as const;
