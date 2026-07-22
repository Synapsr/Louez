'use client'

import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { CheckCircle2, Circle, Loader2, Pause, Play } from 'lucide-react'

import { Badge, Button, Label } from '@louez/ui'
import { cn } from '@louez/utils'

import { listVoiceOptions } from './voice-catalog-actions'

interface VoicePickerProps {
  value: string
  onChange: (voiceId: string) => void
  /** App locale — the preview is generated in this language when possible. */
  language: string
}

export const VoicePicker = ({
  value,
  onChange,
  language,
}: VoicePickerProps) => {
  const t = useTranslations('dashboard.settings.aiVoiceAgent')

  const [gender, setGender] = useState<'female' | 'male' | null>(null)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const query = useQuery({
    queryKey: ['voice-options'],
    queryFn: listVoiceOptions,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  const data = query.data
  const voices = data && 'voices' in data ? data.voices : []
  const previewEnabled =
    data && 'previewEnabled' in data ? data.previewEnabled : false

  const genders = Array.from(new Set(voices.map((v) => v.gender)))
  const showGenderFilter = genders.length > 1
  const filtered = gender ? voices.filter((v) => v.gender === gender) : voices

  const stop = () => {
    audioRef.current?.pause()
    audioRef.current = null
    setPlayingId(null)
    setLoadingId(null)
  }

  const togglePreview = (voiceId: string) => {
    if (playingId === voiceId || loadingId === voiceId) {
      stop()
      return
    }
    stop()
    const audio = new Audio(
      `/api/voice/preview?voiceId=${encodeURIComponent(
        voiceId,
      )}&language=${encodeURIComponent(language)}`,
    )
    audioRef.current = audio
    setLoadingId(voiceId)
    audio.onplaying = () => {
      setLoadingId(null)
      setPlayingId(voiceId)
    }
    audio.onended = () => setPlayingId(null)
    audio.onerror = () => {
      setLoadingId(null)
      setPlayingId(null)
    }
    void audio.play().catch(() => {
      setLoadingId(null)
      setPlayingId(null)
    })
  }

  if (query.isPending) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('voice')}
      </div>
    )
  }

  // No voices configured (no ElevenLabs key and no catalog): the agent uses the
  // operator's default voice, so there is nothing to pick.
  if (voices.length === 0) return null

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label>{t('voice')}</Label>
        {showGenderFilter && (
          <div className="flex gap-1">
            {([null, 'female', 'male'] as const).map((option) => {
              if (option !== null && !genders.includes(option)) return null
              return (
                <Button
                  key={option ?? 'all'}
                  type="button"
                  size="sm"
                  variant={gender === option ? 'default' : 'outline'}
                  onClick={() => setGender(option)}
                >
                  {option === null
                    ? t('voiceGender.all')
                    : t(`voiceGender.${option}`)}
                </Button>
              )
            })}
          </div>
        )}
      </div>

      <div className="max-h-64 divide-y overflow-y-auto rounded-lg border">
        {filtered.map((voice) => (
          <div
            key={voice.id}
            className={cn(
              'flex items-center justify-between gap-2 p-2.5',
              value === voice.id && 'bg-accent/50',
            )}
          >
            <button
              type="button"
              onClick={() => onChange(voice.id)}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              {value === voice.id ? (
                <CheckCircle2 className="text-primary h-4 w-4 shrink-0" />
              ) : (
                <Circle className="text-muted-foreground h-4 w-4 shrink-0" />
              )}
              <span className="truncate text-sm font-medium">
                {voice.label}
              </span>
              <span className="text-muted-foreground shrink-0 text-xs">
                {t(`voiceGender.${voice.gender}`)}
              </span>
              {voice.recommended && (
                <Badge variant="info" className="shrink-0">
                  {t('voiceRecommended')}
                </Badge>
              )}
            </button>
            {previewEnabled && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('voicePreview')}
                onClick={() => togglePreview(voice.id)}
              >
                {loadingId === voice.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : playingId === voice.id ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
              </Button>
            )}
          </div>
        ))}
      </div>

      <p className="text-muted-foreground text-sm">{t('voiceDescription')}</p>
    </div>
  )
}
