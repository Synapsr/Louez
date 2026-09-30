import {
  getCustomerFieldValuesByCustomer,
  listCustomerFieldDefinitions,
} from "@louez/api/services/customer-fields";
import { customers, db } from "@louez/db";
import type { CustomerFieldValues } from "@louez/types";
import { and, between, desc, eq } from "drizzle-orm";

import type { ExportParams } from "./types";
import { buildCustomersExport, getExportableCustomerFields } from "./util.customers-export";

const VALUES_BATCH_SIZE = 1000;

/**
 * Customers created in the requested period (all of them without one), with
 * one column per active custom field. Sensitive fields are never read from the
 * database unless the request opted in.
 */
export async function queryCustomersExport(storeId: string, params: ExportParams) {
  const [rows, definitions] = await Promise.all([
    db
      .select({
        id: customers.id,
        customerType: customers.customerType,
        firstName: customers.firstName,
        lastName: customers.lastName,
        companyName: customers.companyName,
        email: customers.email,
        phone: customers.phone,
        address: customers.address,
        postalCode: customers.postalCode,
        city: customers.city,
        country: customers.country,
        birthDate: customers.birthDate,
        acquisitionSource: customers.acquisitionSource,
        acquisitionSourceDetail: customers.acquisitionSourceDetail,
        createdVia: customers.createdVia,
        createdAt: customers.createdAt,
      })
      .from(customers)
      .where(
        and(
          eq(customers.storeId, storeId),
          params.startDate && params.endDate
            ? between(customers.createdAt, params.startDate, params.endDate)
            : undefined,
        ),
      )
      .orderBy(desc(customers.createdAt)),
    listCustomerFieldDefinitions(storeId, { activeOnly: true, scope: "customer" }),
  ]);

  const includeSensitive = params.includeSensitive === true;
  const fieldIds = getExportableCustomerFields(definitions, includeSensitive).map(
    (definition) => definition.id,
  );

  // Batched: an export can span thousands of customers, and a prepared
  // statement takes a bounded number of placeholders.
  const valuesByCustomer = new Map<string, CustomerFieldValues>();
  for (let start = 0; start < rows.length; start += VALUES_BATCH_SIZE) {
    const batch = await getCustomerFieldValuesByCustomer(
      storeId,
      rows.slice(start, start + VALUES_BATCH_SIZE).map((row) => row.id),
      fieldIds,
    );
    for (const [customerId, values] of batch) valuesByCustomer.set(customerId, values);
  }

  return buildCustomersExport({ customers: rows, definitions, valuesByCustomer, includeSensitive });
}
