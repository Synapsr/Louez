import type { ApiApprovalPayload } from "@louez/db/schema";

/**
 * The three sample approvals' requests, as an agent's request would leave
 * them: their procedure and the payload its row holds, with a preview
 * written as the real procedures write theirs. Pure, so the page's tests
 * render the very details the samples carry.
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
  return [
    {
      label: "A payment recorded on a reservation (money)",
      procedure: "dashboard.payments.record",
      payload: {
        input: { reservationId: reservation.id, type: "rental", amount: 120, method: "cash" },
        preview: {
          summary: `Record a rental payment of 120.00 € (cash) on reservation #${reservation.number}.`,
          details: {
            reservationId: reservation.id,
            number: reservation.number,
            type: "rental",
            amount: 120,
            method: "cash",
          },
        },
        scope: { domain: "payments", level: "write" },
        consequences: ["money"],
      },
    },
    {
      label: "A booking confirmed over the turnover buffer (stock override)",
      procedure: "dashboard.reservations.updateStatus",
      payload: {
        input: { id: reservation.id, status: "confirmed", overrideTurnoverBuffer: true },
        preview: {
          summary: `Change reservation #${reservation.number} for ${reservation.customer} (${reservation.startDate} to ${reservation.endDate}, ${reservation.totalAmount} ${currency}) from pending to confirmed. ${reservation.customer} (${reservation.email}) gets the "request accepted" message by email. Its items leave the stock for these dates. These lines fit the stock but not the 120-minute turnover buffer the store keeps between rentals, and are confirmed past it all the same: Kayak biplace, 2 asked, 1 free with the buffer. The reservation's history records it.`,
          details: {
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
              shortfalls: [{ product: "Kayak biplace", requested: 2, available: 1 }],
              turnoverBufferMinutes: 120,
            },
          },
        },
        scope: { domain: "reservations", level: "write" },
        consequences: ["stock_override", "customer_message"],
      },
    },
    {
      label: "A team member removed (access removed)",
      procedure: "dashboard.team.removeMember",
      payload: {
        input: { id: "sample_membership_01" },
        preview: {
          summary: `Remove Lucas Bernard (lucas.bernard@example.com) from "${storeName}". They lose access to the store at once: its customers, reservations and payments.`,
          details: {
            member: {
              id: "sample_membership_01",
              name: "Lucas Bernard",
              email: "lucas.bernard@example.com",
              role: "member",
            },
          },
        },
        scope: { domain: "team", level: "write", role: "manage_members" },
        consequences: ["access_removed"],
      },
    },
  ];
}
