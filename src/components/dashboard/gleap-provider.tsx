'use client'

import { useEffect } from 'react'
import Gleap from 'gleap'

interface GleapProviderProps {
  children: React.ReactNode
  user?: {
    id: string
    email: string
    name?: string | null
  }
}

export function GleapProvider({ children, user }: GleapProviderProps) {
  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GLEAP_API_KEY

    if (apiKey) {
      Gleap.initialize(apiKey)

      if (user) {
        Gleap.identify(user.id, {
          email: user.email,
          name: user.name || undefined,
        })
      }
    }
  }, [user])

  return <>{children}</>
}
