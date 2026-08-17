import { holdMarketplaceBooking, ApiServiceError } from "@louez/api/services";
import { bookingHoldInputSchema } from "@louez/validations";
import type { NextRequest } from "next/server";

import { bookingJson, bookingServiceError, readBookingPost } from "@/lib/booking-api-route";
import { useLogger, withEvlog } from "@/lib/evlog";
import { marketplaceHoldAdapter } from "@/lib/marketplace-booking";

const handlePost = async (request: NextRequest) => {
  const logger = useLogger();
  try {
    const parsed = await readBookingPost(request, bookingHoldInputSchema);
    if (!parsed.success) return parsed.response;

    return bookingJson(
      await holdMarketplaceBooking({
        input: parsed.data,
        secret: parsed.secret,
        adapter: marketplaceHoldAdapter,
      }),
    );
  } catch (error) {
    if (error instanceof ApiServiceError) return bookingServiceError(error);
    logger.error(error instanceof Error ? error : new Error("Marketplace hold request failed"));
    return bookingJson({ error: "errors.internalServerError" }, 500);
  }
};

export const POST = withEvlog(handlePost);
