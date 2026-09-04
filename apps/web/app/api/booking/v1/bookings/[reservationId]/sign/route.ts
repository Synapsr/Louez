import {
  ApiServiceError,
  getMarketplaceReservationContext,
  signReservationAsCustomer,
} from "@louez/api/services";
import { bookingReservationParamsSchema, bookingSignInputSchema } from "@louez/validations";
import type { NextRequest } from "next/server";

import { bookingJson, bookingServiceError, readBookingPost } from "@/lib/booking-api-route";
import { useLogger, withEvlog } from "@/lib/evlog";
import { generateContract } from "@/lib/pdf/generate";

const handlePost = async (
  request: NextRequest,
  context: { params: Promise<{ reservationId: string }> },
) => {
  const logger = useLogger();
  try {
    const body = await readBookingPost(request, bookingSignInputSchema);
    if (!body.success) return body.response;
    const params = bookingReservationParamsSchema.safeParse(await context.params);
    if (!params.success) {
      return bookingJson({ error: "errors.invalidData" }, 400);
    }

    const reservation = await getMarketplaceReservationContext(params.data.reservationId);
    if (reservation.signedAt) {
      return bookingJson({ error: "already_signed" }, 409);
    }
    if (!reservation.contractAvailable) {
      return bookingJson({ error: "contract_not_available" }, 409);
    }

    // The marketplace authenticated the end customer; the HMAC channel plus the
    // marketplace-source scope stand in for the customer session, and the
    // forwarded IP keeps the recorded signature attributable to that customer.
    const signatureHeaders = new Headers();
    if (body.data.signatureIp) {
      signatureHeaders.set("x-forwarded-for", body.data.signatureIp);
    }

    const result = await signReservationAsCustomer({
      reservationId: reservation.id,
      storeId: reservation.storeId,
      customerId: reservation.customerId,
      headers: signatureHeaders,
      regenerateContract: async (reservationId: string) => {
        await generateContract({ reservationId, regenerate: true });
      },
    });

    return bookingJson({ success: result.success, signedAt: result.signedAt });
  } catch (error) {
    if (error instanceof ApiServiceError) {
      if (error.key === "errors.contractAlreadySigned") {
        return bookingJson({ error: "already_signed" }, 409);
      }
      return bookingServiceError(error);
    }
    logger.error(
      error instanceof Error ? error : new Error("Marketplace booking sign request failed"),
    );
    return bookingJson({ error: "errors.internalServerError" }, 500);
  }
};

export const POST = withEvlog(handlePost);
