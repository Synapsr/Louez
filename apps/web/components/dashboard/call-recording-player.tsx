'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2, Pause, Play, TriangleAlert } from 'lucide-react'

import { cn } from '@louez/utils'

/** mm:ss for a (possibly fractional) number of seconds. */
function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

type CallRecordingPlayerProps = {
  /** Conversation whose recording is streamed from the authed proxy route. */
  conversationId: string
  /** Known recording length (seconds), used before audio metadata loads. */
  durationSeconds: number | null
}

/**
 * Minimal, self-contained audio player for a call recording. The audio is
 * streamed on demand from /api/voice/recording/[conversationId] (session-authed,
 * store-scoped) — nothing is fetched until the merchant presses play.
 */
export const CallRecordingPlayer = ({
  conversationId,
  durationSeconds,
}: CallRecordingPlayerProps) => {
  const t = useTranslations('dashboard.settings.aiAdvisor.conversations.recording')
  const audioRef = useRef<HTMLAudioElement>(null)

  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [metaDuration, setMetaDuration] = useState(0)

  // The provider-reported recording length is authoritative. A streamed / Range
  // mp3 often reports a wrong (under-estimated) duration from its metadata, so
  // only fall back to it when the server value is missing.
  const total =
    durationSeconds && durationSeconds > 0 ? durationSeconds : metaDuration

  const toggle = () => {
    const audio = audioRef.current
    if (!audio) return
    if (error) {
      setError(false)
      audio.load()
    }
    if (audio.paused) {
      void audio.play().catch(() => setError(true))
    } else {
      audio.pause()
    }
  }

  const seek = (value: number) => {
    const audio = audioRef.current
    if (!audio || !Number.isFinite(value)) return
    audio.currentTime = value
    setCurrentTime(value)
  }

  const max = total

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2">
      <button
        type="button"
        onClick={toggle}
        aria-label={error ? t('retry') : playing ? t('pause') : t('play')}
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
          'bg-primary text-primary-foreground transition-opacity hover:opacity-90',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        {error ? (
          <TriangleAlert className="h-4 w-4" />
        ) : loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : playing ? (
          <Pause className="h-4 w-4" />
        ) : (
          <Play className="h-4 w-4 translate-x-[1px]" />
        )}
      </button>

      <input
        type="range"
        min={0}
        max={max || 1}
        step={0.1}
        value={Math.min(currentTime, max || 1)}
        onChange={(event) => seek(Number(event.target.value))}
        aria-label={t('seek')}
        disabled={error || max === 0}
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-primary disabled:cursor-not-allowed disabled:opacity-50"
      />

      <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
        {error ? t('error') : `${formatTime(currentTime)} / ${formatTime(max)}`}
      </span>

      <audio
        ref={audioRef}
        src={`/api/voice/recording/${conversationId}`}
        preload="none"
        onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration
          if (Number.isFinite(value) && value > 0) setMetaDuration(value)
        }}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onWaiting={() => setLoading(true)}
        onPlaying={() => setLoading(false)}
        onEnded={() => {
          setPlaying(false)
          setCurrentTime(0)
        }}
        onError={() => {
          setError(true)
          setPlaying(false)
          setLoading(false)
        }}
      />
    </div>
  )
}
