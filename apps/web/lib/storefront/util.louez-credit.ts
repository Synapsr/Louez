import type { SupportedLocale } from "@louez/types";

/**
 * The storefront footer's "Powered by Louez" credit. On Louez Cloud it links the
 * louez.io page for the store's trade (bike rental software for a bike shop),
 * otherwise the louez.io home page, in the language the storefront is read in.
 */

/** Trades with a louez.io page whose vocabulary is distinct enough to tell from a catalog. */
const STORE_TRADES = ["bike", "ski", "tools", "watersport", "sound"] as const;
export type StoreTrade = (typeof STORE_TRADES)[number];

/** An active product, as the trade detection reads it. */
export interface TradeProduct {
  name: string;
  categoryNames: readonly string[];
}

/**
 * Words naming a trade's items, matched whole on lowercase text without accents
 * (`vélo électrique` reads `velo electrique`). Only words that name the trade's own
 * items: a word another trade also rents (cargo, casque, remorque) has no place here.
 */
const TRADE_TERMS: Record<StoreTrade, readonly string[]> = {
  bike: [
    "velo",
    "velos",
    "vtt",
    "vttae",
    "vtc",
    "vtcae",
    "vae",
    "bike",
    "bikes",
    "ebike",
    "ebikes",
    "bicycle",
    "bicycles",
    "fahrrad",
    "fahrrader",
    "bici",
    "bicicleta",
    "bicicletas",
    "fiets",
    "fietsen",
    "rower",
    "rowery",
  ],
  ski: ["ski", "skis", "snowboard", "snowboards"],
  tools: [
    "outil",
    "outils",
    "outillage",
    "perceuse",
    "perforateur",
    "visseuse",
    "ponceuse",
    "meuleuse",
    "tronconneuse",
    "debroussailleuse",
    "betonniere",
    "echafaudage",
    "marteau piqueur",
    "plaque vibrante",
    "tools",
    "drill",
    "chainsaw",
    "werkzeug",
  ],
  watersport: [
    "paddle",
    "paddles",
    "kayak",
    "kayaks",
    "canoe",
    "canoes",
    "pedalo",
    "pedalos",
    "bateau",
    "bateaux",
    "voilier",
    "jet ski",
    "ski nautique",
    "water ski",
    "windsurf",
    "kitesurf",
    "wingfoil",
    "planche a voile",
    "surf",
    "bodyboard",
  ],
  sound: [
    "sono",
    "sonorisation",
    "enceinte",
    "enceintes",
    "table de mixage",
    "jeu de lumiere",
    "jeux de lumiere",
    "lyre",
    "lyres",
    "sound system",
    "speaker",
    "speakers",
    "subwoofer",
  ],
};

/** Water skiing is a watersport: these never count as ski. */
const NOT_SKI = ["jet ski", "ski nautique", "water ski"];

/** The trade must cover at least half of the store's active products... */
const MIN_TRADE_SHARE = 0.5;
/** ...and no other trade a fifth: a ski and bike shop gets the home page. */
const MAX_OTHER_TRADE_SHARE = 0.2;

/** Lowercase, without accents, every run of other characters one space, padded with spaces. */
const normalize = (text: string): string =>
  ` ${text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;

const mentions = (text: string, term: string): boolean => text.includes(` ${term} `);

const tradesOf = (product: TradeProduct): Set<StoreTrade> => {
  const text = [product.name, ...product.categoryNames].map(normalize).join("");
  const withoutWaterSki = NOT_SKI.reduce((rest, term) => rest.replaceAll(` ${term} `, "  "), text);
  return new Set(
    STORE_TRADES.filter((trade) =>
      TRADE_TERMS[trade].some((term) => mentions(trade === "ski" ? withoutWaterSki : text, term)),
    ),
  );
};

/**
 * The store's trade, read from its active products' names and categories, or null
 * when the catalog does not say it plainly. A wrong trade would print a false line on
 * a customer's storefront, so the rule is strict: one trade names at least half of the
 * products and no other trade a fifth of them.
 */
export function detectStoreTrade(products: readonly TradeProduct[]): StoreTrade | null {
  if (products.length === 0) return null;

  const counts = new Map<StoreTrade, number>();
  for (const product of products) {
    for (const trade of tradesOf(product)) counts.set(trade, (counts.get(trade) ?? 0) + 1);
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [top, second] = ranked;
  if (!top || top[1] / products.length < MIN_TRADE_SHARE) return null;
  if (second && second[1] / products.length >= MAX_OTHER_TRADE_SHARE) return null;
  return top[0];
}

const SITE_URL = "https://louez.io";

/**
 * louez.io trade pages by language, as its sitemap lists them (Louez-Website
 * src/i18n/pathnames.ts; a path that exists there but not in the sitemap is not
 * published). Ski and sound exist in French and English only.
 */
const TRADE_PAGE_PATHS: Record<StoreTrade, Partial<Record<SupportedLocale, string>>> = {
  bike: {
    fr: "/pro/location-velos",
    en: "/pro/bike-rental",
    it: "/pro/noleggio-bici",
    nl: "/pro/fietsverhuur",
    pt: "/pro/aluguer-bicicletas",
    de: "/pro/fahrradvermietung",
    es: "/pro/alquiler-bicicletas",
    pl: "/pro/wypozyczalnia-rowerow",
    zh: "/pro/bike-rental",
    ja: "/pro/bike-rental",
    ru: "/pro/bike-rental",
    id: "/pro/bike-rental",
    ko: "/pro/bike-rental",
  },
  ski: { fr: "/pro/location-ski", en: "/pro/ski-rental" },
  tools: {
    fr: "/pro/location-outillage",
    en: "/pro/tool-rental",
    it: "/pro/noleggio-attrezzi",
    nl: "/pro/gereedschapsverhuur",
    pt: "/pro/aluguer-ferramentas",
    de: "/pro/werkzeugvermietung",
    es: "/pro/alquiler-herramientas",
    pl: "/pro/wypozyczalnia-narzedzi",
    zh: "/pro/tool-rental",
    ja: "/pro/tool-rental",
    ru: "/pro/tool-rental",
    id: "/pro/tool-rental",
    ko: "/pro/tool-rental",
  },
  watersport: {
    fr: "/pro/location-nautique",
    en: "/pro/watersport-rental",
    it: "/pro/noleggio-nautica",
    nl: "/pro/watersportverhuur",
    pt: "/pro/aluguer-nautica",
    de: "/pro/wassersport-vermietung",
    es: "/pro/alquiler-nautico",
    pl: "/pro/wypozyczalnia-sportow-wodnych",
    zh: "/pro/watersport-rental",
    ja: "/pro/watersport-rental",
    ru: "/pro/watersport-rental",
    id: "/pro/watersport-rental",
    ko: "/pro/watersport-rental",
  },
  sound: { fr: "/pro/location-sono", en: "/pro/sound-lighting-rental" },
};

/** What the credit of a Louez Cloud storefront needs, decided on the server. */
export interface LouezCreditTarget {
  trade: StoreTrade | null;
  /** The site's language when a page does not exist in the reader's: French for a French store. */
  fallbackLocale: "fr" | "en";
}

/** Whether the store is French: its country, or the language it is indexed in. */
export const isFrenchStore = (
  settings: {
    country?: string | null;
    locale?: string | null;
  } | null,
): boolean => settings?.country === "FR" || settings?.locale === "fr";

/**
 * The louez.io page the credit links, in the storefront's language when the page
 * exists in it, otherwise in the fallback language. The home page, never the bare
 * domain: louez.io answers it with a redirect.
 */
export function resolveLouezCreditHref(target: LouezCreditTarget, locale: SupportedLocale): string {
  const paths = target.trade ? TRADE_PAGE_PATHS[target.trade] : null;
  if (paths) {
    const pageLocale = paths[locale] ? locale : target.fallbackLocale;
    return `${SITE_URL}/${pageLocale}${paths[pageLocale]}`;
  }
  return `${SITE_URL}/${locale}`;
}
