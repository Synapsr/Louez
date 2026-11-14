import {
  confirmOverridePresentation,
  recordPaymentPresentation,
  removeMemberPresentation,
} from "@louez/api/services/approval-presentations";
import type { StatusChangePreview } from "@louez/api/services/reservation-status";
import type { ApiApprovalPayload } from "@louez/db/schema";

/**
 * The three sample approvals' requests, as an agent's request would leave
 * them: their procedure and the payload its row holds, with a preview
 * written as the real procedures write theirs and the display the real
 * branches build, by their own functions (services/approval-presentations,
 * packages/api). Pure, so the page's tests render the very details and
 * displays the samples carry.
 */

export interface Sample {
  label: string;
  procedure: string;
  payload: ApiApprovalPayload;
}

/** The reservation the samples name: the store's latest one, or a made-up one. */
export interface SampleReservation {
  id: string;
  number: string;
  startDate: string;
  endDate: string;
  totalAmount: string;
  customer: string;
  email: string;
}

const MEMBER = {
  id: "sample_membership_01",
  userId: "sample_member_user_01",
  name: "Lucas Bernard",
  email: "lucas.bernard@example.com",
  role: "member" as const,
  joinedAt: new Date("2026-03-03T09:00:00.000Z"),
};

/** A payment recorded, a booking past the turnover buffer, a team member removed. */
export function sampleApprovals({
  storeName,
  currency,
  reservation,
}: {
  storeName: string;
  currency: string;
  reservation: SampleReservation;
}): Sample[] {
  const payment = {
    reservationId: reservation.id,
    number: reservation.number,
    type: "rental",
    amount: "120.00",
    method: "cash",
  };

  // A booking confirmed past the turnover buffer, as the status change's preview holds it.
  const booking: StatusChangePreview = {
    summary: `Change reservation #${reservation.number} for ${reservation.customer} (${reservation.startDate} to ${reservation.endDate}, ${reservation.totalAmount} ${currency}) from pending to confirmed. ${reservation.customer} (${reservation.email}) gets the "request accepted" message by email. Its items leave the stock for these dates. These lines fit the stock but not the 120-minute turnover buffer the store keeps between rentals, and are confirmed past it all the same: Kayak biplace, 2 asked, 1 free with the buffer. The reservation's history records it.`,
    reservation: {
      id: reservation.id,
      number: reservation.number,
      from: "pending",
      to: "confirmed",
      startDate: reservation.startDate,
      endDate: reservation.endDate,
      totalAmount: reservation.totalAmount,
      currency,
    },
    customer: { name: reservation.customer, email: reservation.email },
    messages: [{ message: "request_accepted", channel: "email" }],
    reducesAvailability: true,
    overbooking: null,
    turnoverBuffer: {
      shortfalls: [
        {
          productId: "sample_product_kayak",
          productName: "Kayak biplace",
          combinationKey: null,
          requested: 2,
          available: 1,
        },
      ],
      turnoverBufferMinutes: 120,
    },
    money: null,
    insuranceContract: null,
    recipientsHash: "0".repeat(64),
  };
  const { summary: bookingSummary, recipientsHash: _recipientsHash, ...bookingDetails } = booking;

  return [
    {
      label: "A payment recorded on a reservation (money)",
      procedure: "dashboard.payments.record",
      payload: {
        input: payment,
        preview: {
          summary: `Record a rental payment of €120.00 (cash) on reservation #${reservation.number}.`,
          details: { sensitive: "money", ...payment },
        },
        display: recordPaymentPresentation(payment, currency)?.display,
        scope: { domain: "payments", level: "write" },
        consequences: ["money"],
      },
    },
    {
      label: "A booking confirmed over the turnover buffer (stock override)",
      procedure: "dashboard.reservations.updateStatus",
      payload: {
        input: { id: reservation.id, status: "confirmed", overrideTurnoverBuffer: true },
        preview: { summary: bookingSummary, details: bookingDetails },
        display: confirmOverridePresentation(booking)?.display,
        scope: { domain: "reservations", level: "write" },
        consequences: ["stock_override", "customer_message"],
      },
    },
    {
      label: "A team member removed (access removed)",
      procedure: "dashboard.team.removeMember",
      payload: {
        input: { id: MEMBER.id },
        preview: {
          summary: `Remove ${MEMBER.name} (${MEMBER.email}) from "${storeName}". They lose access to the store at once: its customers, reservations and payments.`,
          details: { member: { ...MEMBER, joinedAt: MEMBER.joinedAt.toISOString() } },
        },
        display: removeMemberPresentation(MEMBER).display,
        scope: { domain: "team", level: "write", role: "manage_members" },
        consequences: ["access_removed"],
      },
    },
  ];
}
