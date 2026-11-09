import { NextResponse } from "next/server";

import {
  ApiServiceError,
  getReservationSigningContext,
  signReservationAsCustomer,
} from "@louez/api/services";
import { reservationSignInputSchema } from "@louez/validations";

import { getCustomerSession } from "@/lib/customer-auth/session";
import { log } from "@/lib/evlog";
import { generateContract } from "@/lib/pdf/generate";

const statusFromServiceCode = (code: ApiServiceError["code"]): number => {
  switch (code) {
    case "BAD_REQUEST":
      return 400;
    case "UNAUTHORIZED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    default:
      return 500;
  }
};

const regenerateContract = async (reservationId: string): Promise<void> => {
  await generateContract({ reservationId, regenerate: true });
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = reservationSignInputSchema.safeParse({ reservationId: id });

  if (!parsed.success) {
    return NextResponse.json({ error: "errors.invalidData" }, { status: 400 });
  }

  try {
    const { reservationId } = parsed.data;
    const reservation = await getReservationSigningContext(reservationId);

    // Only the customer signs here. The store collects a signature in its dashboard, drawn
    // on its device, through the in-store signing procedure.
    const customerSession = await getCustomerSession(reservation.storeId);
    if (!customerSession || customerSession.customerId !== reservation.customerId) {
      return NextResponse.json({ error: "errors.customerNotAuthenticated" }, { status: 401 });
    }

    return NextResponse.json(
      await signReservationAsCustomer({
        reservationId,
        storeId: reservation.storeId,
        customerId: customerSession.customerId,
        headers: request.headers,
        regenerateContract,
      }),
    );
  } catch (error) {
    if (error instanceof ApiServiceError) {
      return NextResponse.json(
        { error: error.key, details: error.details },
        { status: statusFromServiceCode(error.code) },
      );
    }

    log.error(
      "reservation",
      `sign failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return NextResponse.json({ error: "errors.internalServerError" }, { status: 500 });
  }
}
