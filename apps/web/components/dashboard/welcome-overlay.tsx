'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import confetti from 'canvas-confetti'
import { cn } from '@louez/utils'

/**
 * Animation phases for the welcome overlay
 */
type AnimationPhase =
  | 'hidden'
  | 'entering'
  | 'welcome'
  | 'subtitle'
  | 'pause'
  | 'exiting'
  | 'complete'

/**
 * Animation timing configuration (in milliseconds)
 */
const TIMING = {
  WELCOME_START: 300,
  SUBTITLE_START: 1300,
  PAUSE_START: 2500,
  CONFETTI_START: 2700,
  EXIT_START: 3700,
  COMPLETE: 4700,
} as const

/**
 * Confetti configuration
 */
const CONFETTI_CONFIG = {
  DURATION: 1300,
  COLORS: ['#6366f1', '#8b5cf6', '#5082ef', '#723fed', '#2563eb'] as string[],
  PARTICLE_COUNT: 3,
  SPREAD: 55,
  Z_INDEX: 9999,
}

const STORAGE_KEY = 'louez-show-welcome'

/**
 * Check if welcome animation should be triggered
 * Priority: sessionStorage (from onboarding) > URL param (direct access)
 */
function shouldShowWelcome(): boolean {
  if (typeof window === 'undefined') return false

  // Check sessionStorage first (set by onboarding completion)
  if (sessionStorage.getItem(STORAGE_KEY) === '1') {
    sessionStorage.removeItem(STORAGE_KEY)
    return true
  }

  // Fallback to URL param (for direct access or bookmarks)
  const params = new URLSearchParams(window.location.search)
  if (params.get('welcome') === '1') {
    // Clean up URL
    const url = new URL(window.location.href)
    url.searchParams.delete('welcome')
    window.history.replaceState(null, '', url.pathname + url.search)
    return true
  }

  return false
}

/**
 * WelcomeOverlay - Premium onboarding animation
 *
 * Displays a full-screen welcome animation after store creation,
 * inspired by Apple's "Hello" first-boot experience.
 *
 * Triggered by:
 * 1. sessionStorage flag (set by onboarding completion) - primary
 * 2. `?welcome=1` URL parameter (for direct access) - fallback
 *
 * Supports keyboard shortcuts (Escape/Enter/Space) and click to skip.
 * Respects user's reduced motion preferences.
 */
export function WelcomeOverlay() {
  const t = useTranslations('welcome')

  // State - start hidden, check trigger in useEffect (SSR-safe)
  const [phase, setPhase] = useState<AnimationPhase>('hidden')

  // Refs
  const timersRef = useRef<NodeJS.Timeout[]>([])
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const hasCheckedTriggerRef = useRef(false)
  const hasStartedAnimationRef = useRef(false)

  /**
   * Clear all pending animation timers
   */
  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
  }, [])

  /**
   * Play the welcome audio
   */
  const playAudio = useCallback(() => {
    audioRef.current?.play().catch(() => {
      // Autoplay may be blocked by browser policy
    })
  }, [])

  /**
   * Trigger celebration confetti from both sides of the screen
   */
  const triggerConfetti = useCallback(() => {
    const end = Date.now() + CONFETTI_CONFIG.DURATION

    const frame = () => {
      confetti({
        particleCount: CONFETTI_CONFIG.PARTICLE_COUNT,
        angle: 60,
        spread: CONFETTI_CONFIG.SPREAD,
        origin: { x: 0, y: 0.7 },
        colors: CONFETTI_CONFIG.COLORS,
        zIndex: CONFETTI_CONFIG.Z_INDEX,
      })
      confetti({
        particleCount: CONFETTI_CONFIG.PARTICLE_COUNT,
        angle: 120,
        spread: CONFETTI_CONFIG.SPREAD,
        origin: { x: 1, y: 0.7 },
        colors: CONFETTI_CONFIG.COLORS,
        zIndex: CONFETTI_CONFIG.Z_INDEX,
      })

      if (Date.now() < end) {
        requestAnimationFrame(frame)
      }
    }

    frame()
  }, [])

  /**
   * Skip the animation and go directly to completion
   */
  const skip = useCallback(() => {
    if (phase === 'hidden' || phase === 'complete') return
    clearTimers()
    triggerConfetti()
    setPhase('complete')
  }, [phase, clearTimers, triggerConfetti])

  // Preload audio on mount
  useEffect(() => {
    const audio = new Audio('/sounds/welcome.mp3')
    audio.volume = 0.5
    audio.preload = 'auto'
    audioRef.current = audio

    return () => {
      audio.pause()
      audio.src = ''
    }
  }, [])

  // Check for welcome trigger on client mount (SSR-safe)
  useEffect(() => {
    if (hasCheckedTriggerRef.current) return
    hasCheckedTriggerRef.current = true

    if (shouldShowWelcome()) {
      setPhase('entering')
    }
  }, [])

  // Run animation sequence once when phase is 'entering'
  useEffect(() => {
    if (phase !== 'entering') return
    if (hasStartedAnimationRef.current) return

    hasStartedAnimationRef.current = true

    // Respect reduced motion preference
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      triggerConfetti()
      setPhase('complete')
      return
    }

    // Schedule animation phases
    timersRef.current.push(
      setTimeout(() => {
        setPhase('welcome')
        playAudio()
      }, TIMING.WELCOME_START),

      setTimeout(() => setPhase('subtitle'), TIMING.SUBTITLE_START),
      setTimeout(() => setPhase('pause'), TIMING.PAUSE_START),
      setTimeout(triggerConfetti, TIMING.CONFETTI_START),
      setTimeout(() => setPhase('exiting'), TIMING.EXIT_START),
      setTimeout(() => setPhase('complete'), TIMING.COMPLETE)
    )
  }, [phase, playAudio, triggerConfetti])

  // Cleanup timers on unmount only
  useEffect(() => {
    return () => clearTimers()
  }, [clearTimers])

  // Keyboard shortcuts to skip
  useEffect(() => {
    if (phase === 'hidden' || phase === 'complete') return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        skip()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [phase, skip])

  // Don't render when inactive
  if (phase === 'hidden' || phase === 'complete') {
    return null
  }

  return (
    <div
      className={cn(
        'welcome-overlay',
        phase === 'entering' && 'welcome-overlay--entering',
        phase === 'exiting' && 'welcome-overlay--exiting'
      )}
      onClick={skip}
      role="dialog"
      aria-modal="true"
      aria-label={t('greeting')}
    >
      <div className="welcome-overlay__content">
        <h1
          className={cn(
            'welcome-overlay__title',
            (phase === 'welcome' || phase === 'subtitle' || phase === 'pause') &&
              'welcome-overlay__title--visible',
            phase === 'exiting' && 'welcome-overlay__title--exiting'
          )}
        >
          {t('greeting')}
        </h1>

        <p
          className={cn(
            'welcome-overlay__subtitle',
            (phase === 'subtitle' || phase === 'pause') &&
              'welcome-overlay__subtitle--visible',
            phase === 'exiting' && 'welcome-overlay__subtitle--exiting'
          )}
        >
          {t('tagline')}
        </p>
      </div>

      <div
        className={cn(
          'welcome-overlay__skip',
          (phase === 'subtitle' || phase === 'pause') && 'welcome-overlay__skip--visible'
        )}
      >
        {t('skip')}
      </div>
    </div>
  )
}
