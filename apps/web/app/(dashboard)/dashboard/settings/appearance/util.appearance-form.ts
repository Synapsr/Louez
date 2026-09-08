import { formOptions, revalidateLogic } from "@tanstack/react-form";
import { z } from "zod";

import type { StoreTheme } from "@louez/types";

export const MAX_HERO_IMAGES = 5;
export const DEFAULT_PRIMARY_COLOR = "#2563eb";

const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export const appearanceFormSchema = z.object({
  logoUrl: z.string().nullable(),
  darkLogoUrl: z.string().nullable(),
  primaryColor: z.string().regex(HEX_COLOR_PATTERN),
  themeMode: z.enum(["light", "dark"]),
  heroLayout: z.enum(["cover", "split"]),
  heroAlign: z.enum(["start", "center", "end"]),
  heroVerticalAlign: z.enum(["start", "center", "end"]),
  heroImages: z.array(z.string()).max(MAX_HERO_IMAGES),
  catalogBrowseMode: z.enum(["products", "categories"]),
  maxDiscountEnabled: z.boolean(),
  maxDiscountPercent: z.number().int().min(0).max(100),
});

export type AppearanceFormValues = z.infer<typeof appearanceFormSchema>;

export interface AppearanceStore {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  darkLogoUrl: string | null;
  theme: StoreTheme | null;
}

/** What the `updateAppearance` procedure receives. */
export interface AppearancePayload {
  logoUrl?: string | null;
  darkLogoUrl?: string | null;
  theme: {
    mode: "light" | "dark";
    primaryColor: string;
    heroLayout: "cover" | "split";
    heroAlign: "start" | "center" | "end";
    heroVerticalAlign: "start" | "center" | "end";
    catalogBrowseMode: "products" | "categories";
    maxDiscountPercent: number | null;
    heroImages?: string[];
  };
}

export const buildAppearanceDefaults = (store: AppearanceStore): AppearanceFormValues => ({
  logoUrl: store.logoUrl,
  darkLogoUrl: store.darkLogoUrl,
  primaryColor: store.theme?.primaryColor || DEFAULT_PRIMARY_COLOR,
  themeMode: store.theme?.mode === "dark" ? "dark" : "light",
  heroLayout: store.theme?.heroLayout ?? "cover",
  heroAlign: store.theme?.heroAlign ?? "center",
  heroVerticalAlign: store.theme?.heroVerticalAlign ?? "end",
  heroImages: store.theme?.heroImages ?? [],
  catalogBrowseMode: store.theme?.catalogBrowseMode ?? "products",
  maxDiscountEnabled: store.theme?.maxDiscountPercent != null,
  maxDiscountPercent: store.theme?.maxDiscountPercent ?? 50,
});

/**
 * Black or white text for a background, by WCAG relative luminance. The
 * 0.55 threshold favours white on medium-dark colours like pink or purple.
 */
export const getContrastColor = (hexColor: string): "black" | "white" => {
  const hex = hexColor.replace("#", "");
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  return luminance > 0.55 ? "black" : "white";
};

/** A typed or pasted hex, hash optional, once six digits are there; `null` while incomplete. */
export const parseHexInput = (input: string): string | null => {
  const cleaned = input.replace(/^#/, "").replace(/[^0-9A-Fa-f]/g, "");

  return cleaned.length === 6 ? `#${cleaned.toLowerCase()}` : null;
};

export const isDataUri = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.startsWith("data:");

interface AppearanceDiff {
  value: AppearanceFormValues;
  /** The last saved values. */
  baseline: AppearanceFormValues;
}

const sameImages = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((image, index) => image === b[index]);

/**
 * The request body for the saved values, or `null` when a legacy base64
 * image was edited: those predate S3 and are only accepted as long as they
 * are left untouched, so the store must upload a real file instead.
 *
 * An untouched legacy image is simply left out of the payload, so the
 * server keeps what it has.
 */
export const buildAppearancePayload = ({
  value,
  baseline,
}: AppearanceDiff): AppearancePayload | null => {
  const keepsLegacyLogo = isDataUri(value.logoUrl) && value.logoUrl === baseline.logoUrl;
  const wantsDarkLogo = value.themeMode === "dark";
  const keepsLegacyDarkLogo =
    wantsDarkLogo && isDataUri(value.darkLogoUrl) && value.darkLogoUrl === baseline.darkLogoUrl;
  const hasLegacyHeroImages = value.heroImages.some(isDataUri);
  const keepsLegacyHeroImages =
    hasLegacyHeroImages && sameImages(value.heroImages, baseline.heroImages);

  if (
    (isDataUri(value.logoUrl) && !keepsLegacyLogo) ||
    (wantsDarkLogo && isDataUri(value.darkLogoUrl) && !keepsLegacyDarkLogo) ||
    (hasLegacyHeroImages && !keepsLegacyHeroImages)
  ) {
    return null;
  }

  const payload: AppearancePayload = {
    theme: {
      mode: value.themeMode,
      primaryColor: value.primaryColor,
      heroLayout: value.heroLayout,
      heroAlign: value.heroAlign,
      heroVerticalAlign: value.heroVerticalAlign,
      catalogBrowseMode: value.catalogBrowseMode,
      maxDiscountPercent: value.maxDiscountEnabled ? value.maxDiscountPercent : null,
    },
  };

  if (!keepsLegacyHeroImages) {
    payload.theme.heroImages = value.heroImages;
  }
  if (!keepsLegacyLogo) {
    payload.logoUrl = value.logoUrl;
  }
  if (!wantsDarkLogo) {
    payload.darkLogoUrl = null;
  } else if (!keepsLegacyDarkLogo) {
    payload.darkLogoUrl = value.darkLogoUrl;
  }

  return payload;
};

export interface ReplacedImages {
  logos: string[];
  heroes: string[];
}

/** Saved images the new values no longer reference, to delete from storage after a save. */
export const listReplacedImages = ({ value, baseline }: AppearanceDiff): ReplacedImages => {
  const logos: string[] = [];
  if (baseline.logoUrl && baseline.logoUrl !== value.logoUrl) {
    logos.push(baseline.logoUrl);
  }
  if (baseline.darkLogoUrl && baseline.darkLogoUrl !== value.darkLogoUrl) {
    logos.push(baseline.darkLogoUrl);
  }

  return {
    logos,
    heroes: baseline.heroImages.filter((image) => !value.heroImages.includes(image)),
  };
};

/** Type-only shape for `withForm` sections; the real values come from the store. */
export const APPEARANCE_EMPTY_VALUES: AppearanceFormValues = {
  logoUrl: null,
  darkLogoUrl: null,
  primaryColor: DEFAULT_PRIMARY_COLOR,
  themeMode: "light",
  heroLayout: "cover",
  heroAlign: "center",
  heroVerticalAlign: "end",
  heroImages: [],
  catalogBrowseMode: "products",
  maxDiscountEnabled: false,
  maxDiscountPercent: 50,
};

export const appearanceFormOptions = formOptions({
  defaultValues: APPEARANCE_EMPTY_VALUES,
  validators: { onSubmit: appearanceFormSchema },
  validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
});

/**
 * Type-only placeholder for `withForm({ props })`: TanStack reads the value
 * for inference alone, the real props always come from the parent.
 */
export const appearanceSectionProps = <TProps extends object>(): TProps => Object.create(null);
