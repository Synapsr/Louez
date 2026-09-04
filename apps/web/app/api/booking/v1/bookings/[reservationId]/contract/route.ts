import { ApiServiceError, getMarketplaceReservationContext } from "@louez/api/services";
import { bookingContractQuerySchema, bookingReservationParamsSchema } from "@louez/validations";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { bookingJson, bookingServiceError, verifyBookingGet } from "@/lib/booking-api-route";
import { useLogger, withEvlog } from "@/lib/evlog";
import { generateContract, getContractPdfBuffer } from "@/lib/pdf/generate";

const handleGet = async (
  request: NextRequest,
  context: { params: Promise<{ reservationId: string }> },
) => {
  const logger = useLogger();
  try {
    if (!(await verifyBookingGet(request))) {
      return bookingJson({ error: "Unauthorized" }, 401);
    }
    const params = bookingReservationParamsSchema.safeParse(await context.params);
    if (!params.success) {
      return bookingJson({ error: "errors.invalidData" }, 400);
    }
    const query = bookingContractQuerySchema.safeParse({
      lang: request.nextUrl.searchParams.get("lang") ?? undefined,
    });
    if (!query.success) {
      return bookingJson({ error: "errors.invalidData" }, 400);
    }

    const reservation = await getMarketplaceReservationContext(params.data.reservationId);
    if (!reservation.contractAvailable) {
      return bookingJson({ error: "contract_not_available" }, 409);
    }

    // Same behavior as the customer portal route: regenerate so the PDF always
    // reflects the latest reservation data in the requested locale.
    const contract = await generateContract({
      reservationId: reservation.id,
      regenerate: true,
      locale: query.data.lang,
    });
    if (!contract) {
      return bookingJson({ error: "errors.internalServerError" }, 500);
    }
    const pdfBuffer = await getContractPdfBuffer(reservation.id);
    if (!pdfBuffer) {
      return bookingJson({ error: "errors.internalServerError" }, 500);
    }

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${contract.fileName}"`,
        "Content-Language": query.data.lang,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof ApiServiceError) return bookingServiceError(error);
    logger.error(
      error instanceof Error ? error : new Error("Marketplace booking contract request failed"),
    );
    return bookingJson({ error: "errors.internalServerError" }, 500);
  }
};

export const GET = withEvlog(handleGet);
