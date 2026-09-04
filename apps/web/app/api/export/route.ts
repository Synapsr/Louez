import { NextResponse } from 'next/server'
import { getCurrentStore } from '@/lib/store-context'
import { currentUserHasPermission } from '@/lib/store-context'
import { exportParamsSchema, type ExportParams } from '@/lib/export/types'
import { queryExportData } from '@/lib/export/queries'
import { generateCsv } from '@/lib/export/csv'
import { resolveStoreExportDateRange } from '@/lib/export/date-range'

export async function GET(request: Request) {
  const store = await getCurrentStore()
  if (!store) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const hasPermission = await currentUserHasPermission('manage_settings')
  if (!hasPermission) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  const url = new URL(request.url)
  const parsed = exportParamsSchema.safeParse({
    type: url.searchParams.get('type'),
    format: url.searchParams.get('format'),
    startDate: url.searchParams.get('startDate') || undefined,
    endDate: url.searchParams.get('endDate') || undefined,
  })

  if (!parsed.success) {
    return new NextResponse('Bad Request', { status: 400 })
  }

  const requestParams = parsed.data
  const dateRange =
    requestParams.startDate && requestParams.endDate
      ? resolveStoreExportDateRange(
          requestParams.startDate,
          requestParams.endDate,
          store.settings?.timezone
        )
      : {}
  const params: ExportParams = {
    type: requestParams.type,
    format: requestParams.format,
    ...dateRange,
  }
  const data = await queryExportData(store.id, params)

  // Build filename
  const datePart =
    requestParams.startDate && requestParams.endDate
      ? `-${requestParams.startDate}-to-${requestParams.endDate}`
      : ''
  const filename = `${sanitizeFilename(store.slug)}-${params.type}${datePart}.${params.format}`

  if (params.format === 'json') {
    return new NextResponse(JSON.stringify(data.json, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  }

  const csv = generateCsv(data.headers, data.rows)
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '-')
}
