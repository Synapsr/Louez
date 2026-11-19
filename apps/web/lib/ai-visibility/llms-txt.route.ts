import "server-only";

import { headers } from "next/headers";
import { connection } from "next/server";

import { and, asc, desc, eq } from "drizzle-orm";
import { createTranslator } from "next-intl";

import { db, products } from "@louez/db";
import { formatCurrency, hasRichTextContent, stripHtml } from "@louez/utils";

import { type Locale, defaultLocale, locales } from "@/i18n/config";
import { canUseAiVisibility } from "@/lib/ai-visibility/entitlement";
import { countAiCrawl } from "@/lib/ai-visibility/count-ai-crawl";
import {
  buildLlmsTxt,
  type LlmsTxtProduct,
  type LlmsTxtStore,
} from "@/lib/ai-visibility/util.llms-txt";
import { getConfiguredFormatLocale } from "@/lib/i18n/configured-format-locale";
import { isSearchIndexingEnabled } from "@/lib/search-indexing";
import { getCanonicalUrl, getProductPath } from "@/lib/seo";
import { getStoreBySlug, type StorefrontStore } from "@/lib/storefront/get-store-by-slug";
import { resolveStoreFromHost } from "@/lib/util.storefront-host";
import { buildOpeningHoursRows } from "@/lib/utils/util.opening-hours";
import { formatPeriodLabel } from "@/lib/utils/util.period-label";
import {
  getStorefrontPricingSummary,
  getStorefrontRateRows,
} from "@/lib/utils/util.storefront-pricing";

/** Enough for a rental catalog; past it the file sends assistants to the catalog page. */
const MAX_PRODUCTS = { short: 300, full: 1_000 } as const;

const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (locales as readonly string[]).includes(value);

const notFound = () =>
  new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });

const parseAmount = (value: unknown): number => {
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) ? amount : 0;
};

const readProducts = (storeId: string, limit: number) =>
  db.query.products.findMany({
    columns: {
      id: true,
      slug: true,
      name: true,
      description: true,
      price: true,
      deposit: true,
      pricingKind: true,
      pricingMode: true,
      basePeriodMinutes: true,
      promotion: true,
    },
    with: { pricingTiers: true, category: { columns: { name: true } } },
    where: and(eq(products.storeId, storeId), eq(products.status, "active")),
    orderBy: [asc(products.displayOrder), desc(products.createdAt)],
    limit,
  });

const plain = (html: string | null | undefined): string | null => {
  const text = stripHtml(html ?? "").trim();
  return text || null;
};

/**
 * `/llms.txt` and `/llms-full.txt` of the storefront the host serves, in the
 * store's language. 404 on a host that serves no store, while search
 * indexing is off (`LOUEZ_SEARCH_INDEXING=off`), and for a store without
 * the feature (`canUseAiVisibility`).
 */
export async function respondWithLlmsTxt(full: boolean): Promise<Response> {
  await connection();
  if (!isSearchIndexingEnabled()) return notFound();

  const hostStore = await resolveStoreFromHost();
  const store = hostStore ? await getStoreBySlug(hostStore.slug) : null;
  if (!store || !(await canUseAiVisibility(store))) return notFound();

  countAiCrawl({
    storeId: store.id,
    userAgent: (await headers()).get("user-agent"),
    resource: "llms_txt",
  });

  const body = await renderLlmsTxt(store, full);
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // A text file is no page to rank: the storefront's pages are the ones to cite.
      "X-Robots-Tag": "noindex",
      "Cache-Control": "public, max-age=600",
    },
  });
}

async function renderLlmsTxt(store: StorefrontStore, full: boolean): Promise<string> {
  const settings = store.settings;
  const locale = isLocale(settings?.locale) ? settings.locale : defaultLocale;
  const messages = (await import(`@/messages/${locale}.json`)).default;
  const t = createTranslator({ locale, messages });
  const tl = createTranslator({ locale, messages, namespace: "storefront.llms" });
  const formatLocale = getConfiguredFormatLocale(locale).intl;
  const currency = settings?.currency || "EUR";
  const timezone = settings?.timezone;
  const money = (amount: number) => formatCurrency(amount, currency, formatLocale);
  const period = (minutes: number) => formatPeriodLabel(t, minutes, { alwaysShowCount: true });

  const limit = full ? MAX_PRODUCTS.full : MAX_PRODUCTS.short;
  const rows = await readProducts(store.id, limit + 1);
  const now = new Date();

  const productLines: LlmsTxtProduct[] = rows.slice(0, limit).map((product) => {
    const rates =
      product.pricingKind === "fixed"
        ? [
            `${money(getStorefrontPricingSummary(product, { timezone, now }).displayPrice)} (${t("storefront.product.fixedPricingLabel")})`,
          ]
        : getStorefrontRateRows(product, { timezone, now }).map(
            (row) => `${money(row.price)} / ${period(row.periodMinutes)}`,
          );
    const deposit = parseAmount(product.deposit);
    return {
      name: product.name,
      url: getCanonicalUrl(store.slug, getProductPath(product)),
      category: product.category?.name ?? null,
      description: plain(product.description),
      rates,
      deposit: deposit > 0 ? money(deposit) : null,
    };
  });

  const delivery = settings?.delivery;
  const minRental = settings?.minRentalMinutes ?? 0;
  const maxRental = settings?.maxRentalMinutes ?? null;
  const notice = settings?.advanceNoticeMinutes ?? 0;
  const latitude = store.latitude ? Number(store.latitude) : NaN;
  const longitude = store.longitude ? Number(store.longitude) : NaN;

  const storeFacts: LlmsTxtStore = {
    name: store.name,
    url: getCanonicalUrl(store.slug),
    tagline: plain(store.tagline),
    description: plain(store.description),
    address: store.address?.trim() || null,
    phone: store.phone?.trim() || null,
    email: store.email?.trim() || null,
    mapUrl:
      Number.isFinite(latitude) && Number.isFinite(longitude)
        ? `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`
        : null,
    currency,
    hours: buildOpeningHoursRows(settings?.businessHours, formatLocale),
    booking: {
      mode: settings?.reservationMode === "request" ? "request" : "payment",
      onlinePaymentPercent: settings?.onlinePaymentDepositPercentage ?? 100,
      minDuration: minRental > 0 ? period(minRental) : null,
      maxDuration: maxRental && maxRental > 0 ? period(maxRental) : null,
      advanceNotice: notice > 0 ? period(notice) : null,
    },
    fulfilment: {
      pickup: !delivery?.enabled || delivery.mode === "optional",
      multiLocation: Boolean(delivery?.multiLocationEnabled),
      delivery: delivery?.enabled ? delivery.mode : "none",
    },
    pages: {
      catalog: getCanonicalUrl(store.slug, "/catalog"),
      about: getCanonicalUrl(store.slug, "/about"),
      contact: getCanonicalUrl(store.slug, "/contact"),
      terms: hasRichTextContent(store.cgv) ? getCanonicalUrl(store.slug, "/terms") : null,
      legal: getCanonicalUrl(store.slug, "/legal"),
    },
  };

  return buildLlmsTxt(
    {
      store: storeFacts,
      products: productLines,
      full,
      truncated: rows.length > limit,
      fullUrl: getCanonicalUrl(store.slug, "/llms-full.txt"),
      readAt: new Intl.DateTimeFormat(formatLocale, {
        dateStyle: "long",
        ...(timezone && { timeZone: timezone }),
      }).format(now),
    },
    (key, values) => tl(key, values),
  );
}
