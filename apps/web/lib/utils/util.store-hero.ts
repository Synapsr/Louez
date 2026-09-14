import type { StoreTheme } from "@louez/types";

export type StoreHeroLayout = NonNullable<StoreTheme["heroLayout"]>;
export type StoreHeroAlign = NonNullable<StoreTheme["heroAlign"]>;
export type StoreHeroVerticalAlign = NonNullable<StoreTheme["heroVerticalAlign"]>;

/** What the hero actually renders: the two layouts a store can pick, or the band it gets without photos. */
export type StoreHeroShape = StoreHeroLayout | "band";

export interface StoreHeroPresentation {
  shape: StoreHeroShape;
  /** Horizontal: the side of the text (cover: text alignment, split: the text column's side). */
  align: StoreHeroAlign;
  /** Vertical: top, middle or bottom of the photo. */
  verticalAlign: StoreHeroVerticalAlign;
  /** The headline sits on a photo (white text, scrim, translucent pills). */
  textOnPhoto: boolean;
}

export const DEFAULT_HERO_LAYOUT: StoreHeroLayout = "cover";
export const DEFAULT_HERO_ALIGN: StoreHeroAlign = "center";
export const DEFAULT_HERO_VERTICAL_ALIGN: StoreHeroVerticalAlign = "end";

interface ResolveStoreHeroPresentationInput {
  theme: Pick<StoreTheme, "heroLayout" | "heroAlign" | "heroVerticalAlign"> | null | undefined;
  imageCount: number;
}

/**
 * The store's hero choices, reduced to what the page can render. Without a
 * photo there is nothing to position against, so both layouts collapse to
 * one centred band. The split layout has no horizontal centre: its text
 * lives in a column next to the photo, so "center" reads as "start" there.
 */
export const resolveStoreHeroPresentation = ({
  theme,
  imageCount,
}: ResolveStoreHeroPresentationInput): StoreHeroPresentation => {
  if (imageCount === 0) {
    return { shape: "band", align: "center", verticalAlign: "center", textOnPhoto: false };
  }

  const layout = theme?.heroLayout ?? DEFAULT_HERO_LAYOUT;
  const align = theme?.heroAlign ?? DEFAULT_HERO_ALIGN;
  const verticalAlign = theme?.heroVerticalAlign ?? DEFAULT_HERO_VERTICAL_ALIGN;

  if (layout === "split") {
    return {
      shape: "split",
      align: align === "center" ? "start" : align,
      verticalAlign,
      textOnPhoto: false,
    };
  }

  return { shape: "cover", align, verticalAlign, textOnPhoto: true };
};
