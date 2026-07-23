'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MessagesSquare,
  Phone,
} from 'lucide-react'

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
import type { AdvisorConversationFilter } from '@louez/validations'

import { AdvisorConversationSheet } from '@/components/dashboard/advisor-conversation-sheet'
import { orpc } from '@/lib/orpc/react'

const PAGE_SIZE = 20

export const AdvisorConversationsSection = () => {
  const t = useTranslations('dashboard.settings.aiAdvisor.conversations')
  const format = useFormatter()
  const searchParams = useSearchParams()

  const [filter, setFilter] = useState<AdvisorConversationFilter>('all')
  const [page, setPage] = useState(1)
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null)

  // Deep link (e.g. from the owner callback email): ?conversation=<id> opens
  // that call directly so the owner can read it and replay the recording.
  useEffect(() => {
    const id = searchParams.get('conversation')
    if (id) setSelectedConversationId(id)
  }, [searchParams])

  const conversationsQuery = useQuery({
    ...orpc.dashboard.aiAdvisor.listConversations.queryOptions({
      input: { filter, page, pageSize: PAGE_SIZE },
    }),
    placeholderData: (previousData) => previousData,
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
                      <div className="flex items-center gap-2">
                        {conversation.channel === 'phone' ? (
                          <Phone
                            className="h-4 w-4 shrink-0 text-muted-foreground"
                            aria-label={t('channelPhone')}
                          />
                        ) : (
                          <MessagesSquare
                            className="h-4 w-4 shrink-0 text-muted-foreground"
                            aria-label={t('channelWeb')}
                          />
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-sm">
                            {conversation.firstUserMessage ||
                              (conversation.channel === 'phone'
                                ? t('channelPhone')
                                : '—')}
                          </p>
                          {conversation.customerName && (
                            <p className="truncate text-xs text-muted-foreground">
                              {conversation.customerName}
                            </p>
                          )}
                        </div>
                      </div>
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

      <AdvisorConversationSheet
        conversationId={selectedConversationId}
        onOpenChange={(open) => {
          if (!open) setSelectedConversationId(null)
        }}
      />
    </Card>
  )
}
