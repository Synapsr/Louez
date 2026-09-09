import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, stores } from "@louez/db";
import { getCustomerSession } from "@/lib/customer-auth/session";
import { stripe } from "@/lib/stripe/client";
import { completeExtensionPayment } from "@/lib/reservations/extension-service";
import { loadExtensionReservation } from "@/lib/reservations/extension-quote";
import { getStorefrontUrl } from "@/lib/storefront-url";
import { log } from "@/lib/evlog";

export const GET = async (
  request: Request,
  { params }: { params: Promise<{ slug: string; reservationId: string }> },
) => {
  const { slug, reservationId } = await params;
  const sessionId = z
    .string()
    .regex(/^cs_[a-zA-Z0-9_]+$/)
    .safeParse(new URL(request.url).searchParams.get("session_id"));
  if (!sessionId.success || reservationId.length !== 21)
    return new NextResponse(null, { status: 400 });
  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, slug),
    columns: { id: true, stripeAccountId: true },
  });
  if (!store?.stripeAccountId) return new NextResponse(null, { status: 404 });
  const customer = await getCustomerSession(store.id);
  if (!customer) return NextResponse.redirect(getStorefrontUrl(slug, "/account/login"));
  const destination = getStorefrontUrl(slug, `/account/reservations/${reservationId}`);
  try {
    await db.transaction((tx) =>
      loadExtensionReservation(tx, store.id, reservationId, customer.customerId),
    );
    const session = await stripe.checkout.sessions.retrieve(sessionId.data, {
      stripeAccount: store.stripeAccountId,
    });
    if (session.metadata?.reservationId !== reservationId || !session.metadata.extensionId)
      return new NextResponse(null, { status: 404 });
    await completeExtensionPayment(session, store.stripeAccountId);
  } catch (error) {
    log.error(
      "reservation.extension.return",
      error instanceof Error ? error.message : String(error),
    );
  }
  return NextResponse.redirect(destination);
};
