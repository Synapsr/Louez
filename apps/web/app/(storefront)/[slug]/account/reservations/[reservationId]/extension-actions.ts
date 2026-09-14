"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, stores } from "@louez/db";
import { getCustomerSession } from "@/lib/customer-auth/session";
import {
  ExtensionError,
  loadExtensionReservation,
  parseExtensionEnd,
  quoteExtension,
} from "@/lib/reservations/extension-quote";
import { cancelExtension, startExtension } from "@/lib/reservations/extension-service";
import { log } from "@/lib/evlog";

const identitySchema = z.object({
  storeSlug: z.string().min(1).max(255),
  reservationId: z.string().length(21),
});
const periodSchema = identitySchema.extend({
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
});
const resolve = async (input: z.infer<typeof identitySchema>) => {
  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, input.storeSlug),
    columns: { id: true },
  });
  if (!store) throw new ExtensionError("notFound");
  const session = await getCustomerSession(store.id);
  if (!session) throw new ExtensionError("notFound");
  return { storeId: store.id, customerId: session.customerId };
};
const failed = (error: unknown) => {
  if (error instanceof ExtensionError) return { error: error.message };
  log.error("reservation.extension", error instanceof Error ? error.message : String(error));
  return { error: "unexpected" };
};
const refresh = (slug: string, id: string) => {
  revalidatePath(`/${slug}/account`);
  revalidatePath(`/${slug}/account/reservations/${id}`);
  revalidatePath(`/dashboard/reservations/${id}`);
};

export const previewRentalExtension = async (input: z.infer<typeof periodSchema>) => {
  try {
    const parsed = periodSchema.parse(input);
    const identity = await resolve(parsed);
    const preview = await db.transaction(
      async (tx) => {
        const reservation = await loadExtensionReservation(
          tx,
          identity.storeId,
          parsed.reservationId,
          identity.customerId,
        );
        const end = parseExtensionEnd(
          parsed.endDate,
          reservation.store.settings?.timezone ?? "UTC",
        );
        return (await quoteExtension(tx, reservation, end)).preview;
      },
      { isolationLevel: "read committed" },
    );
    return { preview };
  } catch (error) {
    return failed(error);
  }
};

export const confirmRentalExtension = async (
  input: z.infer<typeof periodSchema> & { expectedSupplement: number },
) => {
  try {
    const parsed = periodSchema
      .extend({ expectedSupplement: z.number().finite().nonnegative().max(99999999) })
      .parse(input);
    const identity = await resolve(parsed);
    const result = await startExtension({ ...identity, ...parsed });
    refresh(parsed.storeSlug, parsed.reservationId);
    return result;
  } catch (error) {
    return failed(error);
  }
};

export const cancelRentalExtension = async (
  input: z.infer<typeof identitySchema> & { extensionId: string },
) => {
  try {
    const parsed = identitySchema.extend({ extensionId: z.string().length(21) }).parse(input);
    const identity = await resolve(parsed);
    await cancelExtension(
      identity.storeId,
      parsed.reservationId,
      identity.customerId,
      parsed.extensionId,
    );
    refresh(parsed.storeSlug, parsed.reservationId);
    return { success: true };
  } catch (error) {
    return failed(error);
  }
};
