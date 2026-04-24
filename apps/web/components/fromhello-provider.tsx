'use client'

import { useEffect } from 'react'

declare global {
  function fh(command: 'identify', profileId: string): void
  function fh(command: 'set', attributes: Record<string, unknown>): void
  function fh(command: 'track', event: string, properties?: Record<string, unknown>): void
  function fh(command: 'page', url?: string): void
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
 * When a user prop is provided, identifies the user in fromHello
 * and sets profile attributes. This merges the anonymous profile
 * (created by the tracking snippet) with the authenticated user.
 */
export function FromHelloProvider({ user, store }: FromHelloProviderProps) {
  useEffect(() => {
    if (typeof fh === 'undefined' || !user) return

    fh('identify', user.id)
    fh('set', {
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
