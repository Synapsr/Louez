import { db, stores } from '@louez/db'
import { eq } from 'drizzle-orm'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { McpSessionContext } from '../auth/context'
import { hasPermission } from '../auth/context'

export function registerStoreResources(server: McpServer, ctx: McpSessionContext) {
  server.resource(
    'store-info',
    'louez://store/info',
    { description: 'Current store information (name, contact, settings)', mimeType: 'text/plain' },
    async () => {
      if (!hasPermission(ctx, 'settings', 'read')) {
        return { contents: [{ uri: 'louez://store/info', text: 'Permission denied: requires settings:read' }] }
      }
      const store = await db.query.stores.findFirst({
        where: eq(stores.id, ctx.storeId),
        with: { members: true },
      })

      if (!store) return { contents: [{ uri: 'louez://store/info', text: 'Store not found.' }] }

      const text =
        `Store: ${store.name}\n` +
        `Slug: ${store.slug}\n` +
        `Email: ${store.email ?? '—'}\n` +
        `Phone: ${store.phone ?? '—'}\n` +
        `Address: ${store.address ?? '—'}\n` +
        `Members: ${store.members.length}\n` +
        `Reservation mode: ${store.settings?.reservationMode ?? '—'}\n` +
        `Stripe connected: ${store.stripeOnboardingComplete ? 'yes' : 'no'}\n` +
        `Created: ${store.createdAt.toISOString()}`

      return { contents: [{ uri: 'louez://store/info', text }] }
    }
  )

  server.resource(
    'store-settings',
    'louez://store/settings',
    { description: 'Complete store configuration', mimeType: 'application/json' },
    async () => {
      if (!hasPermission(ctx, 'settings', 'read')) {
        return { contents: [{ uri: 'louez://store/settings', text: '{"error":"Permission denied: requires settings:read"}' }] }
      }
      const store = await db.query.stores.findFirst({
        where: eq(stores.id, ctx.storeId),
        columns: {
          settings: true,
          theme: true,
          emailSettings: true,
          notificationSettings: true,
          customerNotificationSettings: true,
        },
      })

      return {
        contents: [{
          uri: 'louez://store/settings',
          text: JSON.stringify(store ?? {}, null, 2),
        }],
      }
    }
  )
}
