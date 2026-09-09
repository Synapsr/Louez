import type { ReactNode } from "react";

import {
  ReservationListCard,
  type ReservationListItem,
} from "@/components/storefront/account/reservation-list-card";

interface ReservationListSectionProps {
  title: ReactNode;
  reservations: ReservationListItem[];
}

/** A titled stack of reservation cards; renders nothing when empty. */
export const ReservationListSection = ({ title, reservations }: ReservationListSectionProps) => {
  if (reservations.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold leading-snug">
        {title}
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
          {reservations.length}
        </span>
      </h2>
      <ul className="flex flex-col gap-2 sm:gap-3">
        {reservations.map((reservation) => (
          <li key={reservation.id}>
            <ReservationListCard reservation={reservation} />
          </li>
        ))}
      </ul>
    </section>
  );
};
