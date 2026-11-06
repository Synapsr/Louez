import type {
  CustomerFieldDefinition,
  CustomerFieldValues,
  ImportColumnMapping,
} from "@louez/types";
import { z } from "zod";

import { normalizeCustomerFieldValue, toCustomerFieldSearchValue } from "./customer-fields";
import { isPlausibleBirthDate } from "./customer";
import { getKnownCountryCodes, toE164PhoneNumber } from "./phone";

/** Native targets a source column can feed. `fullName` is split into first and last name. */
export const CUSTOMER_IMPORT_FIELDS = [
  "externalId",
  "fullName",
  "firstName",
  "lastName",
  "email",
  "phone",
  "companyName",
  "companyNumber",
  "vatNumber",
  "address",
  "postalCode",
  "city",
  "country",
  "birthDate",
  "notes",
] as const;

export type CustomerImportField = (typeof CUSTOMER_IMPORT_FIELDS)[number];

const isImportField = (value: string): value is CustomerImportField =>
  CUSTOMER_IMPORT_FIELDS.some((field) => field === value);

/** Column names met in exports of spreadsheets and rental tools, in the languages of the platform. */
const FIELD_SYNONYMS: Record<CustomerImportField, readonly string[]> = {
  externalId: [
    "id",
    "identifiant",
    "customerid",
    "clientid",
    "idclient",
    "reference",
    "ref",
    "code",
    "codeclient",
  ],
  fullName: [
    "nomcomplet",
    "fullname",
    "name",
    "client",
    "customer",
    "nomprenom",
    "prenomnom",
    "nome",
    "nombrecompleto",
    "contact",
    "kunde",
  ],
  firstName: [
    "prenom",
    "firstname",
    "first",
    "givenname",
    "vorname",
    "nombre",
    "primeironome",
    "imie",
  ],
  lastName: [
    "nom",
    "nomdefamille",
    "lastname",
    "last",
    "surname",
    "familyname",
    "nachname",
    "apellido",
    "apellidos",
    "sobrenome",
    "cognome",
    "nazwisko",
  ],
  email: [
    "email",
    "mail",
    "courriel",
    "adressemail",
    "adresseemail",
    "emailaddress",
    "correo",
    "correoelectronico",
  ],
  phone: [
    "telephone",
    "tel",
    "phone",
    "phonenumber",
    "mobile",
    "portable",
    "gsm",
    "celular",
    "telefone",
    "telefono",
    "telefon",
    "handy",
  ],
  companyName: [
    "societe",
    "entreprise",
    "company",
    "companyname",
    "raisonsociale",
    "organisation",
    "organization",
    "empresa",
    "azienda",
    "firma",
  ],
  companyNumber: [
    "siren",
    "siret",
    "bce",
    "numeroentreprise",
    "numerodentreprise",
    "companynumber",
    "registrationnumber",
  ],
  vatNumber: [
    "tva",
    "numerotva",
    "numerodetva",
    "tvaintracom",
    "tvaintracommunautaire",
    "vat",
    "vatnumber",
    "vatid",
  ],
  address: [
    "adresse",
    "address",
    "rue",
    "street",
    "endereco",
    "direccion",
    "indirizzo",
    "adres",
    "strasse",
  ],
  postalCode: [
    "codepostal",
    "cp",
    "zip",
    "zipcode",
    "postalcode",
    "postcode",
    "cep",
    "plz",
    "codigopostal",
  ],
  city: [
    "ville",
    "city",
    "localite",
    "commune",
    "cidade",
    "ciudad",
    "citta",
    "ort",
    "stad",
    "miasto",
  ],
  country: ["pays", "country", "pais", "land", "paese", "kraj"],
  birthDate: [
    "datedenaissance",
    "naissance",
    "datenaissance",
    "birthdate",
    "dateofbirth",
    "dob",
    "birthday",
    "nascimento",
    "datadenascimento",
    "fechadenacimiento",
  ],
  notes: [
    "notes",
    "note",
    "remarque",
    "remarques",
    "commentaire",
    "commentaires",
    "comments",
    "comment",
    "observacoes",
    "observaciones",
  ],
};

export const toImportTarget = (field: CustomerImportField) => `field:${field}`;
export const toCustomImportTarget = (definitionId: string) => `custom:${definitionId}`;

/**
 * A first mapping from the column names alone: a known synonym, or the label
 * of one of the store's custom fields. A target is given to one column only;
 * what is not recognised stays unmapped for the person to decide.
 */
export function suggestCustomerImportMapping(
  columns: readonly string[],
  definitions: readonly Pick<CustomerFieldDefinition, "id" | "label" | "key">[],
): ImportColumnMapping {
  const taken = new Set<string>();
  const mapping: ImportColumnMapping = {};

  for (const column of columns) {
    const name = toCustomerFieldSearchValue(column);
    const field = CUSTOMER_IMPORT_FIELDS.find((candidate) =>
      FIELD_SYNONYMS[candidate].includes(name),
    );
    const definition = definitions.find(
      (candidate) =>
        toCustomerFieldSearchValue(candidate.label) === name ||
        toCustomerFieldSearchValue(candidate.key) === name,
    );
    const target = field
      ? toImportTarget(field)
      : definition
        ? toCustomImportTarget(definition.id)
        : null;
    const isFree = target !== null && !taken.has(target);
    mapping[column] = isFree ? target : null;
    if (isFree) taken.add(target);
  }
  return mapping;
}

export type DateOrder = "dmy" | "mdy";

const DATE_PARTS = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;

/** Day-first unless a value proves otherwise (a second part above 12 can only be a day). */
export function detectDateOrder(values: readonly string[]): DateOrder {
  for (const value of values) {
    const match = DATE_PARTS.exec(value.trim());
    if (!match) continue;
    if (Number(match[1]) > 12) return "dmy";
    if (Number(match[2]) > 12) return "mdy";
  }
  return "dmy";
}

/** A cell as an ISO day: ISO input is kept, `d/m/y`-like input is read in the detected order. */
export function parseDateCell(value: string, order: DateOrder): string | null {
  const raw = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const match = DATE_PARTS.exec(raw);
  if (!match) return null;
  const [day, month] = order === "dmy" ? [match[1], match[2]] : [match[2], match[1]];
  return `${match[3]}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

const COUNTRY_NAME_LOCALES = ["fr", "en", "es", "pt", "it", "de", "nl", "pl"];

let countryCodesByName: Map<string, string> | null = null;

const getCountryCodesByName = () => {
  if (countryCodesByName) return countryCodesByName;
  countryCodesByName = new Map();
  for (const locale of COUNTRY_NAME_LOCALES) {
    const names = new Intl.DisplayNames([locale], { type: "region" });
    for (const code of getKnownCountryCodes()) {
      const name = names.of(code);
      if (name) countryCodesByName.set(toCustomerFieldSearchValue(name), code);
    }
  }
  return countryCodesByName;
};

/** "FR", "fr", "France", "Frankreich"… as an ISO code; null when it names no country. */
export function parseCountryCell(value: string): string | null {
  const raw = value.trim();
  if (/^[a-z]{2}$/i.test(raw) && getKnownCountryCodes().includes(raw.toUpperCase())) {
    return raw.toUpperCase();
  }
  return getCountryCodesByName().get(toCustomerFieldSearchValue(raw)) ?? null;
}

export type CustomerImportErrorCode = "contactRequired" | "emailInvalid" | "nameRequired";
export type CustomerImportWarningCode =
  | "phoneInvalid"
  | "countryUnknown"
  | "birthDateInvalid"
  | "customFieldInvalid";

export interface CustomerImportRowInput {
  externalId: string | null;
  customerType: "individual" | "business";
  /** Null when the file has none: the phone then identifies and reaches the customer. */
  email: string | null;
  firstName: string;
  lastName: string;
  phone: string | null;
  companyName: string | null;
  companyNumber: string | null;
  vatNumber: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  birthDate: string | null;
  notes: string | null;
  customFields: CustomerFieldValues;
}

export interface CustomerImportRowResult {
  input: CustomerImportRowInput | null;
  errors: { field: string | null; code: CustomerImportErrorCode }[];
  warnings: { field: string | null; code: CustomerImportWarningCode }[];
}

export interface CustomerImportContext {
  mapping: ImportColumnMapping;
  definitions: readonly Pick<
    CustomerFieldDefinition,
    "id" | "type" | "format" | "options" | "isActive"
  >[];
  /** ISO code used to read phone numbers written without a prefix. */
  defaultCountry: string;
  dateOrder: DateOrder;
}

const emailSchema = z.email();
const clean = (value: string | undefined) => value?.trim() || null;

/**
 * One source row as a customer, or the reasons it cannot be one. Only a
 * missing name or e-mail blocks a row: an unreadable phone, country, date or
 * custom value is dropped with a warning so the rest of the record gets in.
 */
export function transformCustomerImportRow(
  row: Record<string, string>,
  context: CustomerImportContext,
): CustomerImportRowResult {
  const errors: CustomerImportRowResult["errors"] = [];
  const warnings: CustomerImportRowResult["warnings"] = [];
  const native: Partial<Record<CustomerImportField, string>> = {};
  const customFields: CustomerFieldValues = {};

  for (const [column, target] of Object.entries(context.mapping)) {
    const cell = row[column]?.trim();
    if (!target || !cell) continue;
    const [kind, name] = target.split(":");
    if (kind === "field" && name && isImportField(name)) {
      native[name] = cell;
      continue;
    }
    const definition = context.definitions.find(
      (candidate) => candidate.id === name && candidate.isActive,
    );
    if (kind !== "custom" || !definition) continue;
    // A list value is matched whatever its case: "expert" is the option "Expert".
    const option =
      definition.type === "select"
        ? definition.options?.find((entry) => entry.toLowerCase() === cell.toLowerCase())
        : undefined;
    const normalized = normalizeCustomerFieldValue(definition, option ?? cell);
    if ("code" in normalized) warnings.push({ field: column, code: "customFieldInvalid" });
    else if (normalized.value) customFields[definition.id] = normalized.value;
  }

  let firstName = clean(native.firstName);
  let lastName = clean(native.lastName);
  if ((!firstName || !lastName) && native.fullName) {
    const [head, ...tail] = native.fullName.trim().split(/\s+/);
    firstName ??= head ?? null;
    lastName ??= tail.join(" ") || null;
  }
  if (!firstName || !lastName) errors.push({ field: null, code: "nameRequired" });

  const email = native.email?.trim().toLowerCase() || null;
  if (email && !emailSchema.safeParse(email).success) {
    errors.push({ field: null, code: "emailInvalid" });
  }

  const country = native.country ? parseCountryCell(native.country) : null;
  if (native.country && !country) warnings.push({ field: null, code: "countryUnknown" });

  const phone = native.phone
    ? toE164PhoneNumber(native.phone, country ?? context.defaultCountry)
    : null;
  if (native.phone && !phone) warnings.push({ field: null, code: "phoneInvalid" });
  // Without an e-mail, a usable phone is the only way left to reach the customer.
  if (!email && !phone) errors.push({ field: null, code: "contactRequired" });

  const parsedBirthDate = native.birthDate
    ? parseDateCell(native.birthDate, context.dateOrder)
    : null;
  const birthDate =
    parsedBirthDate && isPlausibleBirthDate(parsedBirthDate) ? parsedBirthDate : null;
  if (native.birthDate && !birthDate) warnings.push({ field: null, code: "birthDateInvalid" });

  if (errors.length > 0 || !firstName || !lastName) return { input: null, errors, warnings };

  const companyName = clean(native.companyName);
  return {
    input: {
      externalId: clean(native.externalId),
      customerType: companyName ? "business" : "individual",
      email,
      firstName,
      lastName,
      phone,
      companyName,
      companyNumber: clean(native.companyNumber),
      vatNumber: clean(native.vatNumber)?.replace(/\s/g, "").toUpperCase() ?? null,
      address: clean(native.address),
      postalCode: clean(native.postalCode),
      city: clean(native.city),
      country,
      birthDate,
      notes: clean(native.notes),
      customFields,
    },
    errors,
    warnings,
  };
}

/**
 * What tells two records of the same person apart: the e-mail when there is
 * one, otherwise the phone together with the last name (a shared family or
 * company phone alone would merge different people).
 */
export function getCustomerImportIdentityKey(
  input: Pick<CustomerImportRowInput, "email" | "phone" | "lastName">,
): string | null {
  if (input.email) return `email:${input.email}`;
  if (input.phone) return `phone:${input.phone}|${input.lastName.trim().toLowerCase()}`;
  return null;
}

// ----------------------------------------------------------------------------
// Procedure inputs
// ----------------------------------------------------------------------------

export const IMPORT_LIMITS = {
  rows: 5000,
  rowsPerCall: 500,
  columns: 60,
  cellLength: 2000,
} as const;

const importRowSchema = z.record(z.string().max(200), z.string().max(IMPORT_LIMITS.cellLength));

export const importCreateRunInputSchema = z.object({
  entityType: z.enum(["customers", "products"]),
  source: z.string().trim().min(1).max(64),
  fileName: z.string().trim().max(255).nullish(),
  columns: z.array(z.string().trim().min(1).max(200)).min(1).max(IMPORT_LIMITS.columns),
});

export const importStageRowsInputSchema = z.object({
  runId: z.string().length(21),
  /** Index of the first row of this call in the whole file. */
  offset: z.number().int().min(0).max(IMPORT_LIMITS.rows),
  rows: z.array(importRowSchema).min(1).max(IMPORT_LIMITS.rowsPerCall),
});

export const importMappingSchema = z.record(z.string().max(200), z.string().max(64).nullable());

export const importUpdateRunInputSchema = z.object({
  runId: z.string().length(21),
  mapping: importMappingSchema.optional(),
  duplicateStrategy: z.enum(["fill_empty", "overwrite", "skip"]).optional(),
});

export const importUpdateRowInputSchema = z.object({
  runId: z.string().length(21),
  rowIndex: z.number().int().min(0),
  payload: importRowSchema,
});
