import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'

import { db, payments, reservations } from '@louez/db'

interface ClaimCompletedCheckoutPaymentParams {
  reservationId: string
  amount: number
  currency: string
  stripeCheckoutSessionId: string
  stripePaymentIntentId: string | null
  stripeChargeId: string | null
  stripePaymentMethodId: string | null
  paidAt: Date
}

export async function claimCompletedCheckoutPayment(
  params: ClaimCompletedCheckoutPaymentParams,
): Promise<{ paymentId: string; claimed: boolean }> {
  return db.transaction(async (tx) => {
    // The reservation lock serializes the success page and webhook before
    // either can claim payment effects for this checkout.
    const [lockedReservation] = await tx
      .select({ id: reservations.id })
      .from(reservations)
      .where(eq(reservations.id, params.reservationId))
      .for('update')

    if (!lockedReservation) {
      throw new Error('Reservation not found while completing checkout payment')
    }

    const [existingPayment] = await tx
      .select({ id: payments.id, status: payments.status })
      .from(payments)
      .where(
        and(
          eq(payments.reservationId, params.reservationId),
          eq(payments.stripeCheckoutSessionId, params.stripeCheckoutSessionId),
        ),
      )
      .limit(1)
      .for('update')

    if (existingPayment) {
      if (existingPayment.status === 'completed') {
        return { paymentId: existingPayment.id, claimed: false }
      }

      await tx
        .update(payments)
        .set({
          status: 'completed',
          stripePaymentIntentId: params.stripePaymentIntentId,
          stripeChargeId: params.stripeChargeId,
          stripePaymentMethodId: params.stripePaymentMethodId,
          paidAt: params.paidAt,
          updatedAt: new Date(),
        })
        .where(eq(payments.id, existingPayment.id))

      return {
        paymentId: existingPayment.id,
        claimed: true,
      }
    }

    const paymentId = nanoid()
    await tx.insert(payments).values({
      id: paymentId,
      reservationId: params.reservationId,
      amount: params.amount.toFixed(2),
      type: 'rental',
      method: 'stripe',
      status: 'completed',
      stripePaymentIntentId: params.stripePaymentIntentId,
      stripeChargeId: params.stripeChargeId,
      stripeCheckoutSessionId: params.stripeCheckoutSessionId,
      stripePaymentMethodId: params.stripePaymentMethodId,
      currency: params.currency,
      paidAt: params.paidAt,
      createdAt: params.paidAt,
      updatedAt: new Date(),
    })

    return { paymentId, claimed: true }
  })
}
