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

      if (!store) return toolError('Boutique non trouvée.')

      return toolResult(
        `## ${store.name}\n\n` +
          `- **Slug**: ${store.slug}\n` +
          `- **Email**: ${store.email ?? '—'}\n` +
          `- **Téléphone**: ${store.phone ?? '—'}\n` +
          `- **Adresse**: ${store.address ?? '—'}\n` +
          (store.description ? `- **Description**: ${store.description}\n` : '') +
          `\n### Configuration\n` +
          `- Mode de réservation: ${store.settings?.reservationMode ?? '—'}\n` +
          `- Préavis minimum: ${store.settings?.advanceNoticeMinutes ? `${store.settings.advanceNoticeMinutes} min` : '—'}\n` +
          `- Stripe connecté: ${store.stripeOnboardingComplete ? 'Oui' : 'Non'}\n` +
          `\n### Apparence\n` +
          `- Thème: ${store.theme?.mode ?? 'light'}\n` +
          `- Couleur primaire: ${store.theme?.primaryColor ?? '#0066FF'}\n` +
          `\n### Notifications\n` +
          `- Email de confirmation: ${store.emailSettings?.confirmationEnabled ? 'Activé' : 'Désactivé'}\n` +
          `- Rappel récupération: ${store.emailSettings?.reminderPickupEnabled ? 'Activé' : 'Désactivé'}\n` +
          `- Rappel retour: ${store.emailSettings?.reminderReturnEnabled ? 'Activé' : 'Désactivé'}`
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
        return toolError('Aucun champ à mettre à jour.')
      }

      await db.update(stores).set(updateData).where(eq(stores.id, ctx.storeId))

      return toolResult('Informations de la boutique mises à jour avec succès.')
    }
  )

  server.tool(
    'update_store_legal',
    'Update legal documents (CGV, legal notice)',
    {
      cgv: z.string().optional().describe('General terms and conditions (HTML or text)'),
      legalNotice: z.string().optional().describe('Legal notice text'),
      includeCgvInContract: z.boolean().optional().describe('Include CGV in rental contracts'),
    },
    async (updates) => {
      requirePermission(ctx, 'settings', 'write')

      const updateData: Record<string, unknown> = {}
      if (updates.cgv !== undefined) updateData.cgv = updates.cgv
      if (updates.legalNotice !== undefined) updateData.legalNotice = updates.legalNotice
      if (updates.includeCgvInContract !== undefined)
        updateData.includeCgvInContract = updates.includeCgvInContract

      if (Object.keys(updateData).length === 0) {
        return toolError('Aucun champ à mettre à jour.')
      }

      await db.update(stores).set(updateData).where(eq(stores.id, ctx.storeId))

      return toolResult('Documents légaux mis à jour avec succès.')
    }
  )
}
