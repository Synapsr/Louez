import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { db, CORE_TABLES } from '@louez/db'

// [SE-01] Intentionally public: liveness/readiness probe for Docker,
// EasyPanel and Kubernetes. Takes no input and only reports a generic
// healthy/unhealthy status — no data, no schema details, no error internals.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// The schema can't disappear once verified — only re-check connectivity after
let schemaVerified = false

export async function GET() {
  try {
    if (schemaVerified) {
      await db.execute(sql`SELECT 1`)
    } else {
      const result = await db.execute(sql`
        SELECT COUNT(*) AS count FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${sql.join(
          CORE_TABLES.map((t) => sql`${t}`),
          sql`, `
        )})
      `)
      const rows = z.array(z.object({ count: z.coerce.number() })).parse(result[0])
      const count = rows[0]?.count ?? 0

      if (count < CORE_TABLES.length) {
        return NextResponse.json(
          {
            status: 'unhealthy',
            reason: 'database schema is missing core tables',
            timestamp: new Date().toISOString(),
          },
          { status: 503 }
        )
      }
      schemaVerified = true
    }

    return NextResponse.json(
      {
        status: 'healthy',
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    )
  } catch {
    return NextResponse.json(
      {
        status: 'unhealthy',
        reason: 'database unreachable',
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    )
  }
}
