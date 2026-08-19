import { quoteMarketplaceBooking, ApiServiceError } from "@louez/api/services";
import { bookingQuoteInputSchema } from "@louez/validations";
import type { NextRequest } from "next/server";

import { env } from "@/env";
import { bookingJson, bookingServiceError, readBookingPost } from "@/lib/booking-api-route";
import { useLogger, withEvlog } from "@/lib/evlog";

const handlePost = async (request: NextRequest) => {
  const logger = useLogger();
  try {
    const parsed = await readBookingPost(request, bookingQuoteInputSchema);
    if (!parsed.success) return parsed.response;

    return bookingJson(
      await quoteMarketplaceBooking({
        input: parsed.data,
        mediaBaseUrl: env.NEXT_PUBLIC_APP_URL,
        secret: parsed.secret,
      }),
    );
  } catch (error) {
    if (error instanceof ApiServiceError) return bookingServiceError(error);
    logger.error(error instanceof Error ? error : new Error("Marketplace quote request failed"));
    return bookingJson({ error: "errors.internalServerError" }, 500);
  }
};

export const POST = withEvlog(handlePost);
