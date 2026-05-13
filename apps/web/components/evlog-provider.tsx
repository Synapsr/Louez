'use client'

import { EvlogProvider as NextEvlogProvider } from 'evlog/next/client'

interface EvlogProviderProps {
  children: React.ReactNode
}

export const EvlogProvider = ({ children }: EvlogProviderProps) => {
  return (
    <NextEvlogProvider
      service="louez-web-client"
      transport={{
        enabled: true,
        endpoint: '/api/evlog/ingest',
        credentials: 'same-origin',
      }}
    >
      {children}
    </NextEvlogProvider>
  )
}
