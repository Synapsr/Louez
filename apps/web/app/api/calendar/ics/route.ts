import { NextResponse } from 'next/server'
import { db } from '@louez/db'
import { stores, reservations } from '@louez/db'
import { eq, and } from 'drizzle-orm'
import { env } from '@/env'

// Format date to ICS format (YYYYMMDDTHHMMSS)
function formatICSDate(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return (
    date.getUTCFullYear().toString() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    'T' +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    'Z'
  )
}

// Escape special characters for ICS text fields
function escapeICSText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

// Fold long lines per ICS spec (max 75 octets per line)
function foldLine(line: string): string {
  const maxLength = 75
  if (line.length <= maxLength) return line

  const lines: string[] = []
  let remaining = line

  while (remaining.length > maxLength) {
    lines.push(remaining.substring(0, maxLength))
    remaining = ' ' + remaining.substring(maxLength)
  }
  lines.push(remaining)

  return lines.join('\r\n')
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const storeId = searchParams.get('store')
  const token = searchParams.get('token')

  if (!storeId || !token) {
    return new NextResponse('Missing parameters', { status: 400 })
  }

  // Verify store and token
  const store = await db.query.stores.findFirst({
    where: and(eq(stores.id, storeId), eq(stores.icsToken, token)),
  })

  if (!store) {
    return new NextResponse('Invalid store or token', { status: 401 })
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
  })

  // Generate ICS content
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Louez//Calendar//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeICSText(store.name)} - Reservations`,
    `X-WR-TIMEZONE:Europe/Paris`,
  ]

  // Add events for each reservation
  for (const reservation of storeReservations) {
    const startDate = new Date(reservation.startDate)
    const endDate = new Date(reservation.endDate)

    // Build product list
    const productNames = reservation.items
      .map((item) => {
        const name = item.productSnapshot?.name || item.product?.name || 'Unknown'
        return item.quantity > 1 ? `${name} (x${item.quantity})` : name
      })
      .join(', ')

    // Build description
    const description = [
      `Client: ${reservation.customer.firstName} ${reservation.customer.lastName}`,
      reservation.customer.email ? `Email: ${reservation.customer.email}` : null,
      reservation.customer.phone ? `Tel: ${reservation.customer.phone}` : null,
      `Produits: ${productNames}`,
      `Total: ${reservation.totalAmount} EUR`,
      reservation.customerNotes ? `Notes client: ${reservation.customerNotes}` : null,
    ]
      .filter(Boolean)
      .join('\\n')

    // Status emoji prefix for visual identification
    const statusEmoji: Record<string, string> = {
      pending: '[?]',
      confirmed: '[OK]',
      ongoing: '[>>]',
      completed: '[V]',
      cancelled: '[X]',
      rejected: '[X]',
    }

    const summary = `${statusEmoji[reservation.status || 'pending']} ${reservation.customer.firstName} ${reservation.customer.lastName} - ${productNames}`

    const isCancelled = reservation.status === 'cancelled' || reservation.status === 'rejected'

    // RFC 5545 STATUS mapping
    let icsStatus: string
    if (isCancelled) {
      icsStatus = 'CANCELLED'
    } else if (reservation.status === 'confirmed' || reservation.status === 'ongoing' || reservation.status === 'completed') {
      icsStatus = 'CONFIRMED'
    } else {
      icsStatus = 'TENTATIVE'
    }

    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${reservation.id}@louez.io`)
    lines.push(`SEQUENCE:${isCancelled ? 1 : 0}`)
    lines.push(`DTSTAMP:${formatICSDate(new Date())}`)
    lines.push(`LAST-MODIFIED:${formatICSDate(new Date(reservation.updatedAt))}`)
    lines.push(`DTSTART:${formatICSDate(startDate)}`)
    lines.push(`DTEND:${formatICSDate(endDate)}`)
    lines.push(foldLine(`SUMMARY:${escapeICSText(summary)}`))
    lines.push(foldLine(`DESCRIPTION:${description}`))
    lines.push(`STATUS:${icsStatus}`)
    lines.push(`TRANSP:${isCancelled ? 'TRANSPARENT' : 'OPAQUE'}`)

    // Add URL to reservation details
    const baseUrl = env.NEXT_PUBLIC_APP_URL
    lines.push(`URL:${baseUrl}/dashboard/reservations/${reservation.id}`)

    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')

  // Join with CRLF as per ICS spec
  const icsContent = lines.join('\r\n')

  return new NextResponse(icsContent, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${store.slug}-calendar.ics"`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  })
}
