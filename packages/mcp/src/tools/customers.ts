import { z } from 'zod'
import { db, customers, reservations } from '@louez/db'
import { and, eq, desc, like, sql } from 'drizzle-orm'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { McpSessionContext } from '../auth/context'
import { requirePermission } from '../auth/context'
import { formatCurrency, formatDate, formatStatus } from '../utils/formatting'
import { toolError, toolResult } from '../utils/errors'
import { paginationParams } from '../utils/pagination'

export function registerCustomerTools(server: McpServer, ctx: McpSessionContext) {
  server.tool(
    'list_customers',
    'List customers with optional search and filters',
    {
      search: z.string().optional().describe('Search by name or email'),
      type: z.enum(['individual', 'business']).optional().describe('Filter by customer type'),
      page: z.number().optional(),
      pageSize: z.number().optional(),
    },
    async ({ search, type, page, pageSize }) => {
      requirePermission(ctx, 'customers', 'read')
      const { limit, offset } = paginationParams({ page, pageSize })

      const conditions = [eq(customers.storeId, ctx.storeId)]

      if (type) {
        conditions.push(eq(customers.customerType, type))
      }
      if (search) {
        const s = `%${search.toLowerCase()}%`
        conditions.push(
          sql`(LOWER(${customers.firstName}) LIKE ${s} OR LOWER(${customers.lastName}) LIKE ${s} OR LOWER(${customers.email}) LIKE ${s})`
        )
      }

      const rows = await db
        .select()
        .from(customers)
        .where(and(...conditions))
        .orderBy(desc(customers.createdAt))
        .limit(limit)
        .offset(offset)

      const [countResult] = await db
        .select({ total: sql<number>`COUNT(*)` })
        .from(customers)
        .where(and(...conditions))

      const total = countResult?.total ?? 0

      const lines = rows.map(
        (c) =>
          `- **${c.firstName} ${c.lastName}** (${c.id})\n` +
          `  ${c.email}${c.phone ? ` | ${c.phone}` : ''} | ${c.customerType}\n` +
          `  Inscrit le ${formatDate(c.createdAt)}`
      )

      return toolResult(
        `## Clients (${total} résultat${total > 1 ? 's' : ''})\n\n${lines.join('\n\n') || 'Aucun client trouvé.'}`
      )
    }
  )

  server.tool(
    'get_customer',
    'Get detailed customer profile with reservation history',
    {
      customerId: z.string().describe('The customer ID'),
    },
    async ({ customerId }) => {
      requirePermission(ctx, 'customers', 'read')

      const customer = await db.query.customers.findFirst({
        where: and(eq(customers.storeId, ctx.storeId), eq(customers.id, customerId)),
        with: {
          reservations: {
            orderBy: [desc(reservations.createdAt)],
            limit: 10,
          },
        },
      })

      if (!customer) return toolError('Client non trouvé.')

      let text =
        `## ${customer.firstName} ${customer.lastName}\n\n` +
        `- **ID**: ${customer.id}\n` +
        `- **Type**: ${customer.customerType}\n` +
        `- **Email**: ${customer.email}\n` +
        (customer.phone ? `- **Tél**: ${customer.phone}\n` : '') +
        (customer.companyName ? `- **Entreprise**: ${customer.companyName}\n` : '') +
        (customer.address ? `- **Adresse**: ${customer.address}, ${customer.city} ${customer.postalCode}\n` : '') +
        `- **Inscrit le**: ${formatDate(customer.createdAt)}\n`

      if (customer.notes) {
        text += `\n### Notes\n${customer.notes}\n`
      }

      if (customer.reservations.length > 0) {
        text += `\n### Dernières réservations (${customer.reservations.length})\n`
        for (const r of customer.reservations) {
          text += `- #${r.number} — ${formatStatus(r.status)} — ${formatDate(r.startDate)} → ${formatDate(r.endDate)} — ${formatCurrency(r.totalAmount)}\n`
        }
      }

      return toolResult(text)
    }
  )

  server.tool(
    'create_customer',
    'Create a new customer',
    {
      email: z.string().email().describe('Customer email'),
      firstName: z.string().min(1).describe('First name'),
      lastName: z.string().min(1).describe('Last name'),
      phone: z.string().optional().describe('Phone number'),
      customerType: z.enum(['individual', 'business']).optional().describe('Customer type'),
      companyName: z.string().optional().describe('Company name (for business customers)'),
      address: z.string().optional().describe('Street address'),
      city: z.string().optional().describe('City'),
      postalCode: z.string().optional().describe('Postal code'),
    },
    async ({ email, firstName, lastName, phone, customerType, companyName, address, city, postalCode }) => {
      requirePermission(ctx, 'customers', 'write')

      const [created] = await db
        .insert(customers)
        .values({
          storeId: ctx.storeId,
          email,
          firstName,
          lastName,
          phone: phone ?? null,
          customerType: customerType ?? 'individual',
          companyName: companyName ?? null,
          address: address ?? null,
          city: city ?? null,
          postalCode: postalCode ?? null,
        })
        .$returningId()

      return toolResult(
        `Client créé avec succès.\n\n` +
          `- **Nom**: ${firstName} ${lastName}\n` +
          `- **ID**: ${created.id}\n` +
          `- **Email**: ${email}`
      )
    }
  )

  server.tool(
    'update_customer',
    'Update an existing customer',
    {
      customerId: z.string().describe('The customer ID'),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
      city: z.string().optional(),
      postalCode: z.string().optional(),
      notes: z.string().optional(),
    },
    async ({ customerId, ...updates }) => {
      requirePermission(ctx, 'customers', 'write')

      const existing = await db.query.customers.findFirst({
        where: and(eq(customers.storeId, ctx.storeId), eq(customers.id, customerId)),
        columns: { id: true },
      })
      if (!existing) return toolError('Client non trouvé.')

      const updateData: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) updateData[key] = value
      }

      if (Object.keys(updateData).length === 0) {
        return toolError('Aucun champ à mettre à jour.')
      }

      await db.update(customers).set(updateData).where(eq(customers.id, customerId))

      return toolResult(`Client ${customerId} mis à jour avec succès.`)
    }
  )
}
