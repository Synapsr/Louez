import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRightIcon,
  CalendarIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  MailIcon,
  MapPinIcon,
  PackageIcon,
  PhoneIcon,
  ShieldCheckIcon,
  StarIcon,
  TruckIcon,
} from "lucide-react";

import { cn } from "@louez/utils";

import { stripHtml } from "@/lib/util.seo-text";
import { resolveStoreHeroPresentation } from "@/lib/utils/util.store-hero";

import type { OnlineStoreDevice } from "../online-store.constants";
import { type OnlineStoreFormValues, getContrastColor } from "../util.online-store-form";
import { SketchBar } from "./sketch-bar";
import { SketchContactRow } from "./sketch-contact-row";
import { SKETCH_TRANSITION, type SketchPalette } from "./sketch-palette";

interface SketchHomePageProps {
  palette: SketchPalette;
  device: OnlineStoreDevice;
  values: OnlineStoreFormValues;
  name: string;
  reduceMotion: boolean;
}

const ALIGN_ITEMS = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
} as const;

const TEXT_ALIGN = {
  start: "text-left",
  center: "text-center",
  end: "text-right",
} as const;

const ALIGN_JUSTIFY = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
} as const;

const VERTICAL_ITEMS = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
} as const;

const SCRIM = {
  start: "bg-linear-to-b from-black/70 via-black/30 via-55% to-transparent to-95%",
  center: "bg-black/40",
  end: "bg-linear-to-t from-black/75 via-black/30 via-45% to-transparent to-90%",
} as const;

const TILES = [0, 1, 2, 3, 4, 5, 6, 7] as const;
const REVIEW_CARDS = [0, 1, 2] as const;
const STARS = [0, 1, 2, 3, 4] as const;
const REASSURANCE_ICONS = [CheckCircle2Icon, ShieldCheckIcon, TruckIcon] as const;

/**
 * The home page drawn at the storefront's own sizes: header aside, the hero
 * in the chosen layout with the period search, the inventory grid, the
 * reviews band, the location block. Real photos and words where they carry
 * meaning, bars the size of the text everywhere else.
 */
export const SketchHomePage = ({
  palette: p,
  device,
  values,
  name,
  reduceMotion,
}: SketchHomePageProps) => {
  const { identity, home, contact } = values;
  const phone = device === "phone";
  const hero = resolveStoreHeroPresentation({
    theme: {
      heroLayout: home.heroLayout,
      heroAlign: home.heroAlign,
      heroVerticalAlign: home.heroVerticalAlign,
    },
    imageCount: home.heroImages.length,
  });
  const photo = home.heroImages[0];
  const primary = identity.primaryColor;
  const onPrimary = getContrastColor(primary) === "white" ? "#ffffff" : "#09090b";
  const tagline = stripHtml(identity.tagline).trim();
  const description = tagline ? "" : stripHtml(identity.description).trim();
  const transition = reduceMotion ? { duration: 0 } : SKETCH_TRANSITION;
  const onPhoto = hero.textOnPhoto;
  // The split layout aligns the column, not the text inside it; a phone stacks it.
  const textAlign = hero.shape === "split" || phone ? "start" : hero.align;
  const gutter = phone ? "px-4" : "px-8";

  const badges = (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={cn(
          "flex h-7 items-center gap-2 rounded-full px-3",
          onPhoto ? "bg-white/90" : cn("border", p.line, p.surface),
        )}
      >
        <span className="size-2 rounded-full bg-emerald-500" />
        <SketchBar className={cn("h-2.5 w-20", onPhoto ? "bg-zinc-300" : p.inkSoft)} />
      </span>
      {home.showReviews ? (
        <span
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-full px-3",
            onPhoto ? "bg-white/90" : cn("border", p.line, p.surface),
          )}
        >
          <StarIcon className="size-3.5 fill-amber-400 text-amber-400" />
          <SketchBar className={cn("h-2.5 w-8", onPhoto ? "bg-zinc-400" : p.ink)} />
          <SketchBar className={cn("h-2 w-8", onPhoto ? "bg-zinc-300" : p.inkSoft)} />
        </span>
      ) : null}
    </div>
  );

  const lead = tagline ? (
    <p
      className={cn(
        "max-w-prose text-pretty",
        phone ? "text-base" : "text-lg",
        onPhoto ? "text-white/85" : p.textSoft,
      )}
    >
      {tagline}
    </p>
  ) : description ? (
    <p
      className={cn(
        "line-clamp-3 max-w-prose text-pretty",
        phone ? "text-base" : "text-lg",
        onPhoto ? "text-white/85" : p.textSoft,
      )}
    >
      {description}
    </p>
  ) : (
    <div className={cn("flex w-full max-w-md flex-col gap-2", ALIGN_ITEMS[textAlign])}>
      <SketchBar className={cn("h-3.5 w-full", onPhoto ? "bg-white/60" : p.inkSoft)} />
      <SketchBar className={cn("h-3.5 w-2/3", onPhoto ? "bg-white/60" : p.inkSoft)} />
    </div>
  );

  const searchCard = (
    <div
      className={cn(
        "w-full max-w-2xl rounded-2xl transition-colors duration-300",
        phone ? "p-4" : "p-5",
        hero.shape === "split"
          ? cn("border", p.line, p.surface)
          : "bg-white text-zinc-900 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.35)]",
      )}
    >
      <div className={cn("grid gap-3", phone ? "grid-cols-1" : "grid-cols-2")}>
        {["pickup", "return"].map((key) => (
          <div key={key} className="flex flex-col gap-2">
            <SketchBar
              className={cn("h-2.5 w-12", hero.shape === "split" ? p.inkSoft : "bg-zinc-300")}
            />
            <div
              className={cn(
                "flex h-11 items-center justify-between rounded-lg border px-3",
                hero.shape === "split" ? p.line : "border-zinc-200/70",
              )}
            >
              <span
                className={cn(
                  "flex items-center gap-2",
                  hero.shape === "split" ? p.textSoft : "text-zinc-400",
                )}
              >
                <CalendarIcon className="size-4" />
                <SketchBar
                  className={cn("h-3 w-14", hero.shape === "split" ? p.fill : "bg-zinc-100")}
                />
              </span>
              <span
                className={cn(
                  "flex items-center gap-2",
                  hero.shape === "split" ? p.textSoft : "text-zinc-400",
                )}
              >
                <ClockIcon className="size-4" />
                <SketchBar
                  className={cn("h-3 w-10", hero.shape === "split" ? p.fill : "bg-zinc-100")}
                />
              </span>
            </div>
          </div>
        ))}
      </div>
      <div
        className="mt-3 flex h-11 items-center justify-center gap-2 rounded-lg transition-colors duration-300"
        style={{ backgroundColor: primary, color: onPrimary }}
      >
        <SketchBar className="h-3 w-32 bg-current opacity-80" />
        <ArrowRightIcon className="size-4" />
      </div>
    </div>
  );

  const reassurance = (
    <AnimatePresence initial={false}>
      {home.showReassurance ? (
        <motion.div
          key="reassurance"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={transition}
          className={cn("flex w-full overflow-hidden", ALIGN_JUSTIFY[textAlign])}
        >
          <div
            className={cn(
              "flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm",
              onPhoto ? "text-white/80" : p.textSoft,
            )}
          >
            {REASSURANCE_ICONS.map((Icon, index) => (
              <span key={index} className="inline-flex items-center gap-1.5">
                <Icon className="size-4 shrink-0" />
                <SketchBar
                  className={cn(
                    "h-3",
                    index === 1 ? "w-24" : "w-28",
                    onPhoto ? "bg-white/70" : p.inkSoft,
                  )}
                />
              </span>
            ))}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );

  const textBlock = (
    <motion.div
      layout={!reduceMotion}
      transition={transition}
      className={cn("flex w-full flex-col gap-5", ALIGN_ITEMS[textAlign], TEXT_ALIGN[textAlign])}
    >
      <div className={cn("flex max-w-3xl flex-col gap-3", ALIGN_ITEMS[textAlign])}>
        {badges}
        <h1
          className={cn(
            "text-balance font-semibold leading-tight tracking-tight",
            phone ? "text-2xl" : "text-4xl",
            onPhoto ? "text-white" : p.text,
          )}
        >
          {name}
        </h1>
        {lead}
      </div>
      <div className={cn("flex w-full", ALIGN_JUSTIFY[textAlign])}>{searchCard}</div>
      {reassurance}
    </motion.div>
  );

  const dots =
    home.heroImages.length > 1 ? (
      <div className="absolute right-8 bottom-6 flex h-9 items-center gap-2 rounded-full bg-black/60 px-3 text-white">
        <ChevronLeftIcon className="size-4" />
        {home.heroImages.map((image, index) => (
          <span
            key={image}
            className={cn("h-1.5 rounded-full bg-white", index === 0 ? "w-4" : "w-1.5 opacity-60")}
          />
        ))}
        <ChevronRightIcon className="size-4" />
      </div>
    ) : null;

  const tiles = (
    <div className={cn("grid", phone ? "grid-cols-2 gap-3" : "grid-cols-4 gap-4")}>
      {TILES.map((index) => (
        <div
          key={index}
          className={cn(
            "overflow-hidden rounded-2xl border p-1 pb-0 transition-colors duration-300",
            p.line,
            p.surface,
          )}
        >
          <div
            className={cn(
              "flex aspect-4/3 items-center justify-center rounded-xl",
              p.fillSoft,
              p.icon,
            )}
          >
            <PackageIcon className="size-8 opacity-60" />
          </div>
          <div className="flex flex-col gap-1.5 px-2 pt-3 pb-3">
            <SketchBar className={cn("h-3.5", index % 3 === 0 ? "w-2/3" : "w-3/4", p.ink)} />
            {home.catalogBrowseMode === "categories" ? (
              <>
                <SketchBar className={cn("h-2.5 w-full", p.inkSoft)} />
                <SketchBar className={cn("h-2.5 w-16", p.inkSoft)} />
              </>
            ) : (
              <div
                aria-hidden
                className="h-3 w-20 rounded-full transition-colors duration-300"
                style={{ backgroundColor: primary }}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div data-slot="sketch-home">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={hero.shape}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={transition}
        >
          {hero.shape === "cover" ? (
            <div
              className={cn(
                "relative flex overflow-hidden bg-zinc-900 text-white",
                phone ? "min-h-147.5" : "min-h-140",
                VERTICAL_ITEMS[hero.verticalAlign],
              )}
            >
              {photo ? (
                <img src={photo} alt="" className="absolute inset-0 h-full w-full object-cover" />
              ) : null}
              <div className={cn("absolute inset-0", SCRIM[hero.verticalAlign])} />
              <div
                className={cn(
                  "relative mx-auto flex w-full max-w-7xl flex-col",
                  gutter,
                  phone ? "pt-20 pb-16" : "pt-24 pb-10",
                  ALIGN_ITEMS[textAlign],
                )}
              >
                {textBlock}
              </div>
              {dots}
            </div>
          ) : hero.shape === "split" ? (
            <div
              className={cn(
                "mx-auto grid w-full max-w-7xl",
                gutter,
                phone
                  ? "gap-6 py-6"
                  : cn("grid-cols-[5fr_6fr] gap-12 py-12", VERTICAL_ITEMS[hero.verticalAlign]),
              )}
            >
              <div
                className={cn(
                  "relative overflow-hidden rounded-2xl",
                  phone ? "aspect-16/10" : "aspect-5/4",
                  p.fillSoft,
                  !phone && hero.align === "end" ? "order-first" : "order-last",
                )}
              >
                {photo ? (
                  <img src={photo} alt="" className="absolute inset-0 h-full w-full object-cover" />
                ) : null}
              </div>
              <div className="flex max-w-2xl flex-col">{textBlock}</div>
            </div>
          ) : (
            <div className={cn("transition-colors duration-300", p.band)}>
              <div
                className={cn(
                  "mx-auto flex w-full max-w-7xl flex-col items-center",
                  gutter,
                  phone ? "py-10" : "py-14",
                )}
              >
                {textBlock}
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <div className={cn("mx-auto w-full max-w-7xl", gutter, phone ? "py-8" : "py-12")}>
        <div className="mb-6 flex items-end justify-between">
          <SketchBar className={cn("h-7", phone ? "w-44" : "w-64", p.ink)} />
          <SketchBar className={cn("h-3.5 w-16", p.ink)} />
        </div>
        {tiles}
      </div>

      <AnimatePresence initial={false}>
        {home.showReviews ? (
          <motion.div
            key="reviews"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={transition}
            className="overflow-hidden"
          >
            <div className={cn("transition-colors duration-300", p.band)}>
              <div className={cn("mx-auto w-full max-w-7xl", gutter, phone ? "py-8" : "py-12")}>
                <div className="mb-6 flex flex-wrap items-center gap-4">
                  <span
                    className={cn(
                      "flex h-11 items-center gap-2 rounded-full px-4 shadow-sm",
                      p.surface,
                    )}
                  >
                    <StarIcon className="size-5 fill-amber-400 text-amber-400" />
                    <SketchBar className={cn("h-3 w-8", p.ink)} />
                    <SketchBar className={cn("h-2.5 w-10", p.inkSoft)} />
                  </span>
                  <SketchBar className={cn("h-7 w-48", p.ink)} />
                </div>
                <div className={cn("grid gap-4", phone ? "grid-cols-1" : "grid-cols-3")}>
                  {REVIEW_CARDS.slice(0, phone ? 1 : 3).map((index) => (
                    <div
                      key={index}
                      className={cn("flex flex-col gap-3 rounded-2xl p-5 shadow-sm", p.surface)}
                    >
                      <div className="flex gap-0.5">
                        {STARS.map((star) => (
                          <StarIcon key={star} className="size-4 fill-amber-400 text-amber-400" />
                        ))}
                      </div>
                      <div className="flex flex-col gap-2">
                        <SketchBar className={cn("h-3 w-full", p.inkSoft)} />
                        <SketchBar className={cn("h-3 w-11/12", p.inkSoft)} />
                        <SketchBar className={cn("h-3 w-2/3", p.inkSoft)} />
                      </div>
                      <div className="mt-1 flex items-center gap-3">
                        <span className={cn("size-8 rounded-full", p.fill)} />
                        <SketchBar className={cn("h-3 w-24", p.ink)} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {home.showMap && contact.address.trim() !== "" ? (
          <motion.div
            key="map"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={transition}
            className="overflow-hidden"
          >
            <div
              className={cn(
                "mx-auto grid w-full max-w-7xl",
                gutter,
                phone ? "gap-6 py-8" : "grid-cols-2 gap-8 py-12",
              )}
            >
              <div className="flex flex-col gap-6">
                <SketchBar className={cn("h-7 w-32", p.ink)} />
                <div className="flex flex-col gap-4">
                  <SketchContactRow palette={p} icon={MapPinIcon} text={contact.address.trim()} />
                  {contact.channels.phone && contact.phone.trim() ? (
                    <SketchContactRow palette={p} icon={PhoneIcon} text={contact.phone.trim()} />
                  ) : null}
                  {contact.channels.email && contact.email.trim() ? (
                    <SketchContactRow palette={p} icon={MailIcon} text={contact.email.trim()} />
                  ) : null}
                </div>
              </div>
              <div
                className={cn(
                  "relative flex items-center justify-center rounded-2xl transition-colors duration-300",
                  phone ? "h-64" : "h-96",
                  p.fillSoft,
                )}
              >
                <MapPinIcon className="size-10" style={{ color: primary }} />
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
};
