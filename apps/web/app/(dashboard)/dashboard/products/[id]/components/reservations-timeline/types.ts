import type { orpcClient } from "@/lib/orpc/client";

/** What the product's reservations timeline shows, as `products.getReservationTimeline` returns it. */
export type ProductTimelineData = Awaited<
  ReturnType<typeof orpcClient.dashboard.products.getReservationTimeline>
>;

export type ProductTimelineReservation = ProductTimelineData["reservations"][number];

export type ProductTimelineDowntime = ProductTimelineData["downtimes"][number];
