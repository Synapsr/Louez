import { z } from 'zod'
import { db, products, categories } from '@louez/db'
import { and, eq, like, sql, desc } from 'drizzle-orm'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { McpSessionContext } from '../auth/context'
import { requirePermission } from '../auth/context'
import { formatCurrency, formatDate } from '../utils/formatting'
import { toolError, toolResult } from '../utils/errors'
import { paginationParams } from '../utils/pagination'

export function registerProductTools(server: McpServer, ctx: McpSessionContext) {
  // ── list_products ──────────────────────────────────────────────────────
  server.tool(
    'list_products',
    'List products in the store catalog with optional filters',
    {
      status: z.enum(['active', 'draft', 'archived', 'all']).optional().describe('Filter by product status'),
      categoryId: z.string().optional().describe('Filter by category ID'),
      search: z.string().optional().describe('Search by product name'),
      page: z.number().optional().describe('Page number (default 1)'),
      pageSize: z.number().optional().describe('Results per page (default 50, max 100)'),
    },
    async ({ status, categoryId, search, page, pageSize }) => {
      requirePermission(ctx, 'products', 'read')
      const { limit, offset } = paginationParams({ page, pageSize })

      const conditions = [eq(products.storeId, ctx.storeId)]
      if (status && status !== 'all') {
        conditions.push(eq(products.status, status))
      }
      if (categoryId) {
        conditions.push(eq(products.categoryId, categoryId))
      }
      if (search) {
        conditions.push(like(products.name, `%${search}%`))
      }

      const rows = await db
        .select({
          id: products.id,
          name: products.name,
          price: products.price,
          deposit: products.deposit,
          pricingMode: products.pricingMode,
          quantity: products.quantity,
          status: products.status,
          categoryId: products.categoryId,
          categoryName: categories.name,
          createdAt: products.createdAt,
        })
        .from(products)
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .where(and(...conditions))
        .orderBy(products.displayOrder, products.name)
        .limit(limit)
        .offset(offset)

      const [countResult] = await db
        .select({ total: sql<number>`COUNT(*)` })
        .from(products)
        .where(and(...conditions))

      const lines = rows.map(
        (p) =>
          `- **${p.name}** (${p.id})\n` +
          `  Prix: ${formatCurrency(p.price)}/${p.pricingMode} | Caution: ${formatCurrency(p.deposit ?? '0')} | Stock: ${p.quantity}\n` +
          `  Statut: ${p.status}${p.categoryName ? ` | Catégorie: ${p.categoryName}` : ''}`
      )

      const total = countResult?.total ?? 0
      return toolResult(
        `## Produits (${total} résultat${total > 1 ? 's' : ''})\n\n${lines.join('\n\n') || 'Aucun produit trouvé.'}`
      )
    }
  )

  // ── get_product ────────────────────────────────────────────────────────
  server.tool(
    'get_product',
    'Get detailed information about a specific product',
    {
      productId: z.string().describe('The product ID'),
    },
    async ({ productId }) => {
      requirePermission(ctx, 'products', 'read')

      const product = await db.query.products.findFirst({
        where: and(eq(products.storeId, ctx.storeId), eq(products.id, productId)),
        with: {
          category: true,
          pricingTiers: true,
          units: true,
        },
      })

      if (!product) return toolError('Produit non trouvé.')

      let text =
        `## ${product.name}\n\n` +
        `- **ID**: ${product.id}\n` +
        `- **Statut**: ${product.status}\n` +
        `- **Prix**: ${formatCurrency(product.price)}/${product.pricingMode}\n` +
        `- **Caution**: ${formatCurrency(product.deposit ?? '0')}\n` +
        `- **Stock**: ${product.quantity}\n` +
        `- **Catégorie**: ${product.category?.name ?? '—'}\n` +
        `- **Suivi des unités**: ${product.trackUnits ? 'Oui' : 'Non'}\n` +
        `- **Créé le**: ${formatDate(product.createdAt)}\n`

      if (product.description) {
        text += `\n### Description\n${product.description}\n`
      }

      if (product.pricingTiers.length > 0) {
        text += `\n### Paliers tarifaires\n`
        for (const tier of product.pricingTiers) {
          const duration = tier.minDuration ?? tier.period ?? '—'
          text += `- ${duration}+ durée: ${formatCurrency(tier.price ?? '0')}/${product.pricingMode}\n`
        }
      }

      if (product.units.length > 0) {
        text += `\n### Unités (${product.units.length})\n`
        for (const unit of product.units) {
          text += `- ${unit.identifier} — ${unit.status}\n`
        }
      }

      return toolResult(text)
    }
  )

  // ── create_product ─────────────────────────────────────────────────────
  server.tool(
    'create_product',
    'Create a new product in the catalog',
    {
      name: z.string().min(1).describe('Product name'),
      description: z.string().optional().describe('Product description'),
      price: z.string().describe('Price per period (e.g. "25.00")'),
      deposit: z.string().optional().describe('Deposit amount (e.g. "100.00")'),
      pricingMode: z.enum(['hour', 'day', 'week']).describe('Pricing period'),
      quantity: z.number().int().min(1).optional().describe('Stock quantity (default 1)'),
      categoryId: z.string().optional().describe('Category ID'),
    },
    async ({ name, description, price, deposit, pricingMode, quantity, categoryId }) => {
      requirePermission(ctx, 'products', 'write')

      const [created] = await db
        .insert(products)
        .values({
          storeId: ctx.storeId,
          name,
          description: description ?? null,
          price,
          deposit: deposit ?? '0',
          pricingMode,
          quantity: quantity ?? 1,
          categoryId: categoryId ?? null,
          status: 'active',
        })
        .$returningId()

      return toolResult(
        `Produit créé avec succès.\n\n` +
          `- **Nom**: ${name}\n` +
          `- **ID**: ${created.id}\n` +
          `- **Prix**: ${formatCurrency(price)}/${pricingMode}\n` +
          `- **Stock**: ${quantity ?? 1}`
      )
    }
  )

  // ── update_product ─────────────────────────────────────────────────────
  server.tool(
    'update_product',
    'Update an existing product',
    {
      productId: z.string().describe('The product ID to update'),
      name: z.string().optional().describe('New product name'),
      description: z.string().optional().describe('New description'),
      price: z.string().optional().describe('New price'),
      deposit: z.string().optional().describe('New deposit amount'),
      quantity: z.number().int().optional().describe('New stock quantity'),
      status: z.enum(['active', 'draft', 'archived']).optional().describe('New status'),
    },
    async ({ productId, ...updates }) => {
      requirePermission(ctx, 'products', 'write')

      // Verify product belongs to store
      const existing = await db.query.products.findFirst({
        where: and(eq(products.storeId, ctx.storeId), eq(products.id, productId)),
        columns: { id: true },
      })
      if (!existing) return toolError('Produit non trouvé.')

      const updateData: Record<string, unknown> = {}
      if (updates.name !== undefined) updateData.name = updates.name
      if (updates.description !== undefined) updateData.description = updates.description
      if (updates.price !== undefined) updateData.price = updates.price
      if (updates.deposit !== undefined) updateData.deposit = updates.deposit
      if (updates.quantity !== undefined) updateData.quantity = updates.quantity
      if (updates.status !== undefined) updateData.status = updates.status

      if (Object.keys(updateData).length === 0) {
        return toolError('Aucun champ à mettre à jour.')
      }

      await db.update(products).set(updateData).where(eq(products.id, productId))

      return toolResult(`Produit ${productId} mis à jour avec succès.`)
    }
  )

  // ── archive_product ────────────────────────────────────────────────────
  server.tool(
    'archive_product',
    'Archive a product (soft delete)',
    {
      productId: z.string().describe('The product ID to archive'),
    },
    async ({ productId }) => {
      requirePermission(ctx, 'products', 'write')

      const existing = await db.query.products.findFirst({
        where: and(eq(products.storeId, ctx.storeId), eq(products.id, productId)),
        columns: { id: true, name: true },
      })
      if (!existing) return toolError('Produit non trouvé.')

      await db.update(products).set({ status: 'archived' }).where(eq(products.id, productId))

      return toolResult(`Produit "${existing.name}" archivé avec succès.`)
    }
  )
}
