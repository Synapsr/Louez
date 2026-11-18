/**
 * A storefront's llms.txt (https://llmstxt.org): what an AI assistant needs to
 * describe the store and send a customer to the right page, as Markdown. Pure:
 * the route loads and formats the data, this lays it out.
 *
 * `llms.txt` lists the products with their rates; `llms-full.txt` adds their
 * descriptions. Both say where the facts come from and when they were read.
 */

/** The labels, already translated into the store's language. */
export type LlmsTxtTranslator = (key: string, values?: Record<string, string | number>) => string;

export interface LlmsTxtStore {
  name: string;
  /** The storefront's home, canonical. */
  url: string;
  /** Plain text, no HTML. */
  tagline: string | null;
  description: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  mapUrl: string | null;
  /** ISO 4217. */
  currency: string;
  /** Opening hours rows ("lundi – vendredi": "09:00–18:00"); empty when not set. */
  hours: readonly { days: string; ranges: readonly string[]; isOpen: boolean }[];
  booking: {
    mode: "payment" | "request";
    /** Part paid online at checkout, 100 for the whole rental. Payment mode only. */
    onlinePaymentPercent: number;
    /** Formatted durations ("1 heure"), or null when the store sets none. */
    minDuration: string | null;
    maxDuration: string | null;
    advanceNotice: string | null;
  };
  fulfilment: {
    pickup: boolean;
    multiLocation: boolean;
    delivery: "none" | "optional" | "required" | "included";
  };
  pages: {
    catalog: string;
    about: string;
    contact: string;
    /** Null when the store wrote no terms of its own. */
    terms: string | null;
    legal: string;
  };
}

export interface LlmsTxtProduct {
  name: string;
  url: string;
  category: string | null;
  /** Plain text, no HTML. */
  description: string | null;
  /** "25 € / 1 jour"; a fixed-price product has one rate with no period. */
  rates: readonly string[];
  /** Formatted, or null when the product asks none. */
  deposit: string | null;
}

export interface LlmsTxtInput {
  store: LlmsTxtStore;
  products: readonly LlmsTxtProduct[];
  /** llms-full.txt: product descriptions included. */
  full: boolean;
  /** When the data was read, formatted. */
  readAt: string;
  /** The URL of llms-full.txt, listed in llms.txt's Optional section. */
  fullUrl: string;
  /** More active products than the file lists. */
  truncated: boolean;
}

const SUMMARY_LENGTH = 300;
const FULL_DESCRIPTION_LENGTH = 2_000;

/** One line, Markdown-safe enough for a list item or a blockquote. */
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

const clip = (text: string, length: number): string => {
  const line = oneLine(text);
  return line.length <= length ? line : `${line.slice(0, length - 1).trimEnd()}…`;
};

/** Square brackets would close a link's label early. */
const linkLabel = (text: string): string => oneLine(text).replace(/[[\]]/g, "");

const link = (label: string, url: string): string => `[${linkLabel(label)}](${url})`;

const practicalLines = (store: LlmsTxtStore, t: LlmsTxtTranslator): string[] => {
  const lines: string[] = [];
  if (store.address) lines.push(t("address", { address: oneLine(store.address) }));
  if (store.mapUrl) lines.push(t("map", { url: store.mapUrl }));
  if (store.phone) lines.push(t("phone", { phone: oneLine(store.phone) }));
  if (store.email) lines.push(t("email", { email: oneLine(store.email) }));
  if (store.hours.length > 0) {
    const hours = store.hours
      .map((row) => `${row.days} ${row.isOpen ? row.ranges.join(", ") : t("closed")}`)
      .join(" ; ");
    lines.push(t("hours", { hours }));
  }

  const { booking, fulfilment } = store;
  if (booking.mode === "request") {
    lines.push(t("bookingRequest"));
  } else if (booking.onlinePaymentPercent < 100) {
    lines.push(t("bookingPartialPayment", { percent: booking.onlinePaymentPercent }));
  } else {
    lines.push(t("bookingPayment"));
  }
  if (booking.minDuration) lines.push(t("minDuration", { duration: booking.minDuration }));
  if (booking.maxDuration) lines.push(t("maxDuration", { duration: booking.maxDuration }));
  if (booking.advanceNotice) lines.push(t("advanceNotice", { duration: booking.advanceNotice }));

  if (fulfilment.pickup) {
    lines.push(fulfilment.multiLocation ? t("pickupLocations") : t("pickup"));
  }
  if (fulfilment.delivery !== "none") lines.push(t(`delivery.${fulfilment.delivery}`));
  lines.push(t("currency", { currency: store.currency }));

  return lines.map((line) => `- ${line}`);
};

const productLine = (product: LlmsTxtProduct, t: LlmsTxtTranslator): string => {
  const facts = [product.rates.join(" ; ")];
  if (product.deposit) facts.push(t("deposit", { amount: product.deposit }));
  return `- ${link(product.name, product.url)}: ${facts.filter(Boolean).join(". ")}`;
};

/** Products grouped by category, in the catalog's order; uncategorized ones last. */
const groupByCategory = (
  products: readonly LlmsTxtProduct[],
): { category: string | null; products: LlmsTxtProduct[] }[] => {
  const groups = new Map<string | null, LlmsTxtProduct[]>();
  for (const product of products) {
    const key = product.category?.trim() || null;
    groups.set(key, [...(groups.get(key) ?? []), product]);
  }
  const named = [...groups.entries()].filter(([category]) => category !== null);
  const loose = groups.get(null);
  return [
    ...named.map(([category, items]) => ({ category, products: items })),
    ...(loose ? [{ category: null, products: loose }] : []),
  ];
};

export function buildLlmsTxt(input: LlmsTxtInput, t: LlmsTxtTranslator): string {
  const { store, products, full } = input;
  const summary = store.tagline || store.description;
  const out: string[] = [`# ${oneLine(store.name)}`, ""];

  out.push(
    `> ${summary ? clip(summary, SUMMARY_LENGTH) : t("summary", { store: oneLine(store.name) })}`,
    "",
  );
  out.push(t("intro", { store: oneLine(store.name), url: store.url }));
  if (store.description && store.description !== summary) {
    out.push("", clip(store.description, full ? FULL_DESCRIPTION_LENGTH : SUMMARY_LENGTH * 2));
  }

  out.push("", `## ${t("practicalTitle")}`, "", ...practicalLines(store, t));

  out.push("", `## ${t("catalogTitle")}`, "");
  if (products.length === 0) {
    out.push(t("noProducts"));
  } else {
    out.push(t("pricesNote"));
    const groups = groupByCategory(products);
    const showHeadings = groups.length > 1 || groups[0]?.category !== null;
    for (const group of groups) {
      if (showHeadings) out.push("", `### ${group.category ?? t("otherProducts")}`);
      out.push("");
      for (const product of group.products) {
        out.push(productLine(product, t));
        if (full && product.description) {
          out.push(`  ${clip(product.description, FULL_DESCRIPTION_LENGTH)}`);
        }
      }
    }
    if (input.truncated) {
      out.push("", t("truncated", { url: store.pages.catalog }));
    }
  }

  out.push(
    "",
    `## ${t("pagesTitle")}`,
    "",
    `- ${link(t("pages.home"), store.url)}`,
    `- ${link(t("pages.catalog"), store.pages.catalog)}`,
    `- ${link(t("pages.about"), store.pages.about)}`,
    `- ${link(t("pages.contact"), store.pages.contact)}`,
    ...(store.pages.terms ? [`- ${link(t("pages.terms"), store.pages.terms)}`] : []),
    `- ${link(t("pages.legal"), store.pages.legal)}`,
  );

  if (!full) {
    // "Optional" is the section name the llms.txt format reserves for what a
    // short context may skip; it is not translated.
    out.push("", "## Optional", "", `- ${link(t("fullFile"), input.fullUrl)}`);
  }

  out.push("", "---", "", t("footer", { date: input.readAt }), "");
  return out.join("\n");
}
