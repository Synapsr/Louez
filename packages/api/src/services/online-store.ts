import {
  db,
  isDuplicateKeyError,
  lockStoreRow,
  markStore,
  stores,
  type Transaction,
} from "@louez/db";
import type { StoreSettings, StoreTheme } from "@louez/types";
import { hasRichTextContent } from "@louez/utils";
import { sanitizeRichTextHtml } from "@louez/utils/sanitize-rich-text";
import { isOwnedImageUrl, type UpdateOnlineStoreInput } from "@louez/validations";
import { eq } from "drizzle-orm";

import { onlineStoreErrors, type UpdateAppearanceInput } from "../contracts/online-store";
import { storeErrors } from "../contracts/stores";
import { platformErrors } from "../platform/errors";
import type { ApiEvent } from "../platform/ports";
import type { ConfirmStep } from "./products";
import type { SettingsActor } from "./settings";
import { assertSlugFree, checkStoreSlug } from "./store-creation";

/**
 * The online store: the editor's sections (identity, home, contact, legal,
 * search engines), the look and images an agent sets, and the store's web
 * address. Every write locks the store row first, then reads and patches the
 * `theme` and `settings` JSON, so a write of another section never loses
 * this one's change, nor this one another's.
 */

/** Column defaults for a row saved before `settings` existed. */
const SETTINGS_SEED: StoreSettings = { reservationMode: "payment", advanceNoticeMinutes: 1440 };

/** Column default of `theme`, for a row saved before it existed. */
const THEME_SEED: StoreTheme = { mode: "light", primaryColor: "#0066FF" };

/** Where a store's logos, favicon, share image and hero photos live in storage. */
const storefrontImagePrefix = (storeId: string) => `${storeId}/logo`;

const lockedColumns = {
  slug: stores.slug,
  onboardingCompleted: stores.onboardingCompleted,
  settings: stores.settings,
  theme: stores.theme,
  logoUrl: stores.logoUrl,
  darkLogoUrl: stores.darkLogoUrl,
  faviconUrl: stores.faviconUrl,
};

/** Locks the store row, the first read of the transaction, and returns what the writes patch. */
async function lockStore(tx: Transaction, storeId: string) {
  if (!(await lockStoreRow(tx, storeId))) throw platformErrors.noStore();
  const [row] = await tx.select(lockedColumns).from(stores).where(eq(stores.id, storeId));
  if (!row) throw platformErrors.noStore();
  return row;
}

function assertOwnedImage(storeId: string, url: string | null | undefined) {
  if (url && !isOwnedImageUrl(url, storefrontImagePrefix(storeId))) {
    throw onlineStoreErrors.imageNotOwned(url);
  }
}

/** An effect must never fail a write that has committed. */
function emit(actor: SettingsActor, event: ApiEvent) {
  try {
    actor.afterCommit(event);
  } catch (error) {
    console.error("An online store effect failed after its commit:", error);
  }
}

/** Editor HTML: null when the editor is empty, sanitised otherwise. */
const toStoredRichText = (html: string): string | null => {
  const sanitized = sanitizeRichTextHtml(html);
  return hasRichTextContent(sanitized) ? sanitized : null;
};

// --- The editor -------------------------------------------------------------

/**
 * Applies the sections of the online store editor in one write. Each
 * section replaces the fields it owns and nothing else.
 */
export async function updateOnlineStore(actor: SettingsActor, input: UpdateOnlineStoreInput) {
  const { identity, home, contact, legal, seo } = input;
  const { storeId } = actor;
  assertOwnedImage(storeId, identity?.logoUrl);
  assertOwnedImage(storeId, identity?.darkLogoUrl);
  assertOwnedImage(storeId, identity?.faviconUrl);
  assertOwnedImage(storeId, seo?.shareImageUrl);
  for (const image of home?.heroImages ?? []) assertOwnedImage(storeId, image);

  const slug = await db.transaction(async (tx) => {
    const row = await lockStore(tx, storeId);
    const settings: StoreSettings = { ...SETTINGS_SEED, ...row.settings };
    const theme: StoreTheme = { ...THEME_SEED, ...row.theme };
    const values: Partial<typeof stores.$inferInsert> = { updatedAt: new Date() };

    if (identity) {
      values.name = identity.name;
      values.tagline = identity.tagline === null ? null : toStoredRichText(identity.tagline);
      values.description = toStoredRichText(identity.description);
      if (identity.logoUrl !== undefined) values.logoUrl = identity.logoUrl || null;
      if (identity.darkLogoUrl !== undefined) values.darkLogoUrl = identity.darkLogoUrl || null;
      if (identity.faviconUrl !== undefined) values.faviconUrl = identity.faviconUrl || null;
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
      values.email = contact.email;
      values.phone = contact.phone;
      values.address = contact.address;
      values.latitude = contact.latitude === null ? null : String(contact.latitude);
      values.longitude = contact.longitude === null ? null : String(contact.longitude);
      settings.contact = contact.channels;
      settings.social = contact.social;
      theme.headerPhone = contact.headerPhone;
    }

    if (legal) {
      values.cgv = sanitizeRichTextHtml(legal.cgv);
      values.legalNotice = sanitizeRichTextHtml(legal.legalNotice);
      values.includeCgvInContract = legal.includeFullCgvInContract;
      settings.footerNote = legal.footerNote;
    }

    if (seo) {
      if (seo.googleSiteVerification !== undefined) {
        settings.seo = { ...settings.seo, googleSiteVerification: seo.googleSiteVerification };
      }
      if (seo.shareImageUrl !== undefined) theme.shareImageUrl = seo.shareImageUrl || null;
    }

    if (identity || home || contact || seo) values.theme = theme;
    if (identity || contact || legal || seo) values.settings = settings;

    await tx.update(stores).set(values).where(eq(stores.id, storeId));
    return row.slug;
  });

  // The theme mode is served from a per-store cache, by the slug the store
  // has now; it travels in the identity section.
  emit(actor, {
    type: "store.storefrontUpdated",
    store: { ...actor.store, slug },
    themeChanged: !!identity,
  });
  return { success: true as const };
}

// --- Appearance -------------------------------------------------------------

export const toAppearanceView = (row: {
  theme: StoreTheme | null;
  logoUrl: string | null;
  darkLogoUrl: string | null;
  faviconUrl: string | null;
}) => {
  const theme: StoreTheme = { ...THEME_SEED, ...row.theme };
  return {
    mode: theme.mode,
    primaryColor: theme.primaryColor,
    logoUrl: row.logoUrl || null,
    darkLogoUrl: row.darkLogoUrl || null,
    faviconUrl: row.faviconUrl || null,
    heroImages: theme.heroImages ?? [],
    heroLayout: theme.heroLayout ?? "cover",
    heroAlign: theme.heroAlign ?? "center",
    heroVerticalAlign: theme.heroVerticalAlign ?? "center",
    catalogBrowseMode: theme.catalogBrowseMode ?? "products",
  };
};

/** The look an agent sets: theme, colour, logos, favicon and hero photos. Fields left out stay. */
export async function updateAppearance(actor: SettingsActor, input: UpdateAppearanceInput) {
  const { storeId } = actor;
  assertOwnedImage(storeId, input.logoUrl);
  assertOwnedImage(storeId, input.darkLogoUrl);
  assertOwnedImage(storeId, input.faviconUrl);
  for (const image of input.heroImages ?? []) assertOwnedImage(storeId, image);

  const saved = await db.transaction(async (tx) => {
    const row = await lockStore(tx, storeId);
    const theme: StoreTheme = { ...THEME_SEED, ...row.theme };
    if (input.mode !== undefined) theme.mode = input.mode;
    if (input.primaryColor !== undefined) theme.primaryColor = input.primaryColor;
    if (input.heroImages !== undefined) theme.heroImages = input.heroImages;
    if (input.heroLayout !== undefined) theme.heroLayout = input.heroLayout;
    if (input.heroAlign !== undefined) theme.heroAlign = input.heroAlign;
    if (input.heroVerticalAlign !== undefined) theme.heroVerticalAlign = input.heroVerticalAlign;
    if (input.catalogBrowseMode !== undefined) theme.catalogBrowseMode = input.catalogBrowseMode;
    const next = {
      theme,
      logoUrl: input.logoUrl === undefined ? row.logoUrl : input.logoUrl,
      darkLogoUrl: input.darkLogoUrl === undefined ? row.darkLogoUrl : input.darkLogoUrl,
      faviconUrl: input.faviconUrl === undefined ? row.faviconUrl : input.faviconUrl,
    };
    await tx
      .update(stores)
      .set({ ...next, updatedAt: new Date() })
      .where(eq(stores.id, storeId));
    return { ...next, slug: row.slug, themeChanged: row.theme?.mode !== theme.mode };
  });

  emit(actor, {
    type: "store.storefrontUpdated",
    store: { ...actor.store, slug: saved.slug },
    themeChanged: saved.themeChanged,
  });
  return toAppearanceView(saved);
}

// --- Web address ------------------------------------------------------------

/** Whether this store could move to a web address, with free ones close to it when not. */
export async function checkCurrentStoreSlug(currentSlug: string, input: { slug: string }) {
  const slug = input.slug.trim();
  if (slug === currentSlug) {
    return { slug, available: false, reason: null, suggestions: [], current: true };
  }
  return { ...(await checkStoreSlug({ slug })), current: false };
}

/** What a slug change shows before it runs. */
export interface SlugChangePreview {
  summary: string;
  previousSlug: string;
  slug: string;
  previousUrl: string;
  url: string;
  online: boolean;
}

/**
 * Moves the store to a new web address. The slug is in the store's billing
 * snapshot, so the store is marked. Louez keeps no history of former
 * addresses: links to the old one stop working, which the preview says. Two
 * stores taking the same address at once: the unique key lets one through,
 * the other answers STORE_SLUG_TAKEN with free addresses close to it.
 */
export async function updateStoreSlug(
  actor: SettingsActor,
  input: { slug: string },
  options: {
    storefrontUrl: (slug: string) => string;
    confirm?: ConfirmStep<SlugChangePreview>;
  },
) {
  const { storeId } = actor;
  if (input.slug === actor.store.slug) throw onlineStoreErrors.slugUnchanged(input.slug);
  await assertSlugFree(input.slug);

  let refusal: Error | null = null;
  let previousSlug = actor.store.slug;
  let online = false;
  try {
    await db.transaction(async (tx) => {
      const row = await lockStore(tx, storeId);
      previousSlug = row.slug;
      online = row.onboardingCompleted === true;
      if (row.slug === input.slug) throw onlineStoreErrors.slugUnchanged(input.slug);
      if (options.confirm) {
        const previousUrl = options.storefrontUrl(row.slug);
        const url = options.storefrontUrl(input.slug);
        // Launched or not as the row is now: a launch since the request read
        // the store changes what breaks.
        refusal = await options.confirm(
          {
            summary:
              `Move the storefront from ${previousUrl} to ${url}.` +
              (online
                ? " The store is online: every link to the old address (shared, printed, in search engines) stops working, as Louez keeps no redirect."
                : " The store is not online yet, so no customer link breaks."),
            previousSlug: row.slug,
            slug: input.slug,
            previousUrl,
            url,
            online,
          },
          tx,
        );
        if (refusal) return;
      }
      await tx
        .update(stores)
        .set({ slug: input.slug, updatedAt: new Date() })
        .where(eq(stores.id, storeId));
      await markStore(tx, storeId);
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const { suggestions } = await checkStoreSlug({ slug: input.slug });
    throw storeErrors.slugTaken(input.slug, suggestions);
  }
  if (refusal) throw refusal;

  emit(actor, {
    type: "store.slugChanged",
    store: { ...actor.store, slug: input.slug },
    previousSlug,
  });
  return { slug: input.slug, previousSlug, online };
}
