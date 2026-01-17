'use client'

import { useEffect, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import confetti from 'canvas-confetti'

export function OnboardingCelebration() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const hasPlayed = useRef(false)

  useEffect(() => {
    const isWelcome = searchParams.get('welcome') === '1'

    if (isWelcome && !hasPlayed.current) {
      hasPlayed.current = true

      // Play celebration audio
      const audio = new Audio('/sounds/celebration.mp3')
      audio.volume = 0.5
      audio.play().catch(() => {
        // Audio autoplay might be blocked, that's ok
      })

      // Fire confetti from multiple angles
      const duration = 3000
      const end = Date.now() + duration

      const colors = ['#6366f1', '#8b5cf6', '#5082ef', '#723fed', '#2563eb']

      const frame = () => {
        confetti({
          particleCount: 3,
          angle: 60,
          spread: 55,
          origin: { x: 0, y: 0.7 },
          colors,
        })
        confetti({
          particleCount: 3,
          angle: 120,
          spread: 55,
          origin: { x: 1, y: 0.7 },
          colors,
        })

        if (Date.now() < end) {
          requestAnimationFrame(frame)
        }
      }

      frame()

      // Clean up URL without welcome param
      const newUrl = new URL(window.location.href)
      newUrl.searchParams.delete('welcome')
      router.replace(newUrl.pathname + newUrl.search, { scroll: false })
    }
  }, [searchParams, router])

  return null
}
