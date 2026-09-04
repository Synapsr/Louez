import { ApiServiceError, getMarketplaceReservationContext } from "@louez/api/services";
import { db, verificationCodes } from "@louez/db";
import { bookingAccessLinkInputSchema, bookingReservationParamsSchema } from "@louez/validations";
import { nanoid } from "nanoid";
import type { NextRequest } from "next/server";

import { bookingJson, bookingServiceError, readBookingPost } from "@/lib/booking-api-route";
import { useLogger, withEvlog } from "@/lib/evlog";
import { getStorefrontUrl } from "@/lib/storefront-url";

// Links are minted on demand per click on the marketplace, so they can stay far
// shorter-lived than the 30-day links the dashboard emails to customers.
const ACCESS_LINK_TTL_MS = 24 * 60 * 60 * 1000;

const handlePost = async (
  request: NextRequest,
  context: { params: Promise<{ reservationId: string }> },
) => {
  const logger = useLogger();
  try {
    const body = await readBookingPost(request, bookingAccessLinkInputSchema);
    if (!body.success) return body.response;
    const params = bookingReservationParamsSchema.safeParse(await context.params);
    if (!params.success) {
      return bookingJson({ error: "errors.invalidData" }, 400);
    }

    const reservation = await getMarketplaceReservationContext(params.data.reservationId);

    const token = nanoid(64);
    const expiresAt = new Date(Date.now() + ACCESS_LINK_TTL_MS);
    await db.insert(verificationCodes).values({
      id: nanoid(),
      email: reservation.customerEmail,
      storeId: reservation.storeId,
      code: "",
      type: "instant_access",
      token,
      reservationId: reservation.id,
      expiresAt,
      createdAt: new Date(),
    });

    const redirectPath =
      body.data.target === "contract"
        ? `/account/reservations/${reservation.id}/contract`
        : `/account/reservations/${reservation.id}`;
    const url = getStorefrontUrl(
      reservation.storeSlug,
      `/r/${reservation.id}?token=${token}&redirect=${encodeURIComponent(redirectPath)}`,
    );

    return bookingJson({ url, expiresAt: expiresAt.toISOString() });
  } catch (error) {
    if (error instanceof ApiServiceError) return bookingServiceError(error);
    logger.error(
      error instanceof Error ? error : new Error("Marketplace booking access-link request failed"),
    );
    return bookingJson({ error: "errors.internalServerError" }, 500);
  }
};

export const POST = withEvlog(handlePost);
