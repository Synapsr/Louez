import type { ComponentType } from "react";

import { FileTextIcon, LayoutIcon, MailIcon, PaintIcon, SearchIcon } from "@louez/ui/icons";

/** The editor's sections, in rail order: what the visitor meets first comes first. */
export const ONLINE_STORE_SECTIONS = ["identity", "home", "contact", "legal", "seo"] as const;

export type OnlineStoreSection = (typeof ONLINE_STORE_SECTIONS)[number];

export const ONLINE_STORE_BASE_PATH = "/online-store";

export const ONLINE_STORE_DEFAULT_SECTION: OnlineStoreSection = "identity";

export const getOnlineStoreSectionHref = (section: OnlineStoreSection): string =>
  `${ONLINE_STORE_BASE_PATH}/${section}`;

export const ONLINE_STORE_SECTION_ICONS: Record<
  OnlineStoreSection,
  ComponentType<{ className?: string }>
> = {
  identity: PaintIcon,
  home: LayoutIcon,
  contact: MailIcon,
  legal: FileTextIcon,
  seo: SearchIcon,
};

/** Storefront page each section previews; the sketch draws it. */
export type OnlineStoreSketchPage = "home" | "contact" | "legal" | "seo";

export const ONLINE_STORE_SECTION_PAGES: Record<OnlineStoreSection, OnlineStoreSketchPage> = {
  identity: "home",
  home: "home",
  contact: "contact",
  legal: "legal",
  seo: "seo",
};

/** Sketch formats: a desktop viewport, or a phone. */
export type OnlineStoreDevice = "desktop" | "phone";
