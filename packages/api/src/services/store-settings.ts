import { db, stores } from "@louez/db";
import type { StoreSettings, StoreTheme } from "@louez/types";
import type {
  UpdateOnlineStoreInput,
  UpdateStoreAppearanceInput,
  UpdateStoreContactInput,
  UpdateStoreLegalInput,
  UpdateStoreSeoInput,
} from "@louez/validations";
import { isOwnedImageUrl } from "@louez/validations";
import { sanitizeRichTextHtml } from "@louez/utils";
import { ApiServiceError } from "./errors";
import { eq } from "drizzle-orm";

interface UpdateStoreLegalParams {
  storeId: string;
  input: UpdateStoreLegalInput;
}

interface UpdateStoreAppearanceParams {
  storeId: string;
  input: UpdateStoreAppearanceInput;
}

interface UpdateStoreContactParams {
  storeId: string;
  input: UpdateStoreContactInput;
}

interface UpdateStoreSeoParams {
  storeId: string;
  input: UpdateStoreSeoInput;
}

export async function updateStoreLegal(params: UpdateStoreLegalParams) {
  const { storeId, input } = params;
  const { cgv, legalNotice, includeFullCgvInContract } = input;

  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  // Editor HTML is sanitised on write so the stored value is safe whatever
  // renders it later (storefront pages, contract PDF).
  if (cgv !== undefined) {
    updateData.cgv = sanitizeRichTextHtml(cgv);
  }

  if (legalNotice !== undefined) {
    updateData.legalNotice = sanitizeRichTextHtml(legalNotice);
  }

  if (includeFullCgvInContract !== undefined) {
    updateData.includeCgvInContract = includeFullCgvInContract;
  }

  await db.update(stores).set(updateData).where(eq(stores.id, storeId));

  return { success: true as const };
}

export async function updateStoreAppearance(params: UpdateStoreAppearanceParams) {
  const { storeId, input } = params;
  const { logoUrl, darkLogoUrl, theme } = input;
  const imagePrefix = `${storeId}/logo`;

  if (logoUrl && !isOwnedImageUrl(logoUrl, imagePrefix)) {
    throw new ApiServiceError("BAD_REQUEST", "errors.invalidData");
  }
  if (darkLogoUrl && !isOwnedImageUrl(darkLogoUrl, imagePrefix)) {
    throw new ApiServiceError("BAD_REQUEST", "errors.invalidData");
  }
  if (theme?.heroImages?.some((image) => !isOwnedImageUrl(image, imagePrefix))) {
    throw new ApiServiceError("BAD_REQUEST", "errors.invalidData");
  }

  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (logoUrl !== undefined) {
    updateData.logoUrl = logoUrl;
  }

  if (darkLogoUrl !== undefined) {
    updateData.darkLogoUrl = darkLogoUrl;
  }

  if (theme) {
    const currentStore = await db.query.stores.findFirst({
      where: eq(stores.id, storeId),
      columns: {
        theme: true,
      },
    });

    const existingTheme = currentStore?.theme ?? null;

    const mergedTheme: {
      mode: "light" | "dark";
      primaryColor: string;
      heroImages?: string[];
      heroLayout?: "cover" | "split";
      heroAlign?: "start" | "center" | "end";
      heroVerticalAlign?: "start" | "center" | "end";
      catalogBrowseMode?: "products" | "categories";
      maxDiscountPercent?: number | null;
    } = {
      mode: theme.mode,
      primaryColor: theme.primaryColor,
    };

    if (existingTheme?.heroLayout !== undefined) {
      mergedTheme.heroLayout = existingTheme.heroLayout;
    }

    if (existingTheme?.heroAlign !== undefined) {
      mergedTheme.heroAlign = existingTheme.heroAlign;
    }

    if (existingTheme?.heroVerticalAlign !== undefined) {
      mergedTheme.heroVerticalAlign = existingTheme.heroVerticalAlign;
    }

    if (theme.heroLayout !== undefined) {
      mergedTheme.heroLayout = theme.heroLayout;
    }

    if (theme.heroAlign !== undefined) {
      mergedTheme.heroAlign = theme.heroAlign;
    }

    if (theme.heroVerticalAlign !== undefined) {
      mergedTheme.heroVerticalAlign = theme.heroVerticalAlign;
    }

    if (existingTheme?.heroImages !== undefined) {
      mergedTheme.heroImages = existingTheme.heroImages;
    }

    if (existingTheme?.catalogBrowseMode !== undefined) {
      mergedTheme.catalogBrowseMode = existingTheme.catalogBrowseMode;
    }

    if (existingTheme?.maxDiscountPercent !== undefined) {
      mergedTheme.maxDiscountPercent = existingTheme.maxDiscountPercent;
    }

    if (theme.heroImages !== undefined) {
      mergedTheme.heroImages = theme.heroImages;
    }

    if (theme.catalogBrowseMode !== undefined) {
      mergedTheme.catalogBrowseMode = theme.catalogBrowseMode;
    }

    if (theme.maxDiscountPercent !== undefined) {
      mergedTheme.maxDiscountPercent = theme.maxDiscountPercent;
    }

    updateData.theme = mergedTheme;
  }

  await db.update(stores).set(updateData).where(eq(stores.id, storeId));

  return { success: true as const };
}

/**
 * Replaces the contact page settings under `settings.contact`. The rest of
 * the settings JSON is re-read and kept as is: the column holds many
 * unrelated groups and a stale client copy must not overwrite them.
 */
export async function updateStoreContact(params: UpdateStoreContactParams) {
  const { storeId, input } = params;

  const currentStore = await db.query.stores.findFirst({
    where: eq(stores.id, storeId),
    columns: { settings: true },
  });

  if (!currentStore) {
    throw new ApiServiceError("NOT_FOUND", "errors.storeNotFound");
  }

  const settings = currentStore.settings ?? {
    reservationMode: "payment" as const,
    advanceNoticeMinutes: 1440,
  };

  await db
    .update(stores)
    .set({
      settings: { ...settings, contact: input },
      updatedAt: new Date(),
    })
    .where(eq(stores.id, storeId));

  return { success: true as const };
}

/**
 * Replaces the search engine settings under `settings.seo`, keeping every
 * other group of the settings JSON as stored.
 */
export async function updateStoreSeo(params: UpdateStoreSeoParams) {
  const { storeId, input } = params;

  const currentStore = await db.query.stores.findFirst({
    where: eq(stores.id, storeId),
    columns: { settings: true },
  });

  if (!currentStore) {
    throw new ApiServiceError("NOT_FOUND", "errors.storeNotFound");
  }

  const settings = currentStore.settings ?? {
    reservationMode: "payment" as const,
    advanceNoticeMinutes: 1440,
  };

  await db
    .update(stores)
    .set({
      settings: { ...settings, seo: input },
      updatedAt: new Date(),
    })
    .where(eq(stores.id, storeId));

  return { success: true as const };
}

// ---------------------------------------------------------------------------
// Online store editor
// ---------------------------------------------------------------------------

interface UpdateOnlineStoreParams {
  storeId: string;
  input: UpdateOnlineStoreInput;
}

/** Column defaults for a row saved before `settings` existed. */
const SETTINGS_SEED: StoreSettings = { reservationMode: "payment", advanceNoticeMinutes: 1440 };

/** Column default of `theme`, for a row saved before it existed. */
const THEME_SEED: StoreTheme = { mode: "light", primaryColor: "#0066FF" };

const assertOwnedImage = (url: string | null | undefined, ownerPrefix: string): void => {
  if (url && !isOwnedImageUrl(url, ownerPrefix)) {
    throw new ApiServiceError("BAD_REQUEST", "errors.invalidData");
  }
};

/** Editor HTML: null when the editor is empty, sanitised otherwise. */
const toStoredRichText = (html: string): string | null => {
  const sanitized = sanitizeRichTextHtml(html);
  return sanitized.replace(/<[^>]*>/g, "").trim() === "" ? null : sanitized;
};

/**
 * Applies the slices of the online store editor in one write. Each slice
 * replaces the fields it owns and nothing else: `theme` and `settings` are
 * re-read and patched, so a stale client copy never overwrites another
 * group of the JSON columns (delivery, taxes, hours, integrations).
 */
export async function updateOnlineStore(params: UpdateOnlineStoreParams) {
  const { storeId, input } = params;
  const { identity, home, contact, legal, seo } = input;
  const imagePrefix = `${storeId}/logo`;

  assertOwnedImage(identity?.logoUrl, imagePrefix);
  assertOwnedImage(identity?.darkLogoUrl, imagePrefix);
  assertOwnedImage(identity?.faviconUrl, imagePrefix);
  assertOwnedImage(seo?.shareImageUrl, imagePrefix);
  for (const image of home?.heroImages ?? []) {
    assertOwnedImage(image, imagePrefix);
  }

  const currentStore = await db.query.stores.findFirst({
    where: eq(stores.id, storeId),
    columns: { settings: true, theme: true },
  });

  if (!currentStore) {
    throw new ApiServiceError("NOT_FOUND", "errors.storeNotFound");
  }

  const settings: StoreSettings = { ...SETTINGS_SEED, ...currentStore.settings };
  const theme: StoreTheme = { ...THEME_SEED, ...currentStore.theme };
  const updateData: Partial<typeof stores.$inferInsert> = { updatedAt: new Date() };

  if (identity) {
    updateData.name = identity.name;
    updateData.tagline = identity.tagline === null ? null : toStoredRichText(identity.tagline);
    updateData.description = toStoredRichText(identity.description);
    if (identity.logoUrl !== undefined) updateData.logoUrl = identity.logoUrl || null;
    if (identity.darkLogoUrl !== undefined) updateData.darkLogoUrl = identity.darkLogoUrl || null;
    if (identity.faviconUrl !== undefined) updateData.faviconUrl = identity.faviconUrl || null;
    theme.mode = identity.theme.mode;
    theme.primaryColor = identity.theme.primaryColor;
    settings.locale = identity.locale;
  }

  if (home) {
    if (home.heroImages !== undefined) theme.heroImages = home.heroImages;
    theme.heroLayout = home.heroLayout;
    theme.heroAlign = home.heroAlign;
    theme.heroVerticalAlign = home.heroVerticalAlign;
    theme.catalogBrowseMode = home.catalogBrowseMode;
    theme.maxDiscountPercent = home.maxDiscountPercent;
    theme.announcement = home.announcement;
    theme.homeSections = home.homeSections;
  }

  if (contact) {
    updateData.email = contact.email;
    updateData.phone = contact.phone;
    updateData.address = contact.address;
    updateData.latitude = contact.latitude === null ? null : String(contact.latitude);
    updateData.longitude = contact.longitude === null ? null : String(contact.longitude);
    settings.contact = contact.channels;
    settings.social = contact.social;
    theme.headerPhone = contact.headerPhone;
  }

  if (legal) {
    updateData.cgv = sanitizeRichTextHtml(legal.cgv);
    updateData.legalNotice = sanitizeRichTextHtml(legal.legalNotice);
    updateData.includeCgvInContract = legal.includeFullCgvInContract;
    settings.footerNote = legal.footerNote;
  }

  if (seo) {
    settings.seo = { ...settings.seo, googleSiteVerification: seo.googleSiteVerification };
    if (seo.shareImageUrl !== undefined) theme.shareImageUrl = seo.shareImageUrl || null;
  }

  if (identity || home || contact || seo) updateData.theme = theme;
  if (identity || contact || legal || seo) updateData.settings = settings;

  await db.update(stores).set(updateData).where(eq(stores.id, storeId));

  return { success: true as const };
}
