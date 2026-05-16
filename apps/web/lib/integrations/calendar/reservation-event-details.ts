import type { ReservationLocationSnapshot } from '@louez/types';

type CalendarStoreLocation = {
  name: string;
  address: string | null;
};

type CalendarReservationLogistics = {
  outboundMethod?: string | null;
  returnMethod?: string | null;
  deliveryAddress?: string | null;
  deliveryCity?: string | null;
  deliveryPostalCode?: string | null;
  deliveryCountry?: string | null;
  returnAddress?: string | null;
  returnCity?: string | null;
  returnPostalCode?: string | null;
  returnCountry?: string | null;
  pickupLocationSnapshot?: ReservationLocationSnapshot | null;
  returnLocationSnapshot?: ReservationLocationSnapshot | null;
};

type CalendarReservationDescription = CalendarReservationLogistics & {
  customer: {
    firstName: string;
    lastName: string;
    email?: string | null;
    phone?: string | null;
  };
  totalAmount: string;
  customerNotes?: string | null;
};

function formatAddress(parts: {
  address?: string | null;
  city?: string | null;
  postalCode?: string | null;
  country?: string | null;
}): string | null {
  return (
    [
      parts.address,
      [parts.postalCode, parts.city].filter(Boolean).join(' '),
      parts.country,
    ]
      .filter(Boolean)
      .join(', ') || null
  );
}

function formatLocation(
  snapshot: ReservationLocationSnapshot | null | undefined,
  fallback: CalendarStoreLocation,
): string {
  const name = snapshot?.name ?? fallback.name;
  const address =
    formatAddress({
      address: snapshot?.address ?? fallback.address,
      city: snapshot?.city,
      postalCode: snapshot?.postalCode,
      country: snapshot?.country,
    }) ?? fallback.address;

  return address ? `${name} - ${address}` : name;
}

export function buildReservationLogisticsDescriptionLines({
  reservation,
  store,
}: {
  reservation: CalendarReservationLogistics;
  store: CalendarStoreLocation;
}): string[] {
  const pickup =
    reservation.outboundMethod === 'address'
      ? `Livraison - ${
          formatAddress({
            address: reservation.deliveryAddress,
            city: reservation.deliveryCity,
            postalCode: reservation.deliveryPostalCode,
            country: reservation.deliveryCountry,
          }) ?? 'Adresse non renseignee'
        }`
      : formatLocation(reservation.pickupLocationSnapshot, store);

  const dropoff =
    reservation.returnMethod === 'address'
      ? `Reprise - ${
          formatAddress({
            address: reservation.returnAddress,
            city: reservation.returnCity,
            postalCode: reservation.returnPostalCode,
            country: reservation.returnCountry,
          }) ?? 'Adresse non renseignee'
        }`
      : formatLocation(
          reservation.returnLocationSnapshot ??
            reservation.pickupLocationSnapshot,
          store,
        );

  return [`Retrait: ${pickup}`, `Retour: ${dropoff}`];
}

function joinSection(lines: Array<string | null | undefined>): string {
  return lines.filter(Boolean).join('\n');
}

export function buildReservationCalendarDescription({
  reservation,
  store,
  productNames,
  reservationUrl,
}: {
  reservation: CalendarReservationDescription;
  store: CalendarStoreLocation;
  productNames: string;
  reservationUrl: string;
}): string {
  return [
    joinSection([
      'CLIENT',
      `Nom: ${reservation.customer.firstName} ${reservation.customer.lastName}`,
      reservation.customer.email
        ? `Email: ${reservation.customer.email}`
        : null,
      reservation.customer.phone
        ? `Telephone: ${reservation.customer.phone}`
        : null,
    ]),
    joinSection([
      'RESERVATION',
      `Produits: ${productNames}`,
      `Total: ${reservation.totalAmount} EUR`,
      `Lien: ${reservationUrl}`,
    ]),
    joinSection([
      'LOGISTIQUE',
      ...buildReservationLogisticsDescriptionLines({ reservation, store }),
    ]),
    reservation.customerNotes
      ? joinSection(['NOTES', `Notes client: ${reservation.customerNotes}`])
      : null,
  ]
    .filter(Boolean)
    .join('\n\n');
}
