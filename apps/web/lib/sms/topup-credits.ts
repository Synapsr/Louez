import { db, smsCredits, smsTopupTransactions } from "@louez/db";
import { and, eq, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { collectUnpaidSmsCredits } from "./delivery-record";

/**
 * Credits an SMS top-up its Stripe checkout paid for, once.
 *
 * Stripe may deliver the same event twice, at once: the top-up row is locked
 * and read again in the transaction, so only the delivery that finds it
 * pending adds the credits and pays the debts (`collectUnpaidSmsCredits`);
 * the others change nothing. The payment intent is credited once across
 * top-ups too.
 *
 * Lock order of the SMS credits, everywhere: the top-up row, then the
 * store's credits row, then its SMS log rows (as `takePrepaidSmsCredit`
 * takes the credits, then the log row).
 */
export async function creditSmsTopup(paid: {
  transactionId: string;
  storeId: string;
  checkoutSessionId: string;
  paymentIntentId: string | null;
}): Promise<{ credited: number }> {
  return db.transaction(async (tx) => {
    const [topup] = await tx
      .select({
        storeId: smsTopupTransactions.storeId,
        quantity: smsTopupTransactions.quantity,
        status: smsTopupTransactions.status,
        stripeSessionId: smsTopupTransactions.stripeSessionId,
      })
      .from(smsTopupTransactions)
      .where(eq(smsTopupTransactions.id, paid.transactionId))
      .for("update");
    if (!topup || topup.status !== "pending") return { credited: 0 };
    // The checkout's metadata names the top-up: it must be this store's, and this session's.
    if (topup.storeId !== paid.storeId) return { credited: 0 };
    if (topup.stripeSessionId && topup.stripeSessionId !== paid.checkoutSessionId) {
      return { credited: 0 };
    }
    if (paid.paymentIntentId) {
      const [credited] = await tx
        .select({ id: smsTopupTransactions.id })
        .from(smsTopupTransactions)
        .where(
          and(
            eq(smsTopupTransactions.stripePaymentIntentId, paid.paymentIntentId),
            ne(smsTopupTransactions.id, paid.transactionId),
          ),
        )
        .limit(1);
      if (credited) return { credited: 0 };
    }

    // What the top-up row says was bought, never what the event's metadata says.
    const quantity = topup.quantity;
    const [existing] = await tx
      .select({ id: smsCredits.id })
      .from(smsCredits)
      .where(eq(smsCredits.storeId, topup.storeId))
      .for("update");
    if (existing) {
      await tx
        .update(smsCredits)
        .set({
          balance: sql`${smsCredits.balance} + ${quantity}`,
          totalPurchased: sql`${smsCredits.totalPurchased} + ${quantity}`,
          updatedAt: new Date(),
        })
        .where(eq(smsCredits.storeId, topup.storeId));
    } else {
      await tx.insert(smsCredits).values({
        id: nanoid(),
        storeId: topup.storeId,
        balance: quantity,
        totalPurchased: quantity,
        totalUsed: 0,
      });
    }
    // SMS sent while the balance was empty take their credits first.
    await collectUnpaidSmsCredits(tx, topup.storeId);

    await tx
      .update(smsTopupTransactions)
      .set({
        status: "completed",
        stripeSessionId: paid.checkoutSessionId,
        stripePaymentIntentId: paid.paymentIntentId,
        completedAt: new Date(),
      })
      .where(eq(smsTopupTransactions.id, paid.transactionId));
    return { credited: quantity };
  });
}
