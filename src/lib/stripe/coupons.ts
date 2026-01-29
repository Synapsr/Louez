import { stripe } from './client'

interface CreateStoreCouponOptions {
  storeId: string
  percentOff: number
  durationMonths: number // 0 = forever/permanent
}

/**
 * Creates a Stripe coupon for a store's subscription discount.
 *
 * @param options.storeId - The store ID for tracking
 * @param options.percentOff - Discount percentage (1-100)
 * @param options.durationMonths - Duration in months (0 = forever/permanent)
 * @returns The created Stripe coupon ID
 */
export async function createStoreCoupon({
  storeId,
  percentOff,
  durationMonths,
}: CreateStoreCouponOptions): Promise<string> {
  const coupon = await stripe.coupons.create({
    percent_off: percentOff,
    duration: durationMonths === 0 ? 'forever' : 'repeating',
    ...(durationMonths > 0 && { duration_in_months: durationMonths }),
    metadata: {
      storeId,
      type: 'platform_admin_discount',
    },
    // Generate a unique ID for tracking and avoiding duplicates
    id: `store_${storeId}_${Date.now()}`,
  })

  return coupon.id
}

/**
 * Retrieves details of a Stripe coupon.
 *
 * @param couponId - The Stripe coupon ID
 * @returns The coupon object or null if not found
 */
export async function getCouponDetails(couponId: string) {
  try {
    return await stripe.coupons.retrieve(couponId)
  } catch {
    return null
  }
}
