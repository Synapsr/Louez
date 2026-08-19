import { cancelMarketplaceBooking, ApiServiceError } from "@louez/api/services";
import { bookingCancelInputSchema, bookingReservationParamsSchema } from "@louez/validations";
import type { NextRequest } from "next/server";

import { env } from "@/env";
import { bookingJson, bookingServiceError, readBookingPost } from "@/lib/booking-api-route";
import { useLogger, withEvlog } from "@/lib/evlog";
import { marketplaceCancellationAdapter } from "@/lib/marketplace-booking";
import { getCanonicalUrl } from "@/lib/seo";

const handlePost = async (
  request: NextRequest,
  context: RouteContext<"/api/booking/v1/bookings/[reservationId]/cancel">,
) => {
  const logger = useLogger();
  try {
    const [body, routeParams] = await Promise.all([
      readBookingPost(request, bookingCancelInputSchema),
      context.params,
    ]);
    if (!body.success) return body.response;
    const parsedParams = bookingReservationParamsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      return bookingJson({ error: "errors.invalidData" }, 400);
    }

    return bookingJson(
      await cancelMarketplaceBooking({
        reservationId: parsedParams.data.reservationId,
        getCanonicalUrl,
        mediaBaseUrl: env.NEXT_PUBLIC_APP_URL,
        adapter: marketplaceCancellationAdapter,
      }),
    );
  } catch (error) {
    if (error instanceof ApiServiceError) return bookingServiceError(error);
    logger.error(
      error instanceof Error ? error : new Error("Marketplace booking cancellation failed"),
    );
    return bookingJson({ error: "errors.internalServerError" }, 500);
  }
};

export const POST = withEvlog(handlePost);
