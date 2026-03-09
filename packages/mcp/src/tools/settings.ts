import { z } from 'zod'
import { db, stores } from '@louez/db'
import { eq } from 'drizzle-orm'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { McpSessionContext } from '../auth/context'
import { requirePermission } from '../auth/context'
import { toolError, toolResult } from '../utils/errors'

export function registerSettingsTools(server: McpServer, ctx: McpSessionContext) {
  server.tool(
    'get_store_settings',
    'Get complete store configuration (name, contact, settings)',
    {},
    async () => {
      requirePermission(ctx, 'settings', 'read')

      const store = await db.query.stores.findFirst({
        where: eq(stores.id, ctx.storeId),
      })

      if (!store) return toolError('Store not found.')

      return toolResult(
        `## ${store.name}\n\n` +
          `- **Slug**: ${store.slug}\n` +
          `- **Email**: ${store.email ?? '—'}\n` +
          `- **Phone**: ${store.phone ?? '—'}\n` +
          `- **Address**: ${store.address ?? '—'}\n` +
          (store.description ? `- **Description**: ${store.description}\n` : '') +
          `\n### Configuration\n` +
          `- Reservation mode: ${store.settings?.reservationMode ?? '—'}\n` +
          `- Advance notice: ${store.settings?.advanceNoticeMinutes ? `${store.settings.advanceNoticeMinutes} min` : '—'}\n` +
          `- Stripe connected: ${store.stripeOnboardingComplete ? 'Yes' : 'No'}\n` +
          `\n### Appearance\n` +
          `- Theme: ${store.theme?.mode ?? 'light'}\n` +
          `- Primary color: ${store.theme?.primaryColor ?? '#0066FF'}\n` +
          `\n### Notifications\n` +
          `- Confirmation email: ${store.emailSettings?.confirmationEnabled ? 'Enabled' : 'Disabled'}\n` +
          `- Pickup reminder: ${store.emailSettings?.reminderPickupEnabled ? 'Enabled' : 'Disabled'}\n` +
          `- Return reminder: ${store.emailSettings?.reminderReturnEnabled ? 'Enabled' : 'Disabled'}`
      )
    }
  )

  server.tool(
    'update_store_info',
    'Update store contact information',
    {
      name: z.string().optional().describe('Store name'),
      email: z.string().email().optional().describe('Contact email'),
      phone: z.string().optional().describe('Phone number'),
      address: z.string().optional().describe('Physical address'),
      description: z.string().optional().describe('Store description'),
    },
    async (updates) => {
      requirePermission(ctx, 'settings', 'write')

      const updateData: Record<string, unknown> = {}
      if (updates.name !== undefined) updateData.name = updates.name
      if (updates.email !== undefined) updateData.email = updates.email
      if (updates.phone !== undefined) updateData.phone = updates.phone
      if (updates.address !== undefined) updateData.address = updates.address
      if (updates.description !== undefined) updateData.description = updates.description

      if (Object.keys(updateData).length === 0) {
        return toolError('No fields to update.')
      }

      await db.update(stores).set(updateData).where(eq(stores.id, ctx.storeId))

      return toolResult('Store information updated successfully.')
    }
  )

  server.tool(
    'update_store_legal',
    'Update legal documents (terms of service, legal notice)',
    {
      cgv: z.string().optional().describe('General terms and conditions (HTML or text)'),
      legalNotice: z.string().optional().describe('Legal notice text'),
      includeCgvInContract: z.boolean().optional().describe('Include terms in rental contracts'),
    },
    async (updates) => {
      requirePermission(ctx, 'settings', 'write')

      const updateData: Record<string, unknown> = {}
      if (updates.cgv !== undefined) updateData.cgv = updates.cgv
      if (updates.legalNotice !== undefined) updateData.legalNotice = updates.legalNotice
      if (updates.includeCgvInContract !== undefined)
        updateData.includeCgvInContract = updates.includeCgvInContract

      if (Object.keys(updateData).length === 0) {
        return toolError('No fields to update.')
      }

      await db.update(stores).set(updateData).where(eq(stores.id, ctx.storeId))

      return toolResult('Legal documents updated successfully.')
    }
  )
}
