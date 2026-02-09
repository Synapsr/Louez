'use client'

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useCallback,
  useState,
  ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'
import { toastManager } from '@louez/ui'
import { useTranslations } from 'next-intl'

interface PollResponse {
  pendingCount: number
  totalCount: number
  latestReservation: {
    id: string
    number: string
    status: string
    createdAt: string
  } | null
  timestamp: string
}

interface ReservationPollingContextValue {
  pendingCount: number
  isPolling: boolean
  lastUpdated: Date | null
  refresh: () => Promise<void>
}

const ReservationPollingContext = createContext<ReservationPollingContextValue | null>(null)

interface ReservationPollingProviderProps {
  children: ReactNode
  /** Polling interval in milliseconds (default: 30000 = 30 seconds) */
  interval?: number
  /** Whether to play sound on new reservation (default: true) */
  playSound?: boolean
  /** Sound file path (default: /sounds/notification.mp3) */
  soundPath?: string
}

export function ReservationPollingProvider({
  children,
  interval = 30000,
  playSound = true,
  soundPath = '/sounds/notification.mp3',
}: ReservationPollingProviderProps) {
  const router = useRouter()
  const t = useTranslations('dashboard.notifications')

  const [pendingCount, setPendingCount] = useState(0)
  const [isPolling, setIsPolling] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const lastReservationIdRef = useRef<string | null>(null)
  const lastTotalCountRef = useRef<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const isFirstPollRef = useRef(true)

  // Initialize audio element
  useEffect(() => {
    if (playSound && typeof window !== 'undefined') {
      audioRef.current = new Audio(soundPath)
      audioRef.current.volume = 0.5
    }
    return () => {
      audioRef.current = null
    }
  }, [playSound, soundPath])

  const playNotificationSound = useCallback(() => {
    if (audioRef.current && playSound) {
      audioRef.current.currentTime = 0
      audioRef.current.play().catch((error) => {
        console.debug('Could not play notification sound:', error)
      })
    }
  }, [playSound])

  const poll = useCallback(async () => {
    try {
      setIsPolling(true)
      const response = await fetch('/api/reservations/poll', {
        method: 'GET',
        cache: 'no-store',
      })

      if (!response.ok) return

      const data: PollResponse = await response.json()

      // Always update pending count
      setPendingCount(data.pendingCount)
      setLastUpdated(new Date())

      // On first poll, just store the reference values
      if (isFirstPollRef.current) {
        lastReservationIdRef.current = data.latestReservation?.id || null
        lastTotalCountRef.current = data.totalCount
        isFirstPollRef.current = false
        return
      }

      // Check if there's a new reservation
      const hasNewReservation =
        data.latestReservation &&
        lastReservationIdRef.current !== data.latestReservation.id &&
        data.totalCount > (lastTotalCountRef.current || 0)

      if (hasNewReservation) {
        // Update references
        lastReservationIdRef.current = data.latestReservation!.id
        lastTotalCountRef.current = data.totalCount

        // Play sound
        playNotificationSound()

        // Show toast notification
        toastManager.add({
          title: t('newReservation', { number: data.latestReservation!.number }),
          description: t('newReservationDescription'),
          type: 'info',
          duration: 10000,
        })

        // Refresh the page data
        router.refresh()
      }
    } catch (error) {
      console.debug('Polling error:', error)
    } finally {
      setIsPolling(false)
    }
  }, [router, playNotificationSound, t])

  const refresh = useCallback(async () => {
    await poll()
  }, [poll])

  useEffect(() => {
    // Initial poll
    poll()

    // Set up interval
    const intervalId = setInterval(poll, interval)

    return () => {
      clearInterval(intervalId)
    }
  }, [poll, interval])

  return (
    <ReservationPollingContext.Provider
      value={{
        pendingCount,
        isPolling,
        lastUpdated,
        refresh,
      }}
    >
      {children}
    </ReservationPollingContext.Provider>
  )
}

export function useReservationPolling() {
  const context = useContext(ReservationPollingContext)
  if (!context) {
    throw new Error('useReservationPolling must be used within a ReservationPollingProvider')
  }
  return context
}
