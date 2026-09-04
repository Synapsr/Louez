import { ApiServiceError, availabilityMarketplaceBooking } from "@louez/api/services";
import { bookingAvailabilityInputSchema } from "@louez/validations";
import type { NextRequest } from "next/server";

import { bookingJson, bookingServiceError, readBookingPost } from "@/lib/booking-api-route";
import { useLogger, withEvlog } from "@/lib/evlog";

const handlePost = async (request: NextRequest) => {
  const logger = useLogger();
  try {
    const parsed = await readBookingPost(request, bookingAvailabilityInputSchema);
    if (!parsed.success) return parsed.response;

    return bookingJson(await availabilityMarketplaceBooking({ input: parsed.data }));
  } catch (error) {
    if (error instanceof ApiServiceError) return bookingServiceError(error);
    logger.error(
      error instanceof Error ? error : new Error("Marketplace availability request failed"),
    );
    return bookingJson({ error: "errors.internalServerError" }, 500);
  }
};

export const POST = withEvlog(handlePost);
