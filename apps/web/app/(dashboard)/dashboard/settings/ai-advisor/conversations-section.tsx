'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MessagesSquare,
} from 'lucide-react'

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  TabsTab,
} from '@louez/ui'
import { cn } from '@louez/utils'
import { orpc } from '@/lib/orpc/react'

const PAGE_SIZE = 20

type ConversationFilter = 'all' | 'converted' | 'not_converted'

export const AdvisorConversationsSection = () => {
  const t = useTranslations('dashboard.settings.aiAdvisor.conversations')
  const format = useFormatter()

  const [filter, setFilter] = useState<ConversationFilter>('all')
  const [page, setPage] = useState(1)
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null)

  const conversationsQuery = useQuery({
    ...orpc.dashboard.aiAdvisor.listConversations.queryOptions({
      input: { filter, page, pageSize: PAGE_SIZE },
    }),
    placeholderData: (previousData) => previousData,
  })

  const transcriptQuery = useQuery({
    ...orpc.dashboard.aiAdvisor.getConversation.queryOptions({
      input: { conversationId: selectedConversationId ?? '' },
    }),
    enabled: selectedConversationId !== null,
  })

  const conversations = conversationsQuery.data?.conversations ?? []
  const totalCount = conversationsQuery.data?.totalCount ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  const handleFilterChange = (value: unknown) => {
    if (value === 'all' || value === 'converted' || value === 'not_converted') {
      setFilter(value)
      setPage(1)
    }
  }

  const transcript = transcriptQuery.data
  const summary = transcript?.collectedData?.summary
  const collectedEntries = transcript?.collectedData
    ? Object.entries(transcript.collectedData).filter(
        ([key]) => key !== 'summary',
      )
    : []

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessagesSquare className="h-5 w-5" />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={filter} onValueChange={handleFilterChange}>
          <TabsList>
            <TabsTab value="all">{t('filterAll')}</TabsTab>
            <TabsTab value="converted">{t('filterConverted')}</TabsTab>
            <TabsTab value="not_converted">{t('filterNotConverted')}</TabsTab>
          </TabsList>
        </Tabs>

        {conversationsQuery.isPending ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
            <Bot className="h-12 w-12 text-muted-foreground/50" />
            <h3 className="mt-4 text-lg font-semibold">{t('empty')}</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {filter === 'all'
                ? t('emptyDescription')
                : t('emptyFilteredDescription')}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('columnDate')}</TableHead>
                  <TableHead>{t('columnFirstMessage')}</TableHead>
                  <TableHead className="text-center">
                    {t('columnMessages')}
                  </TableHead>
                  <TableHead>{t('columnStatus')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {conversations.map((conversation) => (
                  <TableRow
                    key={conversation.id}
                    className="cursor-pointer"
                    onClick={() => setSelectedConversationId(conversation.id)}
                  >
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {format.dateTime(new Date(conversation.createdAt), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </TableCell>
                    <TableCell className="max-w-[280px]">
                      <p className="truncate text-sm">
                        {conversation.firstUserMessage || '—'}
                      </p>
                      {conversation.customerName && (
                        <p className="truncate text-xs text-muted-foreground">
                          {conversation.customerName}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary">
                        {conversation.messageCount}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {conversation.reservationId ? (
                        <Badge
                          variant="success"
                          render={
                            <Link
                              href={`/dashboard/reservations/${conversation.reservationId}`}
                              onClick={(e) => e.stopPropagation()}
                            />
                          }
                        >
                          {conversation.reservationNumber ||
                            t('statusConverted')}
                        </Badge>
                      ) : conversation.validatedAt ? (
                        <Badge variant="info">{t('statusValidated')}</Badge>
                      ) : (
                        <Badge variant="outline">
                          {t('statusNotConverted')}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {totalCount > PAGE_SIZE && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {t('pagination', { page, totalPages })}
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                aria-label={t('previousPage')}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                aria-label={t('nextPage')}
                onClick={() =>
                  setPage((current) => Math.min(totalPages, current + 1))
                }
                disabled={page >= totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      <Sheet
        open={selectedConversationId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedConversationId(null)
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
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : transcript ? (
              <>
                {(summary || collectedEntries.length > 0) && (
                  <div className="space-y-3 rounded-lg bg-muted/50 p-4">
                    {summary && <p className="text-sm">{summary}</p>}
                    {collectedEntries.length > 0 && (
                      <dl className="grid gap-1.5">
                        {collectedEntries.map(([key, value]) => (
                          <div
                            key={key}
                            className="flex items-baseline gap-2 text-sm"
                          >
                            <dt className="shrink-0 font-medium text-muted-foreground">
                              {key}
                            </dt>
                            <dd className="min-w-0 break-words">{value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </div>
                )}

                <div className="space-y-3">
                  {transcript.messages.map((message) => (
                    <div
                      key={message.id}
                      className={cn(
                        'flex',
                        message.role === 'user'
                          ? 'justify-end'
                          : 'justify-start',
                      )}
                    >
                      <div
                        className={cn(
                          'max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm',
                          message.role === 'user'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted',
                        )}
                      >
                        {message.content}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t('transcriptError')}
              </p>
            )}
          </SheetPanel>
        </SheetContent>
      </Sheet>
    </Card>
  )
}
