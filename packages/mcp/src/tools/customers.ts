import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  customerFieldSearchCondition,
  getCustomerFieldValues,
  listCustomerFieldDefinitions,
  saveCustomerFieldValues,
} from '@louez/api/services/customer-fields';
import {
  checkCustomerFieldEntries,
  resolveCustomerCompanyFields,
  toReadableCustomerFields,
} from '@louez/api/services/customer-tools';
import { customers, db, reservations, stores } from '@louez/db';

import type { McpSessionContext } from '../auth/context';
import { requirePermission } from '../auth/context';
import { toolError, toolResult } from '../utils/errors';
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
    'Custom fields defined by the store (ID numbers, licence, sizes…). An unknown field name returns the list of available fields.',
  );

const countryParam = z
  .string()
  .regex(/^[A-Za-z]{2}$/)
  .optional()
  .describe('ISO 3166-1 alpha-2 country code, e.g. "FR"');

export function registerCustomerTools(
  server: McpServer,
  ctx: McpSessionContext,
) {
  server.tool(
    'list_customers',
    'List customers with optional search and filters',
    {
      search: z
        .string()
        .optional()
        .describe(
          'Search by name, email, or the start of a searchable custom field (an ID or licence number)',
        ),
      type: z
        .enum(['individual', 'business'])
        .optional()
        .describe('Filter by customer type'),
      page: z.number().optional(),
      pageSize: z.number().optional(),
    },
    async ({ search, type, page, pageSize }) => {
      requirePermission(ctx, 'customers', 'read');
      const { limit, offset } = paginationParams({ page, pageSize });

      const conditions = [eq(customers.storeId, ctx.storeId)];

      if (type) {
        conditions.push(eq(customers.customerType, type));
      }
      if (search) {
        const s = `%${search.toLowerCase()}%`;
        const nativeMatch = sql`(LOWER(${customers.firstName}) LIKE ${s} OR LOWER(${customers.lastName}) LIKE ${s} OR LOWER(${customers.email}) LIKE ${s})`;
        const customMatch = customerFieldSearchCondition(ctx.storeId, search);
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
          `  Registered: ${formatDate(c.createdAt)}`,
      );

      return toolResult(
        `## Customers (${total} result${total !== 1 ? 's' : ''})\n\n${lines.join('\n\n') || 'No customers found.'}`,
      );
    },
  );

  server.tool(
    'get_customer',
    "Get detailed customer profile with reservation history and the store's custom fields. Custom fields the store flagged as sensitive are never returned: they are listed as withheld, which means the value exists on the record and can be read in the dashboard, not that it is missing.",
    {
      customerId: z.string().describe('The customer ID'),
    },
    async ({ customerId }) => {
      requirePermission(ctx, 'customers', 'read');

      const customer = await db.query.customers.findFirst({
        where: and(
          eq(customers.storeId, ctx.storeId),
          eq(customers.id, customerId),
        ),
        with: {
          reservations: {
            orderBy: [desc(reservations.createdAt)],
            limit: 10,
          },
        },
      });

      if (!customer) return toolError('Customer not found.');

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
        `- **Registered**: ${formatDate(customer.createdAt)}\n`;

      const [definitions, values] = await Promise.all([
        listCustomerFieldDefinitions(ctx.storeId, { activeOnly: true, scope: 'customer' }),
        getCustomerFieldValues(ctx.storeId, customer.id),
      ]);
      const { fields, withheld } = toReadableCustomerFields(definitions, values);

      if (Object.keys(fields).length > 0 || withheld.length > 0) {
        text += `\n### Custom fields\n`;
        for (const [label, value] of Object.entries(fields)) {
          text += `- **${label}**: ${value}\n`;
        }
        for (const label of withheld) {
          text += `- **${label}**: on file, withheld (sensitive)\n`;
        }
      }

      if (customer.notes) {
        text += `\n### Notes\n${customer.notes}\n`;
      }

      if (customer.reservations.length > 0) {
        text += `\n### Recent reservations (${customer.reservations.length})\n`;
        for (const r of customer.reservations) {
          text += `- #${r.number} — ${formatStatus(r.status)} — ${formatDate(r.startDate)} → ${formatDate(r.endDate)} — ${formatCurrency(r.totalAmount)}\n`;
        }
      }

      return toolResult(text);
    },
  );

  server.tool(
    'create_customer',
    'Create a new customer',
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
      requirePermission(ctx, 'customers', 'write');

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
      const checked = checkCustomerFieldEntries({
        definitions,
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
          definitions,
        });
        return created.id;
      });

      return toolResult(
        `Customer created successfully.\n\n` +
          `- **Name**: ${firstName} ${lastName}\n` +
          `- **ID**: ${createdId}\n` +
          `- **Email**: ${email}`,
      );
    },
  );

  server.tool(
    'update_customer',
    'Update an existing customer',
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
      requirePermission(ctx, 'customers', 'write');

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
      if (!existing) return toolError('Customer not found.');

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

      const definitions = await listCustomerFieldDefinitions(ctx.storeId, {
        activeOnly: true,
        scope: 'customer',
      });
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

      return toolResult(`Customer ${customerId} updated successfully.`);
    },
  );
}
