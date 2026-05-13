import { NextResponse } from 'next/server';

import { and, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';

import { db } from '@louez/db';
import { reservations, stores } from '@louez/db';

import { env } from '@/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CALENDAR_REFRESH_INTERVAL = 'PT5M';
const CALENDAR_EVENT_FORMAT_VERSION = 2;

// Format date to ICS format (YYYYMMDDTHHMMSS)
function formatICSDate(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    date.getUTCFullYear().toString() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    'T' +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    'Z'
  );
}

// Escape special characters for ICS text fields
function escapeICSText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

// Fold long lines per ICS spec (max 75 octets per line)
function foldLine(line: string): string {
  const maxLength = 75;
  if (line.length <= maxLength) return line;

  const lines: string[] = [];
  let remaining = line;

  while (remaining.length > maxLength) {
    lines.push(remaining.substring(0, maxLength));
    remaining = ' ' + remaining.substring(maxLength);
  }
  lines.push(remaining);

  return lines.join('\r\n');
}

function getReservationSequence(updatedAt: Date | string | null): number {
  if (!updatedAt) return CALENDAR_EVENT_FORMAT_VERSION;

  const timestamp = new Date(updatedAt).getTime();
  if (!Number.isFinite(timestamp)) return CALENDAR_EVENT_FORMAT_VERSION;

  return (
    Math.max(0, Math.floor(timestamp / 1000)) + CALENDAR_EVENT_FORMAT_VERSION
  );
}

function buildWeakEtag(content: string): string {
  const hash = createHash('sha256').update(content).digest('base64url');
  return `W/"${hash}"`;
}

function requestHasMatchingEtag(request: Request, etag: string): boolean {
  const ifNoneMatch = request.headers.get('if-none-match');
  if (!ifNoneMatch) return false;
  if (ifNoneMatch.trim() === '*') return true;

  return ifNoneMatch
    .split(',')
    .map((value) => value.trim())
    .includes(etag);
}

function joinAddressParts(
  parts: Array<string | null | undefined>,
): string | null {
  const address = parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(', ');

  return address || null;
}

function formatReservationLocationSnapshotAddress(
  snapshot: {
    address: string | null;
    postalCode: string | null;
    city: string | null;
    country: string | null;
  } | null,
): string | null {
  if (!snapshot) return null;

  return joinAddressParts([
    snapshot.address,
    joinAddressParts([snapshot.postalCode, snapshot.city]),
    snapshot.country,
  ]);
}

function formatOutboundAddress(
  reservation: typeof reservations.$inferSelect,
): string | null {
  return joinAddressParts([
    reservation.deliveryAddress,
    joinAddressParts([
      reservation.deliveryPostalCode,
      reservation.deliveryCity,
    ]),
    reservation.deliveryCountry,
  ]);
}

function formatReturnAddress(
  reservation: typeof reservations.$inferSelect,
): string | null {
  return joinAddressParts([
    reservation.returnAddress,
    joinAddressParts([reservation.returnPostalCode, reservation.returnCity]),
    reservation.returnCountry,
  ]);
}

function hasOutboundDelivery(
  reservation: typeof reservations.$inferSelect,
): boolean {
  return (
    reservation.outboundMethod === 'address' ||
    (reservation.deliveryOption === 'delivery' &&
      Boolean(formatOutboundAddress(reservation)))
  );
}

function hasReturnCollection(
  reservation: typeof reservations.$inferSelect,
): boolean {
  return reservation.returnMethod === 'address';
}

function formatStoreLocationLabel(
  name: string | null | undefined,
  address: string | null,
): string {
  if (name && address) return `${name} - ${address}`;
  if (name) return name;
  if (address) return address;
  return 'Adresse magasin non renseignee';
}

function buildLogisticsLines({
  reservation,
  store,
}: {
  reservation: typeof reservations.$inferSelect;
  store: typeof stores.$inferSelect;
}): string[] {
  const outboundMethod = hasOutboundDelivery(reservation) ? 'address' : 'store';
  const returnMethod = hasReturnCollection(reservation) ? 'address' : 'store';
  const outboundAddress = formatOutboundAddress(reservation);
  const returnAddress = formatReturnAddress(reservation);
  const pickupLocationAddress =
    formatReservationLocationSnapshotAddress(
      reservation.pickupLocationSnapshot,
    ) ?? store.address;
  const returnLocationAddress =
    formatReservationLocationSnapshotAddress(
      reservation.returnLocationSnapshot,
    ) ?? store.address;

  const lines = ['Logistique:'];

  if (outboundMethod === 'address') {
    lines.push('Depart: LIVRAISON AU CLIENT');
    lines.push(
      `Adresse livraison: ${outboundAddress ?? 'Adresse livraison non renseignee'}`,
    );
  } else {
    lines.push('Depart: retrait magasin');
    lines.push(
      `Lieu retrait: ${formatStoreLocationLabel(
        reservation.pickupLocationSnapshot?.name ?? store.name,
        pickupLocationAddress,
      )}`,
    );
  }

  if (returnMethod === 'address') {
    lines.push('Retour: RECUPERATION CHEZ LE CLIENT');
    lines.push(
      `Adresse retour: ${returnAddress ?? 'Adresse retour non renseignee'}`,
    );
  } else {
    lines.push('Retour: retour magasin');
    lines.push(
      `Lieu retour: ${formatStoreLocationLabel(
        reservation.returnLocationSnapshot?.name ?? store.name,
        returnLocationAddress,
      )}`,
    );
  }

  if (reservation.deliveryFee && Number(reservation.deliveryFee) > 0) {
    lines.push(`Frais livraison: ${reservation.deliveryFee} EUR`);
  }

  return lines;
}

function buildSummaryPrefix(
  reservation: typeof reservations.$inferSelect,
): string | null {
  const isOutboundDelivery = hasOutboundDelivery(reservation);
  const isReturnCollection = hasReturnCollection(reservation);

  if (isOutboundDelivery && isReturnCollection) {
    return 'LIVRAISON + RETOUR CLIENT';
  }

  if (isOutboundDelivery) {
    return 'LIVRAISON';
  }

  if (isReturnCollection) {
    return 'RETOUR CLIENT';
  }

  return null;
}

function getReservationLocation(
  reservation: typeof reservations.$inferSelect,
): string | null {
  if (hasOutboundDelivery(reservation)) {
    return formatOutboundAddress(reservation);
  }

  if (hasReturnCollection(reservation)) {
    return formatReturnAddress(reservation);
  }

  return formatReservationLocationSnapshotAddress(
    reservation.pickupLocationSnapshot,
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get('store');
  const token = searchParams.get('token');

  if (!storeId || !token) {
    return new NextResponse('Missing parameters', { status: 400 });
  }

  // Verify store and token
  const store = await db.query.stores.findFirst({
    where: and(eq(stores.id, storeId), eq(stores.icsToken, token)),
  });

  if (!store) {
    return new NextResponse('Invalid store or token', { status: 401 });
  }

  // Get all reservations including cancelled/rejected (needed for proper ICS STATUS:CANCELLED)
  const storeReservations = await db.query.reservations.findMany({
    where: eq(reservations.storeId, storeId),
    with: {
      customer: true,
      items: {
        with: {
          product: true,
        },
      },
    },
    orderBy: (reservations, { desc }) => [desc(reservations.startDate)],
  });

  // Generate ICS content
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Louez//Calendar//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `REFRESH-INTERVAL;VALUE=DURATION:${CALENDAR_REFRESH_INTERVAL}`,
    `X-PUBLISHED-TTL:${CALENDAR_REFRESH_INTERVAL}`,
    `X-WR-CALNAME:${escapeICSText(store.name)} - Reservations`,
    `X-WR-TIMEZONE:Europe/Paris`,
  ];

  // Add events for each reservation
  for (const reservation of storeReservations) {
    const startDate = new Date(reservation.startDate);
    const endDate = new Date(reservation.endDate);
    const updatedAt = new Date(reservation.updatedAt);

    // Build product list
    const productNames = reservation.items
      .map((item) => {
        const name =
          item.productSnapshot?.name || item.product?.name || 'Unknown';
        return item.quantity > 1 ? `${name} (x${item.quantity})` : name;
      })
      .join(', ');

    // Build description
    const description = [
      ...buildLogisticsLines({ reservation, store }),
      '',
      `Client: ${reservation.customer.firstName} ${reservation.customer.lastName}`,
      reservation.customer.email
        ? `Email: ${reservation.customer.email}`
        : null,
      reservation.customer.phone ? `Tel: ${reservation.customer.phone}` : null,
      `Produits: ${productNames}`,
      `Total: ${reservation.totalAmount} EUR`,
      reservation.customerNotes
        ? `Notes client: ${reservation.customerNotes}`
        : null,
    ]
      .filter(Boolean)
      .join('\n');

    // Status emoji prefix for visual identification
    const statusEmoji: Record<string, string> = {
      pending: '[?]',
      confirmed: '[OK]',
      ongoing: '[>>]',
      completed: '[V]',
      cancelled: '[X]',
      rejected: '[X]',
    };

    const summaryPrefix = buildSummaryPrefix(reservation);
    const summaryPrefixText = summaryPrefix ? `${summaryPrefix} - ` : '';
    const summary = `${statusEmoji[reservation.status || 'pending']} ${summaryPrefixText}${reservation.customer.firstName} ${reservation.customer.lastName} - ${productNames}`;
    const location = getReservationLocation(reservation);

    const isCancelled =
      reservation.status === 'cancelled' || reservation.status === 'rejected';

    // RFC 5545 STATUS mapping
    let icsStatus: string;
    if (isCancelled) {
      icsStatus = 'CANCELLED';
    } else if (
      reservation.status === 'confirmed' ||
      reservation.status === 'ongoing' ||
      reservation.status === 'completed'
    ) {
      icsStatus = 'CONFIRMED';
    } else {
      icsStatus = 'TENTATIVE';
    }

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${reservation.id}@louez.io`);
    lines.push(`SEQUENCE:${getReservationSequence(updatedAt)}`);
    lines.push(`DTSTAMP:${formatICSDate(updatedAt)}`);
    lines.push(`LAST-MODIFIED:${formatICSDate(updatedAt)}`);
    lines.push(`DTSTART:${formatICSDate(startDate)}`);
    lines.push(`DTEND:${formatICSDate(endDate)}`);
    lines.push(foldLine(`SUMMARY:${escapeICSText(summary)}`));
    lines.push(foldLine(`DESCRIPTION:${escapeICSText(description)}`));
    if (location) {
      lines.push(foldLine(`LOCATION:${escapeICSText(location)}`));
    }
    lines.push(`STATUS:${icsStatus}`);
    lines.push(`TRANSP:${isCancelled ? 'TRANSPARENT' : 'OPAQUE'}`);

    // Add URL to reservation details
    const baseUrl = env.NEXT_PUBLIC_APP_URL;
    lines.push(`URL:${baseUrl}/dashboard/reservations/${reservation.id}`);

    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  // Join with CRLF as per ICS spec
  const icsContent = lines.join('\r\n');
  const etag = buildWeakEtag(icsContent);
  const lastModifiedAt = storeReservations.reduce<Date>(
    (latest, reservation) => {
      const updatedAt = new Date(reservation.updatedAt);
      return updatedAt > latest ? updatedAt : latest;
    },
    new Date(store.updatedAt),
  );
  const sharedHeaders = {
    'Cache-Control': 'private, no-cache, max-age=0, must-revalidate',
    'CDN-Cache-Control': 'no-store',
    'Vercel-CDN-Cache-Control': 'no-store',
    Pragma: 'no-cache',
    Expires: '0',
    ETag: etag,
    'Last-Modified': lastModifiedAt.toUTCString(),
    'X-Robots-Tag': 'noindex, nofollow',
  };

  if (requestHasMatchingEtag(request, etag)) {
    return new NextResponse(null, {
      status: 304,
      headers: sharedHeaders,
    });
  }

  return new NextResponse(icsContent, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${store.slug}-calendar.ics"`,
      ...sharedHeaders,
    },
  });
}
