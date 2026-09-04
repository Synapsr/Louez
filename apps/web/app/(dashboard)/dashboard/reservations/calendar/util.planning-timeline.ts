import { formatDeliveryAddress } from "@/components/dashboard/reservations-timeline/timeline-utils";
import type { PlanningTimelineEntry } from "@/lib/queries/reservation-planning.queries";

import type { StoreTimelineReservation } from "./types";

export const toStoreTimelineReservation = (
  row: PlanningTimelineEntry,
): StoreTimelineReservation => ({
  id: row.id,
  productId: row.productId,
  number: row.number,
  status: row.status,
  startDate: new Date(row.startDate),
  endDate: new Date(row.endDate),
  customerId: row.customerId,
  customerName: row.customerName,
  subtotalAmount: row.subtotalAmount,
  depositAmount: row.depositAmount,
  totalAmount: row.totalAmount,
  quantity: row.quantity,
  assignedUnitIds: row.assignedUnitIds,
  items: row.items,
  outboundDeliveryAddress: row.outboundDelivery
    ? formatDeliveryAddress(row.outboundDelivery)
    : null,
  returnDeliveryAddress: row.returnDelivery ? formatDeliveryAddress(row.returnDelivery) : null,
});
