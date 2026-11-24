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

const RESERVATION_STATUS_LABELS: Record<string, string> = {
  pending: "Oczekująca",
  confirmed: "Potwierdzona",
  ongoing: "W trakcie",
  completed: "Zakończona",
  cancelled: "Anulowana",
  rejected: "Odrzucona",
  quote: "Wycena",
  declined: "Wycena odrzucona",
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

export function getCalendarReservationStatusLabel(status: string): string {
  return RESERVATION_STATUS_LABELS[status] ?? status;
}

export function getReservationCalendarTitle(
  reservation: Pick<CalendarReservationDescription, "internalTitle" | "number" | "customer">,
): string {
  const internalTitle = reservation.internalTitle?.trim();
  let customerName: string | null = null;
  if (reservation.customer.customerType === "business") {
    customerName = reservation.customer.companyName?.trim() || null;
  } else {
    customerName =
      [reservation.customer.firstName, reservation.customer.lastName]
        .map((part) => part?.trim())
        .filter(Boolean)
        .join(" ") || null;
  }

  return [
    customerName ? `[${customerName}]` : null,
    `#${reservation.number}`,
    internalTitle ? `(${internalTitle})` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(", ");
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

function buildGoogleCalendarDescription({
  reservation,
  productNames,
  statusLabel,
  clientName,
  reservationUrl,
}: {
  reservation: CalendarReservationDescription;
  productNames: string[];
  statusLabel: string;
  clientName: string;
  reservationUrl: string;
}): string {
  return [
    joinSection([
      "KLIENT",
      `Nazwa: ${clientName}`,
      reservation.customer.email ? `E-mail: ${reservation.customer.email}` : null,
      reservation.customer.phone ? `Telefon: ${reservation.customer.phone}` : null,
    ]),
    joinSection([
      "REZERWACJA",
      `Status: ${statusLabel}`,
      `Numer rezerwacji: #${reservation.number}`,
      `Produkty:\n${productNames.join(",\n")}`,
      `Suma: ${reservation.totalAmount} PLN`,
      `Link: ${reservationUrl}`,
    ]),
    reservation.customerNotes
      ? joinSection(["UWAGI", `Uwagi klienta: ${reservation.customerNotes}`])
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildReservationCalendarEventDetails(params: {
  reservation: CalendarReservationDescription;
  productNames: string[];
  roomNames: string[];
  statusLabel: string;
  reservationUrl: string;
}): {
  summary: string;
  description: string;
  location?: string;
  startDate: Date;
  endDate: Date;
} {
  return {
    summary: getReservationCalendarTitle(params.reservation),
    location: params.roomNames.length > 0 ? params.roomNames.join(", ") : undefined,
    description: buildGoogleCalendarDescription({
      reservation: params.reservation,
      productNames: params.productNames,
      statusLabel: params.statusLabel,
      clientName: getCalendarCustomerName(params.reservation.customer),
      reservationUrl: params.reservationUrl,
    }),
    startDate: params.reservation.startDate,
    endDate: params.reservation.endDate,
  };
}
