import { db, customers, reservations } from "@louez/db";
import { CUSTOMER_ACQUISITION_SOURCES, CUSTOMER_CREATED_VIA } from "@louez/types";
import { customerFieldDefinitionSchema, customerFieldValuesSchema } from "@louez/validations";
import { and, count, desc, eq, exists, gte, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import { dashboardProcedure } from "../../procedures";
import {
  customerFieldSearchCondition,
  getCustomerFieldValuesByCustomer,
  listCustomerFieldDefinitions,
} from "../../services/customer-fields";

const DEFAULT_PAGE_SIZE = 25;

const listInputSchema = z.object({
  search: z.string().optional(),
  sort: z.enum(["recent", "name", "reservations", "spent"]).optional(),
  type: z.enum(["all", "individual", "business"]).optional(),
  source: z.enum(CUSTOMER_ACQUISITION_SOURCES).optional(),
  channel: z.enum(CUSTOMER_CREATED_VIA).optional(),
  /** Creation day bounds, as instants computed by the caller in the store's timezone. */
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.literal([25, 50, 100]).optional(),
});

const listOutputSchema = z.object({
  customers: z.array(
    z.object({
      id: z.string(),
      customerType: z.enum(["individual", "business"]),
      email: z.string(),
      firstName: z.string(),
      lastName: z.string(),
      companyName: z.string().nullable(),
      phone: z.string().nullable(),
      city: z.string().nullable(),
      createdAt: z.date(),
      reservationCount: z.number(),
      totalSpent: z.string(),
      lastReservation: z.date().nullable(),
      /** Values of the fields flagged "show in list". */
      customFields: customerFieldValuesSchema,
    }),
  ),
  /** Fields flagged "show in list", in display order. */
  listFields: z.array(customerFieldDefinitionSchema),
  /** Customers matching the filters. */
  filteredCount: z.number(),
  /** Every customer of the store, filters aside: what plan limits count. */
  totalCount: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

const list = dashboardProcedure
  .input(listInputSchema)
  .output(listOutputSchema)
  .handler(async ({ context, input }) => {
    const storeId = context.store.id;
    const conditions = [eq(customers.storeId, storeId)];

    const search = input.search?.trim();
    if (search) {
      const searchLower = `%${search.toLowerCase()}%`;
      const nativeMatch = sql`(
        LOWER(${customers.firstName}) LIKE ${searchLower} OR
        LOWER(${customers.lastName}) LIKE ${searchLower} OR
        LOWER(${customers.email}) LIKE ${searchLower} OR
        LOWER(${customers.phone}) LIKE ${searchLower} OR
        LOWER(${customers.companyName}) LIKE ${searchLower}
      )`;
      // Searchable custom fields: typing an ID number finds its customer.
      const customMatch = customerFieldSearchCondition(storeId, search);
      conditions.push(customMatch ? sql`(${nativeMatch} OR ${customMatch})` : nativeMatch);
    }

    // A customer counts as business when that is their default identity or
    // when at least one reservation was billed to a company.
    if (input.type === "individual" || input.type === "business") {
      const hasBusinessReservation = exists(
        db
          .select({ id: reservations.id })
          .from(reservations)
          .where(
            and(
              eq(reservations.customerId, customers.id),
              sql`JSON_UNQUOTE(JSON_EXTRACT(${reservations.billingSnapshot}, '$.customerType')) = 'business'`,
            ),
          ),
      );
      const isBusiness = or(eq(customers.customerType, "business"), hasBusinessReservation);
      if (isBusiness) {
        conditions.push(input.type === "business" ? isBusiness : sql`NOT (${isBusiness})`);
      }
    }

    if (input.source) conditions.push(eq(customers.acquisitionSource, input.source));
    if (input.channel) conditions.push(eq(customers.createdVia, input.channel));
    if (input.createdFrom) conditions.push(gte(customers.createdAt, input.createdFrom));
    if (input.createdTo) conditions.push(lt(customers.createdAt, input.createdTo));

    const whereClause = and(...conditions);
    const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;
    const page = input.page ?? 1;

    let query = db
      .select({
        id: customers.id,
        customerType: customers.customerType,
        email: customers.email,
        firstName: customers.firstName,
        lastName: customers.lastName,
        companyName: customers.companyName,
        phone: customers.phone,
        city: customers.city,
        createdAt: customers.createdAt,
        reservationCount: count(reservations.id),
        totalSpent: sql<string>`COALESCE(SUM(${reservations.totalAmount}), 0)`,
        lastReservation: sql<Date | null>`MAX(${reservations.createdAt})`,
      })
      .from(customers)
      .leftJoin(
        reservations,
        and(eq(reservations.customerId, customers.id), eq(reservations.storeId, storeId)),
      )
      .where(whereClause)
      .groupBy(customers.id)
      .$dynamic();

    switch (input.sort) {
      case "name":
        query = query.orderBy(customers.lastName, customers.firstName);
        break;
      case "reservations":
        query = query.orderBy(desc(count(reservations.id)));
        break;
      case "spent":
        query = query.orderBy(desc(sql`COALESCE(SUM(${reservations.totalAmount}), 0)`));
        break;
      default:
        query = query.orderBy(desc(customers.createdAt));
    }

    const [customerRows, filteredCountResult, totalCountResult, definitions] = await Promise.all([
      query.limit(pageSize).offset((page - 1) * pageSize),
      db.select({ count: count() }).from(customers).where(whereClause),
      db.select({ count: count() }).from(customers).where(eq(customers.storeId, storeId)),
      listCustomerFieldDefinitions(storeId, { activeOnly: true, scope: "customer" }),
    ]);

    const listFields = definitions.filter((definition) => definition.showInList);
    const valuesByCustomer = await getCustomerFieldValuesByCustomer(
      storeId,
      customerRows.map((row) => row.id),
      listFields.map((definition) => definition.id),
    );

    return {
      customers: customerRows.map((row) => ({
        ...row,
        totalSpent: String(row.totalSpent),
        lastReservation: row.lastReservation ? new Date(row.lastReservation) : null,
        customFields: valuesByCustomer.get(row.id) ?? {},
      })),
      listFields,
      filteredCount: filteredCountResult[0]?.count ?? 0,
      totalCount: totalCountResult[0]?.count ?? 0,
      page,
      pageSize,
    };
  });

export const dashboardCustomersRouter = {
  list,
};
