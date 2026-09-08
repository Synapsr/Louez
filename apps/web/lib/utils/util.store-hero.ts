import type { StoreTheme } from "@louez/types";

export type StoreHeroLayout = NonNullable<StoreTheme["heroLayout"]>;
export type StoreHeroAlign = NonNullable<StoreTheme["heroAlign"]>;

/** What the hero actually renders: the two layouts a store can pick, or the band it gets without photos. */
export type StoreHeroShape = StoreHeroLayout | "band";

export interface StoreHeroPresentation {
  shape: StoreHeroShape;
  align: StoreHeroAlign;
  /** The headline sits on a photo (white text, scrim, translucent pills). */
  textOnPhoto: boolean;
}

export const DEFAULT_HERO_LAYOUT: StoreHeroLayout = "cover";
export const DEFAULT_HERO_ALIGN: StoreHeroAlign = "center";

interface ResolveStoreHeroPresentationInput {
  theme: Pick<StoreTheme, "heroLayout" | "heroAlign"> | null | undefined;
  imageCount: number;
}

/**
 * The store's hero choices, reduced to what the page can render. Without a
 * photo there is nothing to align against, so both layouts collapse to one
 * centred band. The split layout has no centre: its text lives in a column
 * next to the photo, so "center" reads as "start" there.
 */
export const resolveStoreHeroPresentation = ({
  theme,
  imageCount,
}: ResolveStoreHeroPresentationInput): StoreHeroPresentation => {
  if (imageCount === 0) {
    return { shape: "band", align: "center", textOnPhoto: false };
  }

  const layout = theme?.heroLayout ?? DEFAULT_HERO_LAYOUT;
  const align = theme?.heroAlign ?? DEFAULT_HERO_ALIGN;

  if (layout === "split") {
    return { shape: "split", align: align === "center" ? "start" : align, textOnPhoto: false };
  }

  return { shape: "cover", align, textOnPhoto: true };
};
