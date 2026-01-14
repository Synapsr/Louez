'use client'

import { useEffect } from 'react'
import Gleap from 'gleap'

export function GleapProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GLEAP_API_KEY

    if (apiKey) {
      Gleap.initialize(apiKey)
    }
  }, [])

  return <>{children}</>
}
