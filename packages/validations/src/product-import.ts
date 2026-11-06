import type { ImportColumnMapping } from "@louez/types";

import { toCustomerFieldSearchValue } from "./customer-fields";

/** Native targets a source column can feed when importing a catalogue. */
export const PRODUCT_IMPORT_FIELDS = [
  "externalId",
  "name",
  "description",
  "category",
  "price",
  "pricingMode",
  "deposit",
  "quantity",
] as const;

export type ProductImportField = (typeof PRODUCT_IMPORT_FIELDS)[number];

const isProductImportField = (value: string): value is ProductImportField =>
  PRODUCT_IMPORT_FIELDS.some((field) => field === value);

/** Column names met in catalogue exports, in the languages of the platform. */
const FIELD_SYNONYMS: Record<ProductImportField, readonly string[]> = {
  externalId: [
    "id",
    "sku",
    "ref",
    "reference",
    "code",
    "codeproduit",
    "productid",
    "idproduit",
    "codearticle",
  ],
  name: [
    "nom",
    "name",
    "produit",
    "product",
    "designation",
    "titre",
    "title",
    "article",
    "libelle",
    "nomduproduit",
    "productname",
    "nombre",
    "nome",
    "bezeichnung",
  ],
  description: [
    "description",
    "desc",
    "details",
    "descriptif",
    "descripcion",
    "descricao",
    "beschreibung",
  ],
  category: [
    "categorie",
    "category",
    "famille",
    "type",
    "rayon",
    "groupe",
    "categoria",
    "kategorie",
  ],
  price: [
    "prix",
    "price",
    "tarif",
    "prixjour",
    "prixparjour",
    "prixjournalier",
    "dailyprice",
    "rate",
    "prixttc",
    "preco",
    "precio",
    "prezzo",
    "preis",
  ],
  pricingMode: [
    "periode",
    "unite",
    "facturation",
    "pricingmode",
    "par",
    "per",
    "tarification",
    "period",
  ],
  deposit: [
    "caution",
    "deposit",
    "garantie",
    "depot",
    "depotdegarantie",
    "kaution",
    "fianza",
    "caucao",
    "cauzione",
  ],
  quantity: [
    "quantite",
    "quantity",
    "qty",
    "qte",
    "stock",
    "nombre",
    "exemplaires",
    "cantidad",
    "quantidade",
    "menge",
  ],
};

/** A first mapping from the column names alone; a target goes to one column only. */
export function suggestProductImportMapping(columns: readonly string[]): ImportColumnMapping {
  const taken = new Set<string>();
  const mapping: ImportColumnMapping = {};
  for (const column of columns) {
    const name = toCustomerFieldSearchValue(column);
    const field = PRODUCT_IMPORT_FIELDS.find(
      (candidate) => !taken.has(candidate) && FIELD_SYNONYMS[candidate].includes(name),
    );
    mapping[column] = field ? `field:${field}` : null;
    if (field) taken.add(field);
  }
  return mapping;
}

/**
 * An amount as a two-decimal string, whatever the spreadsheet's locale:
 * "1 250,50 €", "1.250,50", "1,250.50" and "12.5" all read. The last comma or
 * dot followed by one or two digits is the decimal mark, the others group thousands.
 */
export function parseMoneyCell(value: string): string | null {
  const raw = value.replace(/[^\d.,-]/g, "");
  if (!/\d/.test(raw) || raw.startsWith("-")) return null;
  const decimal = /[.,](\d{1,2})$/.exec(raw);
  const whole = (decimal ? raw.slice(0, decimal.index) : raw).replace(/[.,]/g, "");
  if (!/^\d*$/.test(whole)) return null;
  const amount = Number(`${whole || "0"}.${decimal?.[1] ?? "0"}`);
  return Number.isFinite(amount) ? amount.toFixed(2) : null;
}

export type ProductImportPricingMode = "hour" | "day" | "week";

const PRICING_MODE_WORDS: Record<ProductImportPricingMode, readonly string[]> = {
  hour: ["hour", "heure", "h", "hora", "ora", "stunde", "uur", "godzina", "parheure", "perhour"],
  day: ["day", "jour", "j", "journee", "dia", "giorno", "tag", "dag", "dzien", "parjour", "perday"],
  week: [
    "week",
    "semaine",
    "sem",
    "semana",
    "settimana",
    "woche",
    "tydzien",
    "parsemaine",
    "perweek",
  ],
};

/** "jour", "par heure", "week"… as a pricing mode; null when the word is not one. */
export function parsePricingModeCell(value: string): ProductImportPricingMode | null {
  const word = toCustomerFieldSearchValue(value);
  const modes: ProductImportPricingMode[] = ["hour", "day", "week"];
  return modes.find((mode) => PRICING_MODE_WORDS[mode].includes(word)) ?? null;
}

export type ProductImportErrorCode = "productNameRequired" | "priceRequired" | "priceInvalid";
export type ProductImportWarningCode = "depositInvalid" | "quantityInvalid" | "pricingModeUnknown";

export interface ProductImportRowInput {
  externalId: string | null;
  name: string;
  description: string | null;
  category: string | null;
  price: string;
  pricingMode: ProductImportPricingMode;
  deposit: string | null;
  quantity: number | null;
}

export interface ProductImportRowResult {
  input: ProductImportRowInput | null;
  errors: { field: string | null; code: ProductImportErrorCode }[];
  warnings: { field: string | null; code: ProductImportWarningCode }[];
}

const MAX_QUANTITY = 100_000;

/**
 * One source row as a product, or the reasons it cannot be one. Only a missing
 * name or price blocks a row; an unreadable deposit, quantity or period is
 * dropped with a warning and the product gets the default instead.
 */
export function transformProductImportRow(
  row: Record<string, string>,
  mapping: ImportColumnMapping,
): ProductImportRowResult {
  const errors: ProductImportRowResult["errors"] = [];
  const warnings: ProductImportRowResult["warnings"] = [];
  const cells: Partial<Record<ProductImportField, string>> = {};

  for (const [column, target] of Object.entries(mapping)) {
    const cell = row[column]?.trim();
    if (!target || !cell) continue;
    const [kind, name] = target.split(":");
    if (kind === "field" && name && isProductImportField(name)) cells[name] = cell;
  }

  const name = cells.name?.slice(0, 255) ?? "";
  if (!name) errors.push({ field: null, code: "productNameRequired" });

  const price = cells.price ? parseMoneyCell(cells.price) : null;
  if (!cells.price) errors.push({ field: null, code: "priceRequired" });
  else if (price === null) errors.push({ field: null, code: "priceInvalid" });

  const deposit = cells.deposit ? parseMoneyCell(cells.deposit) : null;
  if (cells.deposit && deposit === null) warnings.push({ field: null, code: "depositInvalid" });

  const parsedQuantity = cells.quantity ? Number(cells.quantity.replace(/\s/g, "")) : null;
  const quantity =
    parsedQuantity !== null &&
    Number.isInteger(parsedQuantity) &&
    parsedQuantity >= 0 &&
    parsedQuantity <= MAX_QUANTITY
      ? parsedQuantity
      : null;
  if (cells.quantity && quantity === null) warnings.push({ field: null, code: "quantityInvalid" });

  const pricingMode = cells.pricingMode ? parsePricingModeCell(cells.pricingMode) : null;
  if (cells.pricingMode && !pricingMode) warnings.push({ field: null, code: "pricingModeUnknown" });

  if (errors.length > 0 || price === null) return { input: null, errors, warnings };

  return {
    input: {
      externalId: cells.externalId ?? null,
      name,
      description: cells.description ?? null,
      category: cells.category?.slice(0, 255) ?? null,
      price,
      pricingMode: pricingMode ?? "day",
      deposit,
      quantity,
    },
    errors,
    warnings,
  };
}
