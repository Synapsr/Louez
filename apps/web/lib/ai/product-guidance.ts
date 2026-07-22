import { and, eq, isNotNull } from 'drizzle-orm'

import { db, products } from '@louez/db'

// Bounds for the owner guidance injected into an AI system prompt.
const GUIDANCE_MAX_PER_PRODUCT = 600
const GUIDANCE_MAX_TOTAL = 15_000

/**
 * Per-product owner guidance (products.aiContext) formatted for a system prompt.
 * This is the ONLY channel through which aiContext reaches a model — tool
 * outputs are streamed to the customer and must never contain it. Shared by the
 * storefront advisor and the phone receptionist so both honor the same guidance.
 */
export async function buildProductGuidance(
  storeId: string,
): Promise<string | null> {
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      aiContext: products.aiContext,
    })
    .from(products)
    .where(
      and(
        eq(products.storeId, storeId),
        eq(products.status, 'active'),
        isNotNull(products.aiContext),
      ),
    )
    .limit(100)

  const lines: string[] = []
  let total = 0
  for (const row of rows) {
    const guidance = row.aiContext?.trim()
    if (!guidance) continue
    const line = `- "${row.name}" (productId: ${row.id}): ${guidance.slice(0, GUIDANCE_MAX_PER_PRODUCT)}`
    if (total + line.length > GUIDANCE_MAX_TOTAL) break
    lines.push(line)
    total += line.length
  }

  return lines.length > 0 ? lines.join('\n') : null
}
