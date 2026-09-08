import { cn } from "@louez/utils";

import { resolveStoreHeroPresentation } from "@/lib/utils/util.store-hero";

import type { AppearanceFormValues } from "./util.appearance-form";

interface StorefrontSketchProps {
  storeName: string;
  values: Pick<
    AppearanceFormValues,
    | "themeMode"
    | "primaryColor"
    | "logoUrl"
    | "heroLayout"
    | "heroAlign"
    | "heroImages"
    | "catalogBrowseMode"
  >;
  className?: string;
}

/**
 * The sketch has its own palette rather than the page tokens: the store's
 * mode is not the dashboard's, so a light store must read light inside a
 * dark dashboard and the other way round.
 */
const PALETTE = {
  light: {
    page: "bg-white text-zinc-900",
    line: "border-zinc-200",
    band: "bg-zinc-100",
    surface: "bg-white",
    ink: "bg-zinc-900",
    inkSoft: "bg-zinc-400",
    fill: "bg-zinc-200",
    fillSoft: "bg-zinc-100",
  },
  dark: {
    page: "bg-zinc-950 text-zinc-100",
    line: "border-zinc-800",
    band: "bg-zinc-900",
    surface: "bg-zinc-900",
    ink: "bg-zinc-100",
    inkSoft: "bg-zinc-500",
    fill: "bg-zinc-800",
    fillSoft: "bg-zinc-900",
  },
} as const;

const ALIGN_ITEMS = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
} as const;

const ALIGN_JUSTIFY = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
} as const;

const INVENTORY_TILES = ["a", "b", "c", "d"] as const;

/**
 * The home page as a wireframe: header, hero in the chosen layout, then the
 * catalog's first screen. Real logo and photos, everything else is bars, so
 * the store owner reads structure and colour, not copy.
 */
export const StorefrontSketch = ({ storeName, values, className }: StorefrontSketchProps) => {
  const p = PALETTE[values.themeMode];
  const hero = resolveStoreHeroPresentation({
    theme: { heroLayout: values.heroLayout, heroAlign: values.heroAlign },
    imageCount: values.heroImages.length,
  });
  const photo = values.heroImages[0];
  const primary = { backgroundColor: values.primaryColor };

  const searchCard = (
    <div
      className={cn(
        "flex w-full max-w-40 flex-col gap-1 rounded-md p-1.5",
        hero.shape === "split" ? cn("border", p.line, p.surface) : "bg-white shadow-md",
      )}
    >
      <div className="grid grid-cols-2 gap-1">
        <div className={cn("h-2.5 rounded-sm", hero.shape === "split" ? p.fill : "bg-zinc-200")} />
        <div className={cn("h-2.5 rounded-sm", hero.shape === "split" ? p.fill : "bg-zinc-200")} />
      </div>
      <div className="h-2.5 rounded-sm" style={primary} />
    </div>
  );

  const reassurance = (
    <div className="flex gap-2">
      {INVENTORY_TILES.slice(0, 3).map((key) => (
        <div
          key={key}
          className={cn("h-1 w-8 rounded-full", hero.textOnPhoto ? "bg-white/70" : p.inkSoft)}
        />
      ))}
    </div>
  );

  // The split layout aligns the column, not the text inside it.
  const textAlign = hero.shape === "split" ? "start" : hero.align;
  const textBlock = (
    <div className={cn("flex w-full flex-col gap-1.5", ALIGN_ITEMS[textAlign])}>
      <div className="flex gap-1">
        <div className={cn("h-2 w-10 rounded-full", hero.textOnPhoto ? "bg-white/90" : p.fill)} />
        <div className={cn("h-2 w-6 rounded-full", hero.textOnPhoto ? "bg-white/90" : p.fill)} />
      </div>
      <div
        className={cn("h-3 w-1/2 max-w-32 rounded-full", hero.textOnPhoto ? "bg-white" : p.ink)}
      />
      <div
        className={cn(
          "h-1.5 w-3/4 max-w-44 rounded-full",
          hero.textOnPhoto ? "bg-white/70" : p.inkSoft,
        )}
      />
      <div className={cn("mt-1 flex w-full", ALIGN_JUSTIFY[textAlign])}>{searchCard}</div>
      {reassurance}
    </div>
  );

  return (
    <div
      aria-hidden
      className={cn("overflow-hidden rounded-xl border", p.page, p.line, className)}
      data-slot="storefront-sketch"
    >
      <div className={cn("flex h-9 items-center justify-between gap-3 border-b px-3", p.line)}>
        <div className="flex min-w-0 items-center">
          {values.logoUrl ? (
            <img src={values.logoUrl} alt="" className="h-4 max-w-16 object-contain" />
          ) : (
            <span className="truncate font-semibold text-[10px] leading-none">{storeName}</span>
          )}
        </div>
        <div className={cn("h-5 w-2/5 rounded-full border", p.line, p.surface)} />
        <div className="flex items-center gap-1.5">
          <div className={cn("size-3 rounded-full", p.fill)} />
          <div className={cn("h-3 w-8 rounded-full", p.fill)} />
        </div>
      </div>

      {hero.shape === "cover" ? (
        <div className="relative aspect-[16/7] overflow-hidden">
          {photo ? (
            <img src={photo} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : null}
          <div className="absolute inset-0 bg-linear-to-t from-black/75 via-black/30 via-45% to-transparent to-90%" />
          <div className="absolute inset-x-3 bottom-3">{textBlock}</div>
        </div>
      ) : hero.shape === "split" ? (
        <div className="grid grid-cols-[5fr_6fr] items-center gap-3 p-3">
          <div className={cn(hero.align === "end" && "order-last")}>{textBlock}</div>
          <div className={cn("relative aspect-[5/4] overflow-hidden rounded-md", p.fill)}>
            {photo ? (
              <img src={photo} alt="" className="absolute inset-0 h-full w-full object-cover" />
            ) : null}
          </div>
        </div>
      ) : (
        <div className={cn("flex flex-col items-center px-3 py-5", p.band)}>{textBlock}</div>
      )}

      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-center justify-between">
          <div className={cn("h-2.5 w-20 rounded-full", p.ink)} />
          <div className={cn("h-1.5 w-8 rounded-full", p.inkSoft)} />
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {INVENTORY_TILES.map((key) => (
            <div key={key} className={cn("overflow-hidden rounded-md border", p.line, p.surface)}>
              <div
                className={cn(
                  values.catalogBrowseMode === "categories" ? "aspect-[4/3]" : "aspect-square",
                  p.fillSoft,
                )}
              />
              <div className="flex flex-col gap-1 p-1.5">
                <div className={cn("h-1.5 w-3/4 rounded-full", p.ink)} />
                {values.catalogBrowseMode === "categories" ? (
                  <div className={cn("h-1 w-1/2 rounded-full", p.inkSoft)} />
                ) : (
                  <div className="h-1.5 w-1/3 rounded-full" style={primary} />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
