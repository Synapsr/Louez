import type { ComponentProps, ComponentType } from "react";

import type { Badge } from "@louez/ui";
import {
  AccentSparklesIcon,
  CalendarPlusIcon,
  KeyboardIcon,
  LayersIcon,
  LayoutIcon,
  PackageIcon,
  PanelLeftIcon,
  ProductIcon,
  PuzzleIcon,
  ReservationsIcon,
  SearchIcon,
  TagIcon,
} from "@louez/ui/icons";

type BadgeVariant = NonNullable<ComponentProps<typeof Badge>["variant"]>;

/**
 * `feature` = a brand new capability, `improvement` = an existing flow made
 * better, `fix` = a bug corrected.
 */
export type WhatsNewCategory = "feature" | "improvement" | "fix";

export type WhatsNewCategoryMeta = {
  /** `@louez/ui` Badge variant — carries its own light/dark tokens. */
  badgeVariant: BadgeVariant;
  /** Key under the `dashboard.whatsNew` namespace. */
  labelKey: string;
};

export type WhatsNewMedia = {
  /** Still frame shown before a video plays. Only meaningful for `video`. */
  posterSrc?: string;
  /** Public path, e.g. `/images/whats-new/<id>.webp` or `/videos/whats-new/<id>.mp4`. */
  src: string;
  type: "video" | "image";
};

export type WhatsNewAnnouncement = {
  category: WhatsNewCategory;
  /** ISO date the feature shipped — drives ordering and the 30-day badge expiry. */
  date: string;
  /** Key under the `dashboard.whatsNew` namespace. */
  descriptionKey: string;
  /** Ties the announcement to a contextual `NewFeatureBadge` in the UI. */
  featureId?: string;
  href?: string;
  icon?: ComponentType<{ className?: string }>;
  id: string;
  /**
   * Demo of the feature. Shown as a thumbnail on the changelog card and at full
   * size on the announcement's page. The long-form write-up is not here: it
   * lives in `content/whats-new/<id>/<locale>.md`.
   */
  media?: WhatsNewMedia;
  titleKey: string;
};

/**
 * Shared by the changelog page filters and every entry badge. `satisfies` keeps
 * the `badgeVariant` literals narrow so the changelog accents can be derived
 * from them and are guaranteed to match the chips.
 */
export const WHATS_NEW_CATEGORIES = {
  feature: { badgeVariant: "submitted", labelKey: "categories.feature" },
  improvement: { badgeVariant: "progress", labelKey: "categories.improvement" },
  fix: { badgeVariant: "success", labelKey: "categories.fix" },
} satisfies Record<WhatsNewCategory, WhatsNewCategoryMeta>;

/**
 * Declaration order drives the changelog page filter order. The assertion is
 * the known `Object.keys` limitation — it is typed `string[]` whatever the
 * object is. Deriving the list beats restating it: the `satisfies` above makes
 * a new category a compile error until it is declared here too.
 */
export const WHATS_NEW_CATEGORY_ORDER = Object.keys(WHATS_NEW_CATEGORIES) as WhatsNewCategory[];

/** How long a contextual "New" badge keeps showing after the feature shipped. */
export const WHATS_NEW_FEATURE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const WHATS_NEW_PAGE_PATH = "/dashboard/whats-new";

/**
 * The announcement's own page — the full write-up, media included. Every entry
 * point points here; the older `${WHATS_NEW_PAGE_PATH}#<id>` hash links still
 * land on the changelog and highlight their entry, they are just not produced
 * anymore.
 */
export const getWhatsNewDetailHref = (announcementId: string) =>
  `${WHATS_NEW_PAGE_PATH}/${announcementId}`;

/** Local midnight, so a "YYYY-MM-DD" date never shifts a day in negative UTC offsets. */
export const parseWhatsNewDate = (date: string) => {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
};

/**
 * Newest first. Nothing sorts this array — the declaration order is the
 * changelog order, so dates must stay non-increasing from top to bottom.
 *
 * Every entry is commented out while its copy and its demo video are being
 * written. Uncomment one the day it is ready — nothing else to touch: the
 * sidebar counter, the changelog page and the contextual `NewFeatureBadge`
 * indicators all read this array, and each entry's write-up already waits in
 * `content/whats-new/<id>/<locale>.md`.
 */
export const WHATS_NEW_ANNOUNCEMENTS: WhatsNewAnnouncement[] = [
  {
    id: "fixed-pricing",
    category: "feature",
    date: "2026-08-27",
    titleKey: "announcements.fixed-pricing.title",
    descriptionKey: "announcements.fixed-pricing.description",
    featureId: "fixed-pricing",
    href: "/dashboard/products",
    media: {
      type: "video",
      src: "/videos/whats-new/fixed-pricing.mp4",
      posterSrc: "/images/whats-new/fixed-pricing.webp",
    },
    icon: TagIcon,
  },
  {
    id: "consumable-stock",
    category: "feature",
    date: "2026-08-27",
    titleKey: "announcements.consumable-stock.title",
    descriptionKey: "announcements.consumable-stock.description",
    featureId: "consumable-stock",
    href: "/dashboard/products",
    media: {
      type: "video",
      src: "/videos/whats-new/consumable-stock.mp4",
      posterSrc: "/images/whats-new/consumable-stock.webp",
    },
    icon: PackageIcon,
  },
  {
    id: "required-accessories",
    category: "feature",
    date: "2026-08-27",
    titleKey: "announcements.required-accessories.title",
    descriptionKey: "announcements.required-accessories.description",
    featureId: "required-accessories",
    href: "/dashboard/products",
    media: {
      type: "video",
      src: "/videos/whats-new/required-accessories.mp4",
      posterSrc: "/images/whats-new/required-accessories.webp",
    },
    icon: PuzzleIcon,
  },
  {
    id: "product-image-ai",
    category: "feature",
    date: "2026-08-04",
    titleKey: "announcements.product-image-ai.title",
    descriptionKey: "announcements.product-image-ai.description",
    featureId: "product-image-ai",
    href: "/dashboard/products",
    media: {
      type: "video",
      src: "/videos/whats-new/product-image-ai.mp4",
      posterSrc: "/images/whats-new/product-image-ai.webp",
    },
    icon: AccentSparklesIcon,
  },
  {
    id: "sidebar-simplified",
    category: "improvement",
    date: "2026-08-04",
    titleKey: "announcements.sidebar-simplified.title",
    descriptionKey: "announcements.sidebar-simplified.description",
    media: {
      type: "video",
      src: "/videos/whats-new/sidebar-simplified.mp4",
      posterSrc: "/images/whats-new/sidebar-simplified.webp",
    },
    icon: PanelLeftIcon,
  },
  {
    id: "navigation-refresh",
    category: "feature",
    date: "2026-08-03",
    titleKey: "announcements.navigation-refresh.title",
    descriptionKey: "announcements.navigation-refresh.description",
    featureId: "navigation-refresh",
    href: "/dashboard/settings",
    media: {
      type: "video",
      src: "/videos/whats-new/navigation-refresh.mp4",
      posterSrc: "/images/whats-new/navigation-refresh.webp",
    },
    icon: SearchIcon,
  },
  {
    id: "product-variants",
    category: "improvement",
    date: "2026-07-31",
    titleKey: "announcements.product-variants.title",
    descriptionKey: "announcements.product-variants.description",
    featureId: "product-variants",
    href: "/dashboard/products",
    media: {
      type: "video",
      src: "/videos/whats-new/product-variants.mp4",
      posterSrc: "/images/whats-new/product-variants.webp",
    },
    icon: LayersIcon,
  },
  {
    id: "product-detail-hub",
    category: "feature",
    date: "2026-07-31",
    titleKey: "announcements.product-detail-hub.title",
    descriptionKey: "announcements.product-detail-hub.description",
    featureId: "product-detail-hub",
    href: "/dashboard/products",
    media: {
      type: "video",
      src: "/videos/whats-new/product-detail-hub.mp4",
      posterSrc: "/images/whats-new/product-detail-hub.webp",
    },
    icon: LayoutIcon,
  },
  {
    id: "reservations-unified-views",
    category: "feature",
    date: "2026-07-30",
    titleKey: "announcements.reservations-unified-views.title",
    descriptionKey: "announcements.reservations-unified-views.description",
    featureId: "reservations-unified-views",
    href: "/dashboard/reservations",
    media: {
      type: "video",
      src: "/videos/whats-new/reservations-unified-views.mp4",
      posterSrc: "/images/whats-new/reservations-unified-views.webp",
    },
    icon: ReservationsIcon,
  },
  {
    id: "product-creation-flow-redesign",
    category: "improvement",
    date: "2026-07-29",
    titleKey: "announcements.product-creation-flow-redesign.title",
    descriptionKey: "announcements.product-creation-flow-redesign.description",
    featureId: "product-creation-flow-redesign",
    href: "/dashboard/products/new",
    icon: ProductIcon,
  },
  {
    id: "reservation-creation-simplified",
    category: "improvement",
    date: "2026-07-28",
    titleKey: "announcements.reservation-creation-simplified.title",
    descriptionKey: "announcements.reservation-creation-simplified.description",
    featureId: "reservation-creation-simplified",
    href: "/dashboard/reservations/new",
    media: {
      type: "video",
      src: "/videos/whats-new/reservation-creation-simplified.mp4",
      posterSrc: "/images/whats-new/reservation-creation-simplified.webp",
    },
    icon: CalendarPlusIcon,
  },
  {
    id: "keyboard-shortcuts",
    category: "feature",
    date: "2026-07-27",
    titleKey: "announcements.keyboard-shortcuts.title",
    descriptionKey: "announcements.keyboard-shortcuts.description",
    featureId: "keyboard-shortcuts",
    href: "/dashboard/account",
    icon: KeyboardIcon,
  },
];

/** `undefined` for an unknown id — the detail route turns that into a 404. */
export const findWhatsNewAnnouncement = (announcementId: string) =>
  WHATS_NEW_ANNOUNCEMENTS.find((announcement) => announcement.id === announcementId);
