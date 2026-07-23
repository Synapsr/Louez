'use client'

import { useQuery } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import { Coins, Loader2, Phone } from 'lucide-react'

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetTitle,
} from '@louez/ui'

import {
  AdvisorCollectedData,
  AdvisorTranscriptMessages,
} from '@/components/dashboard/advisor-transcript'
import { CallRecordingPlayer } from '@/components/dashboard/call-recording-player'
import { orpc } from '@/lib/orpc/react'

/** mm:ss for a call/recording length in whole seconds. */
function formatCallDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

interface AdvisorConversationSheetProps {
  /** Conversation to show; null keeps the sheet closed. */
  conversationId: string | null
  onOpenChange: (open: boolean) => void
}

/**
 * The one conversation detail view: transcript, collected facts, and — for
 * phone calls — the call meta and recording player. Shared by the AI
 * assistant's conversations list and the reservation detail card, so a call
 * replays identically wherever it is opened from.
 */
export const AdvisorConversationSheet = ({
  conversationId,
  onOpenChange,
}: AdvisorConversationSheetProps) => {
  const t = useTranslations('dashboard.settings.aiAdvisor.conversations')
  const format = useFormatter()

  const transcriptQuery = useQuery({
    ...orpc.dashboard.aiAdvisor.getConversation.queryOptions({
      input: { conversationId: conversationId ?? '' },
    }),
    enabled: conversationId !== null,
  })

  const transcript = transcriptQuery.data

  return (
    <Sheet
      open={conversationId !== null}
      onOpenChange={(open) => {
        if (!open) onOpenChange(false)
      }}
    >
      <SheetContent side="right" className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{t('transcriptTitle')}</SheetTitle>
          {transcript && (
            <SheetDescription>
              {transcript.customerName ? `${transcript.customerName} · ` : ''}
              {format.dateTime(new Date(transcript.createdAt), {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </SheetDescription>
          )}
        </SheetHeader>
        <SheetPanel className="space-y-6">
          {transcriptQuery.isPending ? (
            <div className="flex justify-center py-10">
              <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
            </div>
          ) : transcript ? (
            <>
              {transcript.creditsUsed > 0 && (
                <div className="text-muted-foreground flex items-center gap-2 text-sm tabular-nums">
                  <Coins className="h-4 w-4 shrink-0" />
                  <span>
                    {t('creditsUsed', {
                      count: Math.round(transcript.creditsUsed * 10) / 10,
                    })}
                  </span>
                </div>
              )}
              {transcript.channel === 'phone' && (
                <div className="space-y-3">
                  <div className="text-muted-foreground flex items-center gap-2 text-sm">
                    <Phone className="h-4 w-4 shrink-0" />
                    <span>
                      {t('channelPhone')}
                      {transcript.durationSeconds
                        ? ` · ${formatCallDuration(transcript.durationSeconds)}`
                        : ''}
                    </span>
                  </div>
                  {transcript.hasRecording && (
                    <CallRecordingPlayer
                      conversationId={transcript.id}
                      durationSeconds={transcript.recordingDurationSeconds}
                    />
                  )}
                </div>
              )}
              <AdvisorCollectedData collectedData={transcript.collectedData} />
              <AdvisorTranscriptMessages messages={transcript.messages} />
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              {t('transcriptError')}
            </p>
          )}
        </SheetPanel>
      </SheetContent>
    </Sheet>
  )
}
