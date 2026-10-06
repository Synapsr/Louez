import { config } from "dotenv";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { validateStripePaymentAmount } from "@louez/utils";

const optionsSchema = z.object({
  storeId: z.string().length(21),
  reservationIds: z.array(z.string().length(21)).min(1),
  apply: z.boolean(),
});

const main = async (): Promise<void> => {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const value = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
  };
  const options = optionsSchema.parse({
    storeId: value("--store-id"),
    reservationIds: value("--reservation-ids")?.split(","),
    apply: args.includes("--apply"),
  });
  config({ path: value("--env-file") ?? ".env", quiet: true });
  const { db, cancelFailedCheckoutReservation, payments, reservations, stores } =
    await import("@louez/db");
  const { env } = await import("@louez/db/env");
  const target = new URL(env.DATABASE_URL);
  console.log(
    JSON.stringify({
      target: `${target.hostname}:${target.port || "3306"}${target.pathname}`,
      apply: options.apply,
    }),
  );

  const candidates = await db
    .select({
      id: reservations.id,
      number: reservations.number,
      totalAmount: reservations.totalAmount,
      settings: stores.settings,
    })
    .from(reservations)
    .innerJoin(stores, eq(stores.id, reservations.storeId))
    .where(
      and(
        eq(reservations.storeId, options.storeId),
        inArray(reservations.id, options.reservationIds),
        eq(reservations.status, "pending"),
        eq(reservations.source, "online"),
        eq(stores.stripeChargesEnabled, true),
      ),
    );
  for (const candidate of candidates) {
    if (candidate.settings?.reservationMode !== "payment") continue;
    const currency = candidate.settings.currency ?? "EUR";
    const amount = validateStripePaymentAmount(Number(candidate.totalAmount), currency);
    if (amount.ok || amount.error !== "errors.paymentAmountTooSmall") continue;
    const payment = await db.query.payments.findFirst({
      columns: { id: true },
      where: eq(payments.reservationId, candidate.id),
    });
    if (payment) continue;
    const cancelled = options.apply
      ? await cancelFailedCheckoutReservation({
          storeId: options.storeId,
          reservationId: candidate.id,
          expectedAmount: candidate.totalAmount,
          reason: "amount_too_small",
          ...amount.params,
        })
      : false;
    console.log(
      JSON.stringify({
        number: candidate.number,
        amount: candidate.totalAmount,
        ...amount.params,
        cancelled,
      }),
    );
  }
  console.log(JSON.stringify({ inspected: candidates.length }));
};

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    // Avoid printing a driver error object that may include the connection URL.
    console.error(error instanceof Error ? error.message : "Cleanup failed");
    process.exit(1);
  });
