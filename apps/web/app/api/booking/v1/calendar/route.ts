import { ApiServiceError, calendarMarketplaceBooking } from "@louez/api/services";
import { bookingCalendarInputSchema } from "@louez/validations";
import type { NextRequest } from "next/server";

import { bookingJson, bookingServiceError, readBookingPost } from "@/lib/booking-api-route";
import { useLogger, withEvlog } from "@/lib/evlog";

const handlePost = async (request: NextRequest) => {
  const logger = useLogger();
  try {
    const parsed = await readBookingPost(request, bookingCalendarInputSchema);
    if (!parsed.success) return parsed.response;

    return bookingJson(await calendarMarketplaceBooking({ input: parsed.data }));
  } catch (error) {
    if (error instanceof ApiServiceError) return bookingServiceError(error);
    logger.error(error instanceof Error ? error : new Error("Marketplace calendar request failed"));
    return bookingJson({ error: "errors.internalServerError" }, 500);
  }
};

export const POST = withEvlog(handlePost);
