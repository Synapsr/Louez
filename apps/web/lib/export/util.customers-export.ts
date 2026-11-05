import type { CustomerFieldDefinition, CustomerFieldValues } from "@louez/types";
import { formatIdentityValue } from "@louez/validations";

export interface CustomerExportRow {
  id: string;
  customerType: string;
  firstName: string;
  lastName: string;
  companyName: string | null;
  email: string;
  phone: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  birthDate: string | null;
  acquisitionSource: string | null;
  acquisitionSourceDetail: string | null;
  createdVia: string | null;
  createdAt: Date;
}

type ExportFieldDefinition = Pick<
  CustomerFieldDefinition,
  "id" | "label" | "format" | "isSensitive" | "isActive"
>;

const NATIVE_HEADERS = [
  "Type",
  "First Name",
  "Last Name",
  "Company",
  "Email",
  "Phone",
  "Address",
  "Postal Code",
  "City",
  "Country",
  "Birth Date",
  "Source",
  "Channel",
  "Created At",
];

/**
 * Custom fields that make it into an export. Sensitive ones stay out unless
 * the merchant explicitly asked for them.
 */
export function getExportableCustomerFields<T extends ExportFieldDefinition>(
  definitions: readonly T[],
  includeSensitive: boolean,
): T[] {
  return definitions.filter(
    (definition) => definition.isActive && (includeSensitive || !definition.isSensitive),
  );
}

/** Column titles must stay distinct: two fields may share a label, or reuse a native one. */
function toUniqueHeaders(labels: readonly string[]): string[] {
  const taken = new Set(NATIVE_HEADERS.map((header) => header.toLowerCase()));
  return labels.map((label) => {
    let header = label;
    for (let suffix = 2; taken.has(header.toLowerCase()); suffix += 1) {
      header = `${label} (${suffix})`;
    }
    taken.add(header.toLowerCase());
    return header;
  });
}

const text = (value: string | null | undefined) => value ?? "";

/** The acquisition source with its free-text precision, when there is one. */
const formatSource = (
  row: Pick<CustomerExportRow, "acquisitionSource" | "acquisitionSourceDetail">,
) => [row.acquisitionSource, row.acquisitionSourceDetail].filter(Boolean).join(": ");

export function buildCustomersExport(params: {
  customers: readonly CustomerExportRow[];
  definitions: readonly ExportFieldDefinition[];
  valuesByCustomer: ReadonlyMap<string, CustomerFieldValues>;
  includeSensitive: boolean;
}): { headers: string[]; rows: string[][]; json: Record<string, unknown>[] } {
  const fields = getExportableCustomerFields(params.definitions, params.includeSensitive);
  const fieldHeaders = toUniqueHeaders(fields.map((field) => field.label));

  const customValues = (customerId: string) => {
    const values = params.valuesByCustomer.get(customerId) ?? {};
    return fields.map((field) => {
      const stored = values[field.id] ?? "";
      return field.format ? formatIdentityValue(field.format, stored) : stored;
    });
  };

  const rows: string[][] = [];
  const json: Record<string, unknown>[] = [];

  for (const customer of params.customers) {
    const custom = customValues(customer.id);
    rows.push([
      customer.customerType,
      customer.firstName,
      customer.lastName,
      text(customer.companyName),
      customer.email,
      text(customer.phone),
      text(customer.address),
      text(customer.postalCode),
      text(customer.city),
      text(customer.country),
      text(customer.birthDate),
      formatSource(customer),
      text(customer.createdVia),
      customer.createdAt.toISOString(),
      ...custom,
    ]);
    json.push({
      ...customer,
      customFields: Object.fromEntries(
        fieldHeaders.map((header, index) => [header, custom[index] ?? ""]),
      ),
    });
  }

  return { headers: [...NATIVE_HEADERS, ...fieldHeaders], rows, json };
}
