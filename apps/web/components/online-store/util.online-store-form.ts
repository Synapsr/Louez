import { formOptions, revalidateLogic } from "@tanstack/react-form";
import { z } from "zod";

import {
  DEFAULT_STORE_HOME_SECTIONS,
  STORE_SOCIAL_NETWORKS,
  type StoreContactLayout,
  type StoreContactPhoneField,
  type StoreContactPrimaryChannel,
  type StoreSettings,
  type StoreSocialNetwork,
  type StoreTheme,
} from "@louez/types";
import type { UpdateOnlineStoreClientInput } from "@louez/validations";

import { resolveStoreContactSettings } from "@/lib/storefront/util.store-contact";
import { stripHtml } from "@/lib/util.seo-text";

import type { OnlineStoreSection } from "./online-store.constants";

export const MAX_HERO_IMAGES = 5;
export const DEFAULT_PRIMARY_COLOR = "#2563eb";
/** Visible characters of the tagline, HTML aside. */
export const MAX_TAGLINE_LENGTH = 240;
export const MAX_ANNOUNCEMENT_LENGTH = 200;
export const MAX_FOOTER_NOTE_LENGTH = 500;

const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

export interface OnlineStoreIdentityValues {
  name: string;
  /** Editor HTML, inline marks only. */
  tagline: string;
  /** Editor HTML. */
  description: string;
  /** ISO 639-1 code, or "" to follow the visitor's browser. */
  locale: string;
  logoUrl: string | null;
  darkLogoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  themeMode: "light" | "dark";
}

export interface OnlineStoreHomeValues {
  heroImages: string[];
  heroLayout: "cover" | "split";
  heroAlign: "start" | "center" | "end";
  heroVerticalAlign: "start" | "center" | "end";
  catalogBrowseMode: "products" | "categories";
  maxDiscountEnabled: boolean;
  maxDiscountPercent: number;
  announcementEnabled: boolean;
  announcementText: string;
  announcementHref: string;
  showMap: boolean;
  showReviews: boolean;
  showReassurance: boolean;
}

/** The contact page: what the inputs hold, strings where the API takes `string | null`. */
export interface OnlineStoreContactChannelValues {
  layout: StoreContactLayout;
  primaryChannel: StoreContactPrimaryChannel;
  phone: boolean;
  sms: boolean;
  whatsapp: boolean;
  whatsappNumber: string;
  email: boolean;
  form: boolean;
  formRecipientEmail: string;
  formPhoneField: StoreContactPhoneField;
  intro: string;
}

export type OnlineStoreSocialValues = Record<StoreSocialNetwork, string>;

export interface OnlineStoreContactValues {
  email: string;
  phone: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  channels: OnlineStoreContactChannelValues;
  social: OnlineStoreSocialValues;
  headerPhone: boolean;
}

export interface OnlineStoreLegalValues {
  cgv: string;
  legalNotice: string;
  includeFullCgvInContract: boolean;
  footerNote: string;
}

export interface OnlineStoreSeoValues {
  googleSiteVerification: string;
  shareImageUrl: string | null;
}

export interface OnlineStoreFormValues {
  identity: OnlineStoreIdentityValues;
  home: OnlineStoreHomeValues;
  contact: OnlineStoreContactValues;
  legal: OnlineStoreLegalValues;
  seo: OnlineStoreSeoValues;
}

/** The store row as the editor reads it; picked on the server so it can cross to the client. */
export interface OnlineStoreEditorStore {
  id: string;
  name: string;
  slug: string;
  tagline: string | null;
  description: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  latitude: string | null;
  longitude: string | null;
  logoUrl: string | null;
  darkLogoUrl: string | null;
  faviconUrl: string | null;
  cgv: string | null;
  legalNotice: string | null;
  includeCgvInContract: boolean;
  settings: StoreSettings | null;
  theme: StoreTheme | null;
}

// ---------------------------------------------------------------------------
// Client-side validation: what the inputs can tell before the API answers.
// ---------------------------------------------------------------------------

const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .refine((value) => value === "" || /^https?:\/\/\S+$/i.test(value), "validation.url");

export const onlineStoreFormSchema = z.object({
  identity: z.object({
    name: z.string().trim().min(2, "validation.minLength2").max(255),
    tagline: z
      .string()
      .max(4000)
      .refine(
        (value) => stripHtml(value).trim().length <= MAX_TAGLINE_LENGTH,
        "validation.maxLength",
      ),
    description: z.string(),
    locale: z.string(),
    logoUrl: z.string().nullable(),
    darkLogoUrl: z.string().nullable(),
    faviconUrl: z.string().nullable(),
    primaryColor: z.string().regex(HEX_COLOR_PATTERN),
    themeMode: z.enum(["light", "dark"]),
  }),
  home: z.object({
    heroImages: z.array(z.string()).max(MAX_HERO_IMAGES),
    heroLayout: z.enum(["cover", "split"]),
    heroAlign: z.enum(["start", "center", "end"]),
    heroVerticalAlign: z.enum(["start", "center", "end"]),
    catalogBrowseMode: z.enum(["products", "categories"]),
    maxDiscountEnabled: z.boolean(),
    maxDiscountPercent: z.number().int().min(0).max(100),
    announcementEnabled: z.boolean(),
    announcementText: z.string().max(MAX_ANNOUNCEMENT_LENGTH),
    announcementHref: optionalUrl,
    showMap: z.boolean(),
    showReviews: z.boolean(),
    showReassurance: z.boolean(),
  }),
  contact: z.object({
    email: z
      .string()
      .trim()
      .pipe(z.email("validation.email").or(z.literal(""))),
    phone: z.string().max(50),
    address: z.string().max(1000),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    channels: z.object({
      layout: z.enum(["full", "message", "single"]),
      primaryChannel: z.enum(["phone", "whatsapp", "email"]),
      phone: z.boolean(),
      sms: z.boolean(),
      whatsapp: z.boolean(),
      whatsappNumber: z.string().max(50),
      email: z.boolean(),
      form: z.boolean(),
      formRecipientEmail: z
        .string()
        .trim()
        .pipe(z.email("validation.email").or(z.literal(""))),
      formPhoneField: z.enum(["hidden", "optional", "required"]),
      intro: z.string().max(600),
    }),
    social: z.record(z.enum(STORE_SOCIAL_NETWORKS), optionalUrl),
    headerPhone: z.boolean(),
  }),
  legal: z.object({
    cgv: z.string(),
    legalNotice: z.string(),
    includeFullCgvInContract: z.boolean(),
    footerNote: z.string().max(MAX_FOOTER_NOTE_LENGTH),
  }),
  seo: z.object({
    googleSiteVerification: z.string().max(500),
    shareImageUrl: z.string().nullable(),
  }),
});

// ---------------------------------------------------------------------------
// Defaults from the store row
// ---------------------------------------------------------------------------

const toNumber = (value: string | null): number | null => {
  if (value === null) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const emptySocial = (): OnlineStoreSocialValues => ({
  instagram: "",
  facebook: "",
  tiktok: "",
  youtube: "",
  linkedin: "",
  x: "",
  website: "",
});

export const buildOnlineStoreDefaults = (store: OnlineStoreEditorStore): OnlineStoreFormValues => {
  const theme = store.theme;
  const settings = store.settings;
  const contact = resolveStoreContactSettings(settings);
  const homeSections = { ...DEFAULT_STORE_HOME_SECTIONS, ...theme?.homeSections };
  const social = emptySocial();
  for (const network of STORE_SOCIAL_NETWORKS) {
    social[network] = settings?.social?.[network] ?? "";
  }

  return {
    identity: {
      name: store.name,
      tagline: store.tagline ?? "",
      description: store.description ?? "",
      locale: settings?.locale ?? "",
      logoUrl: store.logoUrl,
      darkLogoUrl: store.darkLogoUrl,
      faviconUrl: store.faviconUrl,
      primaryColor: theme?.primaryColor || DEFAULT_PRIMARY_COLOR,
      themeMode: theme?.mode === "dark" ? "dark" : "light",
    },
    home: {
      heroImages: theme?.heroImages ?? [],
      heroLayout: theme?.heroLayout ?? "cover",
      heroAlign: theme?.heroAlign ?? "center",
      heroVerticalAlign: theme?.heroVerticalAlign ?? "end",
      catalogBrowseMode: theme?.catalogBrowseMode ?? "products",
      maxDiscountEnabled: theme?.maxDiscountPercent != null,
      maxDiscountPercent: theme?.maxDiscountPercent ?? 50,
      announcementEnabled: theme?.announcement?.enabled ?? false,
      announcementText: theme?.announcement?.text ?? "",
      announcementHref: theme?.announcement?.href ?? "",
      showMap: homeSections.map,
      showReviews: homeSections.reviews,
      showReassurance: homeSections.reassurance,
    },
    contact: {
      email: store.email ?? "",
      phone: store.phone ?? "",
      address: store.address ?? "",
      latitude: toNumber(store.latitude),
      longitude: toNumber(store.longitude),
      channels: {
        layout: contact.layout,
        primaryChannel: contact.primaryChannel,
        phone: contact.phone,
        sms: contact.sms,
        whatsapp: contact.whatsapp,
        whatsappNumber: contact.whatsappNumber ?? "",
        email: contact.email,
        form: contact.form,
        formRecipientEmail: contact.formRecipientEmail ?? "",
        formPhoneField: contact.formPhoneField,
        intro: contact.intro ?? "",
      },
      social,
      headerPhone: theme?.headerPhone ?? false,
    },
    legal: {
      cgv: store.cgv ?? "",
      legalNotice: store.legalNotice ?? "",
      includeFullCgvInContract: store.includeCgvInContract,
      footerNote: settings?.footerNote ?? "",
    },
    seo: {
      googleSiteVerification: settings?.seo?.googleSiteVerification ?? "",
      shareImageUrl: theme?.shareImageUrl ?? null,
    },
  };
};

// ---------------------------------------------------------------------------
// Diff and payload
// ---------------------------------------------------------------------------

/** Structural equality of plain values: primitives, arrays, plain objects. */
export const isSameValue = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => isSameValue(item, b[index]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    return [...keys].every((key) => isSameValue(left[key], right[key]));
  }
  return false;
};

export const listDirtySections = (
  value: OnlineStoreFormValues,
  baseline: OnlineStoreFormValues,
): OnlineStoreSection[] =>
  (Object.keys(value) as OnlineStoreSection[]).filter(
    (section) => !isSameValue(value[section], baseline[section]),
  );

export const isDataUri = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.startsWith("data:");

interface OnlineStoreDiff {
  value: OnlineStoreFormValues;
  /** The last saved values. */
  baseline: OnlineStoreFormValues;
}

/**
 * Whether a single image may be sent: a legacy base64 image (predating S3)
 * is accepted only while it is left untouched, and then simply left out of
 * the payload so the server keeps it.
 */
type ImageDecision =
  | { send: false }
  | { send: true; value: string | null }
  | { send: false; invalid: true };

const decideImage = (value: string | null, saved: string | null): ImageDecision => {
  if (!isDataUri(value)) return { send: true, value };
  return value === saved ? { send: false } : { send: false, invalid: true };
};

const isInvalid = (decision: ImageDecision): boolean => "invalid" in decision;

/**
 * The request body for what changed since the last save, section by
 * section, or `null` when a legacy base64 image was edited: those predate
 * S3 and cannot be re-sent, the store must upload a real file instead.
 * An empty body (`{}`) means nothing to save.
 */
export const buildOnlineStorePayload = ({
  value,
  baseline,
}: OnlineStoreDiff): UpdateOnlineStoreClientInput | null => {
  const payload: UpdateOnlineStoreClientInput = {};
  const dirty = new Set(listDirtySections(value, baseline));

  if (dirty.has("identity")) {
    const { identity } = value;
    const wantsDarkLogo = identity.themeMode === "dark";
    const logo = decideImage(identity.logoUrl, baseline.identity.logoUrl);
    const darkLogo = wantsDarkLogo
      ? decideImage(identity.darkLogoUrl, baseline.identity.darkLogoUrl)
      : { send: true as const, value: null };
    const favicon = decideImage(identity.faviconUrl, baseline.identity.faviconUrl);
    if (isInvalid(logo) || isInvalid(darkLogo) || isInvalid(favicon)) return null;

    payload.identity = {
      name: identity.name,
      tagline: identity.tagline,
      description: identity.description,
      locale: identity.locale === "" ? null : identity.locale,
      theme: { mode: identity.themeMode, primaryColor: identity.primaryColor },
      ...(logo.send ? { logoUrl: logo.value } : {}),
      ...(darkLogo.send ? { darkLogoUrl: darkLogo.value } : {}),
      ...(favicon.send ? { faviconUrl: favicon.value } : {}),
    };
  }

  if (dirty.has("home")) {
    const { home } = value;
    const hasLegacyHero = home.heroImages.some(isDataUri);
    const keepsLegacyHero = hasLegacyHero && isSameValue(home.heroImages, baseline.home.heroImages);
    if (hasLegacyHero && !keepsLegacyHero) return null;

    payload.home = {
      heroLayout: home.heroLayout,
      heroAlign: home.heroAlign,
      heroVerticalAlign: home.heroVerticalAlign,
      catalogBrowseMode: home.catalogBrowseMode,
      maxDiscountPercent: home.maxDiscountEnabled ? home.maxDiscountPercent : null,
      announcement: {
        enabled: home.announcementEnabled,
        text: home.announcementText,
        href: home.announcementHref,
      },
      homeSections: {
        map: home.showMap,
        reviews: home.showReviews,
        reassurance: home.showReassurance,
      },
      ...(keepsLegacyHero ? {} : { heroImages: home.heroImages }),
    };
  }

  if (dirty.has("contact")) {
    const { contact } = value;
    payload.contact = {
      email: contact.email,
      phone: contact.phone,
      address: contact.address,
      latitude: contact.latitude,
      longitude: contact.longitude,
      channels: contact.channels,
      social: contact.social,
      headerPhone: contact.headerPhone,
    };
  }

  if (dirty.has("legal")) {
    payload.legal = { ...value.legal };
  }

  if (dirty.has("seo")) {
    const share = decideImage(value.seo.shareImageUrl, baseline.seo.shareImageUrl);
    if (isInvalid(share)) return null;
    payload.seo = {
      googleSiteVerification: value.seo.googleSiteVerification,
      ...(share.send ? { shareImageUrl: share.value } : {}),
    };
  }

  return payload;
};

/** Whether a payload carries anything to save. */
export const isEmptyPayload = (payload: UpdateOnlineStoreClientInput): boolean =>
  Object.keys(payload).length === 0;

export interface ReplacedImages {
  logos: string[];
  heroes: string[];
}

/** Saved images the new values no longer reference, to delete from storage after a save. */
export const listReplacedImages = ({ value, baseline }: OnlineStoreDiff): ReplacedImages => {
  const logos: string[] = [];
  const logoSlots: (keyof OnlineStoreIdentityValues)[] = ["logoUrl", "darkLogoUrl", "faviconUrl"];
  for (const slot of logoSlots) {
    const saved = baseline.identity[slot];
    if (typeof saved === "string" && saved && saved !== value.identity[slot]) logos.push(saved);
  }

  const heroes = baseline.home.heroImages.filter((image) => !value.home.heroImages.includes(image));
  if (baseline.seo.shareImageUrl && baseline.seo.shareImageUrl !== value.seo.shareImageUrl) {
    heroes.push(baseline.seo.shareImageUrl);
  }

  return { logos, heroes };
};

/** Uploads of the current values that the saved values do not know, to delete on reset. */
export const listUnsavedImages = ({ value, baseline }: OnlineStoreDiff): string[] => {
  const unsaved: string[] = [];
  const logoSlots: (keyof OnlineStoreIdentityValues)[] = ["logoUrl", "darkLogoUrl", "faviconUrl"];
  for (const slot of logoSlots) {
    const current = value.identity[slot];
    if (typeof current === "string" && current && current !== baseline.identity[slot]) {
      unsaved.push(current);
    }
  }
  for (const image of value.home.heroImages) {
    if (!baseline.home.heroImages.includes(image)) unsaved.push(image);
  }
  if (value.seo.shareImageUrl && value.seo.shareImageUrl !== baseline.seo.shareImageUrl) {
    unsaved.push(value.seo.shareImageUrl);
  }
  return unsaved;
};

// ---------------------------------------------------------------------------
// Small helpers shared by the fields and the sketch
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// TanStack Form wiring
// ---------------------------------------------------------------------------

/** Type-only shape for `withForm` sections; the real values come from the store. */
export const ONLINE_STORE_EMPTY_VALUES: OnlineStoreFormValues = buildOnlineStoreDefaults({
  id: "",
  name: "",
  slug: "",
  tagline: null,
  description: null,
  email: null,
  phone: null,
  address: null,
  latitude: null,
  longitude: null,
  logoUrl: null,
  darkLogoUrl: null,
  faviconUrl: null,
  cgv: null,
  legalNotice: null,
  includeCgvInContract: false,
  settings: null,
  theme: null,
});

export const onlineStoreFormOptions = formOptions({
  defaultValues: ONLINE_STORE_EMPTY_VALUES,
  validators: { onSubmit: onlineStoreFormSchema },
  validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
});

/**
 * Type-only placeholder for `withForm({ props })`: TanStack reads the value
 * for inference alone, the real props always come from the parent.
 */
export const onlineStoreSectionProps = <TProps extends object>(): TProps => Object.create(null);
