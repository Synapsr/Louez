'use client'

import { ReactNode } from 'react'
import { ReservationPollingProvider as Provider } from '@/contexts/reservation-polling-context'

interface ReservationPollingWrapperProps {
  children: ReactNode
  interval?: number
}

// Re-export the provider for backward compatibility
export function ReservationPollingProvider({
  children,
  interval = 30000,
}: ReservationPollingWrapperProps) {
  return (
    <Provider interval={interval} playSound={true}>
      {children}
    </Provider>
  )
}
