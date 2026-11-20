import type { ReservationLocationSnapshot } from "@louez/types";

import { isRoomCategory, isRoomProduct } from "@/lib/utils/util.product-category";

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
  internalTitle: string | null;
  number: string;
  startDate: Date;
  endDate: Date;
  customer: {
    customerType: "individual" | "business";
    firstName: string | null;
    lastName: string | null;
    companyName?: string | null;
    email?: string | null;
    phone?: string | null;
  };
  totalAmount: string;
  customerNotes?: string | null;
};

export function getCalendarCustomerName(
  customer: CalendarReservationDescription["customer"],
): string {
  const personName = [customer.firstName, customer.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");

  if (customer.customerType === "business" && customer.companyName?.trim()) {
    return customer.companyName.trim();
  }

  return personName || customer.email?.trim() || "Customer";
}

export function getReservationCalendarTitle(
  reservation: Pick<CalendarReservationDescription, "internalTitle" | "number" | "customer">,
): string {
  const internalTitle = reservation.internalTitle?.trim();
  if (internalTitle) return internalTitle;

  if (reservation.customer.customerType === "business") {
    const companyName = reservation.customer.companyName?.trim();
    if (companyName) return companyName;
  }

  return reservation.number;
}

export function getCalendarRoomNames(
  items: Array<{
    name: string;
    quantity: number;
    category?: { name?: string | null; slug?: string | null } | null;
    categories?: Array<{ name?: string | null; slug?: string | null }>;
  }>,
): string[] {
  return items.flatMap((item) => {
    const isRoom =
      isRoomProduct({ name: item.name, category: item.category }) ||
      Boolean(item.categories?.some((category) => isRoomCategory(category)));

    return isRoom ? [item.quantity > 1 ? `${item.name} (x${item.quantity})` : item.name] : [];
  });
}

function formatAddress(parts: {
  address?: string | null;
  city?: string | null;
  postalCode?: string | null;
  country?: string | null;
}): string | null {
  return (
    [parts.address, [parts.postalCode, parts.city].filter(Boolean).join(" "), parts.country]
      .filter(Boolean)
      .join(", ") || null
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
    reservation.outboundMethod === "address"
      ? `Livraison - ${
          formatAddress({
            address: reservation.deliveryAddress,
            city: reservation.deliveryCity,
            postalCode: reservation.deliveryPostalCode,
            country: reservation.deliveryCountry,
          }) ?? "Adresse non renseignee"
        }`
      : formatLocation(reservation.pickupLocationSnapshot, store);

  const dropoff =
    reservation.returnMethod === "address"
      ? `Reprise - ${
          formatAddress({
            address: reservation.returnAddress,
            city: reservation.returnCity,
            postalCode: reservation.returnPostalCode,
            country: reservation.returnCountry,
          }) ?? "Adresse non renseignee"
        }`
      : formatLocation(
          reservation.returnLocationSnapshot ?? reservation.pickupLocationSnapshot,
          store,
        );

  return [`Retrait: ${pickup}`, `Retour: ${dropoff}`];
}

function joinSection(lines: Array<string | null | undefined>): string {
  return lines.filter(Boolean).join("\n");
}

export function buildReservationCalendarDescription({
  reservation,
  store,
  productNames,
  roomNames,
  statusLabel,
  clientName,
  reservationUrl,
}: {
  reservation: CalendarReservationDescription;
  store: CalendarStoreLocation;
  productNames: string;
  roomNames?: string[];
  statusLabel?: string;
  clientName?: string;
  reservationUrl: string;
}): string {
  const legacyCustomerName =
    reservation.customer.companyName?.trim() ||
    [reservation.customer.firstName, reservation.customer.lastName].filter(Boolean).join(" ") ||
    reservation.customer.email ||
    "Customer";

  return [
    joinSection([
      "CLIENT",
      clientName ? `Guest: ${clientName}` : `Nom: ${legacyCustomerName}`,
      reservation.customer.email ? `Email: ${reservation.customer.email}` : null,
      reservation.customer.phone ? `Telephone: ${reservation.customer.phone}` : null,
    ]),
    joinSection([
      "RESERVATION",
      statusLabel ? `Statut: ${statusLabel}` : null,
      statusLabel ? `Numero: ${reservation.number}` : null,
      `Produits: ${productNames}`,
      `Total: ${reservation.totalAmount} EUR`,
      `Lien: ${reservationUrl}`,
    ]),
    roomNames && roomNames.length > 0 ? joinSection(["ROOMS", ...roomNames]) : null,
    joinSection([
      "LOGISTIQUE",
      ...buildReservationLogisticsDescriptionLines({ reservation, store }),
    ]),
    reservation.customerNotes
      ? joinSection(["NOTES", `Notes client: ${reservation.customerNotes}`])
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildReservationCalendarEventDetails(params: {
  reservation: CalendarReservationDescription;
  store: CalendarStoreLocation;
  productNames: string;
  roomNames: string[];
  statusLabel: string;
  reservationUrl: string;
}): {
  summary: string;
  description: string;
  startDate: Date;
  endDate: Date;
} {
  return {
    summary: getReservationCalendarTitle(params.reservation),
    description: buildReservationCalendarDescription({
      ...params,
      clientName: getCalendarCustomerName(params.reservation.customer),
    }),
    startDate: params.reservation.startDate,
    endDate: params.reservation.endDate,
  };
}
