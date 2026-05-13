import { NextResponse } from 'next/server'
import { z } from 'zod'

import { createError, useLogger, withEvlog } from '@/lib/evlog'

const clientLogSchema = z
  .object({
    timestamp: z.union([z.string(), z.number()]),
    level: z.enum(['debug', 'info', 'warn', 'error']),
    service: z.string().optional(),
    message: z.string().optional(),
    tag: z.string().optional(),
  })
  .passthrough()

function validateOrigin(request: Request) {
  const origin = request.headers.get('origin')
  const referer = request.headers.get('referer')
  const host = request.headers.get('host')
  const requestOrigin = origin || (referer ? new URL(referer).origin : null)

  if (!host || !requestOrigin) {
    throw createError({
      status: 403,
      message: 'Client log rejected',
      why: 'The request is missing origin or host headers.',
      fix: 'Send client log events from the same application origin.',
    })
  }

  if (new URL(requestOrigin).host !== host) {
    throw createError({
      status: 403,
      message: 'Client log rejected',
      why: 'The request origin does not match the application host.',
      fix: 'Send client log events from the same application origin.',
    })
  }
}

async function ingestClientLog(request: Request) {
  validateOrigin(request)

  const body: unknown = await request.json()
  const result = clientLogSchema.safeParse(body)

  if (!result.success) {
    throw createError({
      status: 400,
      message: 'Invalid client log payload',
      why: result.error.message,
      fix: 'Send a client log payload with timestamp and level fields.',
    })
  }

  const logger = useLogger()
  const { service, ...payload } = result.data

  logger.set({
    source: 'client',
    clientLog: {
      service,
      ...payload,
    },
  })

  return new NextResponse(null, { status: 204 })
}

export const POST = withEvlog(ingestClientLog)
