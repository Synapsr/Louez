import { createHash } from "node:crypto";

import type { MondayColumnIdsConfig, MondayStatusLabelsConfig } from "@louez/db";
import type { ReservationLocationSnapshot } from "@louez/types";
import type { ReservationStatus } from "@louez/validations";

import {
  buildReservationLogisticsDescriptionLines,
  getCalendarCustomerName,
} from "@/lib/integrations/calendar/reservation-event-details";
import { isRoomCategory, isRoomProduct } from "@/lib/utils/util.product-category";

import type { ResolvedMondayStoreConfig } from "./config";

export const DEFAULT_MONDAY_STATUS_LABELS: Record<ReservationStatus, string> = {
  quote: "Oczekująca",
  pending: "Oczekująca",
  confirmed: "Gotowa do wydania",
  ongoing: "Wydana",
  completed: "Zakończona",
  cancelled: "Anulowane",
  rejected: "Anulowane",
  declined: "Anulowane",
};

export type MondaySubitemKind = "product" | "room";

export type ReservationMondayPayloadInput = {
  id: string;
  storeId: string;
  number: string;
  internalTitle: string | null;
  bookedByName: string | null;
  status: ReservationStatus;
  startDate: Date;
  endDate: Date;
  totalAmount: string;
  customerNotes: string | null;
  internalNotes: string | null;
  outboundMethod: string | null;
  returnMethod: string | null;
  deliveryAddress: string | null;
  deliveryCity: string | null;
  deliveryPostalCode: string | null;
  deliveryCountry: string | null;
  returnAddress: string | null;
  returnCity: string | null;
  returnPostalCode: string | null;
  returnCountry: string | null;
  pickupLocationSnapshot: ReservationLocationSnapshot | null;
  returnLocationSnapshot: ReservationLocationSnapshot | null;
  store: {
    name: string;
    address: string | null;
    settings?: {
      timezone?: string;
      currency?: string;
    } | null;
  };
  customer: {
    customerType: "individual" | "business";
    firstName: string | null;
    lastName: string | null;
    companyName: string | null;
    email: string | null;
    phone: string | null;
  };
  items: Array<{
    id: string;
    quantity: number;
    productSnapshot: {
      name?: string | null;
    } | null;
    selectedAttributes: Record<string, string> | null;
    product: {
      name: string;
      category: { name?: string | null; slug?: string | null } | null;
      categoryLinks: Array<{
        category: { name?: string | null; slug?: string | null };
      }>;
    } | null;
    assignedUnits: Array<{
      identifierSnapshot: string;
    }>;
  }>;
};

export type BuiltMondaySubitemPayload = {
  reservationItemId: string;
  itemKind: MondaySubitemKind;
  name: string;
  columnValues: Record<string, unknown>;
  payloadHash: string;
};

export type BuiltMondayChecklistPayload = {
  body: string;
  hash: string;
};

export type BuiltMondayItemPayload = {
  itemName: string;
  statusLabel: string;
  columnValues: Record<string, unknown>;
  payloadHash: string;
  isCancelled: boolean;
  subitems: BuiltMondaySubitemPayload[];
  checklist: BuiltMondayChecklistPayload;
};

const DEFAULT_MONDAY_TO_LOUEZ_STATUS_MAP: Record<string, ReservationStatus> = {
  oczekujaca: "pending",
  "nowa / oczekujaca": "pending",
  nowa: "pending",
  pending: "pending",
  wycena: "quote",
  quote: "quote",
  "gotowa do wydania": "confirmed",
  potwierdzona: "confirmed",
  confirmed: "confirmed",
  wydana: "ongoing",
  "w trakcie": "ongoing",
  ongoing: "ongoing",
  zakonczona: "completed",
  zwrocona: "completed",
  completed: "completed",
  done: "completed",
  anulowane: "cancelled",
  anulowana: "cancelled",
  cancelled: "cancelled",
  canceled: "cancelled",
  odrzucona: "rejected",
  rejected: "rejected",
};

export function normalizeStatusLabelKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function getMondayStatusLabelForLouezStatus(
  status: ReservationStatus,
  statusLabels?: MondayStatusLabelsConfig | null,
): string {
  return statusLabels?.[status]?.trim() || DEFAULT_MONDAY_STATUS_LABELS[status] || "Oczekująca";
}

export function resolveLouezStatusFromMondayLabel(
  label: string,
  config?: Pick<ResolvedMondayStoreConfig, "statusLabels" | "webhookStatusMap"> | null,
): ReservationStatus | null {
  const normalized = normalizeStatusLabelKey(label);
  if (!normalized) return null;

  // 1. Check explicit webhookStatusMap overrides
  if (config?.webhookStatusMap) {
    for (const [key, value] of Object.entries(config.webhookStatusMap)) {
      if (normalizeStatusLabelKey(key) === normalized) {
        return value;
      }
    }
  }

  // 2. Check reverse of configured statusLabels
  if (config?.statusLabels) {
    const priorityOrder: ReservationStatus[] = [
      "confirmed",
      "ongoing",
      "completed",
      "cancelled",
      "pending",
      "rejected",
      "quote",
      "declined",
    ];
    for (const status of priorityOrder) {
      const customLabel = config.statusLabels[status];
      if (customLabel && normalizeStatusLabelKey(customLabel) === normalized) {
        return status;
      }
    }
  }

  // 3. Default dictionary
  return DEFAULT_MONDAY_TO_LOUEZ_STATUS_MAP[normalized] ?? null;
}

export function isCancelledReservationStatus(status: ReservationStatus): boolean {
  return status === "cancelled" || status === "rejected" || status === "declined";
}

function formatDateInTimezone(
  date: Date,
  timeZone = "Europe/Warsaw",
): {
  datePart: string;
  timePart: string;
} {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = get("hour") === "24" ? "00" : get("hour");
  const minute = get("minute");
  const second = get("second");

  return {
    datePart: `${year}-${month}-${day}`,
    timePart: `${hour}:${minute}:${second}`,
  };
}

/**
 * Monday.com Date column expects UTC date & time strings (`YYYY-MM-DD` and `HH:mm:ss` in UTC),
 * while Timeline column expects local calendar days (`from: YYYY-MM-DD`, `to: YYYY-MM-DD`).
 */
function formatUtcDateColumnValue(date: Date): { date: string; time: string } {
  const iso = date.toISOString();
  return {
    date: iso.slice(0, 10),
    time: iso.slice(11, 19),
  };
}

export function buildMondayMainItemTitle(reservation: ReservationMondayPayloadInput): string {
  const customerName = getCalendarCustomerName(reservation.customer);
  const internalTitle = reservation.internalTitle?.trim();

  if (internalTitle) {
    return `[${reservation.number}] ${internalTitle} — ${customerName}`;
  }

  return `[${reservation.number}] ${customerName}`;
}

export function classifyReservationItemKind(
  item: ReservationMondayPayloadInput["items"][number],
): MondaySubitemKind {
  const name = item.productSnapshot?.name || item.product?.name || "Produkt";
  const primaryCategory = item.product?.category ?? null;
  const linkedCategories = item.product?.categoryLinks.map((link) => link.category) ?? [];

  const isRoom =
    isRoomProduct({ name, category: primaryCategory }) ||
    linkedCategories.some((category) => isRoomCategory(category));

  return isRoom ? "room" : "product";
}

export function buildMondaySubitemPayload(
  item: ReservationMondayPayloadInput["items"][number],
  columnConfig?: MondayColumnIdsConfig | null,
): BuiltMondaySubitemPayload {
  const itemKind = classifyReservationItemKind(item);
  const baseName = (item.productSnapshot?.name || item.product?.name || "Pozycja").trim();

  const attributePairs = item.selectedAttributes
    ? Object.entries(item.selectedAttributes)
        .filter(([, val]) => Boolean(val))
        .map(([, val]) => val)
    : [];
  const attributesSuffix = attributePairs.length > 0 ? ` (${attributePairs.join(", ")})` : "";

  const unitIdentifiers = item.assignedUnits
    .map((u) => u.identifierSnapshot?.trim())
    .filter((id): id is string => Boolean(id));
  const unitsSuffix =
    unitIdentifiers.length > 0 ? ` [Jednostki: ${unitIdentifiers.join(", ")}]` : "";

  const prefix = itemKind === "room" ? "[POMIESZCZENIE]" : "[SPRZĘT]";
  const kindLabel = itemKind === "room" ? "Pomieszczenie" : "Sprzęt";
  const name = `${prefix} ${baseName}${attributesSuffix} (x${item.quantity})${unitsSuffix}`;

  const columnValues: Record<string, unknown> = {};

  if (columnConfig?.subitemQuantityColumnId) {
    columnValues[columnConfig.subitemQuantityColumnId] = String(item.quantity);
  }

  if (columnConfig?.subitemTypeColumnId) {
    columnValues[columnConfig.subitemTypeColumnId] = kindLabel;
  }

  if (columnConfig?.subitemUnitsColumnId) {
    columnValues[columnConfig.subitemUnitsColumnId] = unitIdentifiers.join(", ");
  }

  const payloadHash = createHash("sha256")
    .update(
      JSON.stringify({
        reservationItemId: item.id,
        itemKind,
        name,
        columnValues,
      }),
    )
    .digest("hex");

  return {
    reservationItemId: item.id,
    itemKind,
    name,
    columnValues,
    payloadHash,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}

export function buildMondayChecklistPayload(itemNames: string[]): BuiltMondayChecklistPayload {
  const body =
    itemNames.length > 0
      ? itemNames
          .map(
            (name) =>
              `<ul class="checklist"><li class="checklist_task">\uFEFF${escapeHtml(name)}</li></ul>`,
          )
          .join("")
      : "<p>Brak pozycji do przygotowania</p>";
  const hash = createHash("sha256")
    .update(JSON.stringify({ version: 1, items: itemNames }))
    .digest("hex");

  return { body, hash };
}

export function buildMondayReservationPayload(
  reservation: ReservationMondayPayloadInput,
  config: Pick<ResolvedMondayStoreConfig, "columnConfig" | "statusLabels">,
  appBaseUrl = "http://localhost:3000",
): BuiltMondayItemPayload {
  const timeZone = reservation.store.settings?.timezone || "Europe/Warsaw";
  const itemName = buildMondayMainItemTitle(reservation);
  const statusLabel = getMondayStatusLabelForLouezStatus(reservation.status, config.statusLabels);
  const customerName = getCalendarCustomerName(reservation.customer);
  const reservationUrl = `${appBaseUrl.replace(/\/+$/, "")}/dashboard/reservations/${reservation.id}`;

  const cols = config.columnConfig;
  const columnValues: Record<string, unknown> = {};

  if (cols.statusColumnId) {
    columnValues[cols.statusColumnId] = { label: statusLabel };
  }

  if (cols.timelineColumnId) {
    const startLocal = formatDateInTimezone(reservation.startDate, timeZone);
    const endLocal = formatDateInTimezone(reservation.endDate, timeZone);
    const fromDate = startLocal.datePart;
    const toDate = endLocal.datePart >= fromDate ? endLocal.datePart : fromDate;
    columnValues[cols.timelineColumnId] = {
      from: fromDate,
      to: toDate,
    };
  }

  if (cols.startDateColumnId) {
    columnValues[cols.startDateColumnId] = formatUtcDateColumnValue(reservation.startDate);
  }

  if (cols.endDateColumnId) {
    columnValues[cols.endDateColumnId] = formatUtcDateColumnValue(reservation.endDate);
  }

  if (cols.customerColumnId) {
    columnValues[cols.customerColumnId] = customerName;
  }

  if (cols.emailColumnId) {
    const email = reservation.customer.email?.trim() || "";
    columnValues[cols.emailColumnId] = email ? { email, text: email } : "";
  }

  if (cols.phoneColumnId) {
    const phone = reservation.customer.phone?.trim() || "";
    columnValues[cols.phoneColumnId] = phone;
  }

  if (cols.linkColumnId) {
    columnValues[cols.linkColumnId] = {
      url: reservationUrl,
      text: `Rezerwacja #${reservation.number}`,
    };
  }

  if (cols.numberColumnId) {
    columnValues[cols.numberColumnId] = reservation.number;
  }

  if (cols.totalColumnId) {
    columnValues[cols.totalColumnId] = reservation.totalAmount;
  }

  if (cols.notesColumnId) {
    const startLocal = formatDateInTimezone(reservation.startDate, timeZone);
    const endLocal = formatDateInTimezone(reservation.endDate, timeZone);
    const logisticsLines = buildReservationLogisticsDescriptionLines({
      reservation,
      store: reservation.store,
    });
    const noteParts = [
      `Termin: ${startLocal.datePart} ${startLocal.timePart.slice(0, 5)} -> ${endLocal.datePart} ${endLocal.timePart.slice(0, 5)}`,
      ...logisticsLines,
      reservation.bookedByName ? `Wprowadził(a): ${reservation.bookedByName}` : null,
      reservation.customerNotes ? `Notatki klienta: ${reservation.customerNotes}` : null,
      reservation.internalNotes ? `Notatki wewnętrzne: ${reservation.internalNotes}` : null,
      `Link: ${reservationUrl}`,
    ].filter(Boolean);

    columnValues[cols.notesColumnId] = {
      text: noteParts.join("\n"),
    };
  }

  // Sort subitems so rooms appear first, then equipment products
  const subitems = reservation.items
    .map((item) => buildMondaySubitemPayload(item))
    .sort((a, b) => {
      if (a.itemKind !== b.itemKind) {
        return a.itemKind === "room" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  const checklist = buildMondayChecklistPayload(subitems.map((subitem) => subitem.name));

  const payloadHash = createHash("sha256")
    .update(
      JSON.stringify({
        itemName,
        statusLabel,
        columnValues,
        subitems: subitems.map((s) => s.payloadHash),
        checklistHash: checklist.hash,
      }),
    )
    .digest("hex");

  return {
    itemName,
    statusLabel,
    columnValues,
    payloadHash,
    isCancelled: isCancelledReservationStatus(reservation.status),
    subitems,
    checklist,
  };
}
