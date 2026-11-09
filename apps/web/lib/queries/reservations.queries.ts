import type { ListReservationsInput } from "@louez/api/contracts/reservations";

import { orpc } from "@/lib/orpc/react";

export const reservationsQueries = {
  /** One page of the reservations list, with the dashboard's filters and sort. */
  list: (input: ListReservationsInput) => orpc.dashboard.reservations.list.queryOptions({ input }),
  /** Broad key for invalidating every filter combination after a mutation. */
  listKey: () => orpc.dashboard.reservations.list.key(),
  /** One reservation with everything its page shows. */
  detail: (id: string) => orpc.dashboard.reservations.get.queryOptions({ input: { id } }),
  detailKey: (id: string) => orpc.dashboard.reservations.get.key({ input: { id } }),
  /** The counters the dashboard polls: pending requests, the newest one. */
  poll: () => orpc.dashboard.reservations.poll.queryOptions({ input: {} }),
  pollKey: () => orpc.dashboard.reservations.poll.key(),
};
