import { tool } from 'ai'
import { and, eq, inArray, like } from 'drizzle-orm'
import { z } from 'zod'

import {
  ApiServiceError,
  getStorefrontAvailability,
} from '@louez/api/services'
import {
  aiAdvisorConversations,
  categories,
  db,
  effectiveProductQuantitySql,
  products,
  stores,
} from '@louez/db'
import type { AdvisorCartSnapshot } from '@louez/validations'

export type AdvisorChatContext = {
  storeId: string
  storeSlug: string
  conversationId: string
  /** Cart snapshot sent by the widget with the current request. */
  cart: AdvisorCartSnapshot | null
}

/** Public product fields the advisor may see and discuss. */
const advisorProductColumns = {
  id: products.id,
  name: products.name,
  description: products.description,
  aiContext: products.aiContext,
  price: products.price,
  deposit: products.deposit,
  pricingMode: products.pricingMode,
} as const

/**
 * Customer-facing advisor tools. All read-only over PUBLIC catalog data
 * (active products only, no customer/reservation/payment access, no unit
 * identifiers). The one write, record_qualification, targets the advisor's
 * own conversation row.
 */
export function createAdvisorTools(ctx: AdvisorChatContext) {
  return {
    list_products: tool({
      description:
        'List the store catalog (active products only). Each product may carry owner guidance in aiContext — always honor it when advising.',
      inputSchema: z.object({
        search: z.string().optional().describe('Search by product name'),
        categoryId: z.string().optional().describe('Filter by category ID'),
      }),
      execute: async ({ search, categoryId }) => {
        const conditions = [
          eq(products.storeId, ctx.storeId),
          eq(products.status, 'active'),
        ]
        if (categoryId) conditions.push(eq(products.categoryId, categoryId))
        if (search) conditions.push(like(products.name, `%${search}%`))

        const rows = await db
          .select({
            ...advisorProductColumns,
            quantity: effectiveProductQuantitySql(),
            categoryName: categories.name,
          })
          .from(products)
          .leftJoin(categories, eq(products.categoryId, categories.id))
          .where(and(...conditions))
          .orderBy(products.displayOrder, products.name)
          .limit(50)

        return { products: rows }
      },
    }),

    get_product: tool({
      description:
        'Get details of one product: description, owner guidance (aiContext), pricing tiers, options.',
      inputSchema: z.object({
        productId: z.string().describe('The product ID'),
      }),
      execute: async ({ productId }) => {
        const product = await db.query.products.findFirst({
          where: and(
            eq(products.storeId, ctx.storeId),
            eq(products.id, productId),
            eq(products.status, 'active'),
          ),
          columns: {
            id: true,
            name: true,
            description: true,
            aiContext: true,
            price: true,
            deposit: true,
            pricingMode: true,
            quantity: true,
            trackUnits: true,
            bookingAttributeAxes: true,
          },
          with: {
            category: { columns: { id: true, name: true } },
            pricingTiers: {
              columns: {
                minDuration: true,
                period: true,
                discountPercent: true,
                price: true,
              },
            },
            units: { columns: { lifecycleStatus: true } },
          },
        })

        if (!product) return { error: 'Product not found' }

        const { units, ...publicProduct } = product
        const effectiveQuantity = product.trackUnits
          ? units.filter((unit) => unit.lifecycleStatus === 'active').length
          : product.quantity

        return { product: { ...publicProduct, quantity: effectiveQuantity } }
      },
    }),

    check_availability: tool({
      description:
        'Check whether a product is available for a rental period. Also validates the store business hours for that period.',
      inputSchema: z.object({
        productId: z.string().describe('The product ID'),
        startDate: z.string().describe('Rental start (ISO 8601 datetime)'),
        endDate: z.string().describe('Rental end (ISO 8601 datetime)'),
      }),
      execute: async ({ productId, startDate, endDate }) => {
        try {
          const availability = await getStorefrontAvailability({
            storeSlug: ctx.storeSlug,
            startDate,
            endDate,
            productIds: [productId],
          })

          const product = availability.products.find(
            (entry) => entry.productId === productId,
          )
          if (!product) return { error: 'Product not found' }

          return {
            availableQuantity: product.availableQuantity,
            status: product.status,
            businessHoursValidation: availability.businessHoursValidation,
            advanceNoticeValidation: availability.advanceNoticeValidation,
          }
        } catch (error) {
          if (error instanceof ApiServiceError) return { error: error.key }
          throw error
        }
      },
    }),

    get_store_info: tool({
      description:
        'Get public store information: contact, address, business hours, delivery options.',
      inputSchema: z.object({}),
      execute: async () => {
        const store = await db.query.stores.findFirst({
          where: eq(stores.id, ctx.storeId),
          columns: {
            name: true,
            description: true,
            email: true,
            phone: true,
            address: true,
            settings: true,
          },
        })
        if (!store) return { error: 'Store not found' }

        return {
          name: store.name,
          description: store.description,
          email: store.email,
          phone: store.phone,
          address: store.address,
          timezone: store.settings?.timezone,
          currency: store.settings?.currency,
          businessHours: store.settings?.businessHours,
          delivery: store.settings?.delivery,
        }
      },
    }),

    recommend_products: tool({
      description:
        'Present up to 6 products to the customer as visual cards. Use it whenever you suggest products, AFTER verifying they fit the customer needs and constraints.',
      inputSchema: z.object({
        productIds: z
          .array(z.string())
          .min(1)
          .max(6)
          .describe('IDs of the products to present'),
        reason: z
          .string()
          .max(300)
          .describe('One short sentence, in the customer language, saying why these fit'),
      }),
      execute: async ({ productIds, reason }) => {
        const rows = await db
          .select({
            ...advisorProductColumns,
            images: products.images,
          })
          .from(products)
          .where(
            and(
              eq(products.storeId, ctx.storeId),
              eq(products.status, 'active'),
              inArray(products.id, productIds),
            ),
          )
          .limit(6)

        return {
          reason,
          products: rows.map((row) => ({
            id: row.id,
            name: row.name,
            price: row.price,
            deposit: row.deposit,
            pricingMode: row.pricingMode,
            image: row.images?.[0] ?? null,
          })),
        }
      },
    }),

    record_qualification: tool({
      description:
        'Record the facts you verified about the customer (e.g. vehicle model, licence type, event size) so the store owner can see them. Call it as soon as you learn a relevant fact. Set ready=true ONLY once every owner requirement is verified for EVERY product in the cart — this validates the reservation.',
      inputSchema: z.object({
        facts: z
          .record(z.string(), z.string())
          .describe('Verified facts as short key/value pairs, in the customer language'),
        summary: z
          .string()
          .max(500)
          .describe('One-sentence summary of the qualification so far'),
        ready: z
          .boolean()
          .describe('true only when all requirements are verified for the whole cart'),
      }),
      execute: async ({ facts, summary, ready }) => {
        const conversation = await db.query.aiAdvisorConversations.findFirst({
          where: and(
            eq(aiAdvisorConversations.id, ctx.conversationId),
            eq(aiAdvisorConversations.storeId, ctx.storeId),
          ),
          columns: { collectedData: true },
        })
        if (!conversation) return { error: 'Conversation not found' }

        // The validated product list is derived server-side from the request
        // cart — never from model arguments (anti-bypass).
        const cartProductIds = ctx.cart?.items.map((item) => item.productId) ?? []

        await db
          .update(aiAdvisorConversations)
          .set({
            collectedData: {
              ...conversation.collectedData,
              ...facts,
              summary,
            },
            ...(ready
              ? {
                  validatedAt: new Date(),
                  validatedProductIds: cartProductIds,
                }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(aiAdvisorConversations.id, ctx.conversationId))

        return { saved: true, validated: ready }
      },
    }),

    // Client-executed tool: no `execute` here — the widget handles it via
    // onToolCall (it owns the cart state) and reports the outcome back.
    add_to_cart: tool({
      description:
        'Add a product to the customer cart. Use ONLY after the customer confirmed the product, the rental dates are known, and check_availability succeeded for those dates. The result tells you whether it worked.',
      inputSchema: z.object({
        productId: z.string().describe('The product ID'),
        quantity: z.number().int().min(1).max(999).describe('Quantity to add'),
        startDate: z.string().describe('Rental start (ISO 8601 datetime)'),
        endDate: z.string().describe('Rental end (ISO 8601 datetime)'),
      }),
    }),
  }
}
