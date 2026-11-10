import type { McpServer } from '@modelcontextprotocol/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  customerFieldSearchCondition,
  getCustomerFieldValues,
  listCustomerFieldDefinitions,
  saveCustomerFieldValues,
} from '@louez/api/services/customer-fields';
import {
  agentCustomerFields,
  checkCustomerFieldEntries,
  requiresSensitiveFields,
  resolveCustomerCompanyFields,
  toReadableCustomerFields,
} from '@louez/api/services/customer-tools';
import { customerLinks, reservationLinks } from '@louez/api/platform/links';
import { customers, db, reservations, stores } from '@louez/db';

import { hasPermission, type McpRequestContext } from '../auth/context';
import { toolError, toolResult } from '../utils/errors';
import { legacyTool } from '../utils/legacy-tool';
import { linksLine } from '../utils/links';
import { formatCurrency, formatDate, formatStatus } from '../utils/formatting';
import { paginationParams } from '../utils/pagination';

// A list of pairs rather than a free-form object: some MCP clients refuse a
// tool parameter that declares no property.
const customFieldEntriesParam = z
  .array(
    z.object({
      field: z
        .string()
        .describe(
          "The custom field's label as shown on the customer record, or its key",
        ),
      value: z
        .string()
        .describe(
          'The value. Checkboxes take "true" or "false", dates YYYY-MM-DD. An empty string clears the field.',
        ),
    }),
  )
  .optional()
  .describe(
    "The store's own custom fields, such as sizes or preferences, except those it flagged sensitive, which only Louez fills. An unknown field name returns the list of available fields.",
  );

const countryParam = z
  .string()
  .regex(/^[A-Za-z]{2}$/)
  .optional()
  .describe('ISO 3166-1 alpha-2 country code, e.g. "FR"');

export function registerCustomerTools(
  server: McpServer,
  ctx: McpRequestContext,
) {
  legacyTool(
    server,
    ctx,
    { domain: 'customers', level: 'read' },
    { name: 'list_customers', title: 'List Customers' },
    "List customers with optional search and filters. Each customer comes with the link to its dashboard page, the URL to give the user to open it.",
    {
      search: z
        .string()
        .optional()
        .describe(
          "Search by name, email, or the start of a value in one of the store's searchable custom fields, except those it flagged sensitive",
        ),
      type: z
        .enum(['individual', 'business'])
        .optional()
        .describe('Filter by customer type'),
      page: z.number().optional(),
      pageSize: z.number().optional(),
    },
    async ({ search, type, page, pageSize }) => {
      const { limit, offset } = paginationParams({ page, pageSize });

      const conditions = [eq(customers.storeId, ctx.storeId)];

      if (type) {
        conditions.push(eq(customers.customerType, type));
      }
      if (search) {
        const s = `%${search.toLowerCase()}%`;
        const nativeMatch = sql`(LOWER(${customers.firstName}) LIKE ${s} OR LOWER(${customers.lastName}) LIKE ${s} OR LOWER(${customers.email}) LIKE ${s})`;
        const customMatch = customerFieldSearchCondition(ctx.storeId, search, {
          sensitive: false,
        });
        conditions.push(
          customMatch ? sql`(${nativeMatch} OR ${customMatch})` : nativeMatch,
        );
      }

      const rows = await db
        .select()
        .from(customers)
        .where(and(...conditions))
        .orderBy(desc(customers.createdAt))
        .limit(limit)
        .offset(offset);

      const [countResult] = await db
        .select({ total: sql<number>`COUNT(*)` })
        .from(customers)
        .where(and(...conditions));

      const total = countResult?.total ?? 0;

      const lines = rows.map(
        (c) =>
          `- **${c.firstName} ${c.lastName}** (${c.id})\n` +
          `  ${c.email}${c.phone ? ` | ${c.phone}` : ''} | ${c.customerType}\n` +
          `  Registered: ${formatDate(c.createdAt)}\n` +
          `  Dashboard: ${customerLinks(ctx.ports.urls, { id: ctx.storeId }, c).dashboard}`,
      );

      return toolResult(
        `## Customers (${total} result${total !== 1 ? 's' : ''})\n\n${lines.join('\n\n') || 'No customers found.'}`,
      );
    },
  );

  legacyTool(
    server,
    ctx,
    { domain: 'customers', level: 'read' },
    { name: 'get_customer', title: 'Get Customer' },
    "Get detailed customer profile with the store's custom fields and, when the connection may read reservations, the reservation history, with the link to the customer's dashboard page and each reservation's, the URLs to give the user to open them. Custom fields the store flagged as sensitive are never returned nor named: when the record holds some, the answer says other details are kept in Louez, on the customer's dashboard page.",
    {
      customerId: z.string().describe('The customer ID'),
    },
    async ({ customerId }) => {
      // The history is reservation data: only for a connection that may read reservations.
      const readsReservations = hasPermission(ctx, 'reservations', 'read');
      const customer = await db.query.customers.findFirst({
        where: and(
          eq(customers.storeId, ctx.storeId),
          eq(customers.id, customerId),
        ),
      });

      if (!customer) return toolError('Customer not found.', 'NOT_FOUND');

      let text =
        `## ${customer.firstName} ${customer.lastName}\n\n` +
        `- **ID**: ${customer.id}\n` +
        `- **Type**: ${customer.customerType}\n` +
        `- **Email**: ${customer.email}\n` +
        (customer.phone ? `- **Phone**: ${customer.phone}\n` : '') +
        (customer.companyName
          ? `- **Company**: ${customer.companyName}\n`
          : '') +
        (customer.address
          ? `- **Address**: ${customer.address}, ${customer.city} ${customer.postalCode}\n`
          : '') +
        `- **Registered**: ${formatDate(customer.createdAt)}\n` +
        `\n${linksLine(customerLinks(ctx.ports.urls, { id: ctx.storeId }, customer))}\n`;

      const [definitions, values] = await Promise.all([
        listCustomerFieldDefinitions(ctx.storeId, { activeOnly: true, scope: 'customer' }),
        getCustomerFieldValues(ctx.storeId, customer.id),
      ]);
      // A sensitive field is neither shown nor named: only that some exist.
      const { fields, withheld } = toReadableCustomerFields(definitions, values);

      if (Object.keys(fields).length > 0) {
        text += `\n### Custom fields\n`;
        for (const [label, value] of Object.entries(fields)) {
          text += `- **${label}**: ${value}\n`;
        }
      }
      if (withheld.length > 0) {
        text += `\nOther details are kept in Louez only, on the customer's dashboard page.\n`;
      }

      if (customer.notes) {
        text += `\n### Notes\n${customer.notes}\n`;
      }

      const history = readsReservations
        ? await db.query.reservations.findMany({
            where: and(
              eq(reservations.storeId, ctx.storeId),
              eq(reservations.customerId, customer.id),
            ),
            orderBy: [desc(reservations.createdAt)],
            limit: 10,
          })
        : [];
      if (history.length > 0) {
        text += `\n### Recent reservations (${history.length})\n`;
        for (const r of history) {
          const link = reservationLinks(ctx.ports.urls, { id: ctx.storeId }, r).dashboard;
          text += `- #${r.number} — ${formatStatus(r.status)} — ${formatDate(r.startDate)} → ${formatDate(r.endDate)} — ${formatCurrency(r.totalAmount)} — ${link}\n`;
        }
      }

      return toolResult(text);
    },
  );

  legacyTool(
    server,
    ctx,
    { domain: 'customers', level: 'write' },
    { name: 'create_customer', title: 'Create Customer', effect: 'additive' },
    "Create a new customer. Answers with the link to its dashboard page, to give the user. Custom fields the store flagged sensitive are not set here: when the store requires one, the customer is still created and the answer says those details are completed in Louez.",
    {
      email: z.email().describe('Customer email'),
      firstName: z.string().min(1).describe('First name'),
      lastName: z.string().min(1).describe('Last name'),
      phone: z.string().optional().describe('Phone number'),
      customerType: z
        .enum(['individual', 'business'])
        .optional()
        .describe('Customer type'),
      companyName: z
        .string()
        .optional()
        .describe('Company name (for business customers)'),
      companyNumber: z
        .string()
        .max(64)
        .optional()
        .describe(
          'Company registration number (SIREN in France, BCE in Belgium). Business customers only.',
        ),
      vatNumber: z
        .string()
        .max(64)
        .optional()
        .describe('VAT number. Business customers only.'),
      address: z.string().optional().describe('Street address'),
      city: z.string().optional().describe('City'),
      postalCode: z.string().optional().describe('Postal code'),
      country: countryParam,
      customFields: customFieldEntriesParam,
    },
    async ({
      email,
      firstName,
      lastName,
      phone,
      customerType,
      companyName,
      companyNumber,
      vatNumber,
      address,
      city,
      postalCode,
      country,
      customFields,
    }) => {
      const type = customerType ?? 'individual';
      if (type !== 'business' && (companyNumber || vatNumber)) {
        return toolError(
          'companyNumber and vatNumber only apply to business customers: set customerType to "business".',
        );
      }

      const existingEmail = await db.query.customers.findFirst({
        where: and(
          eq(customers.storeId, ctx.storeId),
          eq(customers.email, email),
        ),
        columns: { id: true },
      });
      if (existingEmail) {
        return toolError(
          'A customer with this email already exists in this store.',
        );
      }

      const [definitions, store] = await Promise.all([
        listCustomerFieldDefinitions(ctx.storeId, { activeOnly: true, scope: 'customer' }),
        db.query.stores.findFirst({
          where: eq(stores.id, ctx.storeId),
          columns: { settings: true },
        }),
      ]);
      // Sensitive fields are Louez's alone: not checked, not written, not named.
      const fieldsForAgent = agentCustomerFields(definitions);
      const checked = checkCustomerFieldEntries({
        definitions: fieldsForAgent,
        entries: customFields,
        customerType: type,
        partial: false,
      });
      if (!checked.ok) return toolError(checked.error);

      // A customer is assumed to live where the store trades unless told otherwise.
      const customerCountry =
        country?.toUpperCase() ?? store?.settings?.country ?? 'FR';

      const createdId = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(customers)
          .values({
            storeId: ctx.storeId,
            email,
            firstName,
            lastName,
            phone: phone ?? null,
            customerType: type,
            companyName: companyName ?? null,
            ...resolveCustomerCompanyFields({
              customerType: type,
              country: customerCountry,
              companyNumber,
              vatNumber,
            }),
            address: address ?? null,
            city: city ?? null,
            postalCode: postalCode ?? null,
            country: customerCountry,
            createdVia: 'api',
          })
          .$returningId();

        await saveCustomerFieldValues(tx, {
          storeId: ctx.storeId,
          customerId: created.id,
          values: checked.values,
          definitions: fieldsForAgent,
        });
        return created.id;
      });

      const completeInLouez = requiresSensitiveFields(definitions, type)
        ? `Some details the store requires must be completed in Louez, on the customer's dashboard page.\n\n`
        : '';
      return toolResult(
        `Customer created successfully.\n\n` +
          `- **Name**: ${firstName} ${lastName}\n` +
          `- **ID**: ${createdId}\n` +
          `- **Email**: ${email}\n\n` +
          completeInLouez +
          linksLine(customerLinks(ctx.ports.urls, { id: ctx.storeId }, { id: createdId })),
      );
    },
  );

  legacyTool(
    server,
    ctx,
    { domain: 'customers', level: 'write' },
    { name: 'update_customer', title: 'Update Customer', effect: 'overwrite' },
    'Update an existing customer. Answers with the link to its dashboard page, to give the user.',
    {
      customerId: z.string().describe('The customer ID'),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      email: z.email().optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
      city: z.string().optional(),
      postalCode: z.string().optional(),
      country: countryParam,
      companyNumber: z
        .string()
        .max(64)
        .optional()
        .describe(
          'Company registration number. Business customers only; an empty string clears it.',
        ),
      vatNumber: z
        .string()
        .max(64)
        .optional()
        .describe(
          'VAT number. Business customers only; an empty string clears it.',
        ),
      notes: z.string().optional(),
      customFields: customFieldEntriesParam,
    },
    async ({
      customerId,
      customFields,
      companyNumber,
      vatNumber,
      country,
      ...updates
    }) => {
      const existing = await db.query.customers.findFirst({
        where: and(
          eq(customers.storeId, ctx.storeId),
          eq(customers.id, customerId),
        ),
        columns: {
          id: true,
          email: true,
          customerType: true,
          country: true,
          companyNumber: true,
          vatNumber: true,
        },
      });
      if (!existing) return toolError('Customer not found.', 'NOT_FOUND');

      const isBusiness = existing.customerType === 'business';
      if (!isBusiness && (companyNumber || vatNumber)) {
        return toolError(
          'companyNumber and vatNumber only apply to business customers, and this customer is an individual.',
        );
      }

      if (updates.email && updates.email !== existing.email) {
        const emailTaken = await db.query.customers.findFirst({
          where: and(
            eq(customers.storeId, ctx.storeId),
            eq(customers.email, updates.email),
          ),
          columns: { id: true },
        });
        if (emailTaken) {
          return toolError(
            'A customer with this email already exists in this store.',
          );
        }
      }

      const updateData: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) updateData[key] = value;
      }

      const customerCountry = country?.toUpperCase();
      if (customerCountry) updateData.country = customerCountry;

      // The scheme follows the country: a new country or a new number both
      // call for deriving it again. An individual's saved company is left alone.
      const touchesCompanyIdentity =
        companyNumber !== undefined ||
        vatNumber !== undefined ||
        customerCountry !== undefined;
      if (isBusiness && touchesCompanyIdentity) {
        Object.assign(
          updateData,
          resolveCustomerCompanyFields({
            customerType: 'business',
            country: customerCountry ?? existing.country,
            companyNumber: companyNumber ?? existing.companyNumber,
            vatNumber: vatNumber ?? existing.vatNumber,
          }),
        );
      }

      const hasCustomFields = (customFields?.length ?? 0) > 0;
      if (Object.keys(updateData).length === 0 && !hasCustomFields) {
        return toolError('No fields to update.');
      }

      // Sensitive fields are Louez's alone: not checked, not written, not named.
      const definitions = agentCustomerFields(
        await listCustomerFieldDefinitions(ctx.storeId, {
          activeOnly: true,
          scope: 'customer',
        }),
      );
      const checked = checkCustomerFieldEntries({
        definitions,
        entries: customFields,
        customerType: existing.customerType,
        partial: true,
      });
      if (!checked.ok) return toolError(checked.error);

      await db.transaction(async (tx) => {
        if (Object.keys(updateData).length > 0) {
          await tx
            .update(customers)
            .set(updateData)
            .where(
              and(
                eq(customers.id, customerId),
                eq(customers.storeId, ctx.storeId),
              ),
            );
        }
        await saveCustomerFieldValues(tx, {
          storeId: ctx.storeId,
          customerId,
          values: checked.values,
          definitions,
        });
      });

      return toolResult(
        `Customer ${customerId} updated successfully.\n\n` +
          linksLine(customerLinks(ctx.ports.urls, { id: ctx.storeId }, { id: customerId })),
      );
    },
  );
}
