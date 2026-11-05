import type { CustomerFieldDefinition, CustomerFieldValues } from "@louez/types";
import {
  digitsOnly,
  formatIdentityValue,
  isValidCompanyNumber,
  resolveCompanyNumberScheme,
  toCustomerFieldSearchValue,
  validateCustomerFieldValues,
  type CustomerFieldIssue,
} from "@louez/validations";

/**
 * What the AI assistant and the MCP server share when they read or write a
 * customer. Pure on purpose: both surfaces load the definitions themselves and
 * write inside their own transaction.
 */

type ToolFieldDefinition = Pick<
  CustomerFieldDefinition,
  | "id"
  | "key"
  | "label"
  | "type"
  | "format"
  | "options"
  | "unit"
  | "appliesTo"
  | "isRequired"
  | "isSensitive"
  | "isActive"
>;

/**
 * One custom value as a model sends it. A list of pairs rather than a free-form
 * object: some providers refuse a tool parameter without declared properties.
 */
export interface CustomerFieldEntry {
  /** The field's label as the merchant named it, or its key. */
  field: string;
  /** Checkboxes take "true" / "false", dates `yyyy-MM-dd`; an empty string clears the value. */
  value: string;
}

const quote = (label: string) => `"${label}"`;

/** Label first, then key, ignoring case; then ignoring accents and punctuation too. */
function findDefinitions<T extends ToolFieldDefinition>(
  definitions: readonly T[],
  name: string,
): T[] {
  const exact = name.trim().toLowerCase();
  const loose = toCustomerFieldSearchValue(name);
  const passes: ((definition: T) => boolean)[] = [
    (definition) => definition.label.trim().toLowerCase() === exact,
    (definition) => definition.key.toLowerCase() === exact,
    (definition) =>
      loose !== "" &&
      (toCustomerFieldSearchValue(definition.label) === loose ||
        toCustomerFieldSearchValue(definition.key) === loose),
  ];

  for (const matches of passes) {
    const found = definitions.filter(matches);
    if (found.length > 0) return found;
  }
  return [];
}

function describeIssue(definition: ToolFieldDefinition, issue: CustomerFieldIssue): string {
  const label = quote(definition.label);
  switch (issue.code) {
    case "required":
      return `${label} is required.`;
    case "invalidNumber":
      return `${label} must be a number.`;
    case "invalidDate":
      return `${label} must be a date formatted YYYY-MM-DD.`;
    case "invalidOption":
      return `${label} must be one of: ${(definition.options ?? []).join(", ")}.`;
    case "invalidEmail":
      return `${label} must be a valid e-mail address.`;
    case "invalidPhone":
      return `${label} must be a valid phone number, ideally in international format.`;
    case "invalidUrl":
      return `${label} must be a valid URL.`;
  }
}

/**
 * Turns the pairs sent by a model into values keyed by definition id, checked
 * against the store's active definitions. Unlike the dashboard form, nothing
 * is dropped silently: a model told "done" would repeat it to the merchant.
 */
export function checkCustomerFieldEntries(params: {
  definitions: readonly ToolFieldDefinition[];
  entries: readonly CustomerFieldEntry[] | undefined;
  customerType: "individual" | "business";
  /** An update only checks the fields it carries; a creation also enforces required ones. */
  partial: boolean;
}): { ok: true; values: CustomerFieldValues } | { ok: false; error: string } {
  const active = params.definitions.filter((definition) => definition.isActive);
  const submitted: CustomerFieldValues = {};
  const errors: string[] = [];

  for (const entry of params.entries ?? []) {
    const matches = findDefinitions(active, entry.field);
    const [definition] = matches;
    if (!definition) {
      errors.push(
        active.length > 0
          ? `Unknown custom field ${quote(entry.field)}. Available fields: ${active.map((candidate) => candidate.label).join(", ")}.`
          : `Unknown custom field ${quote(entry.field)}: this store has no custom fields.`,
      );
      continue;
    }
    if (matches.length > 1) {
      errors.push(
        `${quote(entry.field)} matches several custom fields. Use one of these keys instead: ${matches.map((match) => match.key).join(", ")}.`,
      );
      continue;
    }
    if (definition.appliesTo !== "all" && definition.appliesTo !== params.customerType) {
      errors.push(`${quote(definition.label)} only applies to ${definition.appliesTo} customers.`);
      continue;
    }
    submitted[definition.id] = entry.value;
  }

  const { values, issues } = validateCustomerFieldValues({
    definitions: active,
    values: submitted,
    customerType: params.customerType,
    partial: params.partial,
  });

  for (const issue of issues) {
    const definition = active.find((candidate) => candidate.id === issue.definitionId);
    if (definition) errors.push(describeIssue(definition, issue));
  }

  return errors.length > 0 ? { ok: false, error: errors.join(" ") } : { ok: true, values };
}

/**
 * A customer's custom values as a model may read them: label → value. Fields
 * flagged sensitive are withheld; their labels are listed so the model can say
 * the data exists without ever seeing it.
 */
export function toReadableCustomerFields(
  definitions: readonly ToolFieldDefinition[],
  values: CustomerFieldValues,
): { fields: Record<string, string>; withheld: string[] } {
  const fields: Record<string, string> = {};
  const withheld: string[] = [];

  for (const definition of definitions) {
    if (!definition.isActive) continue;
    const stored = values[definition.id] ?? "";
    if (stored === "" || (definition.type === "checkbox" && stored !== "true")) continue;

    if (definition.isSensitive) {
      withheld.push(definition.label);
      continue;
    }

    const display = definition.format ? formatIdentityValue(definition.format, stored) : stored;
    // Two fields may share a label: the key keeps both readable.
    const name =
      definition.label in fields ? `${definition.label} (${definition.key})` : definition.label;
    fields[name] = definition.unit ? `${display} ${definition.unit}` : display;
  }

  return { fields, withheld };
}

/**
 * Company identifiers as persisted. The scheme always comes from the country,
 * never from the caller, and only labels a number that fits that country's
 * format; an individual carries no company identifier at all.
 */
export function resolveCustomerCompanyFields(input: {
  customerType: "individual" | "business";
  country: string | null | undefined;
  companyNumber: string | null | undefined;
  vatNumber: string | null | undefined;
}) {
  if (input.customerType !== "business") {
    return { companyNumber: null, companyNumberScheme: null, vatNumber: null };
  }

  const country = input.country ?? "";
  const raw = input.companyNumber?.trim() ?? "";
  const scheme =
    raw.length > 0 && isValidCompanyNumber(country, raw)
      ? resolveCompanyNumberScheme(country)
      : null;
  const companyNumber = scheme ? digitsOnly(raw) : raw;
  const vatNumber = input.vatNumber?.replace(/\s/g, "").toUpperCase() ?? "";

  return {
    companyNumber: companyNumber.length > 0 ? companyNumber : null,
    companyNumberScheme: scheme,
    vatNumber: vatNumber.length > 0 ? vatNumber : null,
  };
}
