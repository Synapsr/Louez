import { db, stores } from "@louez/db";
import type { UpdateStoreAppearanceInput, UpdateStoreLegalInput } from "@louez/validations";
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

    if (theme.heroLayout !== undefined) {
      mergedTheme.heroLayout = theme.heroLayout;
    }

    if (theme.heroAlign !== undefined) {
      mergedTheme.heroAlign = theme.heroAlign;
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
