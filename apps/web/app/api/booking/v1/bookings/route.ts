import { listMarketplaceBookings, ApiServiceError } from "@louez/api/services";
import { bookingListQuerySchema } from "@louez/validations";
import type { NextRequest } from "next/server";

import { bookingJson, bookingServiceError, verifyBookingGet } from "@/lib/booking-api-route";
import { useLogger, withEvlog } from "@/lib/evlog";
import { getCanonicalUrl } from "@/lib/seo";

const handleGet = async (request: NextRequest) => {
  const logger = useLogger();
  try {
    if (!(await verifyBookingGet(request))) {
      return bookingJson({ error: "Unauthorized" }, 401);
    }
    const parsed = bookingListQuerySchema.safeParse({
      cursor: request.nextUrl.searchParams.get("cursor") ?? undefined,
      limit: request.nextUrl.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      return bookingJson({ error: "errors.invalidData" }, 400);
    }

    return bookingJson(
      await listMarketplaceBookings({
        ...parsed.data,
        getCanonicalUrl,
      }),
    );
  } catch (error) {
    if (error instanceof ApiServiceError) return bookingServiceError(error);
    logger.error(error instanceof Error ? error : new Error("Marketplace bookings request failed"));
    return bookingJson({ error: "errors.internalServerError" }, 500);
  }
};

export const GET = withEvlog(handleGet);
