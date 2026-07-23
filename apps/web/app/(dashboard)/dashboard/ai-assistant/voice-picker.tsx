'use client'

import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  AudioLines,
  CheckCircle2,
  Circle,
  Loader2,
  Pause,
  Play,
  RotateCcw,
} from 'lucide-react'

import {
  Badge,
  Button,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  Label,
} from '@louez/ui'
import { cn } from '@louez/utils'

import { listVoiceOptions } from './voice-catalog-actions'

interface VoicePickerProps {
  value: string
  onChange: (voiceId: string) => void
  /** App locale — drives the preview language AND the recommended default. */
  language: string
}

/**
 * Compact voice control: a single row showing the voice in use (the operator's
 * per-language recommendation until the store picks one), with the full picker
 * (gender filter + audio previews) in a dedicated dialog — the settings form
 * stays short, choosing a voice becomes a focused moment.
 */
export const VoicePicker = ({ value, onChange, language }: VoicePickerProps) => {
  const t = useTranslations('dashboard.settings.aiVoiceAgent')

  const [modalOpen, setModalOpen] = useState(false)
  const [gender, setGender] = useState<'female' | 'male' | null>(null)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const query = useQuery({
    queryKey: ['voice-options', language],
    queryFn: () => listVoiceOptions(language),
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  const data = query.data
  const voices = data && 'voices' in data ? data.voices : []
  const previewEnabled =
    data && 'previewEnabled' in data ? data.previewEnabled : false
  const defaultVoiceId =
    data && 'defaultVoiceId' in data ? data.defaultVoiceId : null

  // The voice actually in use: the store's explicit pick, else the operator's
  // per-language default.
  const effectiveId = value || defaultVoiceId
  const effectiveVoice = voices.find((v) => v.id === effectiveId) ?? null
  const isUsingDefault = !value

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

  const closeModal = (open: boolean) => {
    if (!open) stop()
    setModalOpen(open)
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

  const previewButton = (voiceId: string) => (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={t('voicePreview')}
      onClick={() => togglePreview(voiceId)}
    >
      {loadingId === voiceId ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : playingId === voiceId ? (
        <Pause className="h-4 w-4" />
      ) : (
        <Play className="h-4 w-4" />
      )}
    </Button>
  )

  return (
    <div className="space-y-2">
      <Label>{t('voice')}</Label>

      {/* Current voice, one compact row */}
      <div className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="bg-primary/10 text-primary flex h-8 w-8 shrink-0 items-center justify-center rounded-md">
            <AudioLines className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">
                {effectiveVoice?.label ?? t('voiceModal.defaultVoice')}
              </span>
              {isUsingDefault && (
                <Badge variant="info" className="shrink-0 text-[10px]">
                  {t('voiceModal.defaultBadge')}
                </Badge>
              )}
            </div>
            {effectiveVoice && (
              <p className="text-muted-foreground text-xs">
                {t(`voiceGender.${effectiveVoice.gender}`)}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {previewEnabled && effectiveVoice && previewButton(effectiveVoice.id)}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setModalOpen(true)}
          >
            {t('voiceModal.change')}
          </Button>
        </div>
      </div>

      <p className="text-muted-foreground text-sm">{t('voiceDescription')}</p>

      {/* Full picker in a dedicated dialog */}
      <Dialog open={modalOpen} onOpenChange={closeModal}>
        <DialogPopup className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5">
              <div className="bg-primary/10 flex h-9 w-9 items-center justify-center rounded-lg">
                <AudioLines className="text-primary h-5 w-5" />
              </div>
              {t('voiceModal.title')}
            </DialogTitle>
            <DialogDescription>{t('voiceModal.description')}</DialogDescription>
          </DialogHeader>

          <DialogPanel>
            <div className="space-y-3 pt-1">
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

              <div className="max-h-72 divide-y overflow-y-auto rounded-lg border">
                {filtered.map((voice) => {
                  const isSelected = effectiveId === voice.id
                  return (
                    <div
                      key={voice.id}
                      className={cn(
                        'flex items-center justify-between gap-2 p-2.5',
                        isSelected && 'bg-accent/50',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => onChange(voice.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        {isSelected ? (
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
                      {previewEnabled && previewButton(voice.id)}
                    </div>
                  )
                })}
              </div>
            </div>
          </DialogPanel>

          <DialogFooter className="flex items-center justify-between gap-2">
            {!isUsingDefault ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5"
                onClick={() => onChange('')}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t('voiceModal.resetToRecommended')}
              </Button>
            ) : (
              <span />
            )}
            <Button type="button" onClick={() => closeModal(false)}>
              {t('voiceModal.done')}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  )
}
