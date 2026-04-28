'use client'

import { useEffect } from 'react'

type FhFn = ((...args: unknown[]) => void) & { q?: unknown[][] }

declare global {
  interface Window {
    fh?: FhFn
  }
}

interface FromHelloProviderProps {
  user?: {
    id: string
    email: string
    name?: string | null
  }
  store?: {
    name: string
    slug: string
    phone?: string | null
    email?: string | null
    plan?: string | null
  }
}

/**
 * fromHello engagement provider for client-side identity resolution.
 *
 * When a user prop is provided, identifies the user in fromHello and
 * sets profile attributes. This merges the anonymous profile
 * (created by the tracking snippet on previous pages) with the
 * authenticated user.
 *
 * The snippet loads with strategy="afterInteractive", which races
 * with this useEffect — at hydration time `window.fh` may not exist
 * yet. We seed `window.fh` as a queue stub so the identify/set calls
 * are buffered and replayed by the snippet when it loads (the
 * snippet replays `window.fh.q` on init).
 */
export function FromHelloProvider({ user, store }: FromHelloProviderProps) {
  useEffect(() => {
    if (!user || typeof window === 'undefined') return

    if (!window.fh) {
      const stub: FhFn = ((...args: unknown[]) => {
        ;(stub.q = stub.q || []).push(args)
      }) as FhFn
      stub.q = []
      window.fh = stub
    }

    window.fh('identify', user.id)
    window.fh('set', {
      email: user.email,
      name: user.name || undefined,
      ...(store && {
        company: store.name,
        companySlug: store.slug,
        ...(store.phone && { phone: store.phone }),
        ...(store.email && { companyEmail: store.email }),
        ...(store.plan && { plan: store.plan }),
      }),
    })
  }, [user, store])

  return null
}
