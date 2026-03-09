import { z } from 'zod'
import { db, categories } from '@louez/db'
import { and, eq, sql } from 'drizzle-orm'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { McpSessionContext } from '../auth/context'
import { requirePermission } from '../auth/context'
import { toolError, toolResult } from '../utils/errors'

export function registerCategoryTools(server: McpServer, ctx: McpSessionContext) {
  server.tool(
    'list_categories',
    'List all product categories',
    {},
    async () => {
      requirePermission(ctx, 'categories', 'read')

      const rows = await db.query.categories.findMany({
        where: eq(categories.storeId, ctx.storeId),
        with: { products: { columns: { id: true } } },
        orderBy: [categories.order, categories.name],
      })

      if (rows.length === 0) return toolResult('Aucune catégorie trouvée.')

      const lines = rows.map(
        (c) => `- **${c.name}** (${c.id}) — ${c.products.length} produit(s)${c.description ? `\n  ${c.description}` : ''}`
      )

      return toolResult(`## Catégories (${rows.length})\n\n${lines.join('\n')}`)
    }
  )

  server.tool(
    'create_category',
    'Create a new product category',
    {
      name: z.string().min(1).describe('Category name'),
      description: z.string().optional().describe('Category description'),
    },
    async ({ name, description }) => {
      requirePermission(ctx, 'categories', 'write')

      const [created] = await db
        .insert(categories)
        .values({
          storeId: ctx.storeId,
          name,
          description: description ?? null,
        })
        .$returningId()

      return toolResult(`Catégorie "${name}" créée avec succès (ID: ${created.id}).`)
    }
  )

  server.tool(
    'update_category',
    'Update an existing category',
    {
      categoryId: z.string().describe('The category ID'),
      name: z.string().optional().describe('New name'),
      description: z.string().optional().describe('New description'),
    },
    async ({ categoryId, name, description }) => {
      requirePermission(ctx, 'categories', 'write')

      const existing = await db.query.categories.findFirst({
        where: and(eq(categories.storeId, ctx.storeId), eq(categories.id, categoryId)),
        columns: { id: true },
      })
      if (!existing) return toolError('Catégorie non trouvée.')

      const updateData: Record<string, unknown> = {}
      if (name !== undefined) updateData.name = name
      if (description !== undefined) updateData.description = description

      if (Object.keys(updateData).length === 0) {
        return toolError('Aucun champ à mettre à jour.')
      }

      await db.update(categories).set(updateData).where(eq(categories.id, categoryId))

      return toolResult(`Catégorie ${categoryId} mise à jour avec succès.`)
    }
  )

  server.tool(
    'delete_category',
    'Delete a category (products will be unassigned)',
    {
      categoryId: z.string().describe('The category ID to delete'),
    },
    async ({ categoryId }) => {
      requirePermission(ctx, 'categories', 'write')

      const existing = await db.query.categories.findFirst({
        where: and(eq(categories.storeId, ctx.storeId), eq(categories.id, categoryId)),
        columns: { id: true, name: true },
      })
      if (!existing) return toolError('Catégorie non trouvée.')

      await db.delete(categories).where(eq(categories.id, categoryId))

      return toolResult(`Catégorie "${existing.name}" supprimée.`)
    }
  )
}
