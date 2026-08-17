import { getMarketplaceBooking, ApiServiceError } from "@louez/api/services";
import { bookingReservationParamsSchema } from "@louez/validations";
import type { NextRequest } from "next/server";

import { bookingJson, bookingServiceError, verifyBookingGet } from "@/lib/booking-api-route";
import { useLogger, withEvlog } from "@/lib/evlog";
import { getCanonicalUrl } from "@/lib/seo";

const handleGet = async (
  request: NextRequest,
  context: RouteContext<"/api/booking/v1/bookings/[reservationId]">,
) => {
  const logger = useLogger();
  try {
    if (!(await verifyBookingGet(request))) {
      return bookingJson({ error: "Unauthorized" }, 401);
    }
    const parsed = bookingReservationParamsSchema.safeParse(await context.params);
    if (!parsed.success) {
      return bookingJson({ error: "errors.invalidData" }, 400);
    }

    return bookingJson(
      await getMarketplaceBooking({
        reservationId: parsed.data.reservationId,
        getCanonicalUrl,
      }),
    );
  } catch (error) {
    if (error instanceof ApiServiceError) return bookingServiceError(error);
    logger.error(
      error instanceof Error ? error : new Error("Marketplace booking detail request failed"),
    );
    return bookingJson({ error: "errors.internalServerError" }, 500);
  }
};

export const GET = withEvlog(handleGet);
