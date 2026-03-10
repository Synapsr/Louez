'use client'

import { useCallback, useEffect, useImperativeHandle, useState, useTransition } from 'react'
import type { Ref } from 'react'

import { MessageSquare, Plus } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@louez/ui'
import { cn } from '@louez/utils'

import {
  listChats,
  type ChatSummary,
} from '@/app/(dashboard)/dashboard/ai-chat-actions'

export type ChatHistoryHandle = {
  refresh: () => void
}

type ChatHistoryProps = {
  ref?: Ref<ChatHistoryHandle>
  activeChatId: string | null
  onSelectChat: (chatId: string) => void
  onNewChat: () => void
  open: boolean
}

/** Group conversations by relative date: today, yesterday, previous 7 days, older. */
function groupByDate(
  chats: ChatSummary[],
  labels: { today: string; yesterday: string; week: string; older: string },
) {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterdayStart = new Date(todayStart.getTime() - 86_400_000)
  const weekStart = new Date(todayStart.getTime() - 7 * 86_400_000)

  const groups: { label: string; items: ChatSummary[] }[] = []
  const buckets = new Map<string, ChatSummary[]>()

  for (const chat of chats) {
    const t = new Date(chat.updatedAt).getTime()
    let label: string
    if (t >= todayStart.getTime()) label = labels.today
    else if (t >= yesterdayStart.getTime()) label = labels.yesterday
    else if (t >= weekStart.getTime()) label = labels.week
    else label = labels.older

    if (!buckets.has(label)) buckets.set(label, [])
    buckets.get(label)!.push(chat)
  }

  // Maintain order: today → yesterday → week → older
  for (const label of [labels.today, labels.yesterday, labels.week, labels.older]) {
    const items = buckets.get(label)
    if (items?.length) groups.push({ label, items })
  }

  return groups
}

export function ChatHistory({
  ref,
  activeChatId,
  onSelectChat,
  onNewChat,
  open,
}: ChatHistoryProps) {
  const t = useTranslations('dashboard.aiChat')
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [isPending, startTransition] = useTransition()

  const fetchChats = useCallback(() => {
    startTransition(async () => {
      const result = await listChats()
      if (result.chats) setChats(result.chats)
    })
  }, [])

  // Expose refresh to parent
  useImperativeHandle(ref, () => ({ refresh: fetchChats }), [fetchChats])

  // Fetch on open
  useEffect(() => {
    if (open) fetchChats()
  }, [open, fetchChats])

  const groups = groupByDate(chats, {
    today: t('history.today'),
    yesterday: t('history.yesterday'),
    week: t('history.week'),
    older: t('history.older'),
  })

  return (
    <div
      className={cn(
        'flex h-full flex-col border-r border-border/50 bg-muted/30',
        'transition-[width,opacity] duration-200 ease-out',
        open ? 'w-64 opacity-100' : 'w-0 overflow-hidden opacity-0',
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3">
        <span className="text-xs font-medium text-muted-foreground">
          {t('history.title')}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
          onClick={onNewChat}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {isPending && chats.length === 0 ? (
          <div className="space-y-2 px-1 pt-1">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-9 animate-pulse rounded-lg bg-muted/60"
              />
            ))}
          </div>
        ) : chats.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
            <MessageSquare className="mb-2 h-5 w-5 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">
              {t('history.empty')}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <div key={group.label}>
                <p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {group.items.map((chat) => (
                    <button
                      key={chat.id}
                      type="button"
                      onClick={() => onSelectChat(chat.id)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors',
                        chat.id === activeChatId
                          ? 'bg-primary/10 text-foreground'
                          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {chat.title}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
