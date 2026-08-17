import { checkoutMarketplaceBooking, ApiServiceError } from "@louez/api/services";
import { bookingCheckoutInputSchema } from "@louez/validations";
import type { NextRequest } from "next/server";

import { bookingJson, bookingServiceError, readBookingPost } from "@/lib/booking-api-route";
import { useLogger, withEvlog } from "@/lib/evlog";
import { marketplaceCheckoutAdapter } from "@/lib/marketplace-booking";

const handlePost = async (request: NextRequest) => {
  const logger = useLogger();
  try {
    const parsed = await readBookingPost(request, bookingCheckoutInputSchema);
    if (!parsed.success) return parsed.response;

    return bookingJson(
      await checkoutMarketplaceBooking({
        input: parsed.data,
        adapter: marketplaceCheckoutAdapter,
      }),
    );
  } catch (error) {
    if (error instanceof ApiServiceError) return bookingServiceError(error);
    logger.error(error instanceof Error ? error : new Error("Marketplace checkout request failed"));
    return bookingJson({ error: "errors.internalServerError" }, 500);
  }
};

export const POST = withEvlog(handlePost);
